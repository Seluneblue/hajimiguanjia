import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import * as Icons from 'lucide-react';

// --- Global Setup ---
// Remove the loading spinner when the React app successfully mounts
const hideLoader = () => {
    const loader = document.getElementById('app-loading');
    if (loader) loader.style.display = 'none';
};

// --- Constants & Configuration ---

// Helper to get API Key safely in browser environment
const getApiKey = () => {
    // 1. Try LocalStorage (User set in Settings)
    if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('lifeos_google_api_key');
        if (stored && stored.trim() !== '') return stored;
    }
    // 2. Try Environment Variable (safe check with shim)
    try {
        // @ts-ignore
        if (typeof process !== 'undefined' && process.env && process.env.API_KEY) {
            // @ts-ignore
            return process.env.API_KEY;
        }
    } catch (e) {
        // ignore
    }
    return undefined;
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
  // Safe icon access for ESM environments
  const iconName = name as keyof typeof Icons;
  const LucideIcon = Icons[iconName] as React.ElementType | undefined;
  
  // Fallback to Hash if not found
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
              {details.genre && <div className="text-[10px] bg-pink-900/50 px-1 rounded text-pink-300">{details.genre}</div>}
            </div>
        );
    }
    // Default fallback loop for non-standard fields
    return Object.entries(details).map(([k, v]) => {
        if (standardFields.includes(k) || !v) return null;
        if (k === 'type' && cat === 'exercise') return null; // 'type' usually redundant with event in exercise
        return <div key={k} className="text-[10px]"><span className="opacity-50 mr-1 capitalize">{k.replace(/_/g, ' ')}:</span>{String(v)}</div>;
    });
  };

  return (
      <div className="w-full">
          {/* Standard Fields Header */}
          <div className="flex justify-between items-start text-[10px] text-gray-500 mb-1 border-b border-gray-700/50 pb-1">
              <span className="text-gray-300 font-medium line-clamp-2 flex-1 mr-2" title={details.summary}>{details.summary}</span>
              <div className="text-right whitespace-nowrap">
                  <span className="font-mono text-blue-300">{details.time}</span>
                  {details.duration && <span className="ml-1 text-gray-600">({details.duration})</span>}
              </div>
          </div>
          
          {/* Specifics */}
          {renderSpecifics()}

          {/* Catch-all Notes */}
          {details.notes && (
              <div className="mt-1 pt-1 border-t border-gray-700/50 text-[10px] text-gray-400 italic">
                  Note: {details.notes}
              </div>
          )}
      </div>
  );
};

// --- Dashboard View Component ---

interface DashboardViewProps {
  entries: Entry[];
  viewDate: Date;
  viewMode: 'day' | 'week' | 'month';
  setViewDate: (date: Date) => void;
  setViewMode: (mode: 'day' | 'week' | 'month') => void;
  setEditingEntry: (entry: Entry) => void;
  setEntries: React.Dispatch<React.SetStateAction<Entry[]>>;
  rawLogs: RawLog[];
  setRawLogs: React.Dispatch<React.SetStateAction<RawLog[]>>;
}

