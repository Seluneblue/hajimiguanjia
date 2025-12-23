import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import * as Icons from 'lucide-react';

// --- Constants & Configuration ---

// Helper to get API Key: Priority 1: LocalStorage (User set), Priority 2: Env Var (Dev/Preview)
const getApiKey = () => {
    if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('lifeos_google_api_key');
        if (stored && stored.trim() !== '') return stored;
    }
    // Safe access for process.env in browser environments if injected by build tool
    return typeof process !== 'undefined' ? process.env.API_KEY : undefined;
};

type GroupKey = 'life' | 'body' | 'work';

interface CategoryMeta {
  group: GroupKey;
  color: string;
  icon: string;
  label: string;
}

const BASE_CATEGORY_META: Record<string, CategoryMeta> = {
  // Life (日常)
  finance_tracking: { group: 'life', color: 'bg-emerald-500', icon: 'Wallet', label: '记账' },
  diary: { group: 'life', color: 'bg-indigo-500', icon: 'BookHeart', label: '日记/碎碎念' },
  study: { group: 'life', color: 'bg-blue-500', icon: 'GraduationCap', label: '学习' },
  entertainment: { group: 'life', color: 'bg-purple-500', icon: 'Gamepad2', label: '娱乐' },
  movie: { group: 'life', color: 'bg-pink-500', icon: 'Film', label: '观影' },
  reading: { group: 'life', color: 'bg-amber-600', icon: 'BookOpen', label: '读书' },
  dining: { group: 'life', color: 'bg-orange-500', icon: 'Utensils', label: '餐饮' },
  housework: { group: 'life', color: 'bg-cyan-600', icon: 'Home', label: '家务' },
  personal_care: { group: 'life', color: 'bg-rose-400', icon: 'Sparkles', label: '个人护理' },
  
  // Body (身体)
  exercise: { group: 'body', color: 'bg-orange-600', icon: 'Dumbbell', label: '锻炼' },
  sleep: { group: 'body', color: 'bg-slate-500', icon: 'Moon', label: '睡眠' },
  weight: { group: 'body', color: 'bg-lime-600', icon: 'Scale', label: '体重' },
  medical: { group: 'body', color: 'bg-red-500', icon: 'Stethoscope', label: '看病' },
  checkup: { group: 'body', color: 'bg-teal-500', icon: 'Activity', label: '体检' },
  physiology: { group: 'body', color: 'bg-rose-600', icon: 'Droplet', label: '生理期' },

  // Work (工作)
  work: { group: 'work', color: 'bg-sky-600', icon: 'Briefcase', label: '工作' },
  idea: { group: 'work', color: 'bg-yellow-500', icon: 'Lightbulb', label: '灵感' },
  
  // Default fallback
  other: { group: 'life', color: 'bg-gray-500', icon: 'Hash', label: '其他' },
};

// Define Schema types for dynamic form
type FieldType = 'text' | 'number' | 'select' | 'multiselect' | 'date' | 'rating';

interface FieldSchema {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[]; // For select/multiselect
  unit?: string;
  placeholder?: string;
}

// Helper to create standardized schemas
const createSchema = (specificFields: FieldSchema[]): FieldSchema[] => {
    return [
        { key: 'summary', label: '简述', type: 'text', required: true, placeholder: '10字左右细节描述' },
        { key: 'time', label: '时间', type: 'text', required: true, placeholder: 'HH:mm' },
        { key: 'duration', label: '时长', type: 'text', required: false, placeholder: '例如: 30分钟' },
        ...specificFields,
        { key: 'notes', label: '其他详情', type: 'text', required: false, placeholder: '无法分类的细节存入此处' }
    ];
};

