export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
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
}

export type ChatEventType =
  | 'message_received'
  | 'context'
  | 'core_done'
  | 'breath_done'
  | 'dream_done'
  | 'feel_done'
  | 'error'
  | 'done'
  | 'token'
  | 'message_done';

export interface ChatEvent {
  event: ChatEventType;
  data: {
    stage?: keyof StartupContext;
    status?: string;
    chars?: number;
    label?: string;
    conversation_id?: string;
    persona?: string;
    assistant_response?: string | null;
    text?: string;
    error?: string;
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
  created_at: string;
  updated_at: string;
}