const DashboardView = ({ 
  entries, 
  viewDate, 
  viewMode, 
  setViewDate, 
  setViewMode, 
  setEditingEntry, 
  setEntries,
  rawLogs,
  setRawLogs
}: DashboardViewProps) => {
    const [isLogView, setIsLogView] = useState(false);
    const [editingLogId, setEditingLogId] = useState<string | null>(null);
    const [editingLogText, setEditingLogText] = useState('');

    const filteredEntries = useMemo(() => {
        return entries.filter((e: Entry) => {
            if (!e.date) return false;
            // Validate date format to prevent invalid date errors
            if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return false;
            
            const eDate = new Date(e.date + "T00:00:00"); // Force local time interpretation
            if (isNaN(eDate.getTime())) return false;

            if (viewMode === 'day') {
                return isSameDay(eDate, viewDate);
            } else if (viewMode === 'week') {
                const { start, end } = getWeekRange(viewDate);
                return eDate >= start && eDate <= end;
            } else {
                return eDate.getMonth() === viewDate.getMonth() && eDate.getFullYear() === viewDate.getFullYear();
            }
        });
    }, [entries, viewMode, viewDate]);

    // Grouping
    const groups = { life: [] as string[], body: [] as string[], work: [] as string[] };
    Object.entries(BASE_CATEGORY_META).forEach(([key, meta]) => {
        if (groups[meta.group]) groups[meta.group].push(key);
    });

    const filteredRawLogs = useMemo(() => {
        if (!rawLogs) return [];
        return rawLogs.filter((log: RawLog) => {
             const d = new Date(log.timestamp);
             if (viewMode === 'day') return isSameDay(d, viewDate);
             if (viewMode === 'week') {
                const { start, end } = getWeekRange(viewDate);
                return d >= start && d <= end;
             }
             return d.getMonth() === viewDate.getMonth() && d.getFullYear() === viewDate.getFullYear();
        }).sort((a: RawLog, b: RawLog) => b.timestamp - a.timestamp);
    }, [rawLogs, viewDate, viewMode]);

    const handleSaveLogEdit = (id: string) => {
        setRawLogs((prev: RawLog[]) => prev.map(log => 
            log.id === id ? { ...log, text: editingLogText } : log
        ));
        setEditingLogId(null);
    };

    const handleDeleteLog = (e: React.MouseEvent, id: string) => {
        e.stopPropagation(); // Critical for proper event handling
        if (window.confirm("Are you sure you want to delete this log?")) {
             setRawLogs((prev: RawLog[]) => prev.filter(log => log.id !== id));
        }
    };

    const renderCard = (catKey: string) => {
        const meta = BASE_CATEGORY_META[catKey] || BASE_CATEGORY_META['other'];
        const catEntries = filteredEntries.filter((e: Entry) => e.category === catKey);
        
        return (
            <div key={catKey} className={`rounded-xl border border-gray-800 bg-gray-900/50 flex flex-col h-[280px] overflow-hidden group`}>
                <div className={`px-3 py-2 flex items-center justify-between bg-gray-900/80 border-b border-gray-800/50`}>
                    <div className="flex items-center gap-2">
                         <div className={`p-1.5 rounded-lg ${meta.color} text-white`}>
                             <IconComponent name={meta.icon} className="w-3.5 h-3.5" />
                         </div>
                         <span className="font-medium text-sm text-gray-300">{meta.label}</span>
                    </div>
                    {/* On Mobile, Show "+" always or make card clickable. For now, keep icon logic but ensure it's tappable */}
                    <button onClick={() => {
                        // Create empty entry for manual edit
                        const now = new Date();
                        const timeStr = now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                        const newEntry: Entry = {
                            id: Math.random().toString(36).substr(2,9),
                            date: formatDate(viewDate),
                            category: catKey,
                            event: 'New Event',
                            details: {
                                summary: 'New entry',
                                time: timeStr,
                                notes: ''
                            }
                        };
                        setEntries((prev: Entry[]) => [...prev, newEntry]);
                        setEditingEntry(newEntry);
                    }} className="text-gray-500 hover:text-white transition-colors opacity-100 md:opacity-0 md:group-hover:opacity-100 p-2">
                        <Icons.Plus className="w-4 h-4" />
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                    {catEntries.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-gray-700 text-xs italic">
                            No records
                        </div>
                    ) : (
                        catEntries.map((e: Entry) => (
                            <div key={e.id} className="bg-gray-800/50 rounded p-2 text-xs relative group/item hover:bg-gray-800 transition-colors border border-gray-800/50">
                                <div className="flex justify-between items-start mb-1">
                                    <span className="font-bold text-gray-200 line-clamp-1 text-sm">{e.event}</span>
                                    {/* Action Buttons: Visible by default on mobile, hover on desktop */}
                                    <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover/item:opacity-100 transition-opacity absolute top-2 right-2 bg-gray-900/90 rounded px-1 z-20">
                                        <button 
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                event.preventDefault();
                                                setEditingEntry(e);
                                            }} 
                                            className="text-blue-400 hover:text-blue-300 p-2 md:p-1"
                                        >
                                            <Icons.Pencil className="w-3 h-3" />
                                        </button>
                                        <button 
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                event.preventDefault();
                                                if(window.confirm('Delete this entry?')) {
                                                    setEntries((prev: Entry[]) => prev.filter(x => x.id !== e.id));
                                                }
                                            }} 
                                            className="text-red-400 hover:text-red-300 p-2 md:p-1"
                                        >
                                            <Icons.Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                                {/* Details Render Logic */}
                                <div className="text-gray-400 space-y-0.5">
                                    {renderDetails(catKey, e.details)}
                                    {e.image && (
                                        <img src={`data:image/jpeg;base64,${e.image}`} className="w-8 h-8 object-cover rounded mt-1 cursor-pointer hover:scale-150 transition-transform" />
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        );
    };

    const viewModes: ('day' | 'week' | 'month')[] = ['day', 'week', 'month'];

    return (
        <div className="space-y-6 pb-32 md:pb-20 relative min-h-full flex flex-col">
             {/* Header */}
             <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between bg-gray-900/80 p-3 md:p-4 rounded-2xl border border-gray-800 backdrop-blur-sm sticky top-0 z-30 shrink-0 gap-3">
                <div className="flex items-center gap-2 md:gap-4 justify-between">
                    <div className="flex bg-gray-800 rounded-lg p-1">
                        <button onClick={() => {
                            const d = new Date(viewDate);
                            viewMode === 'month' ? d.setMonth(d.getMonth()-1) : viewMode === 'week' ? d.setDate(d.getDate()-7) : d.setDate(d.getDate()-1);
                            setViewDate(d);
                        }} className="p-2 md:p-1 hover:bg-gray-700 rounded text-gray-400"><Icons.ChevronLeft className="w-4 h-4"/></button>
                        <div className="px-2 md:px-3 py-1 min-w-[100px] md:min-w-[120px] text-center font-mono text-sm flex items-center justify-center">
                             {formatDate(viewDate)}
                        </div>
                         <button onClick={() => {
                            const d = new Date(viewDate);
                            viewMode === 'month' ? d.setMonth(d.getMonth()+1) : viewMode === 'week' ? d.setDate(d.getDate()+7) : d.setDate(d.getDate()+1);
                            setViewDate(d);
                        }} className="p-2 md:p-1 hover:bg-gray-700 rounded text-gray-400"><Icons.ChevronRight className="w-4 h-4"/></button>
                    </div>
                    <div className="flex bg-gray-800 rounded-lg p-1 text-xs">
                        {viewModes.map(m => (
                            <button key={m} onClick={() => setViewMode(m)} className={`px-2 md:px-3 py-1 rounded capitalize ${viewMode === m ? 'bg-gray-700 text-white' : 'text-gray-500'}`}>
                                {m}
                            </button>
                        ))}
                    </div>
                </div>
                
                {/* View Toggle Button */}
                <button 
                    onClick={() => setIsLogView(!isLogView)} 
                    className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg border text-xs transition-colors font-medium ${
                        isLogView 
                        ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20' 
                        : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                    }`}
                >
                    {isLogView ? (
                        <>
                            <Icons.LayoutGrid className="w-4 h-4" />
                            <span>Dashboard</span>
                        </>
                    ) : (
                        <>
                            <Icons.ScrollText className="w-4 h-4" />
                            <span>Logs</span>
                        </>
                    )}
                </button>
             </div>

             {/* Main Content Area */}
             <div className="flex-1 relative">
                 {isLogView ? (
                     // Raw Logs Full Page View
                     <div className="h-full bg-gray-900/30 border border-gray-800/50 rounded-2xl p-4 md:p-6 animate-fade-in flex flex-col">
                         <div className="flex items-center gap-3 mb-6 border-b border-gray-800 pb-4">
                             <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
                                 <Icons.ScrollText className="w-6 h-6" />
                             </div>
                             <div>
                                 <h2 className="text-xl font-bold text-gray-100">Daily Raw Logs</h2>
                                 <p className="text-xs text-gray-500">All original input captured for {formatDate(viewDate)}</p>
                             </div>
                         </div>
                         
                         <div className="space-y-4 flex-1 overflow-y-auto custom-scrollbar pr-2">
                             {filteredRawLogs.length === 0 ? (
                                 <div className="text-center py-20 text-gray-600 italic border-2 border-dashed border-gray-800 rounded-xl">
                                     No raw logs found for this period.
                                 </div>
                             ) : (
                                 filteredRawLogs.map((log: RawLog) => (
                                     <div key={log.id} className="bg-gray-800/40 border border-gray-800 rounded-xl p-4 group hover:bg-gray-800/80 transition-all duration-200">
                                         <div className="flex justify-between items-start mb-3">
                                             <div className="flex items-center gap-2">
                                                 <span className="text-[10px] font-mono text-gray-400 bg-gray-900 px-2 py-1 rounded border border-gray-800">
                                                     {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                 </span>
                                                 {editingLogId === log.id && <span className="text-xs text-blue-400 font-bold animate-pulse">Editing...</span>}
                                             </div>
                                             
                                             <div className="flex gap-2">
                                                 {editingLogId === log.id ? (
                                                     <>
                                                         <button 
                                                             onClick={() => handleSaveLogEdit(log.id)}
                                                             className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-500 transition-colors"
                                                         >
                                                             Save
                                                         </button>
                                                         <button 
                                                             onClick={() => setEditingLogId(null)}
                                                             className="text-xs bg-gray-700 text-gray-300 px-3 py-1 rounded hover:bg-gray-600 transition-colors"
                                                         >
                                                             Cancel
                                                         </button>
                                                     </>
                                                 ) : (
                                                     <div className="flex gap-1">
                                                         <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setEditingLogText(log.text);
                                                                setEditingLogId(log.id);
                                                            }}
                                                            className="p-1.5 text-gray-400 hover:text-blue-300 hover:bg-blue-900/20 rounded-lg transition-colors"
                                                            title="Edit Log"
                                                         >
                                                             <Icons.Pencil className="w-4 h-4" />
                                                         </button>
                                                         <button 
                                                            onClick={(e) => handleDeleteLog(e, log.id)}
                                                            className="p-1.5 text-gray-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-colors"
                                                            title="Delete Log"
                                                         >
                                                             <Icons.Trash2 className="w-4 h-4" />
                                                         </button>
                                                     </div>
                                                 )}
                                             </div>
                                         </div>
                                         
                                         {editingLogId === log.id ? (
                                             <textarea 
                                                 value={editingLogText}
                                                 onChange={e => setEditingLogText(e.target.value)}
                                                 className="w-full bg-gray-900 border border-blue-500/50 rounded-lg p-3 text-sm text-gray-200 outline-none focus:ring-2 focus:ring-blue-500/20 min-h-[100px]"
                                                 autoFocus
                                             />
                                         ) : (
                                             <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed pl-3 border-l-2 border-indigo-500/30">
                                                 {log.text}
                                             </div>
                                         )}
                                     </div>
                                 ))
                             )}
                         </div>
                     </div>
                 ) : (
                     // Default Dashboard Grids
                     <div className="space-y-6">
                         {['life', 'body', 'work'].map(g => (
                             <div key={g} className="animate-fade-in">
                                 <h3 className="text-xs font-bold uppercase tracking-wider text-gray-600 mb-3 px-1">{g}</h3>
                                 <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                                     {groups[g as GroupKey].map(cat => renderCard(cat))}
                                 </div>
                             </div>
                         ))}
                     </div>
                 )}
             </div>
        </div>
    );
};

export default function Index() {
  // Hide loader upon mount
  useEffect(() => {
      hideLoader();
  }, []);

  // State: Data
  const [entries, setEntries] = useState<Entry[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [rawLogs, setRawLogs] = useState<RawLog[]>([]);
  
  // State: UI
  const [activeTab, setActiveTab] = useState<'chat' | 'dashboard' | 'settings'>('chat');
  const [viewDate, setViewDate] = useState<Date>(new Date());
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('day');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [showAIControl, setShowAIControl] = useState(false);
  const [userApiKey, setUserApiKey] = useState('');
  
  // State: Input & Processing
  const [inputText, setInputText] = useState('');
  const [editingMsgIndex, setEditingMsgIndex] = useState<number | null>(null);
  const [editingMsgText, setEditingMsgText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [chatBufferCount, setChatBufferCount] = useState(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  
  // State: Config
  const [aiConfig, setAiConfig] = useState<AISettings>({
    chatInstructions: DEFAULT_CHAT_INSTRUCTIONS,
    organizerInstructions: DEFAULT_ORGANIZER_INSTRUCTIONS,
    loggerInstructions: DEFAULT_LOGGER_INSTRUCTIONS,
    batchSize: 30,
  });
  
  const [chatSettings, setChatSettings] = useState<ChatSettings>({
      chatEnabled: true,
      organizerEnabled: true,
      contextRounds: 10,
      contextMode: 'global',
      customStartDate: new Date().toISOString().split('T')[0],
      customEndDate: new Date().toISOString().split('T')[0]
  });

  const [customSchemas, setCustomSchemas] = useState<Record<string, FieldSchema[]>>(INITIAL_SCHEMAS);

  // State: Modals
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [editingSchemaCat, setEditingSchemaCat] = useState<string | null>(null);
  
  // State: Schema Editor (augmented with _uid for stable UI rendering)
  type TempFieldSchema = FieldSchema & { _uid: string };
  const [tempSchema, setTempSchema] = useState<TempFieldSchema[]>([]);

  // --- Effects ---

  // Load Data with generic type safety
  useEffect(() => {
    const load = <T,>(key: string, setter: React.Dispatch<React.SetStateAction<T>>, def: T) => {
      const saved = localStorage.getItem(key);
      if (saved) setter(JSON.parse(saved));
      else setter(def);
    };
    load<Entry[]>('lifeos_entries', setEntries, []);
    load<ChatMessage[]>('lifeos_messages', setMessages, []);
    
    // Load rawlogs with migration for missing IDs
    const savedLogs = localStorage.getItem('lifeos_rawlogs');
    if (savedLogs) {
        const parsed: any[] = JSON.parse(savedLogs);
        // Backfill IDs if missing from older versions
        const migrated = parsed.map(log => {
            if (!log.id) return { ...log, id: Math.random().toString(36).substr(2, 9) };
            return log;
        });
        setRawLogs(migrated);
    } else {
        setRawLogs([]);
    }

    load<AISettings>('lifeos_aiconfig', setAiConfig, {
        chatInstructions: DEFAULT_CHAT_INSTRUCTIONS,
        organizerInstructions: DEFAULT_ORGANIZER_INSTRUCTIONS,
        loggerInstructions: DEFAULT_LOGGER_INSTRUCTIONS,
        batchSize: 30,
    });
    load<ChatSettings>('lifeos_chatsettings', setChatSettings, {
        chatEnabled: true,
        organizerEnabled: true,
        contextRounds: 10,
        contextMode: 'global',
        customStartDate: new Date().toISOString().split('T')[0],
        customEndDate: new Date().toISOString().split('T')[0]
    });
    
    // Merge Schemas
    const savedSchemas = localStorage.getItem('lifeos_schemas');
    if (savedSchemas) {
        const parsed = JSON.parse(savedSchemas);
        // Merge with initial in case we added new defaults in code
        setCustomSchemas({...INITIAL_SCHEMAS, ...parsed});
    } else {
        setCustomSchemas(INITIAL_SCHEMAS);
    }

    // Load API Key
    const key = getApiKey();
    if (key) setUserApiKey(key);

  }, []);

  // Save Data
  useEffect(() => localStorage.setItem('lifeos_entries', JSON.stringify(entries)), [entries]);
  useEffect(() => localStorage.setItem('lifeos_messages', JSON.stringify(messages)), [messages]);
  useEffect(() => localStorage.setItem('lifeos_rawlogs', JSON.stringify(rawLogs)), [rawLogs]);
  useEffect(() => localStorage.setItem('lifeos_aiconfig', JSON.stringify(aiConfig)), [aiConfig]);
  useEffect(() => localStorage.setItem('lifeos_chatsettings', JSON.stringify(chatSettings)), [chatSettings]);
  useEffect(() => localStorage.setItem('lifeos_schemas', JSON.stringify(customSchemas)), [customSchemas]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (editingEntry) {
        document.body.style.overflow = 'hidden';
    } else {
        document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [editingEntry]);

  // --- Core AI Logic ---

  const getFilteredHistory = () => {
      let filtered = messages.filter(m => m.role === 'user'); // AI only sees user inputs
      
      // Time Filter
      const now = new Date();
      if (chatSettings.contextMode === 'today') {
          filtered = filtered.filter(m => isSameDay(new Date(m.timestamp), now));
      } else if (chatSettings.contextMode === 'week') {
          const { start, end } = getWeekRange(now);
          filtered = filtered.filter(m => m.timestamp >= start.getTime() && m.timestamp <= end.getTime());
      } else if (chatSettings.contextMode === 'custom') {
          const s = new Date(chatSettings.customStartDate).getTime();
          const e = new Date(chatSettings.customEndDate).getTime() + 86400000;
          filtered = filtered.filter(m => m.timestamp >= s && m.timestamp <= e);
      }

      // Rounds Limit
      if (chatSettings.contextRounds < 9999) {
          filtered = filtered.slice(-chatSettings.contextRounds);
      }
      return filtered;
  };

  const chatWithGemini = async (history: ChatMessage[], newMsg: string, signal: AbortSignal, regenerate = false) => {
    const apiKey = getApiKey();
    if (!apiKey) return "Error: No API Key Configured in Settings";
    const ai = new GoogleGenAI({ apiKey });
    
    // Construct prompt
    let prompt = aiConfig.chatInstructions + "\n\nChat History:\n";
    history.forEach(m => {
        prompt += `${m.role === 'user' ? 'User' : 'You'}: ${m.text}\n`;
    });
    if (!regenerate) {
        prompt += `User: ${newMsg}\n`;
    }
    
    // Check signal before starting
    if (signal.aborted) return "";

    try {
        // Create a race between the generation and the abort signal
        const generatePromise = ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: prompt,
        });

        // Abort promise wrapper
        const abortPromise = new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('Aborted')));
        });

        const res = await Promise.race([generatePromise, abortPromise]) as GenerateContentResponse;
        return res.text || "";
    } catch (e: any) {
        if (e.message === 'Aborted') return ""; // Silent return
        console.error(e);
        return "Thinking process interrupted or failed.";
    }
  };

  const organizeInput = async (text: string, dateStr: string, imageBase64?: string): Promise<any[]> => {
    const apiKey = getApiKey();
    if (!apiKey) return [];
    const ai = new GoogleGenAI({ apiKey });
    
    // Generate valid JSON schema parts based on customSchemas
    const prompt = `
${aiConfig.organizerInstructions}

Current Date: ${dateStr}
Current Time: ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
IMPORTANT: Analyze the input for time references (e.g., "Yesterday", "Last Friday"). If found, calculate the specific date (YYYY-MM-DD) based on Current Date. If not, use Current Date. Return this in the "date" field.

Defined Schemas (Follow these fields strictly):
${Object.entries(customSchemas).map(([cat, fields]) => `
Table: ${cat}
Fields: ${fields.map(f => `- ${f.key} (${f.type}): ${f.label}`).join(', ')}
`).join('\n')}

User Input: "${text}"
`;

    const parts: any[] = [{ text: prompt }];
    if (imageBase64) {
        parts.push({
            inlineData: {
                mimeType: "image/jpeg",
                data: imageBase64.split(',')[1]
            }
        });
    }

    try {
      const res = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        date: { type: Type.STRING, description: "YYYY-MM-DD" },
                        category: { type: Type.STRING, enum: Object.keys(BASE_CATEGORY_META) },
                        event: { type: Type.STRING, description: "1-2 words Title" },
                        details: { type: Type.OBJECT, properties: {
                            // Standard fields must be here for AI to fill them
                            summary: { type: Type.STRING, description: "10 word description" },
                            time: { type: Type.STRING, description: "HH:mm" },
                            duration: { type: Type.STRING, nullable: true },
                            notes: { type: Type.STRING, nullable: true, description: "Catch-all for other info" },
                            
                            // Common specific fields
                            transaction_type: { type: Type.STRING, nullable: true },
                            amount: { type: Type.NUMBER, nullable: true },
                            currency: { type: Type.STRING, nullable: true },
                            tags: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
                            title: { type: Type.STRING, nullable: true },
                            value: { type: Type.NUMBER, nullable: true },
                            item: { type: Type.STRING, nullable: true }
                        }, required: ["summary", "time"]}
                    },
                    required: ["category", "event", "date", "details"]
                }
            }
        }
      });
      const txt = res.text;
      if (!txt) return [];
      return JSON.parse(txt) as any[];
    } catch (e) {
      console.error("Organization failed", e);
      return [];
    }
  };

  // --- Handlers ---

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    if (isProcessing) return;

    // API Key Check
    if (!getApiKey()) {
        alert("Please configure your Google API Key in Settings first.");
        setActiveTab('settings');
        return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsProcessing(true);

    const userMsg: ChatMessage = { role: 'user', text: inputText, timestamp: Date.now() };
    const tempMessages = [...messages, userMsg];
    setMessages(tempMessages);
    setInputText('');
    
    // Save raw log with ID and timestamp for Dashboard display
    setRawLogs(prev => [...prev, { id: Math.random().toString(36).substr(2,9), timestamp: userMsg.timestamp, text: userMsg.text }]);

    const relevantHistory = getFilteredHistory();

    // 1. Chat AI
    let chatResponse = "";
    if (chatSettings.chatEnabled) {
         chatResponse = await chatWithGemini(relevantHistory, userMsg.text, controller.signal) || "...";
         if (controller.signal.aborted) {
             setIsProcessing(false);
             return;
         }
         setMessages(prev => [...prev, { role: 'model', text: chatResponse, timestamp: Date.now() }]);
    }

    // 2. Organizer AI
    if (chatSettings.organizerEnabled) {
        const today = formatDate(new Date());
        
        const structuredData = await organizeInput(userMsg.text, today);
        
        if (structuredData && structuredData.length > 0) {
            const newEntries: Entry[] = structuredData.map((d: any) => ({
                id: Math.random().toString(36).substr(2, 9),
                date: d.date || today, // Use inferred date from AI if available, else today
                category: d.category,
                event: d.event,
                details: d?.details || {}
            }));
            
            setEntries(prev => [...prev, ...newEntries]);
            
            // Notify in chat
            const entryIds = newEntries.map(e => e.id);
            setMessages(prev => [...prev, { 
                role: 'system', 
                text: `Saved: ${newEntries.map(e => `[${e.date}] ${e.event}`).join(', ')}`, 
                timestamp: Date.now(),
                relatedEntryIds: entryIds
            }]);
        }
    }
    
    setChatBufferCount(prev => prev + 1);
    setIsProcessing(false);
    abortControllerRef.current = null;
  };

  const handleStop = () => {
      if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          setIsProcessing(false);
      }
  };

  const handleUndo = (msgIndex: number, entryIds: string[]) => {
      setEntries(prev => prev.filter(e => !entryIds.includes(e.id)));
      setMessages(prev => prev.map((m, i) => {
          if (i === msgIndex) return { ...m, text: m.text + " (Revoked)" };
          return m;
      }));
  };

  const handleRegenerateChat = async (msgIndex: number) => {
      // Find the user message before this AI message
      const prevMsgs = messages.slice(0, msgIndex);
      const userMsg = prevMsgs.filter(m => m.role === 'user').pop();
      if (!userMsg) return;

      setIsProcessing(true);
      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Filter history excluding the message we are replacing
      const history = getFilteredHistory().filter(m => m.timestamp < messages[msgIndex].timestamp);
      
      const newResponse = await chatWithGemini(history, userMsg.text, controller.signal, true);
      
      if (!controller.signal.aborted) {
        setMessages(prev => {
            const next = [...prev];
            next[msgIndex] = { ...next[msgIndex], text: newResponse || "..." };
            return next;
        });
      }
      setIsProcessing(false);
  };
  
  const handleSaveAndRegenerate = async (index: number, newText: string) => {
      // 1. Update text and truncate local state
      const nextMessages = messages.slice(0, index + 1);
      nextMessages[index] = { ...nextMessages[index], text: newText };
      setMessages(nextMessages);
      setEditingMsgIndex(null);

      // 2. Prepare for API call
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsProcessing(true);

      // 3. Construct history for the AI call based on the NEW state (computed locally)
      let history = nextMessages.filter(m => m.role === 'user');
      
      // Apply existing filters manually to this new list
      const now = new Date();
      if (chatSettings.contextMode === 'today') {
          history = history.filter(m => isSameDay(new Date(m.timestamp), now));
      } else if (chatSettings.contextMode === 'week') {
          const { start, end } = getWeekRange(now);
          history = history.filter(m => m.timestamp >= start.getTime() && m.timestamp <= end.getTime());
      } else if (chatSettings.contextMode === 'custom') {
          const s = new Date(chatSettings.customStartDate).getTime();
          const e = new Date(chatSettings.customEndDate).getTime() + 86400000;
          history = history.filter(m => m.timestamp >= s && m.timestamp <= e);
      }
      if (chatSettings.contextRounds < 9999) {
          history = history.slice(-chatSettings.contextRounds);
      }

      // 4. Trigger AI using regenerate=true (which effectively uses the history stack provided)
      const response = await chatWithGemini(history, "", controller.signal, true);
      
      if (!controller.signal.aborted) {
          setMessages(prev => [...prev, { role: 'model', text: response, timestamp: Date.now() }]);
      }
      setIsProcessing(false);
  };

  const handleDeleteMessage = (index: number) => {
      setMessages(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateMessage = (index: number, newText: string) => {
      setMessages(prev => {
          const next = [...prev];
          next[index] = { ...next[index], text: newText };
          return next;
      });
      setEditingMsgIndex(null);
  };

  // --- Import/Export Handlers ---

  const handleExportData = () => {
    const data = {
      entries,
      messages,
      rawLogs,
      customSchemas,
      aiConfig,
      chatSettings,
      meta: {
          exportedAt: new Date().toISOString(),
          app: 'Gemini LifeOS'
      }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lifeos-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (json.meta?.app === 'Gemini LifeOS' || confirm("File format unknown. Try to import anyway?")) {
             if (json.entries) setEntries(json.entries);
             if (json.messages) setMessages(json.messages);
             if (json.rawLogs) setRawLogs(json.rawLogs);
             if (json.customSchemas) setCustomSchemas(json.customSchemas);
             if (json.aiConfig) setAiConfig(json.aiConfig);
             if (json.chatSettings) setChatSettings(json.chatSettings);
             alert("Data imported successfully!");
        }
      } catch (err) {
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset
  };

  // --- Modal Form for Editing ---

  const renderEditModal = () => {
      if (!editingEntry) return null;
      const schema = customSchemas[editingEntry.category] || [];
      
      const updateDetail = (key: string, val: any) => {
          setEditingEntry({
              ...editingEntry,
              details: { ...editingEntry.details, [key]: val }
          });
      };

      const hasChanges = () => {
          if (!editingEntry) return false;
          const original = entries.find(e => e.id === editingEntry.id);
          // Simple JSON compare is sufficient for this structure
          return JSON.stringify(original) !== JSON.stringify(editingEntry);
      };

      const handleClose = () => {
          if (hasChanges() && !window.confirm("Discard unsaved changes?")) {
              return;
          }
          setEditingEntry(null);
      };

      return (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 shadow-2xl animate-fade-in max-h-[90dvh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-6">
                      <div className="flex items-center gap-3">
                           <div className={`p-2 rounded-lg ${BASE_CATEGORY_META[editingEntry.category]?.color || 'bg-gray-600'}`}>
                               <IconComponent name={BASE_CATEGORY_META[editingEntry.category]?.icon || 'Hash'} className="w-5 h-5 text-white" />
                           </div>
                           <h3 className="text-xl font-bold">{BASE_CATEGORY_META[editingEntry.category]?.label || editingEntry.category}</h3>
                      </div>
                      <button onClick={handleClose}><Icons.X className="w-5 h-5 text-gray-500 hover:text-white" /></button>
                  </div>
                  
                  <div className="space-y-4">
                      {/* Core Fields */}
                      <div>
                          <label className="block text-xs text-gray-500 uppercase mb-1">Date</label>
                          <input type="date" value={editingEntry.date} onChange={e => setEditingEntry({...editingEntry, date: e.target.value})} 
                                 className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm focus:border-blue-500 outline-none" />
                      </div>
                      <div>
                          <label className="block text-xs text-gray-500 uppercase mb-1">Event (Title)</label>
                          <input type="text" value={editingEntry.event} onChange={e => setEditingEntry({...editingEntry, event: e.target.value})} 
                                 className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm focus:border-blue-500 outline-none" />
                      </div>

                      <div className="h-px bg-gray-800 my-4" />
                      
                      {/* Dynamic Details based on Schema */}
                      <div className="space-y-4">
                          {schema.length > 0 ? schema.map((field) => (
                              <div key={field.key}>
                                  <label className="block text-xs text-gray-500 uppercase mb-1 flex items-center gap-1">
                                    {field.label}
                                    {field.required && <span className="text-red-500">*</span>}
                                  </label>
                                  {field.type === 'select' && (
                                      <select 
                                        value={editingEntry.details[field.key] || ''} 
                                        onChange={e => updateDetail(field.key, e.target.value)}
                                        className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm"
                                      >
                                          <option value="">Select...</option>
                                          {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                                      </select>
                                  )}
                                  {field.type === 'multiselect' && (
                                      <div className="flex flex-wrap gap-2">
                                          {(field.options || []).map(o => {
                                              const rawVal = editingEntry.details[field.key];
                                              const list = Array.isArray(rawVal) ? rawVal : [];
                                              const selected = list.includes(o);
                                              return (
                                                  <button key={o} onClick={() => {
                                                      const curr = Array.isArray(editingEntry.details[field.key]) ? editingEntry.details[field.key] : [];
                                                      const next = selected ? curr.filter((x:string) => x!==o) : [...curr, o];
                                                      updateDetail(field.key, next);
                                                  }} className={`px-2 py-1 rounded text-xs border ${selected ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
                                                      {o}
                                                  </button>
                                              );
                                          })}
                                      </div>
                                  )}
                                  {(field.type === 'text' || field.type === 'number' || field.type === 'rating') && (
                                      <input 
                                        type={field.type === 'number' || field.type === 'rating' ? 'number' : 'text'}
                                        value={editingEntry.details[field.key] || ''}
                                        onChange={e => updateDetail(field.key, field.type === 'number' ? parseFloat(e.target.value) : e.target.value)}
                                        className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-sm"
                                        placeholder={field.placeholder || (field.unit ? `Unit: ${field.unit}` : '')}
                                      />
                                  )}
                              </div>
                          )) : (
                              // Fallback for no schema
                              <div className="text-gray-500 text-xs">No specific fields configured.</div>
                          )}
                      </div>
                  </div>

                  <div className="mt-6 flex justify-end gap-3 pb-safe-offset">
                      <button onClick={handleClose} className="px-4 py-2 rounded text-sm text-gray-400 hover:bg-gray-800">Cancel</button>
                      <button onClick={() => {
                          setEntries(prev => prev.map(e => e.id === editingEntry.id ? editingEntry : e));
                          setEditingEntry(null);
                      }} className="px-4 py-2 rounded text-sm bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20">Save Changes</button>
                  </div>
              </div>
          </div>
      );
  };

  const renderSchemaEditor = () => {
      // Helper: Check if there are unsaved changes
      const hasUnsavedChanges = () => {
          if (!editingSchemaCat) return false;
          const original = customSchemas[editingSchemaCat];
          // Compare without _uid to ensure we only catch real schema changes
          const current = tempSchema.map(({ _uid, ...rest }) => rest);
          
          if (!original) return current.length > 0;
          return JSON.stringify(original) !== JSON.stringify(current);
      };

      const handleCategorySelect = (cat: string) => {
          if (editingSchemaCat === cat) return;
          if (hasUnsavedChanges()) {
              if (!window.confirm("You have unsaved changes. Discard them?")) return;
          }
          setEditingSchemaCat(cat);
          const loaded = JSON.parse(JSON.stringify(customSchemas[cat] || []));
          // Assign stable _uid for React keys
          setTempSchema(loaded.map((f: FieldSchema) => ({ ...f, _uid: Math.random().toString(36).substr(2, 9) })));
      };

      const handleSave = () => {
          if (!editingSchemaCat) return;
          // Clean _uid before saving to persistent storage
          const cleanSchema = tempSchema.map(({ _uid, ...rest }) => rest);
          setCustomSchemas(prev => ({
              ...prev,
              [editingSchemaCat]: cleanSchema
          }));
          alert("Schema updated successfully!");
      };

      const handleReset = () => {
          if (!editingSchemaCat) return;
          if (window.confirm("Discard current changes and reload from saved?")) {
              const loaded = JSON.parse(JSON.stringify(customSchemas[editingSchemaCat] || []));
              setTempSchema(loaded.map((f: FieldSchema) => ({ ...f, _uid: Math.random().toString(36).substr(2, 9) })));
          }
      };

      const updateTempField = (uid: string, changes: Partial<FieldSchema>) => {
          setTempSchema(prev => prev.map(f => 
              f._uid === uid ? { ...f, ...changes } : f
          ));
      };

      const removeTempField = (uid: string) => {
          // Find field to double check if it's standard, though UI prevents this
          const field = tempSchema.find(f => f._uid === uid);
          if (field && ['summary', 'time', 'duration', 'notes'].includes(field.key)) {
              alert("Standard fields cannot be deleted.");
              return;
          }
          if (window.confirm(`Delete field "${field?.label}"?`)) {
              setTempSchema(prev => prev.filter(f => f._uid !== uid));
          }
      };

      const addNewTempField = () => {
          const newField: TempFieldSchema = { 
              key: 'new_field_' + Date.now(), 
              label: 'New Field', 
              type: 'text',
              required: false,
              _uid: Math.random().toString(36).substr(2, 9)
          };
          const newFields = [...tempSchema];
          const notesIdx = newFields.findIndex(f => f.key === 'notes');
          if (notesIdx !== -1) {
              newFields.splice(notesIdx, 0, newField);
          } else {
              newFields.push(newField);
          }
          setTempSchema(newFields);
      };

      return (
          <div className="space-y-6 pb-20">
              <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold">Module Field Configuration</h3>
                  <button onClick={() => {
                      alert("AI Instructions will use the currently saved schemas.");
                  }} className="text-xs bg-purple-900/30 text-purple-300 px-3 py-1 rounded border border-purple-800 hover:bg-purple-900/50">
                      Sync AI Prompt
                  </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Category Selector */}
                  <div className="md:col-span-1 space-y-2 max-h-[200px] md:max-h-[60vh] overflow-y-auto custom-scrollbar bg-gray-900/30 p-3 rounded-lg border border-gray-800">
                      <h4 className="text-xs font-bold text-gray-400 uppercase mb-3 px-2">Select Module</h4>
                      {Object.keys(customSchemas).map(cat => {
                          const meta = BASE_CATEGORY_META[cat] || BASE_CATEGORY_META['other'];
                          return (
                              <button 
                                  key={cat} 
                                  onClick={(e) => {
                                      e.preventDefault();
                                      handleCategorySelect(cat);
                                  }}
                                  className={`w-full text-left px-3 py-2 rounded text-sm flex items-center gap-2 transition-all ${
                                      editingSchemaCat === cat 
                                          ? 'bg-blue-600 text-white shadow-lg' 
                                          : 'hover:bg-gray-800 text-gray-400'
                                  }`}
                              >
                                  <IconComponent name={meta.icon} className="w-4 h-4" />
                                  {meta.label || cat}
                              </button>
                          );
                      })}
                  </div>

                  {/* Field Editor */}
                  <div className="md:col-span-2 bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                      {editingSchemaCat ? (
                          <>
                              <div className="flex justify-between items-center border-b border-gray-800 pb-4 mb-4">
                                  <h4 className="font-bold text-blue-300 flex items-center gap-2">
                                      <Icons.Edit3 className="w-4 h-4" />
                                      Editing: {BASE_CATEGORY_META[editingSchemaCat]?.label || editingSchemaCat}
                                  </h4>
                                  <div className="flex gap-2">
                                      <button 
                                          onClick={handleReset} 
                                          disabled={!hasUnsavedChanges()}
                                          className={`text-xs px-3 py-1 rounded border ${hasUnsavedChanges() ? 'text-gray-300 border-gray-600 hover:bg-gray-800 cursor-pointer' : 'text-gray-600 border-transparent cursor-not-allowed'}`}
                                      >
                                          Discard Changes
                                      </button>
                                      <button 
                                          onClick={handleSave} 
                                          disabled={!hasUnsavedChanges()}
                                          className={`text-xs px-3 py-1 rounded flex items-center gap-1 shadow-lg ${hasUnsavedChanges() ? 'bg-green-600 text-white hover:bg-green-500 shadow-green-900/20 cursor-pointer' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}
                                      >
                                          <Icons.Save className="w-3 h-3" />
                                          Save Config
                                      </button>
                                  </div>
                              </div>
                              
                              <div className="space-y-3 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">
                                  {tempSchema.map((field) => {
                                      const isStandard = ['summary', 'time', 'duration', 'notes'].includes(field.key);
                                      return (
                                          <div key={field._uid} className="bg-gray-800 rounded p-3 flex flex-col md:flex-row gap-3 items-start group">
                                              <div className="grid grid-cols-2 md:grid-cols-12 gap-2 flex-1 w-full">
                                                  {/* Label */}
                                                  <div className="col-span-2 md:col-span-3">
                                                      <label className="text-[10px] text-gray-500 uppercase">Label</label>
                                                      <input 
                                                          value={field.label} 
                                                          onChange={e => updateTempField(field._uid, { label: e.target.value })} 
                                                          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs focus:border-blue-500 outline-none" 
                                                          placeholder="Label" 
                                                      />
                                                  </div>
                                                  {/* Key */}
                                                  <div className="col-span-2 md:col-span-3">
                                                      <label className="text-[10px] text-gray-500 uppercase">Key ID</label>
                                                      <input 
                                                          value={field.key} 
                                                          onChange={e => updateTempField(field._uid, { key: e.target.value })} 
                                                          className={`w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs font-mono focus:border-blue-500 outline-none ${isStandard ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                          placeholder="Key"
                                                          disabled={isStandard}
                                                      />
                                                  </div>
                                                  {/* Type */}
                                                  <div className="col-span-1 md:col-span-3">
                                                      <label className="text-[10px] text-gray-500 uppercase">Type</label>
                                                      <select 
                                                          value={field.type} 
                                                          onChange={e => updateTempField(field._uid, { type: e.target.value as FieldType })} 
                                                          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs focus:border-blue-500 outline-none"
                                                      >
                                                          {['text', 'number', 'select', 'multiselect', 'date', 'rating'].map(t => 
                                                              <option key={t} value={t}>{t}</option>
                                                          )}
                                                      </select>
                                                  </div>
                                                  {/* Required */}
                                                  <div className="col-span-1 md:col-span-1 flex flex-col items-center">
                                                      <label className="text-[10px] text-gray-500 uppercase mb-1">Req?</label>
                                                      <input 
                                                          type="checkbox" 
                                                          checked={!!field.required} 
                                                          onChange={e => updateTempField(field._uid, { required: e.target.checked })} 
                                                          className="w-4 h-4 rounded bg-gray-900 border-gray-700 accent-blue-500"
                                                          disabled={isStandard && field.key !== 'notes'} // Allow optional notes, impose strict on others
                                                      />
                                                  </div>
                                                  {/* Options (Conditional) */}
                                                  {(field.type === 'select' || field.type === 'multiselect') && (
                                                      <div className="col-span-2 md:col-span-12 mt-1">
                                                          <input 
                                                              value={field.options?.join(',') || ''} 
                                                              onChange={e => updateTempField(field._uid, { options: e.target.value.split(',').filter(Boolean) })} 
                                                              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs focus:border-blue-500 outline-none" 
                                                              placeholder="Options (comma separated)" 
                                                          />
                                                      </div>
                                                  )}
                                              </div>
                                              
                                              {/* Actions */}
                                              <div className="flex gap-1 mt-0 md:mt-4 self-end md:self-auto">
                                                  {isStandard ? (
                                                      <div className="p-1.5 opacity-30 cursor-not-allowed"><Icons.Lock className="w-4 h-4"/></div>
                                                  ) : (
                                                      <button 
                                                          type="button"
                                                          onClick={(e) => {
                                                              e.stopPropagation();
                                                              e.preventDefault();
                                                              removeTempField(field._uid);
                                                          }}
                                                          className="p-1.5 text-red-500 hover:bg-red-900/30 rounded cursor-pointer transition-colors"
                                                          title="Delete Field"
                                                      >
                                                          <Icons.Trash2 className="w-4 h-4" />
                                                      </button>
                                                  )}
                                              </div>
                                          </div>
                                      );
                                  })}
                              </div>

                              <div className="mt-4 flex gap-4">
                                  <button 
                                      type="button"
                                      onClick={(e) => {
                                          e.preventDefault();
                                          addNewTempField();
                                      }}
                                      className="flex-1 py-3 border-2 border-dashed border-gray-700 hover:border-blue-500 hover:bg-blue-900/10 rounded-lg text-xs text-gray-500 hover:text-blue-400 uppercase tracking-wider transition-all flex items-center justify-center gap-2"
                                  >
                                      <Icons.Plus className="w-4 h-4" />
                                      Add Custom Field
                                  </button>
                                  <button 
                                      onClick={() => {
                                          if(window.confirm(`Reset ${BASE_CATEGORY_META[editingSchemaCat]?.label || editingSchemaCat} to FACTORY defaults?`)) {
                                              const defaults = INITIAL_SCHEMAS[editingSchemaCat] || createSchema([]);
                                              setTempSchema(defaults.map(f => ({ ...f, _uid: Math.random().toString(36).substr(2, 9) }))); 
                                          }
                                      }} 
                                      className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-xs text-gray-400"
                                      title="Factory Reset"
                                  >
                                      <Icons.RotateCcw className="w-4 h-4" />
                                  </button>
                              </div>
                          </>
                      ) : (
                          <div className="h-[200px] md:h-[400px] flex flex-col items-center justify-center text-gray-600">
                              <Icons.ArrowLeft className="w-12 h-12 mb-4 opacity-30 hidden md:block" />
                              <Icons.ArrowUp className="w-12 h-12 mb-4 opacity-30 block md:hidden" />
                              <p className="text-sm">Select a module to configure fields</p>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      );
  };

  // --- Main Layout ---

  return (
    <div className="flex flex-col md:flex-row h-full bg-gray-950 text-gray-100 font-sans overflow-hidden">
      {/* Sidebar - Desktop Only */}
      <div className={`hidden md:flex ${isSidebarOpen ? 'w-64' : 'w-16'} bg-gray-900 border-r border-gray-800 transition-all duration-300 flex-col shrink-0 z-50`}>
        <div className="p-4 flex items-center justify-between">
           {isSidebarOpen && <span className="font-bold text-xl tracking-tighter bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">Gemini LifeOS</span>}
           <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-1.5 hover:bg-gray-800 rounded text-gray-400"><Icons.Menu className="w-5 h-5" /></button>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-2">
            {[
                { id: 'chat', icon: 'MessageSquare', label: 'Chat' },
                { id: 'dashboard', icon: 'LayoutGrid', label: 'Dashboard' },
                { id: 'settings', icon: 'Settings', label: 'Settings' }
            ].map(item => (
                <button 
                  key={item.id}
                  onClick={() => setActiveTab(item.id as 'chat' | 'dashboard' | 'settings')}
                  className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg transition-colors ${activeTab === item.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'}`}
                >
                    <IconComponent name={item.icon} className="w-5 h-5" />
                    {isSidebarOpen && <span>{item.label}</span>}
                </button>
            ))}
        </nav>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full relative overflow-hidden w-full">
          <div className="flex-1 overflow-hidden relative">
              {activeTab === 'chat' && (
                  <div className="h-full flex flex-col max-w-4xl mx-auto w-full relative">
                      {/* Messages Area */}
                      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar pb-32 md:pb-32">
                          {messages.map((msg, idx) => (
                              <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group py-3`}>
                                  <div className={`max-w-[90%] md:max-w-[80%] rounded-2xl p-4 shadow-sm relative ${
                                      msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 
                                      msg.role === 'system' ? 'bg-gray-800/50 border border-orange-500/30 text-gray-300 text-xs font-mono' : // Distinct Organizer style
                                      'bg-gray-800 text-gray-200 rounded-bl-none'
                                  }`}>
                                      {/* Message Edit/Delete Controls */}
                                      {/* Logic: Always visible on mobile (since no hover), hover on desktop */}
                                      <div className={`absolute -top-3 z-30 ${msg.role === 'user' ? '-left-0 md:-left-16' : '-right-0 md:-right-16'} opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity flex gap-1 bg-gray-900/90 p-1 rounded-full border border-gray-700 shadow-md`}>
                                          {msg.role === 'user' && (
                                              <>
                                                <button onClick={() => {
                                                    setEditingMsgIndex(idx);
                                                    setEditingMsgText(msg.text);
                                                }} className="p-1 hover:text-blue-300 text-gray-400"><Icons.Pencil className="w-3 h-3"/></button>
                                                <button onClick={() => handleDeleteMessage(idx)} className="p-1 hover:text-red-300 text-gray-400"><Icons.Trash2 className="w-3 h-3"/></button>
                                              </>
                                          )}
                                          {msg.role === 'model' && (
                                              <button onClick={() => handleRegenerateChat(idx)} className="p-1 hover:text-green-300 text-gray-400"><Icons.RefreshCw className="w-3 h-3"/></button>
                                          )}
                                      </div>
                                      
                                      {editingMsgIndex === idx ? (
                                          <div className="min-w-[200px] md:min-w-[300px] text-gray-900">
                                              <textarea 
                                                value={editingMsgText}
                                                onChange={e => setEditingMsgText(e.target.value)}
                                                className="w-full bg-gray-100 border border-blue-500 rounded p-2 text-sm mb-2 outline-none text-gray-800"
                                                rows={3}
                                              />
                                              <div className="flex gap-2 justify-end flex-wrap">
                                                   <button onClick={() => setEditingMsgIndex(null)} className="text-xs bg-gray-700 text-gray-300 px-3 py-1 rounded hover:bg-gray-600">Cancel</button>
                                                   <button onClick={() => handleUpdateMessage(idx, editingMsgText)} className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-400">Save</button>
                                                   <button onClick={() => handleSaveAndRegenerate(idx, editingMsgText)} className="text-xs bg-purple-600 text-white px-3 py-1 rounded hover:bg-purple-500 border border-purple-400 shadow-sm flex items-center gap-1">
                                                       <Icons.RefreshCw className="w-3 h-3" /> <span className="hidden sm:inline">Restart</span>
                                                   </button>
                                              </div>
                                          </div>
                                      ) : (
                                          <div className="whitespace-pre-wrap leading-relaxed">
                                              {msg.text}
                                          </div>
                                      )}
                                      
                                      {/* System Action Buttons */}
                                      {msg.role === 'system' && msg.relatedEntryIds && (
                                          <div className="mt-2 flex gap-2">
                                              {msg.text.includes("(Revoked)") ? (
                                                  <span className="flex items-center gap-1 text-green-400 text-xs">
                                                      <Icons.Check className="w-3 h-3" /> Revoked
                                                  </span>
                                              ) : (
                                                  <button onClick={() => handleUndo(idx, msg.relatedEntryIds!)} className="text-xs bg-red-900/30 text-red-300 px-2 py-1 rounded border border-red-800/50 hover:bg-red-900/50">
                                                      Revoke
                                                  </button>
                                              )}
                                          </div>
                                      )}
                                      
                                      <div className="text-[10px] opacity-40 mt-2 text-right">
                                          {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                      </div>
                                  </div>
                              </div>
                          ))}
                          {isProcessing && (
                             <div className="flex justify-start animate-pulse">
                                 <div className="bg-gray-800/50 rounded-2xl p-3 flex items-center gap-2">
                                     <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" />
                                     <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce delay-75" />
                                     <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce delay-150" />
                                     <span className="text-xs text-gray-500 ml-2">Thinking...</span>
                                 </div>
                             </div>
                          )}
                          <div ref={chatEndRef} />
                      </div>

                      {/* AI Control & Input Area Container */}
                      {/* Fixed to bottom above nav bar on mobile */}
                      <div className="bg-gray-900/95 border-t border-gray-800 backdrop-blur-sm absolute bottom-0 md:bottom-0 left-0 right-0 z-40 pb-[env(safe-area-inset-bottom)]">
                          
                          {/* AI Control Bar */}
                          <div className="flex items-center justify-between px-2 md:px-4 py-2 bg-gray-800/50 border-b border-gray-800">
                             <div className="flex items-center gap-2 md:gap-3">
                                 <button onClick={() => setShowAIControl(!showAIControl)} className={`flex items-center gap-2 px-3 py-1 rounded text-xs transition-colors ${showAIControl ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                                     <Icons.Cpu className="w-3 h-3" />
                                     <span className="hidden sm:inline">AI Control</span>
                                     <Icons.ChevronUp className={`w-3 h-3 transition-transform ${showAIControl ? 'rotate-180' : ''}`} />
                                 </button>
                                 <div className="h-4 w-px bg-gray-700" />
                                 <div className="flex gap-2 text-[10px] text-gray-500">
                                     <span className={chatSettings.chatEnabled ? 'text-blue-400' : ''}>Chat</span>
                                     <span>•</span>
                                     <span className={chatSettings.organizerEnabled ? 'text-orange-400' : ''}>Org</span>
                                 </div>
                             </div>
                             <div className="text-[10px] text-gray-600 font-mono hidden sm:block">
                                 Mem: {chatSettings.contextMode === 'global' ? 'All' : chatSettings.contextMode}
                             </div>
                          </div>

                          {/* Expandable Settings Panel */}
                          {showAIControl && (
                              <div className="p-4 border-b border-gray-800 animate-fade-in bg-gray-900 shadow-xl max-h-[50vh] overflow-y-auto">
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                      {/* Column 1: Capabilities */}
                                      <div className="space-y-3">
                                          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Independent Modules</h4>
                                          <div className="flex items-center justify-between bg-gray-800 p-2 rounded px-3">
                                              <div className="flex items-center gap-2">
                                                  <Icons.MessageCircle className="w-4 h-4 text-blue-400" />
                                                  <span className="text-sm">Companion AI (Chat)</span>
                                              </div>
                                              <input type="checkbox" checked={chatSettings.chatEnabled} onChange={e => setChatSettings({...chatSettings, chatEnabled: e.target.checked})} className="accent-blue-500" />
                                          </div>
                                          <div className="flex items-center justify-between bg-gray-800 p-2 rounded px-3">
                                              <div className="flex items-center gap-2">
                                                  <Icons.Database className="w-4 h-4 text-orange-400" />
                                                  <div className="flex flex-col">
                                                      <span className="text-sm">Organizer AI</span>
                                                      <span className="text-[10px] text-gray-500">Processes latest message only</span>
                                                  </div>
                                              </div>
                                              <input type="checkbox" checked={chatSettings.organizerEnabled} onChange={e => setChatSettings({...chatSettings, organizerEnabled: e.target.checked})} className="accent-orange-500" />
                                          </div>
                                      </div>

                                      {/* Column 2: Context & Memory */}
                                      <div className="space-y-3">
                                          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Context & Memory</h4>
                                          
                                          {/* Time Span */}
                                          <div className="flex bg-gray-800 rounded p-1 gap-1">
                                              {['global', 'today', 'week', 'custom'].map(m => (
                                                  <button 
                                                    key={m} 
                                                    onClick={() => setChatSettings({...chatSettings, contextMode: m as any})}
                                                    className={`flex-1 py-1 text-xs rounded capitalize ${chatSettings.contextMode === m ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
                                                  >
                                                      {m}
                                                  </button>
                                              ))}
                                          </div>
                                          
                                          {chatSettings.contextMode === 'custom' && (
                                              <div className="flex gap-2 text-xs">
                                                  <input type="date" value={chatSettings.customStartDate} onChange={e => setChatSettings({...chatSettings, customStartDate: e.target.value})} className="bg-gray-800 border border-gray-700 rounded px-2 py-1" />
                                                  <span className="py-1 text-gray-500">to</span>
                                                  <input type="date" value={chatSettings.customEndDate} onChange={e => setChatSettings({...chatSettings, customEndDate: e.target.value})} className="bg-gray-800 border border-gray-700 rounded px-2 py-1" />
                                              </div>
                                          )}

                                          {/* Rounds Input */}
                                          <div>
                                              <div className="flex justify-between items-center text-xs text-gray-400 mb-2">
                                                  <span>Context Depth (Rounds)</span>
                                                  <label className="flex items-center gap-1.5 cursor-pointer hover:text-purple-300 transition-colors">
                                                      <input 
                                                          type="checkbox" 
                                                          checked={chatSettings.contextRounds >= 9999}
                                                          onChange={e => setChatSettings({
                                                              ...chatSettings, 
                                                              contextRounds: e.target.checked ? 9999 : 10
                                                          })}
                                                          className="accent-purple-500 w-3 h-3 rounded-sm"
                                                      />
                                                      <span className="text-[10px] font-mono uppercase tracking-wider">Infinite Mode</span>
                                                  </label>
                                              </div>
                                              <input 
                                                type="number" 
                                                min="0"
                                                disabled={chatSettings.contextRounds >= 9999}
                                                value={chatSettings.contextRounds >= 9999 ? '' : chatSettings.contextRounds} 
                                                onChange={e => {
                                                    const val = parseInt(e.target.value);
                                                    setChatSettings({...chatSettings, contextRounds: isNaN(val) ? 0 : val});
                                                }}
                                                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 focus:border-purple-500 outline-none disabled:opacity-30 disabled:cursor-not-allowed placeholder-gray-600 font-mono transition-colors"
                                                placeholder={chatSettings.contextRounds >= 9999 ? "Processing all history..." : "Enter number of rounds..."}
                                              />
                                          </div>
                                      </div>
                                  </div>
                              </div>
                          )}

                          {/* Input Area */}
                          <div className="p-2 md:p-4">
                              <div className="flex items-end gap-2 bg-gray-800 p-2 rounded-xl border border-gray-700 focus-within:border-blue-500 transition-colors">
                                  <button className="p-2 text-gray-400 hover:text-white transition-colors">
                                      <Icons.Paperclip className="w-5 h-5" />
                                      <input type="file" className="hidden" ref={fileInputRef} />
                                  </button>
                                  <textarea 
                                    value={inputText}
                                    onChange={e => setInputText(e.target.value)}
                                    onKeyDown={e => {
                                        if(e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSendMessage();
                                        }
                                    }}
                                    placeholder="Type a message..."
                                    className="flex-1 bg-transparent border-none outline-none resize-none h-10 max-h-32 py-2 text-sm custom-scrollbar"
                                  />
                                  {isProcessing ? (
                                      <button onClick={handleStop} className="p-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors">
                                          <div className="w-5 h-5 flex items-center justify-center font-bold">■</div>
                                      </button>
                                  ) : (
                                      <button onClick={handleSendMessage} className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors shadow-lg shadow-blue-900/20">
                                          <Icons.Send className="w-5 h-5" />
                                      </button>
                                  )}
                              </div>
                          </div>
                      </div>
                  </div>
              )}

              {activeTab === 'dashboard' && (
                  <div className="h-full overflow-y-auto p-4 md:p-8 custom-scrollbar">
                      <DashboardView 
                        entries={entries} 
                        viewDate={viewDate} 
                        viewMode={viewMode}
                        setViewDate={setViewDate}
                        setViewMode={setViewMode}
                        setEditingEntry={setEditingEntry}
                        setEntries={setEntries}
                        rawLogs={rawLogs}
                        setRawLogs={setRawLogs}
                      />
                  </div>
              )}

              {activeTab === 'settings' && (
                  <div className="h-full overflow-y-auto p-4 md:p-8 pb-32 custom-scrollbar max-w-5xl mx-auto">
                      <div className="space-y-12">
                           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-4">
                                    <h3 className="text-xl font-bold flex items-center gap-2 text-blue-400">
                                        <Icons.Bot className="w-5 h-5" /> Chat Persona
                                    </h3>
                                    <textarea 
                                        value={aiConfig.chatInstructions} 
                                        onChange={e => setAiConfig({...aiConfig, chatInstructions: e.target.value})}
                                        className="w-full h-48 bg-gray-800 border border-gray-700 rounded-xl p-4 text-sm font-mono focus:border-blue-500 outline-none" 
                                    />
                                </div>
                                <div className="space-y-4">
                                    <h3 className="text-xl font-bold flex items-center gap-2 text-orange-400">
                                        <Icons.Database className="w-5 h-5" /> Organizer Logic
                                    </h3>
                                    <textarea 
                                        value={aiConfig.organizerInstructions} 
                                        onChange={e => setAiConfig({...aiConfig, organizerInstructions: e.target.value})}
                                        className="w-full h-48 bg-gray-800 border border-gray-700 rounded-xl p-4 text-sm font-mono focus:border-orange-500 outline-none" 
                                    />
                                </div>
                           </div>
                           
                           <div className="border-t border-gray-800 pt-8">
                                <div className="flex flex-col gap-4">
                                    <h4 className="text-lg font-bold text-gray-300 flex items-center gap-2">
                                        <Icons.Key className="w-5 h-5 text-yellow-400" />
                                        API Configuration (GitHub Pages Support)
                                    </h4>
                                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                                        <label className="block text-xs text-gray-500 uppercase mb-2">Google Gemini API Key</label>
                                        <input 
                                            type="password" 
                                            value={userApiKey} 
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                setUserApiKey(val);
                                                localStorage.setItem('lifeos_google_api_key', val);
                                            }}
                                            placeholder="Enter your AI Studio API Key here..."
                                            className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-sm text-white focus:border-yellow-500 outline-none" 
                                        />
                                        <p className="text-xs text-gray-500 mt-2">
                                            The key is stored locally in your browser. Required for deployments without environment variables.
                                        </p>
                                    </div>
                                </div>
                           </div>

                           <div className="border-t border-gray-800 pt-8">
                               {renderSchemaEditor()}
                           </div>

                           <div className="border-t border-gray-800 pt-8">
                                <div className="flex flex-col gap-4">
                                    <h4 className="text-lg font-bold text-gray-300 flex items-center gap-2">
                                        <Icons.HardDriveDownload className="w-5 h-5 text-green-400" />
                                        Data Backup & Restore
                                    </h4>
                                    <div className="flex gap-4">
                                        <button onClick={handleExportData} className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors border border-gray-700">
                                            <Icons.Download className="w-4 h-4" />
                                            Export JSON
                                        </button>
                                        <button onClick={() => backupInputRef.current?.click()} className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors border border-gray-700">
                                            <Icons.Upload className="w-4 h-4" />
                                            Import JSON
                                        </button>
                                        <input type="file" ref={backupInputRef} onChange={handleImportData} className="hidden" accept=".json" />
                                    </div>
                                    <p className="text-xs text-gray-500">
                                        Save your data to a local file. Useful for backing up or migrating to another device.
                                    </p>
                                </div>
                           </div>

                           <div className="border-t border-gray-800 pt-8">
                               <div className="flex justify-between items-center bg-red-900/10 border border-red-900/30 p-6 rounded-xl">
                                   <div>
                                       <h4 className="text-red-400 font-bold">Danger Zone</h4>
                                       <p className="text-xs text-red-400/60 mt-1">Irreversibly wipe all local data</p>
                                   </div>
                                   <button onClick={() => {
                                       if(window.confirm("NUKE EVERYTHING? This cannot be undone.")) {
                                           localStorage.clear();
                                           window.location.reload();
                                       }
                                   }} className="bg-red-900/50 hover:bg-red-800 text-red-200 px-4 py-2 rounded text-sm border border-red-800">Clear All Data</button>
                               </div>
                           </div>
                      </div>
                  </div>
              )}
          </div>

          {/* Overlays */}
          {editingEntry && renderEditModal()}
      </main>

      {/* Bottom Navigation for Mobile */}
      <nav className="md:hidden bg-gray-900 border-t border-gray-800 flex justify-around items-center pb-[env(safe-area-inset-bottom)] shrink-0 z-50">
        {[
            { id: 'chat', icon: 'MessageSquare', label: 'Chat' },
            { id: 'dashboard', icon: 'LayoutGrid', label: 'Dashboard' },
            { id: 'settings', icon: 'Settings', label: 'Settings' }
        ].map(item => (
            <button 
                key={item.id}
                onClick={() => setActiveTab(item.id as 'chat' | 'dashboard' | 'settings')}
                className={`flex flex-col items-center justify-center w-full py-3 transition-colors ${activeTab === item.id ? 'text-blue-400 bg-gray-800/50' : 'text-gray-500'}`}
            >
                <IconComponent name={item.icon} className="w-6 h-6 mb-1" />
                <span className="text-[10px] font-medium">{item.label}</span>
            </button>
        ))}
      </nav>
    </div>
  );
}

// Mount the application
const root = createRoot(document.getElementById('root')!);
root.render(<Index />);