const INITIAL_SCHEMAS: Record<string, FieldSchema[]> = {
  finance_tracking: createSchema([
    { key: 'transaction_type', label: '交易类型', type: 'select', required: true, options: ['支出', '收入', '转账'] },
    { key: 'amount', label: '金额', type: 'number', required: true, unit: '元' },
    { key: 'currency', label: '货币', type: 'select', required: true, options: ['CNY', 'USD', 'EUR', 'JPY', 'HKD'] },
    { key: 'tags', label: '分类', type: 'multiselect', required: true, options: ['餐饮', '交通', '购物', '娱乐', '医疗', '教育', '住房', '旅行', '人情', '工资', '理财', '其他'] },
    { key: 'payment_method', label: '支付方式', type: 'select', required: false, options: ['微信', '支付宝', '信用卡', '储蓄卡', '现金'] },
    { key: 'merchant', label: '商家/对象', type: 'text', required: false },
  ]),
  movie: createSchema([
    { key: 'title', label: '电影名称', type: 'text', required: true },
    { key: 'genre', label: '类别', type: 'text', required: false },
    { key: 'rating', label: '评分', type: 'rating', required: false }, // 1-5
  ]),
  exercise: createSchema([
    { key: 'type', label: '运动项目', type: 'text', required: true },
    { key: 'calories', label: '消耗卡路里', type: 'number', required: false },
    { key: 'feeling', label: '感受', type: 'text', required: false },
  ]),
  sleep: createSchema([
    { key: 'waketime', label: '醒来时间', type: 'text', required: false },
    { key: 'quality', label: '睡眠质量', type: 'select', required: false, options: ['很好', '还行', '一般', '差'] },
  ]),
  personal_care: createSchema([
    { key: 'item', label: '护理项目', type: 'text', required: true }, // e.g., Skincare, Mask
    { key: 'product', label: '使用产品', type: 'text', required: false },
  ]),
  weight: createSchema([
    { key: 'value', label: '体重(kg)', type: 'number', required: true },
    { key: 'fat_rate', label: '体脂率(%)', type: 'number', required: false },
  ]),
  diary: createSchema([
    { key: 'mood', label: '心情', type: 'text', required: false },
    { key: 'weather', label: '天气', type: 'text', required: false },
  ]),
  reading: createSchema([
      { key: 'book_name', label: '书名', type: 'text', required: true},
      { key: 'author', label: '作者', type: 'text', required: false},
      { key: 'progress', label: '进度', type: 'text', required: false},
  ]),
  dining: createSchema([
      { key: 'meal_type', label: '餐别', type: 'select', required: true, options: ['早餐','午餐','晚餐','夜宵','零食']},
      { key: 'food_items', label: '食物', type: 'text', required: true},
      { key: 'calories', label: '热量', type: 'number', required: false}
  ]),
  housework: createSchema([
      { key: 'task', label: '任务', type: 'text', required: true},
      { key: 'area', label: '区域', type: 'text', required: false}
  ]),
  medical: createSchema([
      { key: 'symptom', label: '症状', type: 'text', required: true},
      { key: 'diagnosis', label: '诊断', type: 'text', required: false},
      { key: 'medicine', label: '药物', type: 'text', required: false}
  ],),
  checkup: createSchema([
      { key: 'hospital', label: '医院', type: 'text', required: false},
      { key: 'project', label: '项目', type: 'text', required: true},
      { key: 'result', label: '结果', type: 'text', required: false}
  ]),
  physiology: createSchema([
      { key: 'status', label: '状态', type: 'select', required: true, options: ['开始','结束','流量大','流量小','痛经']},
  ]),
  work: createSchema([
      { key: 'project', label: '项目', type: 'text', required: false},
      { key: 'task', label: '任务', type: 'text', required: true},
      { key: 'status', label: '状态', type: 'select', required: true, options:['进行中','已完成','延期']}
  ]),
  idea: createSchema([
      { key: 'topic', label: '主题', type: 'text', required: true},
  ]),
  study: createSchema([
      { key: 'subject', label: '科目', type: 'text', required: true},
      { key: 'content', label: '内容', type: 'text', required: true},
  ]),
  entertainment: createSchema([
      { key: 'activity', label: '活动', type: 'text', required: true},
      { key: 'partners', label: '同伴', type: 'text', required: false}
  ])
};

// --- Prompts ---

const DEFAULT_CHAT_INSTRUCTIONS = `You are a friendly, empathetic AI assistant in a personal "LifeOS" app.
Your user interacts with you to record their life, emotions, work, and health.
Style: Warm, encouraging, concise, and natural. Use Chinese.
If the user shares good news, celebrate. If bad news, comfort.
You are NOT the database. You are the companion. The database recording happens in the background.
If the user asks about previous records, you can generally refer to "the dashboard".
`;

