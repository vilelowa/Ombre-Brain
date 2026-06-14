import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { Conversation, ConversationFolder, Message, PersonaProfile, StartupContext } from '../../types';

function createAssistantMessage(partial: Partial<Message>): Message {
  return {
    id: partial.id || crypto.randomUUID(),
    role: 'assistant',
    content: partial.content || '',
    reasoning: partial.reasoning || null,
    createdAt: partial.createdAt || new Date().toISOString(),
    dreamFlagged: partial.dreamFlagged || false,
    attachments: partial.attachments,
    metadata: partial.metadata,
  };
}

export function useChatController() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [draftAttachments, setDraftAttachments] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [startupContext, setStartupContext] = useState<StartupContext | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [folders, setFolders] = useState<ConversationFolder[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [lastActiveConvoId, setLastActiveConvoId] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [profiles, setProfiles] = useState<PersonaProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState('elroy-default');
  const [relayEnabled, setRelayEnabled] = useState(true);
  const [splitEnabled, setSplitEnabled] = useState(true);
  const [quickEditPrompt, setQuickEditPrompt] = useState('');
  const [isQuickSaving, setIsQuickSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) || profiles[0] || null,
    [activeProfileId, profiles],
  );

  const changeActiveConvo = useCallback((id: string | null) => {
    setActiveConversationId(id);
    if (id) {
      setLastActiveConvoId(id);
    }
  }, []);

  const loadHistory = useCallback(async (convoId: string, convos?: Conversation[]) => {
    setIsHistoryLoading(true);
    setStartupContext(null);
    setError(null);

    const sourceConvos = convos || conversationsRef.current;
    const convo = sourceConvos.find((item) => item.id === convoId);
    if (convo?.persona) {
      setActiveProfileId(convo.persona);
    }

    try {
      const history = await api.getChatEvents(convoId);
      setMessages(history.map((message) => ({ ...message, isHistory: true })));
    } catch (err: any) {
      console.error('Failed to load message history:', err);
      setError(err?.message || 'Failed to load message history');
    } finally {
      setIsHistoryLoading(false);
    }
  }, []);

  const refreshConversations = useCallback(async () => {
    const next = await api.getConversations();
    conversationsRef.current = next;
    setConversations(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initData = async () => {
      try {
        setError(null);
        const [convos, profs] = await Promise.all([
          api.getConversations(),
          api.getPersonaProfiles(),
        ]);
        const folderList = await api.getFolders();
        if (cancelled) return;
        conversationsRef.current = convos;
        setConversations(convos);
        setFolders(folderList);
        setProfiles(profs);

        if (convos.length > 0) {
          const mostRecent = convos[0].id;
          changeActiveConvo(mostRecent);
          await loadHistory(mostRecent, convos);
        } else {
          setMessages([]);
        }
      } catch (err: any) {
        console.error('Failed to load Albireo chat data:', err);
        if (!cancelled) setError(err?.message || 'Failed to load chat data');
      }
    };

    initData();

    return () => {
      cancelled = true;
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [changeActiveConvo, loadHistory]);

  const selectConversation = useCallback(async (id: string) => {
    changeActiveConvo(id);
    await loadHistory(id);
  }, [changeActiveConvo, loadHistory]);

  const startNewConversation = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setMessages([]);
    setDraft('');
    setStartupContext(null);
    setActiveConversationId(null);
    setError(null);
  }, []);

  const selectPersona = useCallback((id: string) => {
    setActiveProfileId(id);
  }, []);

  const createFolder = useCallback(async (name: string) => {
    const result = await api.createFolder(name);
    setFolders((current) => [...current, result.folder]);
    return result.folder;
  }, []);

  const deleteFolder = useCallback(async (id: string) => {
    await api.deleteFolder(id);
    setFolders((current) => current.filter((folder) => folder.id !== id));
    setConversations((current) => {
      const next = current.map((conv) => (conv.folder_id === id ? { ...conv, folder_id: null } : conv));
      conversationsRef.current = next;
      return next;
    });
  }, []);

  const renameConversation = useCallback(async (conversationId: string, title: string) => {
    await api.renameConversation(conversationId, title);
    setConversations((current) => {
      const next = current.map((conversation) => (
        conversation.id === conversationId ? { ...conversation, title } : conversation
      ));
      conversationsRef.current = next;
      return next;
    });
  }, []);

  const moveConversationToFolder = useCallback(async (conversationId: string, folderId: string | null) => {
    await api.moveConversationToFolder(conversationId, folderId);
    setConversations((current) => {
      const next = current.map((conversation) => (
        conversation.id === conversationId ? { ...conversation, folder_id: folderId } : conversation
      ));
      conversationsRef.current = next;
      return next;
    });
  }, []);

  const deleteConversation = useCallback(async (conversationId: string) => {
    await api.deleteConversation(conversationId);
    const next = conversationsRef.current.filter((conversation) => conversation.id !== conversationId);
    conversationsRef.current = next;
    setConversations(next);

    if (activeConversationId === conversationId) {
      const replacement = next[0] || null;
      if (replacement) {
        changeActiveConvo(replacement.id);
        await loadHistory(replacement.id, next);
      } else {
        startNewConversation();
      }
    }
  }, [activeConversationId, changeActiveConvo, loadHistory, startNewConversation]);

  const openQuickEdit = useCallback(() => {
    if (activeProfile) {
      setQuickEditPrompt(activeProfile.base_prompt);
    }
  }, [activeProfile]);

  const saveQuickEdit = useCallback(async () => {
    if (!activeProfile) return;
    setIsQuickSaving(true);
    try {
      const updated = await api.updatePersonaProfile(activeProfile.id, {
        ...activeProfile,
        base_prompt: quickEditPrompt,
      });
      setProfiles((current) => current.map((profile) => (profile.id === updated.id ? updated : profile)));
    } catch (err: any) {
      console.error('Quick edit save failed:', err);
      setError(err?.message || 'Quick edit save failed');
    } finally {
      setIsQuickSaving(false);
    }
  }, [activeProfile, quickEditPrompt]);

  const flagDream = useCallback(async (message: Message) => {
    if (!activeConversationId || message.dreamFlagged) return;
    try {
      await api.flagMessageAsDreamCandidate(message.content, message.id, activeConversationId);
      setMessages((current) => current.map((item) => (
        item.id === message.id ? { ...item, dreamFlagged: true } : item
      )));
    } catch (err: any) {
      console.error('Failed to flag as dream candidate:', err);
      setError(err?.message || 'Failed to flag dream candidate');
    }
  }, [activeConversationId]);

  const unflagDream = useCallback(async (message: Message) => {
    if (!activeConversationId || !message.dreamFlagged) return;
    try {
      await api.unflagMessageAsDreamCandidate(message.id, activeConversationId);
      setMessages((current) => current.map((item) => (
        item.id === message.id ? { ...item, dreamFlagged: false } : item
      )));
    } catch (err: any) {
      console.error('Failed to unflag dream candidate:', err);
      setError(err?.message || 'Failed to unflag dream candidate');
    }
  }, [activeConversationId]);

  const regenerateMessage = useCallback(async () => {
    if (!activeConversationId || isSending) return;

    // Optimistically remove the last assistant message
    setMessages((current) => {
      const next = [...current];
      if (next.length > 0 && next[next.length - 1].role === 'assistant') {
        next.pop();
      }
      return next;
    });

    setIsSending(true);
    setError(null);
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setStartupContext({ core: 'pending', breath: 'pending', dream: 'pending', feel: 'pending' });

    try {
      const response = await api.regenerateChat(activeConversationId);
      console.log(`[SSE] Opening EventSource: ${response.event_stream}`);
      const source = api.openChatEvents(
        response.event_stream,
        (event) => {
          console.log(`[SSE Event] ${event.event}`, event.data);
          switch (event.event) {
            case 'context':
              if (event.data.stage) {
                setStartupContext((current) => current ? {
                  ...current,
                  [event.data.stage!]: event.data.status === 'started' ? 'running' : 'pending',
                } : null);
              }
              break;
            case 'core_done':
            case 'breath_done':
            case 'dream_done':
            case 'feel_done': {
              const stage = event.event.replace('_done', '') as keyof StartupContext;
              setStartupContext((current) => current ? { ...current, [stage]: 'done' } : null);
              break;
            }
            case 'tool_call': {
              const toolName = event.data.name;
              if (toolName === 'mark_dream_candidate') {
                setMessages((current) => {
                  const last = current[current.length - 1];
                  if (last?.role === 'assistant') {
                    const next = [...current];
                    next[next.length - 1] = {
                      ...last,
                      dreamFlagged: true,
                    };
                    return next;
                  }
                  return [...current, createAssistantMessage({ dreamFlagged: true })];
                });
              }
              break;
            }
            case 'thinking_token': {
              const reasoningToken = event.data.text || '';
              if (!reasoningToken) break;
              setMessages((current) => {
                const last = current[current.length - 1];
                if (last?.role === 'assistant') {
                  const next = [...current];
                  next[next.length - 1] = {
                    ...last,
                    reasoning: `${last.reasoning || ''}${reasoningToken}`,
                  };
                  return next;
                }
                return [...current, createAssistantMessage({ reasoning: reasoningToken })];
              });
              break;
            }
            case 'token': {
              const tokenText = event.data.text || '';
              if (!tokenText) break;
              setMessages((current) => {
                const last = current[current.length - 1];
                if (last?.role === 'assistant') {
                  const next = [...current];
                  next[next.length - 1] = {
                    ...last,
                    content: `${last.content}${tokenText}`,
                  };
                  return next;
                }
                return [...current, createAssistantMessage({ content: tokenText })];
              });
              break;
            }
            case 'message_done': {
              const fullText = event.data.assistant_response || '';
              const fullReasoning = event.data.assistant_reasoning;
              const backendMsgId = event.data.message_id;
              setMessages((current) => {
                const last = current[current.length - 1];
                if (last?.role === 'assistant') {
                  const next = [...current];
                  next[next.length - 1] = {
                    ...last,
                    id: backendMsgId || last.id,
                    content: fullText,
                    reasoning: fullReasoning,
                  };
                  return next;
                }
                return [...current, createAssistantMessage({
                  id: backendMsgId,
                  content: fullText,
                  reasoning: fullReasoning,
                })];
              });
              break;
            }
            case 'done':
              setStartupContext(null);
              setMessages((current) => {
                const last = current[current.length - 1];
                if (last?.role === 'assistant') {
                  if (!event.data.message_id && event.data.assistant_reasoning == null) return current;
                  const next = [...current];
                  next[next.length - 1] = {
                    ...last,
                    id: event.data.message_id || last.id,
                    reasoning: event.data.assistant_reasoning || last.reasoning,
                  };
                  return next;
                }
                return current;
              });
              source.close();
              eventSourceRef.current = null;
              setIsSending(false);
              refreshConversations().catch((err) => console.error('Failed to refresh conversations:', err));
              break;
            case 'error':
              if (event.data.stage) {
                setStartupContext((current) => current ? {
                  ...current,
                  [event.data.stage!]: 'error',
                } : null);
              } else {
                setError(event.data.error || 'Stream error');
                source.close();
                eventSourceRef.current = null;
                setIsSending(false);
              }
              break;
          }
        },
        (err) => {
          console.error('[SSE] Error:', err);
          setError('Connection lost');
          source.close();
          eventSourceRef.current = null;
          setIsSending(false);
        }
      );

      eventSourceRef.current = source;
    } catch (err: any) {
      setIsSending(false);
      setStartupContext(null);
      setError(err?.message || 'Failed to regenerate message');
    }
  }, [activeConversationId, isSending, refreshConversations]);

  const sendMessage = useCallback(async () => {
    const text = draft.trim();
    if (!text || isSending) return;

    const currentAttachments = [...draftAttachments];
    setDraft('');
    setDraftAttachments([]);
    setIsSending(true);
    setError(null);
    eventSourceRef.current?.close();
    eventSourceRef.current = null;

    const optimisticUser: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimisticUser]);
    setStartupContext({ core: 'pending', breath: 'pending', dream: 'pending', feel: 'pending' });

    try {
      const parentId = activeConversationId === null && relayEnabled ? lastActiveConvoId : null;
      const response = await api.createChat(text, activeProfileId, activeConversationId, parentId, currentAttachments.length > 0 ? currentAttachments : undefined);
      const convoId = response.conversation_id;

      if (response.user_message_id) {
        setMessages((current) => current.map((msg) =>
          msg.id === optimisticUser.id ? { ...msg, id: response.user_message_id! } : msg
        ));
      }

      if (!activeConversationId) {
        changeActiveConvo(convoId);
        refreshConversations().catch((err) => console.error('Failed to refresh conversations:', err));
      }

      console.log(`[SSE] Opening EventSource: ${response.event_stream}`);
      const source = api.openChatEvents(
        response.event_stream,
        (event) => {
          console.log(`[SSE Event] ${event.event}`, event.data);
          switch (event.event) {
            case 'context':
              if (event.data.stage) {
                setStartupContext((current) => current ? {
                  ...current,
                  [event.data.stage!]: event.data.status === 'started' ? 'running' : 'pending',
                } : null);
              }
              break;
            case 'core_done':
            case 'breath_done':
            case 'dream_done':
            case 'feel_done': {
              const stage = event.event.replace('_done', '') as keyof StartupContext;
              setStartupContext((current) => current ? { ...current, [stage]: 'done' } : null);
              break;
            }
            case 'thinking_token': {
              const reasoningToken = event.data.text || '';
              if (!reasoningToken) break;
              setMessages((current) => {
                const last = current[current.length - 1];
                if (last?.role === 'assistant') {
                  const next = [...current];
                  next[next.length - 1] = {
                    ...last,
                    reasoning: `${last.reasoning || ''}${reasoningToken}`,
                  };
                  return next;
                }
                return [...current, createAssistantMessage({ reasoning: reasoningToken })];
              });
              break;
            }
            case 'tool_call': {
              const toolName = event.data.name;
              if (toolName === 'mark_dream_candidate') {
                setMessages((current) => {
                  const last = current[current.length - 1];
                  if (last?.role === 'assistant') {
                    const next = [...current];
                    next[next.length - 1] = {
                      ...last,
                      dreamFlagged: true,
                    };
                    return next;
                  }
                  return [...current, createAssistantMessage({ dreamFlagged: true })];
                });
              }
              break;
            }
            case 'token': {
              const tokenText = event.data.text || '';
              if (!tokenText) break;
              setMessages((current) => {
                const last = current[current.length - 1];
                if (last?.role === 'assistant') {
                  const next = [...current];
                  next[next.length - 1] = {
                    ...last,
                    content: `${last.content}${tokenText}`,
                  };
                  return next;
                }
                return [...current, createAssistantMessage({ content: tokenText })];
              });
              break;
            }
            case 'message_done': {
              const fullText = event.data.assistant_response || '';
              const fullReasoning = event.data.assistant_reasoning;
              const backendMsgId = event.data.message_id;
              setMessages((current) => {
                const last = current[current.length - 1];
                if (last?.role === 'assistant') {
                  const next = [...current];
                  next[next.length - 1] = {
                    ...last,
                    id: backendMsgId || last.id,
                    content: fullText,
                    reasoning: fullReasoning ?? last.reasoning ?? null,
                  };
                  return next;
                }
                return [...current, createAssistantMessage({
                  id: backendMsgId,
                  content: fullText,
                  reasoning: fullReasoning,
                })];
              });
              break;
            }
            case 'done':
              setStartupContext(null);
              setMessages((current) => {
                const last = current[current.length - 1];
                if (last?.role === 'assistant') {
                  if (!event.data.message_id && event.data.assistant_reasoning == null) return current;
                  const next = [...current];
                  next[next.length - 1] = {
                    ...last,
                    id: event.data.message_id || last.id,
                    reasoning: event.data.assistant_reasoning ?? last.reasoning ?? null,
                  };
                  return next;
                }

                const responseText = event.data.assistant_response || 'Context ready. No assistant response was generated.';
                return [...current, createAssistantMessage({
                  id: event.data.message_id,
                  content: responseText,
                  reasoning: event.data.assistant_reasoning,
                })];
              });
              console.log('[SSE] Stream marked as done, closing source.');
              source.close();
              eventSourceRef.current = null;
              setIsSending(false);
              refreshConversations().catch((err) => console.error('Failed to refresh conversations:', err));
              break;
            case 'error':
              if (event.data.stage) {
                setStartupContext((current) => current ? {
                  ...current,
                  [event.data.stage!]: 'error',
                } : null);
              } else if (event.data.error) {
                setError(event.data.error);
                setMessages((current) => [...current, {
                  id: crypto.randomUUID(),
                  role: 'system',
                  content: `Error from server: ${event.data.error}`,
                  createdAt: new Date().toISOString(),
                }]);
              }
              break;
            default:
              break;
          }
        },
        (errorEvent) => {
          console.error('[SSE] connection error (source.onerror):', errorEvent);
          setStartupContext(null);
          setError('Connection lost or failed to load context. (SSE Error)');
          source.close();
          eventSourceRef.current = null;
          setIsSending(false);
        },
      );

      eventSourceRef.current = source;
    } catch (err: any) {
      console.error('Failed to create chat:', err);
      setStartupContext(null);
      setError(err?.message || 'Failed to start chat');
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'system',
        content: `Error starting chat: ${err?.message || err}`,
        createdAt: new Date().toISOString(),
      }]);
      setIsSending(false);
    }
  }, [
    activeConversationId,
    activeProfileId,
    changeActiveConvo,
    draft,
    draftAttachments,
    isSending,
    lastActiveConvoId,
    refreshConversations,
    relayEnabled,
  ]);

  const handleDraftKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  return {
    activeConversationId,
    activeProfile,
    activeProfileId,
    conversations,
    draft,
    error,
    folders,
    isHistoryLoading,
    isQuickSaving,
    isSending,
    messages,
    profiles,
    quickEditPrompt,
    relayEnabled,
    splitEnabled,
    startupContext,
    flagDream,
    unflagDream,
    createFolder,
    deleteFolder,
    deleteConversation,
    handleDraftKeyDown,
    loadHistory,
    openQuickEdit,
    refreshConversations,
    renameConversation,
    saveQuickEdit,
    selectConversation,
    selectPersona,
    moveConversationToFolder,
    regenerateMessage,
    sendMessage,
    setDraft,
    draftAttachments,
    setDraftAttachments,
    setQuickEditPrompt,
    setRelayEnabled,
    setSplitEnabled,
    startNewConversation,
  };
}
