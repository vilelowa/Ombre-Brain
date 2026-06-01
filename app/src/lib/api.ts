import {
  AwakeningConfigureResponse,
  AwakeningLogEntry,
  AwakeningSchedulerConfig,
  AwakeningStatus,
  AwakeningTriggerResponse,
  ChatCreateResponse,
  ChatEvent,
  Conversation,
  Dream,
  Message,
  PrivateDiaryEntry,
  StartupContext,
  StartupContextResponse,
} from '../types';

type BackendDream = {
  id: string;
  content: string;
  influence_type: Dream['influenceType'];
  source_bucket_ids?: string[];
  valence: number;
  arousal: number;
  created: string;
  name?: string;
};

type PushSubscribeResponse = {
  ok?: boolean;
  status?: string;
  subscriptions?: number;
  error?: string;
};

type PushTestResponse = {
  ok?: boolean;
  status?: string;
  queued?: boolean;
  subscriptions?: number;
  reason?: string;
  error?: string;
};

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error || `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function mapDream(dream: BackendDream): Dream {
  return {
    id: dream.id,
    influenceType: dream.influence_type,
    createdAt: dream.created,
    text: dream.content,
    valence: dream.valence,
    arousal: dream.arousal,
    name: dream.name,
    sourceBucketIds: dream.source_bucket_ids || [],
  };
}

function eventSourceUrl(path: string): string {
  const url = apiUrl(path);
  if (url.startsWith('http')) {
    return url;
  }
  return url || path;
}

class ApiService {
  get baseUrl(): string {
    return API_BASE_URL || window.location.origin;
  }

  /* GET /api/context/startup */
  async getStartupContext(): Promise<StartupContext> {
    await this.getStartupContextDetails();
    return {
      core: 'done',
      breath: 'done',
      dream: 'done',
      feel: 'done',
    };
  }

  async getStartupContextDetails(): Promise<StartupContextResponse> {
    const response = await fetch(apiUrl('/api/context/startup'));
    return readJson<StartupContextResponse>(response);
  }

  /* POST /api/chat */
  async sendMessage(content: string, persona = 'elroy-default'): Promise<Message> {
    await this.createChat(content, persona);
    return {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
  }

  async createChat(
    content: string, 
    persona = 'elroy-default', 
    conversationId?: string | null,
    parentId?: string | null
  ): Promise<ChatCreateResponse> {
    const response = await fetch(apiUrl('/api/chat'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        message: content, 
        persona,
        conversation_id: conversationId || undefined,
        parent_id: parentId || undefined
      }),
    });
    return readJson<ChatCreateResponse>(response);
  }

  /* GET /api/chat/{conversation_id}/events */
  openChatEvents(
    eventStreamPath: string,
    onEvent: (event: ChatEvent) => void,
    onError?: (error: Event) => void,
  ): EventSource {
    const source = new EventSource(eventSourceUrl(eventStreamPath));
    const eventTypes: ChatEvent['event'][] = [
      'message_received',
      'context',
      'core_done',
      'breath_done',
      'dream_done',
      'feel_done',
      'error',
      'done',
      'token',
      'message_done',
    ];

    eventTypes.forEach((eventName) => {
      source.addEventListener(eventName, (event) => {
        const message = event as MessageEvent<string>;
        const data = JSON.parse(message.data || '{}');
        onEvent({event: eventName, data});
      });
    });

    source.onerror = (error) => {
      onError?.(error);
    };
    return source;
  }

  // Fetch message history for a conversation
  async getChatEvents(conversationId: string): Promise<Message[]> {
    if (!conversationId || conversationId === 'default') {
      return [];
    }
    const response = await fetch(apiUrl(`/api/conversations/${encodeURIComponent(conversationId)}/messages`));
    const rawMsgs = await readJson<any[]>(response);
    return rawMsgs.map((m) => ({
      id: m.id || crypto.randomUUID(),
      role: m.role,
      content: m.content,
      createdAt: m.created_at || new Date().toISOString(),
    }));
  }

  // Fetch all conversation metadata
  async getConversations(): Promise<Conversation[]> {
    const response = await fetch(apiUrl('/api/conversations'));
    return readJson<Conversation[]>(response);
  }

  // Delete a conversation thread
  async deleteConversation(conversationId: string): Promise<{ ok: boolean }> {
    const response = await fetch(apiUrl(`/api/conversations/${encodeURIComponent(conversationId)}`), {
      method: 'DELETE',
    });
    return readJson<{ ok: boolean }>(response);
  }

  // Compatibility shim until /api/chat produces real assistant text.
  async generateAssistantResponse(): Promise<Message> {
    return {
      id: crypto.randomUUID(),
      role: 'system',
      content: 'Context is ready. Assistant response generation is not wired yet.',
      createdAt: new Date().toISOString(),
    };
  }

  /* GET /api/dreams */
  async getDreams(): Promise<Dream[]> {
    const response = await fetch(apiUrl('/api/dreams'));
    const dreams = await readJson<BackendDream[]>(response);
    return dreams.map(mapDream);
  }

  /* POST /api/push/subscribe */
  async subscribePush(subscription?: PushSubscription): Promise<PushSubscribeResponse> {
    if (!subscription) {
      return {ok: false, status: 'not_subscribed', error: 'Push subscription is required'};
    }
    const response = await fetch(apiUrl('/api/push/subscribe'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(subscription.toJSON()),
    });
    return readJson<PushSubscribeResponse>(response);
  }

  /* POST /api/push/test */
  async testPush(): Promise<PushTestResponse> {
    const response = await fetch(apiUrl('/api/push/test'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
    });
    return readJson<PushTestResponse>(response);
  }

  /* GET /api/push/public-key */
  async getPushPublicKey(): Promise<{ public_key: string }> {
    const response = await fetch(apiUrl('/api/push/public-key'));
    return readJson<{ public_key: string }>(response);
  }

  /* GET /api/awakening/status */
  async getAwakeningStatus(): Promise<AwakeningStatus> {
    const response = await fetch(apiUrl('/api/awakening/status'));
    return readJson<AwakeningStatus>(response);
  }

  /* GET /api/awakening/log */
  async getAwakeningLog(limit = 12): Promise<AwakeningLogEntry[]> {
    const response = await fetch(apiUrl(`/api/awakening/log?limit=${encodeURIComponent(limit)}`));
    return readJson<AwakeningLogEntry[]>(response);
  }

  /* POST /api/awakening/trigger */
  async triggerAwakening(): Promise<AwakeningTriggerResponse> {
    const response = await fetch(apiUrl('/api/awakening/trigger'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
    });
    return readJson<AwakeningTriggerResponse>(response);
  }

  /* POST /api/awakening/configure */
  async configureAwakening(
    scheduler: Partial<AwakeningSchedulerConfig>,
    persist = false,
  ): Promise<AwakeningConfigureResponse> {
    const response = await fetch(apiUrl('/api/awakening/configure'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({scheduler, persist}),
    });
    return readJson<AwakeningConfigureResponse>(response);
  }

  /* GET /api/private-diary */
  async getPrivateDiary(limit = 20, includeLocked = true): Promise<PrivateDiaryEntry[]> {
    const params = new URLSearchParams({
      limit: String(limit),
      include_locked: String(includeLocked),
    });
    const response = await fetch(apiUrl(`/api/private-diary?${params.toString()}`));
    return readJson<PrivateDiaryEntry[]>(response);
  }
}

export const api = new ApiService();