const DEFAULT_ORGANIZER_INSTRUCTIONS = `You are a strict Data Entry Clerk for a personal database.
Your Goal: Extract structured events from the user's input.
Input: A natural language message (which may contain multiple events) and the Current Date.

**CRITICAL RULES:**
1.  **Atomic Splitting**: If the input contains multiple distinct events (e.g., "Bought lunch for 20 and then watched a movie"), you MUST split them into separate entries.
2.  **Mandatory Fields (Must fill for EVERY entry)**:
    *   \`event\`: The "Title". Must be extremely concise, 1-3 words (e.g., "午餐", "跑步", "买书").
    *   \`details.summary\`: A short description (approx. 10 words) with key context (e.g., "麦当劳双层吉士套餐", "公园慢跑5公里").
    *   \`details.time\`: The time of occurrence in HH:mm format. Infer from context or use current time if unspecified.
    *   \`details.duration\`: Duration string if mentioned (e.g., "30分钟", "2小时"). If not mentioned, leave empty.
3.  **Specific Data Mapping**:
    *   Identify the \`category\` code (finance_tracking, exercise, etc.).
    *   Extract structured data matching that category's specific fields (e.g., \`amount\`, \`calories\`, \`book_name\`).
4.  **Catch-All Rule**:
    *   Any information that does NOT fit into the mandatory fields or the category-specific fields MUST be put into \`details.notes\`. Do not ignore any user details.
5.  **Finance Rules**:
    *   Category: \`finance_tracking\`.
    *   Amount: Negative for expense, Positive for income.
    *   Tags: Infer from '餐饮', '交通', '购物', '娱乐', '医疗', '教育', '住房', '旅行', '人情', '工资', '理财', '其他'.
    *   Currency: Default 'CNY'.

**Category Codes**:
*   Money: \`finance_tracking\`
*   Body: \`exercise\`, \`sleep\`, \`weight\`, \`medical\`, \`checkup\`, \`physiology\`
*   Life: \`movie\`, \`reading\`, \`study\`, \`entertainment\`, \`dining\`, \`housework\`, \`personal_care\`, \`diary\`
*   Work: \`work\`, \`idea\`

**Output JSON Schema:**
Return an array of objects.
{
  "date": "YYYY-MM-DD",
  "category": "ENUM_CODE",
  "event": "Short Title (1-2 words)",
  "details": {
     "summary": "10 word description",
     "time": "HH:mm",
     "duration": "Duration string (optional)",
     "notes": "All other unstructured info",
     // ... Plus category specific keys
  }
}
`;

const DEFAULT_LOGGER_INSTRUCTIONS = `You are a background logger.
The user has been chatting casually.
Your job: Summarize the last ~30 messages into a single "Diary/Muttering" entry.
Capture: Mood, key topics discussed, interesting thoughts.
Format: A single paragraph, fluent Simplified Chinese.
Category: 'diary'.
Event Title: "闲聊速记".
`;

// --- Interfaces ---

interface Entry {
  id: string;
  date: string; // YYYY-MM-DD
  category: string;
  event: string;
  details: Record<string, any>;
  image?: string; // Base64 data URI
}

interface ChatMessage {
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: number;
  relatedEntryIds?: string[]; // IDs of entries created by this message
}

interface RawLog {
    id: string;
    timestamp: number;
    text: string;
}

interface AISettings {
  chatInstructions: string;
  organizerInstructions: string;
  loggerInstructions: string;
  batchSize: number;
}

interface ChatSettings {
    chatEnabled: boolean;
    organizerEnabled: boolean;
    contextRounds: number; // 9999 for infinite
    contextMode: 'global' | 'today' | 'week' | 'custom';
    customStartDate: string;
    customEndDate: string;
}

// --- Components ---

const IconComponent = ({ name, className }: { name: string; className?: string }) => {
  // Use a safer check for dynamic icon access
  const LucideIcon = (Icons as any)[name] as React.ElementType | undefined;
  if (!LucideIcon) return <Icons.Hash className={className} />;
  return <LucideIcon className={className} />;
};

// --- Helper Functions ---
const formatDate = (date: Date) => {
  // Local YYYY-MM-DD
  const offset = date.getTimezoneOffset() * 60000;
  const local = new Date(date.getTime() - offset);
  return local.toISOString().split('T')[0];
};

const getWeekRange = (date: Date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
  const start = new Date(d.setDate(diff));
  start.setHours(0,0,0,0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23,59,59,999);
  return { start, end };
};

const isSameDay = (d1: Date, d2: Date) => {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
};

const renderDetails = (cat: string, details: Record<string, any>) => {
  // Filter out standard fields to avoid duplication if handled by parent container
  const standardFields = ['summary', 'time', 'duration', 'notes'];
  
  // Custom Renderers for specific logic
  const renderSpecifics = () => {
    if (cat === 'finance_tracking') {
        return (
          <div className="mt-1 mb-1">
             <div className={`font-mono font-bold text-sm ${details.transaction_type === '收入' ? 'text-emerald-400' : 'text-red-400'}`}>
                 {details.amount ? (details.transaction_type === '支出' && details.amount > 0 ? -details.amount : details.amount) : 0} {details.currency}
             </div>
             {details.merchant && <div className="text-[10px] text-gray-500">@{details.merchant}</div>}
             {details.tags && <div className="flex flex-wrap gap-1 mt-1">{
                 (Array.isArray(details.tags) ? details.tags : [details.tags]).map((t:string, i:number) => (
                     <span key={i} className="bg-gray-700 px-1 rounded text-[10px]">{t}</span>
                 ))
             }</div>}
          </div>
        );
    }
    if (cat === 'movie') {
        return (
            <div className="flex gap-2 items-center mt-1">
              {details.rating && <div className="text-yellow-500 text-xs">{'★'.repeat(Math.round(details.rating))}</div>}