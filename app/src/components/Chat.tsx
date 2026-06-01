import React, { useState, useEffect, useRef } from 'react';
import { Send, Image as ImageIcon, Menu, Plus, Trash2, X, MessageSquare, RefreshCw, AlertCircle } from 'lucide-react';
import { api } from '../lib/api';
import { Conversation, Message, StartupContext } from '../types';
import { cn } from '../lib/utils';

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [startupContext, setStartupContext] = useState<StartupContext | null>(null);
  
  // Multi-session & persistence states
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [lastActiveConvoId, setLastActiveConvoId] = useState<string | null>(null);
  const [isConvoSidebarOpen, setIsConvoSidebarOpen] = useState(false);
  const [inheritContext, setInheritContext] = useState(true);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const changeActiveConvo = (id: string | null) => {
    setActiveConversationId(id);
    if (id) {
      setLastActiveConvoId(id);
    }
  };

  const loadHistory = async (convoId: string) => {
    setIsHistoryLoading(true);
    setStartupContext(null); // Clear startup waterfall progress indicator
    try {
      const history = await api.getChatEvents(convoId);
      setMessages(history);
    } catch (err) {
      console.error('Failed to load message history:', err);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  useEffect(() => {
    const loadConversations = async () => {
      try {
        const convos = await api.getConversations();
        setConversations(convos);
        if (convos.length > 0) {
          const mostRecent = convos[0].id;
          changeActiveConvo(mostRecent);
          await loadHistory(mostRecent);
        } else {
          setMessages([]);
        }
      } catch (error) {
        console.error('Failed to load conversations:', error);
      }
    };

    loadConversations();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, startupContext]);

  const handleSelectConvo = async (id: string) => {
    changeActiveConvo(id);
    setIsConvoSidebarOpen(false);
    await loadHistory(id);
  };

  const handleNewConvo = () => {
    setMessages([]);
    setActiveConversationId(null);
    setStartupContext(null);
    setIsConvoSidebarOpen(false);
  };

  const handleDeleteConvo = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this conversation?')) return;
    try {
      await api.deleteConversation(id);
      const updated = conversations.filter(c => c.id !== id);
      setConversations(updated);
      
      if (activeConversationId === id) {
        if (updated.length > 0) {
          changeActiveConvo(updated[0].id);
          await loadHistory(updated[0].id);
        } else {
          handleNewConvo();
        }
      }
      if (lastActiveConvoId === id) {
        setLastActiveConvoId(updated.length > 0 ? updated[0].id : null);
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isSending) return;
    const text = inputValue.trim();
    setInputValue('');
    setIsSending(true);

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);
    setStartupContext({ core: 'pending', breath: 'pending', dream: 'pending', feel: 'pending' });

    try {
      const parentId = (activeConversationId === null && inheritContext) ? lastActiveConvoId : null;
      const chatResponse = await api.createChat(text, 'elroy-default', activeConversationId, parentId);
      
      const convoId = chatResponse.conversation_id;
      if (!activeConversationId) {
        changeActiveConvo(convoId);
        // Refresh sidebar
        const convos = await api.getConversations();
        setConversations(convos);
      }

      const source = api.openChatEvents(
        chatResponse.event_stream,
        (event) => {
          switch (event.event) {
            case 'context':
              if (event.data.stage) {
                setStartupContext(prev => prev ? {
                  ...prev,
                  [event.data.stage!]: event.data.status === 'started' ? 'running' : 'pending'
                } : null);
              }
              break;
            case 'core_done':
            case 'breath_done':
            case 'dream_done':
            case 'feel_done': {
              const stage = event.event.replace('_done', '') as keyof StartupContext;
              setStartupContext(prev => prev ? {
                ...prev,
                [stage]: 'done'
              } : null);
              break;
            }
            case 'error':
              if (event.data.stage) {
                setStartupContext(prev => prev ? {
                  ...prev,
                  [event.data.stage!]: 'error'
                } : null);
              }
              break;
            case 'token': {
              const tokenText = event.data.text || '';
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'assistant') {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...last,
                    content: last.content + tokenText
                  };
                  return updated;
                } else {
                  return [...prev, {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: tokenText,
                    createdAt: new Date().toISOString()
                  }];
                }
              });
              break;
            }
            case 'message_done': {
              const fullText = event.data.assistant_response || '';
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'assistant') {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...last,
                    content: fullText
                  };
                  return updated;
                } else {
                  return [...prev, {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: fullText,
                    createdAt: new Date().toISOString()
                  }];
                }
              });
              break;
            }
            case 'done':
              setStartupContext(null);
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last && last.role === 'assistant') {
                  return prev;
                }
                const responseText = event.data.assistant_response || 'Context ready. No assistant response was generated.';
                return [...prev, {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: responseText,
                  createdAt: new Date().toISOString()
                }];
              });
              source.close();
              setIsSending(false);
              eventSourceRef.current = null;
              // Refresh conversation list to update titles/timestamps
              api.getConversations().then(setConversations);
              break;
            default:
              break;
          }
        },
        (errorEvent) => {
          console.error('SSE connection error:', errorEvent);
          setStartupContext(null);
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            role: 'system',
            content: 'Error: Connection lost or failed to load context.',
            createdAt: new Date().toISOString(),
          }]);
          source.close();
          setIsSending(false);
          eventSourceRef.current = null;
        }
      );
      eventSourceRef.current = source;
    } catch (err: any) {
      console.error('Failed to create chat:', err);
      setStartupContext(null);
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'system',
        content: `Error starting chat: ${err?.message || err}`,
        createdAt: new Date().toISOString(),
      }]);
      setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-background relative pt-14">
      {/* Top Status Strip */}
      <header className="fixed top-0 left-0 right-0 w-full md:max-w-3xl md:mx-auto md:left-auto md:right-auto z-40 bg-background/90 backdrop-blur-sm border-b border-hairline border-dotted flex justify-between items-center px-4 h-14">
        <div className="flex items-center gap-3 min-w-0">
          <button 
            onClick={() => setIsConvoSidebarOpen(true)}
            className="p-1 text-charcoal hover:text-primary transition-colors cursor-pointer shrink-0"
            title="Conversation list"
          >
            <Menu size={20} />
          </button>
          <div className="flex flex-col min-w-0">
            <h1 className="font-sans text-[15px] font-semibold text-primary tracking-tight truncate">
              {activeConversationId 
                ? (conversations.find(c => c.id === activeConversationId)?.title || "Elroy")
                : "New Chat"
              }
            </h1>
            <span className="font-mono text-[8px] text-muted-gray uppercase tracking-wider mt-0.5 opacity-80 truncate">
              {activeConversationId ? "Active Convo" : "Seamless Relay Ready"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
           <span className="font-mono text-[9px] text-primary tracking-wide uppercase">Ready</span>
           <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></div>
        </div>
      </header>

      {/* Messages Timeline */}
      <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-8 w-full">
        {isHistoryLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 gap-2">
            <RefreshCw size={24} className="text-primary animate-spin" />
            <span className="font-mono text-[10px] text-muted-gray uppercase tracking-wider">Loading history...</span>
          </div>
        ) : messages.length === 0 && !activeConversationId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 gap-3 select-none mt-10">
            <MessageSquare size={36} className="text-muted-gray opacity-45" />
            <div>
              <p className="font-sans text-[15px] font-semibold text-charcoal">Start a new conversation</p>
              <p className="font-sans text-[12px] text-muted-gray max-w-[280px] mt-1 leading-relaxed">
                Elroy is ready. Send a message to begin, and your memory layers will be dynamically injected.
              </p>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div 
              key={msg.id} 
              className={cn(
                 "flex flex-col max-w-[90%]", 
                 msg.role === 'user' ? "self-end items-end" : "self-start items-start"
              )}
            >
              <div className={cn(
                "text-[16px] leading-[24px] font-sans text-charcoal whitespace-pre-wrap",
                msg.role === 'assistant' ? "pl-4 border-l-2 border-primary/40 py-1" : "pr-2 text-right"
              )}>
                {msg.content}
              </div>
            </div>
          ))
        )}

        {/* Diagnostic Startup Segment */}
        {startupContext && (
           <div className="flex flex-col max-w-[90%] self-start items-start my-4 opacity-80 animate-fade-in">
              <div className="pl-4 border-l-2 border-muted-gray/30 py-2 flex flex-col gap-1 w-full bg-surface-container-lowest/50 rounded-r-md px-4">
                 {(Object.keys(startupContext) as (keyof StartupContext)[]).map((key) => {
                    const status = startupContext[key];
                    return (
                      <div key={key} className="flex justify-between items-center w-32">
                         <span className="font-mono text-[11px] text-muted-gray">{key}</span>
                         <span className={cn(
                            "font-mono text-[11px]",
                            status === 'done' ? "text-primary" : 
                            status === 'running' ? "text-unresolved-violet animate-pulse font-semibold" : "text-muted-gray opacity-50"
                         )}>
                            {status}
                         </span>
                      </div>
                    )
                 })}
              </div>
           </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer Container */}
      <div className="w-full bg-background border-t border-hairline border-dotted p-4 pb-8 md:pb-6 relative z-30">
        <div className="flex items-end gap-2 bg-surface-container-lowest border border-hairline rounded-[8px] p-2 focus-within:border-outline-variant transition-colors shadow-sm">
          <button className="p-2 text-muted-gray hover:text-primary transition-colors shrink-0">
            <ImageIcon size={20} strokeWidth={1.5} />
          </button>
          
          <textarea 
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={activeConversationId ? "Message Elroy..." : "Start a new conversation..."}
            className="flex-1 max-h-32 min-h-[24px] bg-transparent resize-none outline-none font-sans text-[16px] text-charcoal placeholder:text-muted-gray/70 py-2"
            rows={1}
          />
          
          <button 
            onClick={handleSend}
            disabled={!inputValue.trim() || isSending}
            className="p-2 text-primary hover:text-primary-container disabled:text-muted-gray/50 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            <Send size={20} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Sidebar Backdrop */}
      {isConvoSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 transition-opacity duration-300 ease-out cursor-pointer"
          onClick={() => setIsConvoSidebarOpen(false)}
        />
      )}

      {/* Sidebar Panel */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-50 w-full sm:max-w-xs bg-surface-container-lowest border-r border-hairline shadow-2xl flex flex-col h-full transition-all duration-300 ease-out transform",
        isConvoSidebarOpen ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0 pointer-events-none"
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-hairline shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-primary" />
            <h3 className="font-sans text-[15px] font-semibold text-primary">Chat History</h3>
          </div>
          <button
            onClick={() => setIsConvoSidebarOpen(false)}
            className="w-8 h-8 flex items-center justify-center border border-hairline rounded-[4px] hover:bg-surface-container transition-colors"
            title="Close list"
          >
            <X size={14} className="text-charcoal" />
          </button>
        </div>

        {/* Action Buttons */}
        <div className="p-3 border-b border-hairline bg-surface-container-low/50 flex flex-col gap-2.5 shrink-0">
          <button
            onClick={handleNewConvo}
            className="w-full font-mono text-[10px] text-charcoal border border-hairline bg-background hover:bg-surface-container py-2.5 rounded-[4px] transition-colors uppercase flex items-center justify-center gap-1.5 font-semibold cursor-pointer"
          >
            <Plus size={12} /> New Convo
          </button>
          
          {/* Relay Checkbox (only show when there's an active chat) */}
          {lastActiveConvoId && (
            <label className="flex items-center justify-between gap-3 cursor-pointer select-none">
              <span className="font-sans text-[11px] text-muted-gray">Inherit parent context (Relay)</span>
              <input
                type="checkbox"
                checked={inheritContext}
                onChange={(e) => setInheritContext(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary cursor-pointer"
              />
            </label>
          )}
        </div>

        {/* List of Conversations */}
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {conversations.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
              <span className="font-sans text-[12px] text-muted-gray">No conversations. Start a new convo above!</span>
            </div>
          ) : (
            conversations.map((convo) => (
              <div
                key={convo.id}
                onClick={() => handleSelectConvo(convo.id)}
                className={cn(
                  "p-2.5 rounded-[4px] border transition-all duration-200 cursor-pointer text-left flex items-center justify-between gap-3 group relative overflow-hidden",
                  convo.id === activeConversationId
                    ? "border-primary/30 bg-primary/5 shadow-sm"
                    : "border-hairline hover:bg-surface-container-low"
                )}
              >
                <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                  <span className={cn(
                    "font-sans text-[13px] truncate pr-4",
                    convo.id === activeConversationId ? "font-semibold text-primary" : "text-charcoal"
                  )}>
                    {convo.title}
                  </span>
                  <span className="font-mono text-[8px] text-muted-gray opacity-85">
                    {new Date(convo.updated_at).toLocaleDateString()}
                  </span>
                </div>
                <button
                  onClick={(e) => handleDeleteConvo(convo.id, e)}
                  className="p-1.5 text-muted-gray hover:text-secondary hover:bg-secondary/5 rounded transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer shrink-0"
                  title="Delete convo"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
