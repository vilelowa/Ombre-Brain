import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronDown, ChevronUp, MessageSquare, Send } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { EnrichedDream } from './NocturneRoom';

interface NocturneArchiveProps {
  dreams: EnrichedDream[];
  onClose: () => void;
  onAddComment: (dreamId: string, content: string) => void;
}

type TimeFilter = '7days' | 'month' | 'all';
type CategoryFilter = 'all' | 'tone' | 'attention' | 'unresolved';

const timeLabels: Record<TimeFilter, string> = {
  '7days': '7 days',
  month: '30 days',
  all: 'All Time',
};

const categoryLabels: Record<CategoryFilter, string> = {
  all: 'All Dreams',
  tone: 'Tone',
  attention: 'Attention',
  unresolved: 'Unresolved',
};

export default function NocturneArchive({ dreams, onClose, onAddComment }: NocturneArchiveProps) {
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [isTimeOpen, setIsTimeOpen] = useState(false);
  const [isCategoryOpen, setIsCategoryOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [selectedItem, setSelectedItem] = useState<EnrichedDream | null>(null);

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

  const filteredData = dreams.filter((item) => {
    if (category !== 'all' && item.influenceType !== category) return false;
    if (timeFilter === 'all') return true;

    const created = new Date(item.createdAt);
    if (Number.isNaN(created.getTime())) return false;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - (timeFilter === '7days' ? 7 : 30));
    return created >= cutoff;
  });

  return (
    <div
      className="relative h-full overflow-hidden text-[#3A332B] dark:text-[#E8E2D2]"
    >
      <div className="absolute left-2 top-0 z-40 flex h-14 items-center">
        <button
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full opacity-60 transition-all hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/5"
        >
          <ChevronLeft size={24} strokeWidth={1.5} />
        </button>
      </div>

      <div
        className="relative z-10 h-full overflow-y-auto scrollbar-hide"
        onClick={() => {
          if (isTimeOpen) setIsTimeOpen(false);
          if (isCategoryOpen) setIsCategoryOpen(false);
        }}
        onScroll={(e) => setIsScrolled(e.currentTarget.scrollTop > 132)}
      >
        {/* Header */}
        <header className="px-6 pb-7 pt-20">
          <div className="flex flex-col items-center text-center">
            <h1 className="font-serif text-[20px] font-medium tracking-[0.28em]">
              ARCHIVE
            </h1>
            <p className="mt-2 font-serif text-[13px] italic opacity-60">
              The dreams that stayed after waking.
            </p>
          </div>
        </header>

        {/* Sticky Filters Area */}
        <div
          className={cn(
            'sticky top-0 z-30 px-6 transition-all duration-700',
            isScrolled
              ? 'bg-[#211D18]/22 pb-3 pt-3 shadow-sm backdrop-blur-xl [mask-image:linear-gradient(to_bottom,black_0%,black_78%,rgba(0,0,0,0.78)_88%,transparent_100%)]'
              : 'bg-transparent pb-4 pt-2',
          )}
        >
        <div className="relative mx-auto grid max-w-[360px] grid-cols-[1fr_auto_1fr] items-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsTimeOpen((open) => !open);
              setIsCategoryOpen(false);
            }}
            className="relative flex h-11 items-center justify-center gap-1 font-serif text-[14px] transition-colors"
          >
            <span>{timeLabels[timeFilter]}</span>
            <ChevronDown
              size={12}
              strokeWidth={1.6}
              className={cn('transition-transform', isTimeOpen && 'rotate-180')}
            />
          </button>

          <div className="h-8 w-px bg-current opacity-15" />

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsCategoryOpen((open) => !open);
              setIsTimeOpen(false);
            }}
            className="relative flex h-11 items-center justify-center gap-1 font-serif text-[14px] transition-colors"
          >
            <span>{categoryLabels[category]}</span>
            <ChevronDown
              size={12}
              strokeWidth={1.6}
              className={cn('transition-transform', isCategoryOpen && 'rotate-180')}
            />
          </button>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-current to-transparent opacity-25" />
        </div>

        <AnimatePresence>
          {isTimeOpen && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.14, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
              className="mx-auto mt-3 max-w-[320px] rounded-[18px] border border-[#D5CDBD]/30 bg-[#211D18]/70 p-2 text-[#E8E2D2] shadow-[0_18px_50px_rgba(0,0,0,0.3)] backdrop-blur-2xl"
            >
              <div className="grid grid-cols-3 gap-1">
                {(Object.keys(timeLabels) as TimeFilter[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setTimeFilter(option);
                      setIsTimeOpen(false);
                    }}
                    className={cn(
                      'h-8 rounded-[12px] font-sans text-[11px] transition-colors',
                      timeFilter === option
                        ? 'bg-[#E8E2D2]/14 text-[#FFF7E8]'
                        : 'text-[#E8E2D2]/62 hover:bg-white/8 hover:text-[#FFF7E8]',
                    )}
                  >
                    {timeLabels[option]}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {isCategoryOpen && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.14, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
              className="mx-auto mt-3 max-w-[320px] rounded-[18px] border border-[#D5CDBD]/30 bg-[#211D18]/70 p-2 text-[#E8E2D2] shadow-[0_18px_50px_rgba(0,0,0,0.3)] backdrop-blur-2xl"
            >
              <div className="grid grid-cols-2 gap-1">
                {(Object.keys(categoryLabels) as CategoryFilter[]).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setCategory(option);
                      setIsCategoryOpen(false);
                    }}
                    className={cn(
                      'h-8 rounded-[12px] font-sans text-[11px] transition-colors',
                      category === option
                        ? 'bg-[#E8E2D2]/14 text-[#FFF7E8]'
                        : 'text-[#E8E2D2]/62 hover:bg-white/8 hover:text-[#FFF7E8]',
                    )}
                  >
                    {categoryLabels[option]}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>

        {/* List */}
        <main className="px-6 pb-14 pt-2">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${timeFilter}-${category}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col gap-1"
            >
              {filteredData.length === 0 ? (
                <div className="mt-10 text-center font-serif text-[14px] italic opacity-40">
                  No records found.
                </div>
              ) : (
                filteredData.map((reflection) => (
                  <button
                    key={reflection.id}
                    onClick={() => setSelectedItem(reflection)}
                    className="group relative flex w-full flex-col gap-1 rounded-xl border-b border-[#D5CDBD]/10 px-2 py-4 text-left transition-all hover:bg-black/5 dark:border-[#2A2621]/30 dark:hover:bg-white/5"
                  >
                    <div className="flex w-full items-baseline justify-between">
                      <h3 className="font-serif text-[14px] tracking-wide opacity-80 transition-opacity group-hover:opacity-100">
                        {reflection.name}
                      </h3>
                      <span className="shrink-0 font-mono text-[10px] opacity-40">
                        {formatDate(reflection.createdAt)}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Modal Overlay for Selected Item */}
      <AnimatePresence>
        {selectedItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-[#F5EFE7]/80 dark:bg-[#0A0808]/80 backdrop-blur-md p-4"
            onClick={() => setSelectedItem(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[400px] flex flex-col max-h-[85vh] rounded-[20px] border border-[#D5CDBD]/50 dark:border-[#2A2621]/50 bg-[#F5EFE7]/90 dark:bg-[#1A1816]/90 backdrop-blur-xl shadow-2xl overflow-hidden"
            >
              <div className="flex-1 overflow-y-auto p-6">
                {/* Meta Header */}
                <div className="flex items-center justify-between mb-4">
                  <span className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-sm font-mono text-[9px] uppercase tracking-wider border",
                    "border-current opacity-60"
                  )}>
                    {selectedItem.influenceType}
                  </span>
                  <span className="font-mono text-[10px] opacity-40">
                    {formatDate(selectedItem.createdAt)}
                  </span>
                </div>

                {/* Title & Body */}
                <h2 className="font-serif text-[18px] font-medium tracking-wide mb-3">
                  {selectedItem.name}
                </h2>
                <p className="font-sans text-[14px] leading-[1.8] opacity-80 mb-6">
                  {selectedItem.text}
                </p>

                {/* Comments Preview */}
                {(selectedItem.comments || []).length > 0 && (
                  <div className="mb-6 flex items-start gap-2 rounded-lg bg-black/5 dark:bg-white/5 p-4">
                    <MessageSquare size={14} className="mt-0.5 opacity-40" />
                    <div className="flex-1">
                      {(selectedItem.comments || []).map((c: any) => (
                        <p key={c.id} className="text-[13px] opacity-70">
                          <span className="font-semibold opacity-100">{c.author}: </span>
                          {c.content}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                {/* Accordion Toggle */}
                {(selectedItem.loadedSourceMemories || []).length > 0 && (
                  <button 
                    onClick={() => toggleExpanded(selectedItem.id)}
                    className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider opacity-50 hover:opacity-100 transition-opacity"
                  >
                    {expandedIds[selectedItem.id] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    <span>Source Memories ({(selectedItem.loadedSourceMemories || []).length})</span>
                  </button>
                )}

                {/* Accordion Content */}
                {expandedIds[selectedItem.id] && (selectedItem.loadedSourceMemories || []).length > 0 && (
                  <div className="overflow-hidden mt-4 flex flex-col gap-4 border-t border-[#D5CDBD]/30 dark:border-[#2A2621]/30 pt-5">
                    {(selectedItem.loadedSourceMemories || []).map((mem: any) => (
                      <div key={mem.id} className="border-l-[2px] border-current/20 pl-4">
                        <p className="font-sans text-[13px] leading-relaxed opacity-70 italic">
                          "{mem.content}"
                        </p>
                        <span className="mt-2 block font-mono text-[9px] opacity-30">
                          {formatDate(mem.created)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Whisper Input Pinned Bottom */}
              <div className="border-t border-[#D5CDBD]/20 dark:border-[#2A2621]/20 p-5 bg-black/5 dark:bg-white/5">
                {replyingTo !== selectedItem.id ? (
                  <button 
                    onClick={() => setReplyingTo(selectedItem.id)}
                    className="font-serif italic text-[14px] opacity-40 hover:opacity-100 transition-opacity w-full text-left pl-2"
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
                      className="w-full resize-none bg-transparent text-[14px] font-sans leading-relaxed outline-none placeholder:font-serif placeholder:italic placeholder:opacity-40 opacity-80 min-h-[24px]"
                      rows={1}
                      onInput={(e) => {
                        e.currentTarget.style.height = 'auto';
                        e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
                      }}
                    />
                    <div className="flex justify-end gap-3 mt-2">
                      <button 
                        onClick={() => { setReplyingTo(null); setReplyContent(''); }}
                        className="font-mono text-[10px] uppercase tracking-wider opacity-40 hover:opacity-100 transition-opacity"
                      >
                        Cancel
                      </button>
                      <button 
                        onClick={() => {
                          onAddComment(selectedItem.id, replyContent);
                          
                          // Optimistically update local selected item so comment shows immediately
                          setSelectedItem({
                            ...selectedItem,
                            comments: [
                              ...(selectedItem.comments || []),
                              { id: Math.random().toString(), author: 'Ciel', content: replyContent, created: new Date().toISOString() }
                            ]
                          });
                          
                          setReplyContent('');
                          setReplyingTo(null);
                        }}
                        className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider opacity-80 hover:opacity-100 transition-opacity"
                      >
                        <Send size={12} /> Send
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
