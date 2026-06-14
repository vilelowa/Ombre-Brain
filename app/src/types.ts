export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  reasoning?: string | null;
  createdAt: string;
  dreamFlagged?: boolean;
  isHistory?: boolean;
  attachments?: string[];
  metadata?: {
    attachment_summaries?: Record<string, string>;
  };
}

export interface Dream {
  id: string;
  influenceType: 'tone' | 'attention' | 'unresolved';
  createdAt: string;
  text: string;
  valence: number; // 0-1
  arousal: number; // 0-1
  name?: string;
  sourceBucketIds?: string[];
  comments?: {
    id: string;
    author: string;
    content: string;
    created: string;
  }[];
}

export type ContextState = 'pending' | 'running' | 'done' | 'error';

export interface StartupContext {
  core: ContextState;
  breath: ContextState;
  dream: ContextState;
  feel: ContextState;
}

export interface StartupContextResponse {
  context: Record<keyof StartupContext, string>;
  events: ChatEvent[];
}

export interface ChatCreateResponse {
  conversation_id: string;
  event_stream: string;
  status: string;
  context: Record<keyof StartupContext, string>;
  user_message_id?: string;
}

export type ChatEventType =
  | 'message_received'
  | 'context'
  | 'core_done'
  | 'breath_done'
  | 'dream_done'
  | 'feel_done'
  | 'thinking_token'
  | 'cache_stats'
  | 'error'
  | 'done'
  | 'token'
  | 'message_done'
  | 'tool_call';

export interface ChatEvent {
  event: ChatEventType;
  data: {
    stage?: keyof StartupContext;
    status?: string;
    chars?: number;
    label?: string;
    name?: string;
    conversation_id?: string;
    persona?: string;
    assistant_response?: string | null;
    assistant_reasoning?: string | null;
    text?: string;
    error?: string;
    message_id?: string;
    cache_read?: number;
    cache_creation?: number;
    input_tokens?: number;
    hit_pct?: number;
  };
}

export type AwakeningAnchorStatus = 'passed' | 'current' | 'upcoming';

export interface AwakeningAnchor {
  time: string;
  status: AwakeningAnchorStatus;
}

export interface AwakeningLogEntry {
  timestamp: string;
  aborted: boolean;
  abort_reason: string | null;
  dice: number | null;
  action: 'push' | 'diary' | 'idle' | string | null;
  message_preview: string | null;
  private_entry_id?: string | null;
  next_wake_time: string | null;
}

export interface AwakeningStatus {
  enabled: boolean;
  running: boolean;
  current_time: string;
  next_wake_time: string | null;
  today_anchors: AwakeningAnchor[];
  sleep_window: {
    start: string;
    end: string;
  };
  wake_limits: {
    min_minutes: number;
    max_minutes: number;
  };
  dice_threshold: number;
  last_message_time: string | null;
  last_awakening: AwakeningLogEntry | null;
  model: string;
}

export interface AwakeningSchedulerConfig {
  enabled: boolean;
  anchors: string[];
  sleep_window: {
    start: string;
    end: string;
  };
  wake_limits: {
    min_minutes: number;
    max_minutes: number;
  };
  dice_threshold: number;
  timezone?: string;
  cache_ttl_minutes?: number;
}

export interface AwakeningTriggerResponse {
  ok: boolean;
  result?: AwakeningLogEntry;
  error?: string;
}

export interface AwakeningConfigureResponse {
  ok: boolean;
  updated?: string[];
  scheduler?: AwakeningSchedulerConfig;
  status?: AwakeningStatus;
  error?: string;
}

export interface PrivateDiaryEntry {
  id: string;
  name?: string;
  created?: string;
  locked: boolean;
  locked_until?: string | null;
  content: string | null;
}

export interface Conversation {
  id: string;
  title: string;
  persona: string;
  summary?: string;
  folder_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationFolder {
  id: string;
  name: string;
  color?: string | null;
  created_at: string;
}

export interface PersonaProfile {
  id: string;
  name: string;
  icon: string;
  model: string;
  base_prompt: string;
  chat_history_limit: number;
  compaction_strategy: 'summarize' | 'hybrid' | 'truncate';
}

export interface Book {
  id: string;
  title: string;
  author: string;
  filename: string;
  extension: string;
  cover_url: string | null;
  created_at: string;
  archived?: boolean;
  archived_at?: string | null;
  finished_at?: string | null;
  content_available?: boolean;
  chapters: { title: string; length: number }[];
  progress?: ReadingProgress | null;
}

export interface ReadingProgress {
  chapter_idx: number;
  percentage: number;
  last_read_position: string;
  updated_at: string;
}

export interface BookChapter {
  title: string;
  content: string;
}

export interface ReadingComment {
  id: string;
  book_id: string;
  book_name: string;
  chapter: string;
  chapter_idx?: number | null;
  character_offset?: number | null;
  original: string;
  comment: string;
  category: ReadingCategory | null;
  flag?: string | null;
  dream_candidate: boolean;
  created_at: string;
}

export interface ReadingBookmark {
  id: string;
  book_id: string;
  book_name: string;
  chapter: string;
  chapter_idx: number;
  character_offset: number;
  excerpt: string;
  created_at: string;
}

export type ReadingCategory = 'discuss' | 'resonance' | 'question';
