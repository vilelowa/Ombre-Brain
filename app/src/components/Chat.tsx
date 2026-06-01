import React, { useState, useEffect, useRef } from 'react';
import { Send, Image as ImageIcon } from 'lucide-react';
import { api } from '../lib/api';
import { Message, StartupContext } from '../types';
import { cn } from '../lib/utils';

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [startupContext, setStartupContext] = useState<StartupContext | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const loadData = async () => {
      // Setup initial context states as pending out of the gate
      setStartupContext({ core: 'pending', breath: 'pending', dream: 'pending', feel: 'pending' });
      
      // Load initial chat history
      const history = await api.getChatEvents('default');
      setMessages(history);

      try {
        const details = await api.getStartupContextDetails();
        
        // Reconstruct startupContext from details.events
        const updatedContext = { core: 'pending', breath: 'pending', dream: 'pending', feel: 'pending' } as StartupContext;
        
        if (details.events && Array.isArray(details.events)) {
          details.events.forEach((event) => {
            if (event.event === 'context' && event.data.stage) {
              updatedContext[event.data.stage] = event.data.status === 'started' ? 'running' : 'pending';
            } else if (event.event.endsWith('_done')) {
              const stage = event.event.replace('_done', '') as keyof StartupContext;
              updatedContext[stage] = 'done';
            } else if (event.event === 'error' && event.data.stage) {
              updatedContext[event.data.stage] = 'error';
            }
          });
        }
        
        setStartupContext(updatedContext);
        
        // Hide after 1.5 seconds if all done
        const allDone = Object.values(updatedContext).every(status => status === 'done');
        if (allDone) {
          setTimeout(() => {
            setStartupContext(null);
          }, 1500);
        }
      } catch (error) {
        console.error('Failed to load startup context:', error);
        setStartupContext(null);
      }
    };

    loadData();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, startupContext]);

  const handleSend = async () => {
    if (!inputValue.trim() || isSending) return;
    const text = inputValue.trim();
    setInputValue('');
    setIsSending(true);

    // Close any existing EventSource
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Append local user message immediately
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);

    // Reset startup context to pending
    setStartupContext({ core: 'pending', breath: 'pending', dream: 'pending', feel: 'pending' });

    try {
      const chatResponse = await api.createChat(text);
      
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
      <header className="fixed top-0 w-full max-w-3xl z-40 bg-background/90 backdrop-blur-sm border-b border-hairline border-dotted flex justify-between items-center px-4 h-14">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <h1 className="font-sans text-[18px] font-semibold text-primary tracking-tight">Elroy</h1>
            <span className="font-mono text-[10px] text-muted-gray uppercase tracking-widest mt-0.5 opacity-80">Connected : Local</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
           <span className="font-mono text-[10px] text-primary tracking-wide uppercase">Ready</span>
           <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></div>
        </div>
      </header>

      {/* Messages Timeline */}
      <div className="flex-1 overflow-y-auto px-4 py-6 flex flex-col gap-8 w-full">
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={cn(
               "flex flex-col max-w-[90%]", 
               msg.role === 'user' ? "self-end items-end" : "self-start items-start"
            )}
          >
            {/* Timestamp / Context (optional) */}
            {msg.role === 'assistant' && (
              <span className="font-mono text-[10px] text-muted-gray mb-1 ml-4 opacity-0 transition-opacity">Just now</span>
            )}
            
            <div className={cn(
              "text-[16px] leading-[24px] font-sans text-charcoal",
              msg.role === 'assistant' ? "pl-4 border-l-2 border-primary/40 py-1" : "pr-2 text-right"
            )}>
              {msg.content}
            </div>
          </div>
        ))}

        {/* Diagnostic Startup Segment */}
        {startupContext && (
           <div className="flex flex-col max-w-[90%] self-start items-start my-4 opacity-80">
              <div className="pl-4 border-l-2 border-muted-gray/30 py-2 flex flex-col gap-1 w-full bg-surface-container-lowest/50 rounded-r-md px-4">
                 {(Object.keys(startupContext) as (keyof StartupContext)[]).map((key) => {
                    const status = startupContext[key];
                    return (
                      <div key={key} className="flex justify-between items-center w-32">
                         <span className="font-mono text-[12px] text-muted-gray">{key}</span>
                         <span className={cn(
                            "font-mono text-[12px]",
                            status === 'done' ? "text-primary" : 
                            status === 'running' ? "text-unresolved-violet animate-pulse" : "text-muted-gray opacity-50"
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
            placeholder="Talk to Elroy..."
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
    </div>
  );
}
