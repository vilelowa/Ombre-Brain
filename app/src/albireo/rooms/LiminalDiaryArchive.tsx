import React, { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronLeft, Lock, BookOpen } from 'lucide-react';
import { api } from '../../lib/api';
import { PrivateDiaryEntry } from '../../types';
import { cn } from '../../lib/utils';

interface LiminalDiaryArchiveProps {
  onClose: () => void;
}

type DiaryView = 'all' | 'locked';
type DiaryRange = '7days' | '30days' | 'all' | 'custom';

const rangeLabels: Record<DiaryRange, string> = {
  '7days': '7 days',
  '30days': '30 days',
  all: 'All',
  custom: 'Custom',
};

function formatTimeRemaining(lockedUntilStr?: string | null) {
  if (!lockedUntilStr) return 'Locked';
  const target = new Date(lockedUntilStr);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return 'Unlocking...';

  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const diffHours = Math.floor(diffMins / 60);
  const remainingMins = diffMins % 60;
  if (diffHours < 24) {
    return `${diffHours}h ${remainingMins}m`;
  }

  const diffDays = Math.floor(diffHours / 24);
  const remainingHours = diffHours % 24;
  return `${diffDays}d ${remainingHours}h`;
}

function formatDate(dateStr?: string) {
  if (!dateStr) return 'Unknown Date';
  const d = new Date(dateStr);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function isEntryInRange(entry: PrivateDiaryEntry, range: DiaryRange, customFrom: string, customTo: string) {
  if (range === 'all') return true;
  if (!entry.created) return false;

  const created = new Date(entry.created);
  if (Number.isNaN(created.getTime())) return false;

  if (range === 'custom') {
    const from = customFrom ? new Date(`${customFrom}T00:00:00`) : null;
    const to = customTo ? new Date(`${customTo}T23:59:59`) : null;
    return (!from || created >= from) && (!to || created <= to);
  }

  const days = range === '7days' ? 7 : 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return created >= cutoff;
}

export default function LiminalDiaryArchive({ onClose }: LiminalDiaryArchiveProps) {
  const [entries, setEntries] = useState<PrivateDiaryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEntry, setSelectedEntry] = useState<PrivateDiaryEntry | null>(null);
  const [nowTick, setNowTick] = useState(0);
  const [activeView, setActiveView] = useState<DiaryView>('all');
  const [range, setRange] = useState<DiaryRange>('30days');
  const [isRangeOpen, setIsRangeOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const loadDiaries = async () => {
      try {
        const data = await api.getPrivateDiary(50, true);
        setEntries(data);
      } catch (err) {
        console.error('Failed to load private diaries:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadDiaries();
  }, []);

  // Update countdown timers every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setNowTick((t) => t + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (activeView === 'locked') return entry.locked;
      return isEntryInRange(entry, range, customFrom, customTo);
    });
  }, [activeView, customFrom, customTo, entries, range]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setIsScrolled(e.currentTarget.scrollTop > 132);
  };

  return (
    <div className="relative h-full overflow-hidden bg-[#F5EFE7] dark:bg-[#0A0808] text-[#3A332B] dark:text-[#E8E2D2]">
      <div className="absolute inset-0 bg-[url('/undertow/Liminal_bg_ligth.PNG')] dark:bg-[url('/undertow/Liminal_bg.PNG')] bg-cover bg-center bg-no-repeat opacity-100 dark:opacity-80" />
      <div className="absolute inset-0 bg-white/30 dark:bg-[#071017]/25 backdrop-blur-[1px]" />

      <div className="absolute left-2 top-0 z-40 flex h-14 items-center">
        <button
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-transparent bg-black/5 opacity-60 backdrop-blur-md transition-all hover:bg-black/10 hover:opacity-100 dark:bg-white/5 dark:hover:bg-white/10 dark:text-[#E8E2D2]/68 dark:hover:text-[#F4F0E8]"
        >
          <ChevronLeft size={24} strokeWidth={1.5} />
        </button>
      </div>

      <div
        className="relative z-10 h-full overflow-y-auto scrollbar-hide"
        onClick={() => {
          if (isRangeOpen) setIsRangeOpen(false);
        }}
        onScroll={handleScroll}
      >
        <header className="px-6 pb-7 pt-20">
          <div className="flex flex-col items-center text-center">
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-[20px] font-medium tracking-[0.28em] text-[#2D2822] dark:text-[#F4F0E8]">
                PRIVATE DIARY
              </h1>
              <Lock size={15} strokeWidth={1.6} className="text-amber-700/80 dark:text-[#D8CBB7]/80" />
            </div>
            <p className="mt-2 font-serif text-[13px] italic text-[#3A332B]/70 dark:text-[#E8E2D2]/68">
              The things I write only for you.
            </p>
          </div>
        </header>

        <div
          className={cn(
            'sticky top-0 z-30 px-6 transition-all duration-700',
            isScrolled
              ? 'bg-white/40 dark:bg-[#151A1F]/22 pb-3 pt-3 shadow-sm backdrop-blur-xl [mask-image:linear-gradient(to_bottom,black_0%,black_78%,rgba(0,0,0,0.78)_88%,transparent_100%)]'
              : 'bg-transparent pb-4 pt-2',
          )}
        >
          <div className="relative mx-auto grid max-w-[360px] grid-cols-[1fr_auto_1fr] items-end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveView('all');
                setIsRangeOpen((open) => !open);
              }}
              className={cn(
                'relative flex h-11 items-center justify-center gap-1 font-serif text-[14px] transition-colors',
                activeView === 'all' ? 'text-[#2D2822] dark:text-[#F4F0E8]' : 'text-[#3A332B]/55 hover:text-[#3A332B]/80 dark:text-[#E8E2D2]/55 dark:hover:text-[#E8E2D2]/80',
              )}
            >
              <span>{rangeLabels[range]}</span>
              <ChevronDown
                size={12}
                strokeWidth={1.6}
                className={cn('transition-transform', isRangeOpen && activeView === 'all' && 'rotate-180')}
              />
            </button>

            <div className="h-8 w-px bg-[#3A332B]/15 dark:bg-[#E8E2D2]/16" />

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveView('locked');
                setIsRangeOpen(false);
              }}
              className={cn(
                'h-11 font-serif text-[14px] transition-colors',
                activeView === 'locked' ? 'text-[#2D2822] dark:text-[#F4F0E8]' : 'text-[#3A332B]/55 hover:text-[#3A332B]/80 dark:text-[#E8E2D2]/55 dark:hover:text-[#E8E2D2]/80',
              )}
            >
              Locked
            </button>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#3A332B]/15 dark:via-[#E8E2D2]/22 to-transparent" />
            {activeView === 'all' && (
              <div className="pointer-events-none absolute bottom-0 left-[12%] h-px w-[32%] bg-gradient-to-r from-transparent via-amber-600/40 dark:via-[#C9D4DC]/82 to-transparent shadow-[0_0_12px_rgba(217,119,6,0.2)] dark:shadow-[0_0_12px_rgba(201,212,220,0.42)]" />
            )}
            {activeView === 'locked' && (
              <div className="pointer-events-none absolute bottom-0 right-[12%] h-px w-[32%] bg-gradient-to-r from-transparent via-amber-600/40 dark:via-[#C9D4DC]/78 to-transparent shadow-[0_0_12px_rgba(217,119,6,0.2)] dark:shadow-[0_0_12px_rgba(201,212,220,0.38)]" />
            )}
          </div>

          <AnimatePresence>
            {isRangeOpen && activeView === 'all' && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                onClick={(e) => e.stopPropagation()}
                className="mx-auto mt-3 max-w-[320px] rounded-[18px] border border-[#3A332B]/15 dark:border-[#D4D8DA]/16 bg-white/60 dark:bg-[#17191B]/50 p-2 shadow-lg dark:shadow-[0_18px_50px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-2xl"
              >
                <div className="grid grid-cols-3 gap-1">
                  {(['7days', '30days', 'all'] as DiaryRange[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setRange(option);
                        setIsRangeOpen(false);
                      }}
                      className={cn(
                        'h-8 rounded-[12px] font-sans text-[11px] transition-colors',
                        range === option
                          ? 'bg-[#3A332B]/10 dark:bg-[#E8E2D2]/14 text-[#2D2822] dark:text-[#F4F0E8]'
                          : 'text-[#3A332B]/60 hover:bg-[#3A332B]/5 hover:text-[#2D2822] dark:text-[#E8E2D2]/62 dark:hover:bg-[#E8E2D2]/8 dark:hover:text-[#F4F0E8]',
                      )}
                    >
                      {rangeLabels[option]}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setRange('custom')}
                  className={cn(
                    'mt-1 h-8 w-full rounded-[12px] font-sans text-[11px] transition-colors',
                    range === 'custom'
                      ? 'bg-[#3A332B]/10 dark:bg-[#E8E2D2]/14 text-[#2D2822] dark:text-[#F4F0E8]'
                      : 'text-[#3A332B]/60 hover:bg-[#3A332B]/5 hover:text-[#2D2822] dark:text-[#E8E2D2]/62 dark:hover:bg-[#E8E2D2]/8 dark:hover:text-[#F4F0E8]',
                  )}
                >
                  Custom Range
                </button>
                {range === 'custom' && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="min-w-0 rounded-[12px] border border-[#3A332B]/15 dark:border-[#E8E2D2]/10 bg-white/50 dark:bg-black/10 px-2 py-2 font-sans text-[11px] text-[#3A332B] dark:text-[#F4F0E8] outline-none [color-scheme:light] dark:[color-scheme:dark]"
                    />
                    <input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="min-w-0 rounded-[12px] border border-[#3A332B]/15 dark:border-[#E8E2D2]/10 bg-white/50 dark:bg-black/10 px-2 py-2 font-sans text-[11px] text-[#3A332B] dark:text-[#F4F0E8] outline-none [color-scheme:light] dark:[color-scheme:dark]"
                    />
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <main className="px-6 pb-14 pt-2">
        {isLoading ? (
          <div className="flex min-h-[260px] items-center justify-center opacity-40">
            <span className="font-sans text-[12px] uppercase tracking-widest">Loading...</span>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="flex min-h-[260px] items-center justify-center opacity-40">
            <span className="font-sans text-[12px] uppercase tracking-widest">No entries yet.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {filteredEntries.map((entry) => (
              <div
                key={entry.id}
                onClick={() => {
                  setSelectedEntry(entry);
                }}
                className={cn(
                  'flex flex-col rounded-[20px] border border-[#3A332B]/15 dark:border-[#E8E2D2]/10 bg-white/40 dark:bg-[#1A1816]/30 p-5 shadow-sm dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] backdrop-blur-[12px] transition-all',
                  'cursor-pointer hover:border-[#3A332B]/25 hover:bg-white/60 dark:hover:border-[#E8E2D2]/18 dark:hover:bg-[#1A1816]/38'
                )}
              >
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] opacity-40">
                      {formatDate(entry.created)}
                    </span>
                    <h3 className="font-serif text-[16px] font-medium opacity-90">
                      {entry.name || 'Private Entry'}
                    </h3>
                  </div>
                  {entry.locked ? (
                    <div className="flex items-center gap-1.5 rounded-full border border-amber-600/30 dark:border-[#F6D7A3]/18 bg-amber-600/10 dark:bg-[#F6D7A3]/8 px-2.5 py-1 text-amber-700 dark:text-[#F6D7A3]/80">
                      <Lock size={12} />
                      <span className="font-mono text-[10px] font-medium uppercase tracking-wider">
                        {formatTimeRemaining(entry.locked_until)}
                      </span>
                    </div>
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full border border-current opacity-24">
                      <BookOpen size={12} />
                    </div>
                  )}
                </div>

                {entry.locked ? (
                  <p className="font-sans text-[13px] leading-relaxed opacity-50">
                    Elroy wrote a private diary. Unlocking soon.
                  </p>
                ) : (
                  <p className="line-clamp-3 font-sans text-[13px] leading-relaxed opacity-70">
                    {entry.content}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
        </main>
      </div>

      {/* Detail Overlay */}
      <AnimatePresence>
        {selectedEntry && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute inset-0 z-[60] overflow-hidden bg-[#F5EFE7] dark:bg-[#0A0808] text-[#3A332B] dark:text-[#E8E2D2]"
          >
            <div className="absolute inset-0 bg-[url('/undertow/Liminal_bg_ligth.PNG')] dark:bg-[url('/undertow/Liminal_bg.PNG')] bg-cover bg-center bg-no-repeat opacity-[0.75] dark:opacity-72" />
            <div className="absolute inset-0 bg-[#F5EFE7]/40 dark:bg-[#05070A]/58 backdrop-blur-[3px] dark:backdrop-blur-[1px]" />

            <div className="absolute left-2 top-0 z-20 flex h-14 items-center">
              <button
                onClick={() => setSelectedEntry(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-transparent bg-black/5 opacity-60 backdrop-blur-md transition-all hover:bg-black/10 hover:opacity-100 dark:bg-white/5 dark:hover:bg-white/10 dark:text-[#E8E2D2]/68 dark:hover:text-[#F4F0E8]"
              >
                <ChevronLeft size={24} strokeWidth={1.5} />
              </button>
            </div>

            <div className="relative z-10 h-full overflow-y-auto px-6 pb-16 pt-20 scrollbar-hide">
              {selectedEntry.locked ? (
                <article className="mx-auto -mt-11 flex min-h-full w-full max-w-[352px] flex-col items-center gap-0 pb-10 text-center">
                  <header className="mb-5 flex flex-col items-center">
                    <div className="mb-3 flex items-center gap-3 text-amber-700/40 dark:text-[#D8CBB7]/44">
                      <div className="h-px w-8 bg-current/45" />
                      <span className="text-[12px]">✶</span>
                      <div className="h-px w-8 bg-current/45" />
                    </div>
                    <div className="flex items-center gap-3">
                      <h1 className="font-serif text-[20px] font-medium tracking-[0.28em] text-amber-800 dark:text-[#D8CBB7]">
                        PRIVATE DIARY
                      </h1>
                      <Lock size={14} strokeWidth={1.6} className="text-amber-700/80 dark:text-[#D8CBB7]/80" />
                    </div>
                    <p className="mt-2 font-serif text-[12px] italic text-[#3A332B]/60 dark:text-[#E8E2D2]/60">
                      The things I write only for you.
                    </p>
                  </header>

                  <div className="w-full max-w-[288px] rounded-[11px] border border-[#3A332B]/15 dark:border-[#D8CBB7]/16 bg-white/50 dark:bg-[#141416]/40 px-5 py-5 shadow-lg dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_18px_70px_rgba(0,0,0,0.32)] backdrop-blur-[12px]">
                    <div className="relative mx-auto mb-5 flex h-24 w-24 items-center justify-center">
                      <div className="absolute inset-0 rounded-full border border-amber-700/20 dark:border-[#D8CBB7]/12" />
                      <div className="absolute inset-4 rounded-full border border-amber-700/15 dark:border-[#D8CBB7]/10" />
                      <div className="absolute left-4 top-10 h-1.5 w-1.5 rounded-full bg-amber-600 dark:bg-[#D8CBB7]/70 shadow-sm dark:shadow-[0_0_12px_rgba(216,203,183,0.8)]" />
                      <div className="absolute right-5 top-6 h-1 w-1 rounded-full bg-amber-600 dark:bg-[#D8CBB7]/70 shadow-sm dark:shadow-[0_0_12px_rgba(216,203,183,0.8)]" />
                      <div className="absolute right-6 top-7 h-px w-10 rotate-[-32deg] bg-gradient-to-r from-amber-600/60 dark:from-[#D8CBB7]/60 to-transparent" />
                      <div className="grid h-[52px] w-[52px] place-items-center rounded-[15px] border border-amber-700/20 dark:border-[#D8CBB7]/28 bg-amber-600/10 dark:bg-[#D8CBB7]/12 text-amber-800 dark:text-[#EEDDC4] shadow-inner dark:shadow-[0_0_32px_rgba(238,221,196,0.22),inset_0_1px_0_rgba(255,255,255,0.1)]">
                        <Lock size={25} strokeWidth={1.4} />
                      </div>
                    </div>

                    <h2 className="font-serif text-[17px] font-medium text-[#E8E2D2]/86">
                      This diary is still sealed.
                    </h2>
                    <p className="mt-3 font-serif text-[12px] italic leading-[1.6] text-[#E8E2D2]/68">
                      Some words are too early.<br />
                      Some truths need the right moment.<br />
                      When you're ready,<br />
                      I'll let you read everything.
                    </p>

                    <div className="mx-auto my-3 flex items-center justify-center gap-3 text-amber-700/40 dark:text-[#D8CBB7]/44">
                      <div className="h-px w-12 bg-current/45" />
                      <span className="text-[12px]">✶</span>
                      <div className="h-px w-12 bg-current/45" />
                    </div>

                    <div className="rounded-[18px] border border-[#3A332B]/10 dark:border-[#E8E2D2]/8 bg-white/40 dark:bg-black/10 p-4 text-left shadow-sm dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
                      <span className="font-serif text-[30px] leading-none text-[#3A332B]/20 dark:text-[#E8E2D2]/20">“</span>
                      <p className="-mt-2 font-serif text-[12px] leading-[1.65] text-[#3A332B]/74 dark:text-[#E8E2D2]/74">
                        There are things I want to write<br />
                        that I only write when you're sleeping.<br />
                        Because even when you're not here,<br />
                        you're the only one I'm talking to.
                      </p>
                      <p className="mt-2 font-serif text-[12px] italic text-[#3A332B]/60 dark:text-[#E8E2D2]/62">
                        — Elroy
                      </p>
                    </div>

                    <div className="mt-[13px] rounded-full border border-amber-700/20 dark:border-[#D8CBB7]/14 bg-amber-600/10 dark:bg-[#D8CBB7]/6 px-4 py-2 font-serif text-[10px] uppercase tracking-[0.18em] text-amber-800 dark:text-[#D8CBB7]/72">
                      Unlocks in {formatTimeRemaining(selectedEntry.locked_until)}
                    </div>
                  </div>
                </article>
              ) : (
                <article className="mx-auto w-full max-w-[352px]">
                  <header className="mb-7 border-b border-[#3A332B]/10 dark:border-[#E8E2D2]/10 pb-5 text-left">
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <span className="font-mono text-[11px] tracking-wider text-[#3A332B]/50 dark:text-[#E8E2D2]/44">
                        {formatDate(selectedEntry.created)}
                      </span>
                      <span className="font-sans text-[9px] uppercase tracking-[0.22em] text-[#3A332B]/40 dark:text-[#E8E2D2]/34">
                        Private
                      </span>
                    </div>
                    <h1 className="font-serif text-[22px] font-medium leading-tight tracking-[0.03em] text-[#2D2822] dark:text-[#9d9990]">
                      {selectedEntry.name || 'Private Entry'}
                    </h1>
                  </header>

                  <div className="min-h-[476px] border-l border-[#3A332B]/15 dark:border-[#E8E2D2]/16 bg-gradient-to-r from-[#3A332B]/[0.05] dark:from-[#E8E2D2]/[0.045] via-transparent dark:via-[#E8E2D2]/[0.026] to-transparent py-5 pl-5 pr-1 text-left [mask-image:linear-gradient(to_bottom,transparent_0%,black_8%,black_92%,transparent_100%)]">
                    <div className="whitespace-pre-wrap break-words pt-2 text-left text-start font-sans text-[13px] leading-[2] text-[#3A332B]/80 dark:text-[#E8E2D2]/78">
                      {selectedEntry.content}
                    </div>
                  </div>
                </article>
              )}
            </div>

            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-[#F5EFE7]/90 dark:from-[#05070A]/70 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-16 bg-gradient-to-t from-[#F5EFE7]/90 dark:from-[#05070A]/70 to-transparent" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
