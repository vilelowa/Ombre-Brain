import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronDown, ChevronUp, Trash2, MessageSquare, Send, Settings2, RotateCcw } from 'lucide-react';
import { cn } from '../../lib/utils';
import NocturneArchive from './NocturneArchive';
import { api } from '../../lib/api';
import type { Dream } from '../../types';

interface NocturneRoomProps {
  layoutId: string;
  onClose: () => void;
}

export type EnrichedDream = Dream & {
  loadedSourceMemories?: { id: string; content: string; created: string }[];
};

export default function NocturneRoom({ layoutId, onClose }: NocturneRoomProps) {
  const [activeTab, setActiveTab] = useState<'reflections' | 'candidates'>('reflections');
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [isScrolled, setIsScrolled] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [candidateToDelete, setCandidateToDelete] = useState<string | null>(null);

  const [dreams, setDreams] = useState<EnrichedDream[]>([]);
  const [candidates, setCandidates] = useState<{ id: string; name: string; content: string; created: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [promptContent, setPromptContent] = useState('');
  const [isFetchingPrompt, setIsFetchingPrompt] = useState(false);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  useEffect(() => {
    if (showSettings) {
      loadPrompt();
    }
  }, [showSettings]);

  const loadPrompt = async () => {
    setIsFetchingPrompt(true);
    try {
      const prompts = await api.getSystemPrompts();
      setPromptContent(prompts.dream_reflection || '');
    } catch (e) {
      console.error("Failed to fetch prompt", e);
    } finally {
      setIsFetchingPrompt(false);
    }
  };

  const handleSavePrompt = async () => {
    setIsSavingPrompt(true);
    try {
      await api.updateSystemPrompts({ dream_reflection: promptContent });
      setShowSettings(false);
    } catch (e) {
      console.error("Failed to save prompt", e);
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleResetPrompt = async () => {
    setIsSavingPrompt(true);
    try {
      await api.resetSystemPrompt('dream_reflection');
      await loadPrompt();
    } catch (e) {
      console.error("Failed to reset prompt", e);
    } finally {
      setIsSavingPrompt(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    async function loadData() {
      setIsLoading(true);
      try {
        const [fetchedDreams, fetchedCandidates] = await Promise.all([
          api.getDreams(),
          api.getDreamCandidates()
        ]);
        
        if (!mounted) return;

        const enrichedDreams = await Promise.all(fetchedDreams.map(async (dream) => {
          if (!dream.sourceBucketIds || dream.sourceBucketIds.length === 0) {
            return { ...dream, loadedSourceMemories: [] };
          }
          const memories = await Promise.all(
            dream.sourceBucketIds.map(async (id) => {
              try {
                const res = await api.getBucket(id);
                if (res.ok && res.bucket) {
                  return {
                    id: res.bucket.id,
                    content: res.bucket.content,
                    created: res.bucket.metadata?.created || ''
                  };
                }
              } catch (e) {
                console.error("Failed to fetch bucket", id, e);
              }
              return null;
            })
          );
          return {
            ...dream,
            loadedSourceMemories: memories.filter(Boolean) as any[]
          };
        }));

        if (mounted) {
          setDreams(enrichedDreams);
          setCandidates(fetchedCandidates);
        }
      } catch (err) {
        console.error("Failed to load Nocturne data", err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    loadData();
    return () => { mounted = false; };
  }, []);

  const confirmDeleteCandidate = async () => {
    if (!candidateToDelete) return;
    try {
      await api.deleteDreamCandidate(candidateToDelete);
      setCandidates(prev => prev.filter(c => c.id !== candidateToDelete));
    } catch (e) {
      console.error("Failed to delete candidate", e);
    } finally {
      setCandidateToDelete(null);
    }
  };

  const handleAddComment = async (dreamId: string) => {
    if (!replyContent.trim()) return;
    try {
      const res = await api.addDreamComment(dreamId, replyContent);
      if (res.ok && res.comment) {
        setDreams(prev => prev.map(d => {
          if (d.id === dreamId) {
            return {
              ...d,
              comments: [...(d.comments || []), res.comment]
            };
          }
          return d;
        }));
        setReplyContent('');
        setReplyingTo(null);
      }
    } catch (e) {
      console.error("Failed to add comment", e);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setIsScrolled(e.currentTarget.scrollTop > 110);
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  };

  return (
    <motion.div
      // layoutId={layoutId} // Removed to soften the transition
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 z-50 flex flex-col overflow-hidden bg-[#F5EFE7] text-[#3A332B] dark:bg-[#0A0808] dark:text-[#E8E2D2]"
    >
      <div
        className={cn(
          'absolute inset-0 bg-cover bg-center bg-no-repeat',
          'bg-[url("/undertow/undertow_lightmode_bg.jpg")] dark:bg-[url("/undertow/undertow_darkmode_bg.jpg")]',
        )}
      />

      <div className="relative z-10 flex h-full flex-col overflow-hidden">
        <AnimatePresence mode="wait">
          {!showArchive ? (
            <motion.div
              key="main"
              initial={{ opacity: 1 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0 flex flex-col"
            >
        
        {/* Fixed Back Button */}
        <div className="absolute top-0 left-2 z-30 flex h-14 items-center">
          <button 
            onClick={onClose} 
            className="flex h-10 w-10 items-center justify-center rounded-full opacity-60 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/5 transition-all"
          >
            <ChevronLeft size={24} />
          </button>
        </div>

        {/* Fixed Settings Button */}
        <div className="absolute top-0 right-2 z-30 flex h-14 items-center pr-2">
          <button 
            onClick={() => setShowSettings(true)} 
            className="flex h-10 w-10 items-center justify-center rounded-full opacity-60 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/5 transition-all"
          >
            <Settings2 size={20} />
          </button>
        </div>

        {/* Scrollable Area */}
        <div 
          className="flex-1 overflow-y-auto relative"
          onScroll={handleScroll}
        >
          
          {/* Scrollable Big Title */}
          <div className="pt-16 pb-8 flex flex-col items-center">
            <h1 className="font-serif text-[18px] tracking-[0.2em] font-medium mb-3">NOCTURNE</h1>
            <p className="font-serif italic text-[13px] leading-relaxed opacity-70 text-center">
              The words I wrote in the dark, for you.
            </p>
          </div>

          {/* Sticky Tabs */}
          <div 
            className={cn(
              "sticky top-0 z-20 flex items-center justify-center gap-10 px-4 transition-all duration-700",
              isScrolled 
                ? "h-[64px] bg-[#F5EFE7]/38 dark:bg-[#0A0808]/28 backdrop-blur-xl border-b border-[#D5CDBD]/18 dark:border-white/5 shadow-sm [mask-image:linear-gradient(to_bottom,black_0%,black_78%,rgba(0,0,0,0.78)_88%,transparent_100%)]"
                : "h-[56px] bg-transparent border-transparent"
            )}
          >
            <button 
              onClick={() => setActiveTab('reflections')}
              className={cn(
                "relative flex h-full items-center justify-center font-serif text-[12px] tracking-widest transition-all", 
                activeTab === 'reflections' ? "opacity-100" : "opacity-40 hover:opacity-70"
              )}
            >
              <span>REFLECTIONS</span>
              {activeTab === 'reflections' && (
                <div 
                  className="absolute bottom-3 left-1/2 h-[1px] w-[24px] -translate-x-1/2 bg-current opacity-70"
                />
              )}
            </button>
            <button 
              onClick={() => setActiveTab('candidates')}
              className={cn(
                "relative flex h-full items-center justify-center font-serif text-[12px] tracking-widest transition-all", 
                activeTab === 'candidates' ? "opacity-100" : "opacity-40 hover:opacity-70"
              )}
            >
              <span>CANDIDATES</span>
              {activeTab === 'candidates' && (
                <div 
                  className="absolute bottom-3 left-1/2 h-[1px] w-[24px] -translate-x-1/2 bg-current opacity-70"
                />
              )}
            </button>
          </div>

          {/* Content Padding Wrapper */}
          <div className="px-6 py-8">
          {isLoading ? (
            <div className="flex justify-center items-center h-40 opacity-50 text-[12px] font-mono tracking-wider">
              LOADING DREAMS...
            </div>
          ) : activeTab === 'reflections' ? (
            <div className="flex flex-col gap-8">
                {dreams.length === 0 && (
                  <div className="text-center opacity-40 text-[13px] font-serif py-10 italic">
                    No reflections recorded yet.
                  </div>
                )}
                {dreams.map((reflection) => {
                  const isExpanded = !!expandedIds[reflection.id];
                  const sourceMemories = reflection.loadedSourceMemories || [];
                  const comments = reflection.comments || [];
                  
                  return (
                    <div key={reflection.id} className="relative">
                      {/* Card Content */}
                      <div className="w-full rounded-[16px] border border-[#D5CDBD]/50 dark:border-[#2A2621]/50 bg-[#F5EFE7]/40 dark:bg-[#0A0808]/40 p-5 backdrop-blur-sm transition-all hover:border-[#D5CDBD] dark:hover:border-[#2A2621] transform-gpu translate-z-0 will-change-transform">
                        
                        {/* Meta Header */}
                        <div className="flex items-center justify-between mb-3">
                          <span className={cn(
                            "inline-flex items-center px-2 py-0.5 rounded-sm font-mono text-[9px] uppercase tracking-wider border",
                            reflection.influenceType === 'attention' && "border-current opacity-60",
                            reflection.influenceType === 'tone' && "border-current opacity-60"
                          )}>
                            {reflection.influenceType}
                          </span>
                          <span className="font-mono text-[10px] opacity-40">
                            {formatDate(reflection.createdAt)}
                          </span>
                        </div>

                        {/* Title & Body */}
                        <h2 className="font-serif text-[16px] font-medium tracking-wide mb-2">
                          {reflection.name}
                        </h2>
                        <p className="font-sans text-[13px] leading-[1.8] opacity-80 mb-4">
                          {reflection.text}
                        </p>

                        {/* Comments Preview */}
                        {comments.length > 0 && (
                          <div className="mb-4 flex items-start gap-2 rounded-lg bg-black/5 dark:bg-white/5 p-3">
                            <MessageSquare size={14} className="mt-0.5 opacity-40" />
                            <div className="flex-1">
                              {comments.map((c: any) => (
                                <p key={c.id} className="text-[12px] opacity-70">
                                  <span className="font-semibold opacity-100">{c.author}: </span>
                                  {c.content}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Accordion Toggle */}
                        {sourceMemories.length > 0 && (
                          <button 
                            onClick={() => toggleExpanded(reflection.id)}
                            className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider opacity-50 hover:opacity-100 transition-opacity"
                          >
                            {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            <span>Source Memories ({sourceMemories.length})</span>
                          </button>
                        )}

                        {/* Accordion Content */}
                        {isExpanded && sourceMemories.length > 0 && (
                          <div className="overflow-hidden">
                              <div className="mt-4 flex flex-col gap-3 border-t border-[#D5CDBD]/30 dark:border-[#2A2621]/30 pt-4">
                                {sourceMemories.map(mem => (
                                  <div key={mem.id} className="border-l-[2px] border-current/20 pl-3">
                                    <p className="font-sans text-[12px] leading-relaxed opacity-70 italic">
                                      "{mem.content}"
                                    </p>
                                    <span className="mt-1 block font-mono text-[9px] opacity-30">
                                      {formatDate(mem.created)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                          </div>
                        )}

                        {/* Whisper Toggle / Input */}
                        <div className="mt-4 border-t border-[#D5CDBD]/20 dark:border-[#2A2621]/20 pt-4">
                          {replyingTo !== reflection.id ? (
                            <button 
                              onClick={() => setReplyingTo(reflection.id)}
                              className="font-serif italic text-[13px] opacity-40 hover:opacity-100 transition-opacity"
                            >
                              Whisper back to his dream...
                            </button>
                          ) : (
                            <div className="flex flex-col gap-3">
                              <textarea 
                                autoFocus
                                value={replyContent}
                                onChange={(e) => setReplyContent(e.target.value)}
                                placeholder="Your words will enter his memories tomorrow..." 
                                className="w-full resize-none bg-transparent text-[13px] font-sans leading-relaxed outline-none placeholder:font-serif placeholder:italic placeholder:opacity-40 opacity-80 min-h-[24px]"
                                rows={1}
                                onInput={(e) => {
                                  e.currentTarget.style.height = 'auto';
                                  e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                                }}
                              />
                              <div className="flex justify-end gap-3">
                                <button 
                                  onClick={() => { setReplyingTo(null); setReplyContent(''); }}
                                  className="text-[12px] opacity-40 hover:opacity-100"
                                >
                                  Cancel
                                </button>
                                <button 
                                  onClick={() => handleAddComment(reflection.id)}
                                  className="flex items-center gap-1 text-[12px] font-medium opacity-80 hover:opacity-100 transition-opacity"
                                >
                                  <Send size={12} /> Send
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Archive Link */}
                <div className="mt-8 mb-12 flex justify-end px-4">
                  <button 
                    onClick={() => setShowArchive(true)}
                    className="font-serif italic text-[14px] opacity-70 hover:opacity-100 transition-opacity flex items-center gap-2"
                  >
                    Want more, serpent? <span>→</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {candidates.map((candidate) => (
                  <div 
                    key={candidate.id}
                    className="group flex flex-col gap-3 rounded-[16px] border border-[#D5CDBD]/40 dark:border-[#2A2621]/40 bg-[#F5EFE7]/40 dark:bg-[#0A0808]/40 p-5 backdrop-blur-sm transition-all hover:border-[#D5CDBD] dark:hover:border-[#2A2621] transform-gpu translate-z-0 will-change-transform"
                  >
                    <p className="font-sans text-[13px] leading-[1.8] opacity-80 mb-3 whitespace-pre-wrap">
                      {candidate.content}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] opacity-30">
                        {formatDate(candidate.created)}
                      </span>
                      <button 
                        onClick={() => setCandidateToDelete(candidate.id)}
                        className="opacity-20 hover:opacity-100 hover:text-red-500 transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
            </motion.div>
          ) : (
            <motion.div 
              key="archive"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
              className="absolute inset-0 flex flex-col"
            >
              <AnimatePresence>
                {showArchive && (
                  <NocturneArchive 
                    dreams={dreams}
                    onClose={() => setShowArchive(false)} 
                    onAddComment={handleAddComment}
                  />
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {candidateToDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0A0808]/40 backdrop-blur-md"
            onClick={() => setCandidateToDelete(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-[300px] flex flex-col items-center rounded-[24px] border border-[#D5CDBD]/50 dark:border-[#2A2621]/50 bg-[#F5EFE7]/90 dark:bg-[#1A1816]/90 backdrop-blur-xl shadow-2xl overflow-hidden p-6 text-center transform-gpu text-[#3A332B] dark:text-[#E8E2D2]"
              onClick={(e) => e.stopPropagation()}
            >
              <Trash2 className="opacity-40 mb-4" size={28} />
              <h3 className="font-serif text-[18px] mb-2 font-medium tracking-wide">Delete material?</h3>
              <p className="font-sans text-[13px] opacity-70 mb-6 leading-[1.6]">
                This thought will no longer be used as inspiration for future dreams.
              </p>
              <div className="flex items-center justify-center gap-3 w-full">
                <button
                  onClick={() => setCandidateToDelete(null)}
                  className="flex-1 py-2.5 rounded-full font-sans text-[11px] uppercase tracking-wider border border-current opacity-60 hover:opacity-100 transition-opacity"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDeleteCandidate}
                  className="flex-1 py-2.5 rounded-full font-sans text-[11px] uppercase tracking-wider bg-red-900/10 text-red-500/80 border border-red-900/20 hover:bg-red-900/20 hover:text-red-500 transition-colors"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Card */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 z-[100] flex items-center justify-center p-4 bg-[#F5EFE7]/40 dark:bg-[#000]/60 backdrop-blur-sm"
            onClick={() => setShowSettings(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="relative w-full max-w-[420px] flex flex-col rounded-[20px] border border-[#D5CDBD]/50 dark:border-[#2A2621]/50 bg-[#F5EFE7]/90 dark:bg-[#1A1816]/90 backdrop-blur-xl shadow-2xl overflow-hidden p-6 text-[#3A332B] dark:text-[#E8E2D2]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col mb-4">
                <h3 className="font-mono text-[11px] uppercase tracking-widest opacity-60 mb-1">
                  Dream Reflection Engine
                </h3>
                <p className="font-serif italic text-[13px] opacity-80 leading-relaxed">
                  Define how Elroy weaves his past memories into new identity reflections.
                </p>
              </div>

              {isFetchingPrompt ? (
                <div className="flex justify-center items-center h-[150px] opacity-50 font-mono text-[10px] tracking-wider">
                  LOADING PATTERNS...
                </div>
              ) : (
                <textarea
                  value={promptContent}
                  onChange={(e) => setPromptContent(e.target.value)}
                  className="w-full h-[200px] resize-none rounded-[12px] bg-black/5 dark:bg-white/5 p-4 text-[13px] font-sans leading-relaxed outline-none focus:ring-1 focus:ring-current/20 transition-all opacity-80"
                  placeholder="Enter system prompt instructions..."
                />
              )}

              <div className="flex items-center justify-between mt-5">
                <button
                  onClick={handleResetPrompt}
                  disabled={isFetchingPrompt || isSavingPrompt}
                  className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider opacity-40 hover:opacity-100 transition-opacity disabled:opacity-20"
                >
                  <RotateCcw size={12} /> Default
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowSettings(false)}
                    className="px-4 py-2 rounded-full font-sans text-[11px] uppercase tracking-wider opacity-60 hover:opacity-100 transition-opacity"
                  >
                    Close
                  </button>
                  <button
                    onClick={handleSavePrompt}
                    disabled={isFetchingPrompt || isSavingPrompt}
                    className="px-4 py-2 rounded-full font-sans text-[11px] uppercase tracking-wider bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 border border-black/5 dark:border-white/5 transition-colors disabled:opacity-50"
                  >
                    {isSavingPrompt ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
