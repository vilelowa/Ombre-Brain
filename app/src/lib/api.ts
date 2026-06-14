import {
  AwakeningConfigureResponse,
  AwakeningLogEntry,
  AwakeningSchedulerConfig,
  AwakeningStatus,
  AwakeningTriggerResponse,
  ChatCreateResponse,
  ChatEvent,
  Conversation,
  ConversationFolder,
  Dream,
  Message,
  PersonaProfile,
  PrivateDiaryEntry,
  StartupContext,
  StartupContextResponse,
  Book,
  BookChapter,
  ReadingBookmark,
  ReadingCategory,
  ReadingComment,
  ReadingProgress,
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
  comments?: any[];
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


async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem('ombre_api_token');
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('ombre-auth-failed'));
  }
  return response;
}

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
    comments: dream.comments || [],
  };
}

function eventSourceUrl(path: string): string {
  let url = apiUrl(path) || path;
  const token = localStorage.getItem('ombre_api_token') || '';
  if (token) {
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}token=${encodeURIComponent(token)}`;
  }
  return url;
}

class ApiService {
  get baseUrl(): string {
    return API_BASE_URL || window.location.origin;
  }

  /* ── config ── */
  async getConfig(): Promise<Record<string, any>> {
    const response = await apiFetch(apiUrl('/api/config'));
    return readJson<Record<string, any>>(response);
  }



  async updateConfig(config: Record<string, any>): Promise<{ ok: boolean }> {
    const response = await apiFetch(apiUrl('/api/config'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(config),
    });
    return readJson<{ ok: boolean }>(response);
  }

  /* ── System Prompts ── */
  async getSystemPrompts(): Promise<Record<string, string>> {
    const response = await apiFetch(apiUrl('/api/system-prompts'));
    return readJson<Record<string, string>>(response);
  }

  async updateSystemPrompts(prompts: Record<string, string | null>): Promise<{ ok: boolean, system_prompts: Record<string, string> }> {
    const response = await apiFetch(apiUrl('/api/system-prompts'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(prompts),
    });
    return readJson<{ ok: boolean, system_prompts: Record<string, string> }>(response);
  }

  async resetSystemPrompt(key: string): Promise<{ ok: boolean }> {
    const response = await apiFetch(apiUrl('/api/system-prompts/reset'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ key }),
    });
    return readJson<{ ok: boolean }>(response);
  }

  async regenerateChat(conversationId: string): Promise<ChatCreateResponse> {
    const response = await apiFetch(apiUrl(`/api/chat/${conversationId}/regenerate`), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'}
    });
    return readJson<ChatCreateResponse>(response);
  }

  async uploadAttachment(file: File): Promise<{ ok: boolean, url: string, filename: string }> {
    const formData = new FormData();
    formData.append('file', file);
    
    const token = localStorage.getItem('ombre_api_token');
    const headers = new Headers();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    
    const response = await fetch(apiUrl('/api/upload'), {
      method: 'POST',
      headers,
      body: formData,
    });
    
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent('ombre-auth-failed'));
    }
    return readJson<{ ok: boolean, url: string, filename: string }>(response);
  }

  /* --- Stats APIs --- */
  async getStatsUsage(days = 7): Promise<any> {
    const response = await apiFetch(apiUrl(`/api/stats/usage?days=${encodeURIComponent(days)}`));
    return readJson<any>(response);
  }

  async getStatsSavings(days = 30): Promise<any> {
    const response = await apiFetch(apiUrl(`/api/stats/savings?days=${encodeURIComponent(days)}`));
    return readJson<any>(response);
  }

  async getStatus(): Promise<any> {
    const response = await apiFetch(apiUrl('/api/status'));
    return readJson<any>(response);
  }

  async getHostVault(): Promise<any> {
    const response = await apiFetch(apiUrl('/api/host-vault'));
    return readJson<any>(response);
  }

  async updateHostVault(value: string): Promise<any> {
    const response = await apiFetch(apiUrl('/api/host-vault'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ value }),
    });
    return readJson<any>(response);
  }

  async testConfigApi(config: { model: string; base_url: string; api_key: string; tab?: string }): Promise<{ ok: boolean; message?: string }> {
    const response = await apiFetch(apiUrl('/api/config/test'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(config),
    });
    return readJson<{ ok: boolean; message?: string }>(response);
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
    const response = await apiFetch(apiUrl('/api/context/startup'));
    return readJson<StartupContextResponse>(response);
  }

  /* GET /api/persona */
  async getPersona(): Promise<{ persona: string }> {
    const response = await apiFetch(apiUrl(`/api/persona?t=${Date.now()}`), { cache: 'no-store' });
    return readJson<{ persona: string }>(response);
  }

  /* POST /api/persona */
  async updatePersona(persona: string): Promise<{ ok: boolean }> {
    const response = await apiFetch(apiUrl('/api/persona'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ persona }),
    });
    return readJson<{ ok: boolean }>(response);
  }

  /* ── Persona Profiles ── */
  async getPersonaProfiles(): Promise<PersonaProfile[]> {
    const response = await apiFetch(apiUrl(`/api/persona-profiles?t=${Date.now()}`), { cache: 'no-store' });
    return readJson<PersonaProfile[]>(response);
  }

  async createPersonaProfile(profile: Partial<PersonaProfile>): Promise<PersonaProfile> {
    const response = await apiFetch(apiUrl('/api/persona-profiles'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(profile),
    });
    return readJson<PersonaProfile>(response);
  }

  async updatePersonaProfile(id: string, profile: Partial<PersonaProfile>): Promise<PersonaProfile> {
    const response = await apiFetch(apiUrl(`/api/persona-profiles/${encodeURIComponent(id)}`), {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(profile),
    });
    return readJson<PersonaProfile>(response);
  }

  async deletePersonaProfile(id: string): Promise<{ ok: boolean }> {
    const response = await apiFetch(apiUrl(`/api/persona-profiles/${encodeURIComponent(id)}`), {
      method: 'DELETE',
    });
    return readJson<{ ok: boolean }>(response);
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
    parentId?: string | null,
    attachments?: string[],
  ): Promise<ChatCreateResponse> {
    const response = await apiFetch(apiUrl('/api/chat'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        message: content, 
        persona,
        conversation_id: conversationId || undefined,
        parent_id: parentId || undefined,
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
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
      'thinking_token',
      'cache_stats',
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
    const response = await apiFetch(apiUrl(`/api/conversations/${encodeURIComponent(conversationId)}/messages`));
    const rawMsgs = await readJson<any[]>(response);
    return rawMsgs.map((m) => ({
      id: m.id || crypto.randomUUID(),
      role: m.role,
      content: m.content,
      reasoning: m.reasoning || null,
      createdAt: m.created_at || m.timestamp || new Date().toISOString(),
      dreamFlagged: m.dream_flagged || false,
      attachments: Array.isArray(m.attachments) ? m.attachments : undefined,
      metadata: m.metadata,
    }));
  }

  // Fetch all conversation metadata
  async getConversations(): Promise<Conversation[]> {
    const response = await apiFetch(apiUrl('/api/conversations'));
    return readJson<Conversation[]>(response);
  }

  async renameConversation(conversationId: string, title: string): Promise<{ ok: boolean; title: string }> {
    const response = await apiFetch(apiUrl(`/api/chat/${encodeURIComponent(conversationId)}/title`), {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ title }),
    });
    return readJson<{ ok: boolean; title: string }>(response);
  }

  async getFolders(): Promise<ConversationFolder[]> {
    const response = await apiFetch(apiUrl('/api/folders'));
    return readJson<ConversationFolder[]>(response);
  }

  async createFolder(name: string, color?: string | null): Promise<{ ok: boolean; folder: ConversationFolder }> {
    const response = await apiFetch(apiUrl('/api/folders'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ name, color }),
    });
    return readJson<{ ok: boolean; folder: ConversationFolder }>(response);
  }

  async updateFolder(folderId: string, folder: Partial<ConversationFolder>): Promise<{ ok: boolean; folder: ConversationFolder }> {
    const response = await apiFetch(apiUrl(`/api/folders/${encodeURIComponent(folderId)}`), {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(folder),
    });
    return readJson<{ ok: boolean; folder: ConversationFolder }>(response);
  }

  async deleteFolder(folderId: string): Promise<{ ok: boolean }> {
    const response = await apiFetch(apiUrl(`/api/folders/${encodeURIComponent(folderId)}`), {
      method: 'DELETE',
    });
    return readJson<{ ok: boolean }>(response);
  }

  async moveConversationToFolder(conversationId: string, folderId: string | null): Promise<{ ok: boolean; conversation_id: string; folder_id: string | null }> {
    const response = await apiFetch(apiUrl(`/api/conversations/${encodeURIComponent(conversationId)}/folder`), {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ folder_id: folderId }),
    });
    return readJson<{ ok: boolean; conversation_id: string; folder_id: string | null }>(response);
  }

  // Delete a conversation thread
  async deleteConversation(conversationId: string): Promise<{ ok: boolean }> {
    const response = await apiFetch(apiUrl(`/api/conversations/${encodeURIComponent(conversationId)}`), {
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
    const response = await apiFetch(apiUrl('/api/dreams'));
    const dreams = await readJson<BackendDream[]>(response);
    return dreams.map(mapDream);
  }

  /* GET /api/dream-candidates */
  async getDreamCandidates(): Promise<{ id: string; name: string; content: string; created: string }[]> {
    const response = await apiFetch(apiUrl('/api/dream-candidates'));
    return readJson<{ id: string; name: string; content: string; created: string }[]>(response);
  }

  /* DELETE /api/dream-candidates/{bucket_id} */
  async deleteDreamCandidate(bucketId: string): Promise<{ ok: boolean }> {
    const response = await apiFetch(apiUrl(`/api/dream-candidates/${encodeURIComponent(bucketId)}`), {
      method: 'DELETE',
    });
    return readJson<{ ok: boolean }>(response);
  }

  /* GET /api/buckets/{bucket_id} */
  async getBucket(bucketId: string): Promise<{ ok: boolean, bucket: any }> {
    const response = await apiFetch(apiUrl(`/api/buckets/${encodeURIComponent(bucketId)}`));
    return readJson<{ ok: boolean, bucket: any }>(response);
  }

  async getMemoryBuckets(limit = 500, type?: string, scope?: string, source?: string): Promise<any[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (type) params.set('type', type);
    if (scope) params.set('scope', scope);
    if (source) params.set('source', source);
    const response = await apiFetch(apiUrl(`/api/buckets?${params.toString()}`));
    const payload = await readJson<any>(response);
    if (Array.isArray(payload)) return payload;
    return payload?.buckets || [];
  }

  async getDailyJournals(limit = 2000): Promise<any[]> {
    return this.getMemoryBuckets(limit, undefined, undefined, 'daily_journal');
  }

  async getWeeklyJournals(limit = 500): Promise<any[]> {
    return this.getMemoryBuckets(limit, undefined, undefined, 'weekly_journal');
  }

  async getMonthlyJournals(limit = 200): Promise<any[]> {
    return this.getMemoryBuckets(limit, undefined, undefined, 'monthly_journal');
  }

  async getYearlyJournals(limit = 50): Promise<any[]> {
    return this.getMemoryBuckets(limit, undefined, undefined, 'yearly_journal');
  }

  async updateMemoryBucket(bucketId: string, updates: Record<string, any>): Promise<{ ok: boolean }> {
    const response = await apiFetch(apiUrl(`/api/buckets/${encodeURIComponent(bucketId)}`), {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(updates),
    });
    return readJson<{ ok: boolean }>(response);
  }

  async deleteMemoryBucket(bucketId: string): Promise<{ ok: boolean }> {
    const response = await apiFetch(apiUrl(`/api/buckets/${encodeURIComponent(bucketId)}`), {
      method: 'DELETE',
    });
    return readJson<{ ok: boolean }>(response);
  }

  async getCoreMemories(): Promise<any[]> {
    const response = await apiFetch(apiUrl('/api/core-memories'));
    const payload = await readJson<{ ok: boolean; entries: any[] }>(response);
    return payload.entries || [];
  }

  async createCoreMemory(input: { name: string; content: string; tags?: string[]; since?: string; order?: number }): Promise<{ ok: boolean; entry: any }> {
    const response = await apiFetch(apiUrl('/api/core-memories'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(input),
    });
    return readJson<{ ok: boolean; entry: any }>(response);
  }

  async updateCoreMemory(coreId: string, updates: Record<string, any>): Promise<{ ok: boolean; entry: any }> {
    const response = await apiFetch(apiUrl(`/api/core-memories/${encodeURIComponent(coreId)}`), {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(updates),
    });
    return readJson<{ ok: boolean; entry: any }>(response);
  }

  async deleteCoreMemory(coreId: string): Promise<{ ok: boolean }> {
    const response = await apiFetch(apiUrl(`/api/core-memories/${encodeURIComponent(coreId)}`), {
      method: 'DELETE',
    });
    return readJson<{ ok: boolean }>(response);
  }

  /* POST /api/dreams/{bucket_id}/comment */
  async addDreamComment(bucketId: string, content: string, author: string = 'Ciel'): Promise<{ ok: boolean, comment: any }> {
    const response = await apiFetch(apiUrl(`/api/dreams/${encodeURIComponent(bucketId)}/comment`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, author }),
    });
    return readJson<{ ok: boolean, comment: any }>(response);
  }

  /* POST /api/push/subscribe */
  async subscribePush(subscription?: PushSubscription): Promise<PushSubscribeResponse> {
    if (!subscription) {
      return {ok: false, status: 'not_subscribed', error: 'Push subscription is required'};
    }
    const response = await apiFetch(apiUrl('/api/push/subscribe'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(subscription.toJSON()),
    });
    return readJson<PushSubscribeResponse>(response);
  }

  /* POST /api/push/test */
  async testPush(): Promise<PushTestResponse> {
    const response = await apiFetch(apiUrl('/api/push/test'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
    });
    return readJson<PushTestResponse>(response);
  }

  /* GET /api/push/public-key */
  async getPushPublicKey(): Promise<{ public_key: string }> {
    const response = await apiFetch(apiUrl('/api/push/public-key'));
    return readJson<{ public_key: string }>(response);
  }

  /* GET /api/awakening/status */
  async getAwakeningStatus(): Promise<AwakeningStatus> {
    const response = await apiFetch(apiUrl('/api/awakening/status'));
    return readJson<AwakeningStatus>(response);
  }

  /* GET /api/awakening/log */
  async getAwakeningLog(limit = 12): Promise<AwakeningLogEntry[]> {
    const response = await apiFetch(apiUrl(`/api/awakening/log?limit=${encodeURIComponent(limit)}`));
    return readJson<AwakeningLogEntry[]>(response);
  }

  /* POST /api/awakening/trigger */
  async triggerAwakening(): Promise<AwakeningTriggerResponse> {
    const response = await apiFetch(apiUrl('/api/awakening/trigger'), {
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
    const response = await apiFetch(apiUrl('/api/awakening/configure'), {
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
    const response = await apiFetch(apiUrl(`/api/private-diary?${params.toString()}`));
    return readJson<PrivateDiaryEntry[]>(response);
  }

  /* POST /api/dream-candidate/from-message */
  async flagMessageAsDreamCandidate(content: string, messageId: string, conversationId: string): Promise<{ ok: boolean; bucket_id: string }> {
    const response = await apiFetch(apiUrl('/api/dream-candidate/from-message'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ content, message_id: messageId, conversation_id: conversationId }),
    });
    return readJson<{ ok: boolean; bucket_id: string }>(response);
  }

  /* POST /api/dream-candidate/unflag */
  async unflagMessageAsDreamCandidate(messageId: string, conversationId: string): Promise<{ ok: boolean }> {
    const response = await apiFetch(apiUrl('/api/dream-candidate/unflag'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ message_id: messageId, conversation_id: conversationId }),
    });
    return readJson<{ ok: boolean }>(response);
  }

  /* --- Reading Space APIs --- */
  async getReadingBooks(): Promise<Book[]> {
    const response = await apiFetch(apiUrl('/api/reading/books'));
    return readJson<Book[]>(response);
  }

  async uploadBook(file: File): Promise<{ ok: boolean; book: Book }> {
    const formData = new FormData();
    formData.append('file', file);
    const response = await apiFetch(apiUrl('/api/reading/upload'), {
      method: 'POST',
      body: formData,
    });
    return readJson<{ ok: boolean; book: Book }>(response);
  }

  async getBookDetails(bookId: string): Promise<Book> {
    const response = await apiFetch(apiUrl(`/api/reading/books/${encodeURIComponent(bookId)}`));
    return readJson<Book>(response);
  }

  async updateBook(
    bookId: string,
    updates: { title?: string; author?: string },
  ): Promise<{ ok: boolean; book: Omit<Book, 'chapters' | 'progress'> }> {
    const response = await apiFetch(apiUrl(`/api/reading/books/${encodeURIComponent(bookId)}`), {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(updates),
    });
    return readJson<{ ok: boolean; book: Omit<Book, 'chapters' | 'progress'> }>(response);
  }

  async archiveBook(bookId: string): Promise<{ ok: boolean; book: Book }> {
    const response = await apiFetch(apiUrl(`/api/reading/books/${encodeURIComponent(bookId)}/archive`), {
      method: 'POST',
    });
    return readJson<{ ok: boolean; book: Book }>(response);
  }

  async deleteBook(bookId: string): Promise<{ ok: boolean; deleted_notes: number }> {
    const response = await apiFetch(apiUrl(`/api/reading/books/${encodeURIComponent(bookId)}`), {
      method: 'DELETE',
    });
    return readJson<{ ok: boolean; deleted_notes: number }>(response);
  }

  async getBookChapter(bookId: string, chapterIdx: number): Promise<BookChapter> {
    const response = await apiFetch(apiUrl(`/api/reading/books/${encodeURIComponent(bookId)}/chapters/${chapterIdx}`));
    return readJson<BookChapter>(response);
  }

  async saveReadingProgress(
    bookId: string,
    progress: Pick<ReadingProgress, 'chapter_idx' | 'percentage'> & { last_read_position?: string },
  ): Promise<{ ok: boolean; progress: ReadingProgress }> {
    const response = await apiFetch(apiUrl(`/api/reading/books/${encodeURIComponent(bookId)}/progress`), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(progress),
    });
    return readJson<{ ok: boolean; progress: ReadingProgress }>(response);
  }

  async getReadingProgress(bookId: string): Promise<{ progress: ReadingProgress | null }> {
    const response = await apiFetch(apiUrl(`/api/reading/books/${encodeURIComponent(bookId)}/progress`));
    return readJson<{ progress: ReadingProgress | null }>(response);
  }

  async getRecentlyReadBook(): Promise<{ recent: { book: Book; progress: ReadingProgress } | null }> {
    const response = await apiFetch(apiUrl('/api/reading/progress/recent'));
    return readJson<{ recent: { book: Book; progress: ReadingProgress } | null }>(response);
  }

  async createReadingComment(comment: {
    book_id: string;
    book_name: string;
    chapter: string;
    chapter_idx?: number;
    character_offset?: number;
    original: string;
    comment: string;
    category: ReadingCategory | null;
  }): Promise<{ ok: boolean; comment: ReadingComment }> {
    const response = await apiFetch(apiUrl('/api/reading/comments'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(comment),
    });
    return readJson<{ ok: boolean; comment: ReadingComment }>(response);
  }

  async updateReadingComment(
    commentId: string,
    updates: {
      comment?: string;
      original?: string;
      category?: ReadingCategory | null;
      chapter_idx?: number | null;
      character_offset?: number | null;
    },
  ): Promise<{ ok: boolean; comment: ReadingComment }> {
    const response = await apiFetch(apiUrl(`/api/reading/comments/${encodeURIComponent(commentId)}`), {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(updates),
    });
    return readJson<{ ok: boolean; comment: ReadingComment }>(response);
  }

  async getReadingComments(bookId?: string): Promise<ReadingComment[]> {
    const url = bookId
      ? `/api/reading/comments?book_id=${encodeURIComponent(bookId)}`
      : '/api/reading/comments';
    const response = await apiFetch(apiUrl(url));
    return readJson<ReadingComment[]>(response);
  }

  async deleteReadingComment(commentId: string): Promise<{ ok: boolean }> {
    const response = await apiFetch(apiUrl(`/api/reading/comments/${encodeURIComponent(commentId)}`), {
      method: 'DELETE',
    });
    return readJson<{ ok: boolean }>(response);
  }

  async getReadingBookmarks(bookId?: string): Promise<ReadingBookmark[]> {
    const url = bookId
      ? `/api/reading/bookmarks?book_id=${encodeURIComponent(bookId)}`
      : '/api/reading/bookmarks';
    const response = await apiFetch(apiUrl(url));
    return readJson<ReadingBookmark[]>(response);
  }

  async createReadingBookmark(bookmark: {
    book_id: string;
    book_name: string;
    chapter: string;
    chapter_idx: number;
    character_offset: number;
    excerpt: string;
  }): Promise<{ ok: boolean; bookmark: ReadingBookmark }> {
    const response = await apiFetch(apiUrl('/api/reading/bookmarks'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(bookmark),
    });
    return readJson<{ ok: boolean; bookmark: ReadingBookmark }>(response);
  }

  async deleteReadingBookmark(bookmarkId: string): Promise<{ ok: boolean }> {
    const response = await apiFetch(apiUrl(
      `/api/reading/bookmarks/${encodeURIComponent(bookmarkId)}`,
    ), {
      method: 'DELETE',
    });
    return readJson<{ ok: boolean }>(response);
  }

  async getFeaturedReadingQuote(): Promise<{ quote: ReadingComment | null }> {
    const response = await apiFetch(apiUrl('/api/reading/featured-quote'));
    return readJson<{ quote: ReadingComment | null }>(response);
  }

  /* --- Memory CMS / Strata APIs --- */
  async searchMemories(query: string): Promise<Array<{
    id: string;
    name: string;
    score: number;
    domain: string[];
    valence: number;
    arousal: number;
    content_preview: string;
  }>> {
    const response = await apiFetch(apiUrl(`/api/search?q=${encodeURIComponent(query)}`));
    return readJson<Array<{
      id: string;
      name: string;
      score: number;
      domain: string[];
      valence: number;
      arousal: number;
      content_preview: string;
    }>>(response);
  }

  async growMemory(content: string): Promise<{ ok: boolean; result: string }> {
    const response = await apiFetch(apiUrl('/api/grow'), {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ content }),
    });
    return readJson<{ ok: boolean; result: string }>(response);
  }

  async uploadMemoryImport(file: File, preserveRaw = false, resume = false): Promise<{
    status: string;
    filename: string;
    size_bytes: number;
  }> {
    const formData = new FormData();
    formData.append('file', file);
    const params = new URLSearchParams();
    if (preserveRaw) params.set('preserve_raw', 'true');
    if (resume) params.set('resume', 'true');
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const response = await apiFetch(apiUrl(`/api/import/upload${suffix}`), {
      method: 'POST',
      body: formData,
    });
    return readJson<{ status: string; filename: string; size_bytes: number }>(response);
  }

  async getMemoryImportStatus(): Promise<Record<string, any>> {
    const response = await apiFetch(apiUrl('/api/import/status'));
    return readJson<Record<string, any>>(response);
  }

  async getMemoryImportResults(limit = 20): Promise<{ buckets: any[]; total: number }> {
    const response = await apiFetch(apiUrl(`/api/import/results?limit=${encodeURIComponent(limit)}`));
    return readJson<{ buckets: any[]; total: number }>(response);
  }
}

export const api = new ApiService();
