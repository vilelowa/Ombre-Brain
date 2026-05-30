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
