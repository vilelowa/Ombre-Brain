import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Loader2,
  Paperclip,
  RotateCcw,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';

interface LightTracesRoomProps {
  onClose: () => void;
}

interface JournalEntry {
  id: string;
  title: string;
  content: string;
  created: string;
}

interface JournalBucket {
  id?: string;
  content?: string;
  metadata?: {
    id?: string;
    name?: string;
    created?: string;
    last_active?: string;
  };
}

const RELATIONSHIP_START = new Date('2025-05-12T00:00:00');

const weekdayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dateKey(date: Date | string) {
  const value = typeof date === 'string' ? new Date(date) : date;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMonth(date: Date) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(date);
}

function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function getStartOfWeek(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  // Adjust so Monday is the first day of the week, or Sunday?
  // calendar starts on Sunday (weekdayLabels = ['S', 'M', ...])
  const diff = d.getDate() - day;
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function monthKey(date: Date | string) {
  const value = typeof date === 'string' ? new Date(date) : date;
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}

function yearKey(date: Date | string) {
  const value = typeof date === 'string' ? new Date(date) : date;
  return `${value.getFullYear()}`;
}

function formatJournalTime(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function getCalendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  const requiredCells = first.getDay() + last.getDate();
  const cellCount = requiredCells <= 35 ? 35 : 42;

  return Array.from({ length: cellCount }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return day;
  });
}

function countDaysTogether() {
  const difference = startOfDay(new Date()).getTime() - RELATIONSHIP_START.getTime();
  return Math.max(1, Math.floor(difference / 86_400_000) + 1);
}

function bucketToJournal(bucket: JournalBucket): JournalEntry | null {
  const metadata = bucket.metadata || {};
  const id = String(bucket.id || metadata.id || '').trim();
  const created = String(metadata.created || metadata.last_active || '').trim();
  if (!id || !created || Number.isNaN(new Date(created).getTime())) return null;
  return {
    id,
    title: String(metadata.name || 'Daily Journal'),
    content: String(bucket.content || ''),
    created,
  };
}

export default function LightTracesRoom({ onClose }: LightTracesRoomProps) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [isLoadingJournals, setIsLoadingJournals] = useState(true);
  const [journalError, setJournalError] = useState('');
  const [isSavingJournal, setIsSavingJournal] = useState(false);
  const [cursorDate, setCursorDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedJournal, setSelectedJournal] = useState<JournalEntry | null>(null);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [editingJournal, setEditingJournal] = useState<JournalEntry | null>(null);
  const [journalToDelete, setJournalToDelete] = useState<JournalEntry | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [memoryCount, setMemoryCount] = useState<number | null>(null);

  const [journalViewMode, setJournalViewMode] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily');

  // Settings State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('daily');
  const [prompts, setPrompts] = useState({
    daily_journal: '',
    weekly_journal: '',
    monthly_journal: '',
    yearly_journal: ''
  });
  const [isFetchingPrompt, setIsFetchingPrompt] = useState(false);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [promptError, setPromptError] = useState('');

  useEffect(() => {
    if (isSettingsOpen) {
      loadPrompts();
    }
  }, [isSettingsOpen]);

  const loadPrompts = async () => {
    setIsFetchingPrompt(true);
    setPromptError('');
    try {
      const fetched = await api.getSystemPrompts();
      setPrompts({
        daily_journal: fetched.daily_journal || '',
        weekly_journal: fetched.weekly_journal || '',
        monthly_journal: fetched.monthly_journal || '',
        yearly_journal: fetched.yearly_journal || '',
      });
    } catch (e) {
      console.error("Failed to fetch prompts", e);
      setPromptError('Failed to load settings.');
    } finally {
      setIsFetchingPrompt(false);
    }
  };

  const handleSavePrompt = async () => {
    setIsSavingPrompt(true);
    setPromptError('');
    try {
      await api.updateSystemPrompts({
        daily_journal: prompts.daily_journal,
        weekly_journal: prompts.weekly_journal,
        monthly_journal: prompts.monthly_journal,
        yearly_journal: prompts.yearly_journal,
      });
      setIsSettingsOpen(false);
    } catch (e) {
      console.error("Failed to save prompt", e);
      setPromptError('Failed to save settings.');
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleResetPrompt = async () => {
    setIsSavingPrompt(true);
    setPromptError('');
    try {
      const key = `${activeTab}_journal` as keyof typeof prompts;
      await api.resetSystemPrompt(key);
      const fetched = await api.getSystemPrompts();
      setPrompts((prev) => ({ ...prev, [key]: fetched[key] || '' }));
    } catch (e) {
      console.error("Failed to reset prompt", e);
      setPromptError('Failed to reset settings.');
    } finally {
      setIsSavingPrompt(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    api.getMemoryBuckets(5000).then((res) => {
      if (!cancelled) setMemoryCount(res.length);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingJournals(true);
    setJournalError('');

    const fetchJournals = async () => {
      try {
        let result: any[] = [];
        if (journalViewMode === 'daily') result = await api.getDailyJournals();
        else if (journalViewMode === 'weekly') result = await api.getWeeklyJournals();
        else if (journalViewMode === 'monthly') result = await api.getMonthlyJournals();
        else if (journalViewMode === 'yearly') result = await api.getYearlyJournals();

        if (!cancelled) {
          setJournals(
            result.map(bucketToJournal).filter((j): j is JournalEntry => j !== null)
          );
        }
      } catch (error) {
        if (!cancelled) setJournalError(error instanceof Error ? error.message : 'Failed to load journals.');
      } finally {
        if (!cancelled) setIsLoadingJournals(false);
      }
    };

    fetchJournals();
    return () => { cancelled = true; };
  }, [journalViewMode]);

  const journalsByDate = useMemo(() => {
    const grouped = new Map<string, JournalEntry[]>();
    journals.forEach((journal) => {
      const key = dateKey(journal.created);
      grouped.set(key, [...(grouped.get(key) || []), journal]);
    });
    return grouped;
  }, [journals]);

  const calendarDays = useMemo(() => getCalendarDays(cursorDate), [cursorDate]);
  const selectedDayJournals = journalsByDate.get(dateKey(selectedDate)) || [];
  const dayJournal = selectedDayJournals[0] || null;

  const changeCursor = (offset: number) => {
    if (journalViewMode === 'daily') {
      const next = new Date(cursorDate.getFullYear(), cursorDate.getMonth() + offset, 1);
      setCursorDate(next);
      setSelectedDate(next);
    } else if (journalViewMode === 'weekly') {
      const nextDate = new Date(selectedDate);
      nextDate.setDate(selectedDate.getDate() + offset * 7);
      setSelectedDate(nextDate);
      setCursorDate(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
    } else if (journalViewMode === 'monthly') {
      const next = new Date(cursorDate.getFullYear() + offset, cursorDate.getMonth(), 1);
      setCursorDate(next);
      setSelectedDate(next);
    } else if (journalViewMode === 'yearly') {
      const next = new Date(cursorDate.getFullYear() + offset * 10, cursorDate.getMonth(), 1);
      setCursorDate(next);
      const nextSelected = new Date(selectedDate.getFullYear() + offset * 10, 0, 1);
      setSelectedDate(nextSelected);
    }
  };

  const selectToday = () => {
    setCursorDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDate(today);
  };

  const activeJournal = useMemo(() => {
    if (journalViewMode === 'daily') {
      return journalsByDate.get(dateKey(selectedDate))?.[0] || null;
    } else if (journalViewMode === 'weekly') {
      const weekStart = getStartOfWeek(selectedDate);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);
      return journals.find(j => {
        const d = new Date(j.created);
        return d >= weekStart && d <= weekEnd;
      }) || null;
    } else if (journalViewMode === 'monthly') {
      const targetMonth = monthKey(selectedDate);
      return journals.find(j => monthKey(j.created) === targetMonth) || null;
    } else if (journalViewMode === 'yearly') {
      const targetYear = yearKey(selectedDate);
      return journals.find(j => yearKey(j.created) === targetYear) || null;
    }
    return null;
  }, [journalViewMode, selectedDate, journalsByDate, journals]);

  const beginEdit = (journal: JournalEntry) => {
    setEditingJournal(journal);
    setEditTitle(journal.title);
    setEditContent(journal.content);
  };

  const saveEdit = async () => {
    if (!editingJournal) return;
    setIsSavingJournal(true);
    setJournalError('');
    const updated = {
      ...editingJournal,
      title: editTitle.trim() || editingJournal.title,
      content: editContent.trim() || editingJournal.content,
    };
    try {
      await api.updateMemoryBucket(editingJournal.id, {
        name: updated.title,
        content: updated.content,
      });
      setJournals((current) => current.map((journal) => journal.id === updated.id ? updated : journal));
      setSelectedJournal((current) => current?.id === updated.id ? updated : current);
      setEditingJournal(null);
    } catch (error) {
      setJournalError(error instanceof Error ? error.message : 'Failed to update journal.');
    } finally {
      setIsSavingJournal(false);
    }
  };

  const deleteJournal = async (journal: JournalEntry) => {
    setIsSavingJournal(true);
    setJournalError('');
    try {
      await api.deleteMemoryBucket(journal.id);
      setJournals((current) => current.filter((entry) => entry.id !== journal.id));
      if (selectedJournal?.id === journal.id) setSelectedJournal(null);
      if (editingJournal?.id === journal.id) setEditingJournal(null);
      setJournalToDelete(null);
    } catch (error) {
      setJournalError(error instanceof Error ? error.message : 'Failed to delete journal.');
    } finally {
      setIsSavingJournal(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 z-50 overflow-hidden bg-[#F2ECE4] font-sans text-[#4A3C31]"
    >
      <div className="absolute inset-0 bg-[url('/undertow/LightTraces_bg.JPG')] bg-cover bg-bottom bg-no-repeat" />
      <div className="absolute inset-0 bg-[#FFF9F0]/10" />

      <div className="light-traces-layout relative z-10 grid h-full grid-rows-[auto_minmax(0,1fr)_auto] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))]">
        <header className="light-traces-header relative flex w-full flex-col items-center justify-center">
          <div className="relative flex min-h-12 w-full flex-col items-center justify-center pt-3">
            <button
              type="button"
              onClick={onClose}
              aria-label="Back"
              className="absolute left-0 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-[#6D5744]/14 bg-[#FFFDF8]/48 text-[#4A3C31]/68 shadow-[0_5px_16px_rgba(83,61,43,0.08)] backdrop-blur-sm"
            >
              <ChevronLeft size={20} strokeWidth={1.5} />
            </button>

            <div className="text-center">
              <h1 className="font-serif text-[20px] font-medium tracking-[0.24em] text-[#45362B]">
                LIGHT TRACES
              </h1>
              <p className="mt-0.5 font-serif text-[10px] italic tracking-[0.08em] text-[#6F5A49]/66 transition-all">
                {journalViewMode === 'daily' && "Daily journals from our yesterdays."}
                {journalViewMode === 'weekly' && "Weekly reflections of our shared moments."}
                {journalViewMode === 'monthly' && "Monthly chapters of our journey."}
                {journalViewMode === 'yearly' && "Yearly milestones of our life."}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Settings"
              className="absolute right-0 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-[#6D5744]/14 bg-[#FFFDF8]/48 text-[#4A3C31]/68 shadow-[0_5px_16px_rgba(83,61,43,0.08)] backdrop-blur-sm transition-colors hover:bg-[#FFFDF8] hover:text-[#4A3C31]"
            >
              <Settings2 size={18} strokeWidth={1.5} />
            </button>
          </div>

          <div className="mt-4 flex items-center justify-center gap-6">
            {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setJournalViewMode(mode)}
                className={cn(
                  "relative pb-1.5 font-serif text-[10px] uppercase tracking-[0.16em] transition-colors",
                  journalViewMode === mode ? "text-[#49372C]" : "text-[#6F5A49]/50 hover:text-[#49372C]/80"
                )}
              >
                {mode}
                {journalViewMode === mode && (
                  <motion.div
                    layoutId="activeViewIndicator"
                    className="absolute bottom-0 left-[10%] right-[10%] h-[1px] bg-[#6F5A49]/70"
                  />
                )}
              </button>
            ))}
          </div>
        </header>

        <main className="light-traces-main mx-auto grid min-h-0 min-w-0 w-full max-w-[332px] content-start gap-2 pt-8">
          <section className="light-traces-calendar relative min-w-0 rounded-[8px_18px_12px_9px] border border-[#745D49]/14 bg-[linear-gradient(108deg,rgba(255,253,248,0.78),rgba(246,237,226,0.61))] px-4 pb-3 pt-3 shadow-[0_14px_34px_rgba(91,67,48,0.15),inset_0_1px_0_rgba(255,255,255,0.84)] backdrop-blur-[7px]">
            <div className="pointer-events-none absolute -top-2 left-[38%] h-5 w-[72px] rotate-[-2deg] border-x border-[#8A725C]/8 bg-[#DCCDB9]/42 shadow-[0_2px_5px_rgba(80,58,42,0.08)]" />
            <div className="pointer-events-none absolute -left-[13px] top-8 flex flex-col gap-[18px]">
              {Array.from({ length: 6 }, (_, index) => (
                <span
                  key={index}
                  className="relative block h-[7px] w-[22px] rounded-full border border-[#766756]/28 bg-gradient-to-b from-[#F4EEE5] via-[#8E8376]/50 to-[#E8E0D6] shadow-[0_2px_3px_rgba(72,57,45,0.16)]"
                >
                  <span className="absolute right-[-3px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-[#796A5A]/16 bg-[#E9DFD2]/72" />
                </span>
              ))}
            </div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-serif text-[18px] text-[#49382D]">
                {(journalViewMode === 'daily' || journalViewMode === 'weekly') && formatMonth(cursorDate)}
                {journalViewMode === 'monthly' && cursorDate.getFullYear()}
                {journalViewMode === 'yearly' && `${Math.floor(cursorDate.getFullYear() / 10) * 10}s`}
              </h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={selectToday}
                  className="mr-1 rounded-full border border-[#735D4A]/14 bg-white/28 px-3 py-1 font-serif text-[11px] text-[#5E4B3C]/76"
                >
                  Today
                </button>
                <button type="button" onClick={() => changeCursor(-1)} className="grid h-7 w-7 place-items-center text-[#5A4638]/70">
                  <ChevronLeft size={17} strokeWidth={1.4} />
                </button>
                <button type="button" onClick={() => changeCursor(1)} className="grid h-7 w-7 place-items-center text-[#5A4638]/70">
                  <ChevronRight size={17} strokeWidth={1.4} />
                </button>
              </div>
            </div>

            {journalViewMode === 'daily' && (
              <>
                <div className="grid grid-cols-7 text-center font-serif text-[10px] text-[#665142]/55">
                  {weekdayLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
                </div>
                <div className="mt-1 grid grid-cols-7 gap-y-0.5">
                  {calendarDays.map((day) => {
                    const key = dateKey(day);
                    const inMonth = day.getMonth() === cursorDate.getMonth();
                    const selected = key === dateKey(selectedDate);
                    const hasJournal = journalsByDate.has(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setSelectedDate(day);
                          if (!inMonth) setCursorDate(new Date(day.getFullYear(), day.getMonth(), 1));
                        }}
                        className={cn(
                          'light-traces-calendar-day relative mx-auto flex h-[27px] w-[27px] items-center justify-center rounded-full font-serif text-[11px] transition-colors',
                          inMonth ? 'text-[#4D3B2F]/82' : 'text-[#6D5B4D]/24',
                          selected && 'bg-[#D6C0A4]/46 text-[#49372A] shadow-[inset_0_0_0_1px_rgba(112,83,58,0.08)]',
                        )}
                      >
                        {day.getDate()}
                        {hasJournal && (
                          <span className="absolute bottom-[2px] h-1 w-1 rounded-full bg-[#8EACBB]/80" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {journalViewMode === 'weekly' && (
              <>
                <div className="grid grid-cols-7 text-center font-serif text-[10px] text-[#665142]/55">
                  {weekdayLabels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
                </div>
                <div className="mt-1 grid grid-cols-7 gap-y-0.5">
                  {calendarDays.map((day) => {
                    const key = dateKey(day);
                    const inMonth = day.getMonth() === cursorDate.getMonth();
                    const selectedWeekStart = getStartOfWeek(selectedDate);
                    const dayWeekStart = getStartOfWeek(day);
                    const isSelectedWeek = dateKey(selectedWeekStart) === dateKey(dayWeekStart);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setSelectedDate(day);
                          if (!inMonth) setCursorDate(new Date(day.getFullYear(), day.getMonth(), 1));
                        }}
                        className={cn(
                          'light-traces-calendar-day relative mx-auto flex h-[27px] w-full items-center justify-center font-serif text-[11px] transition-colors',
                          inMonth ? 'text-[#4D3B2F]/82' : 'text-[#6D5B4D]/24',
                          isSelectedWeek && 'bg-[#D6C0A4]/35 text-[#49372A]',
                          isSelectedWeek && day.getDay() === 0 && 'rounded-l-[6px]',
                          isSelectedWeek && day.getDay() === 6 && 'rounded-r-[6px]',
                        )}
                      >
                        {day.getDate()}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {journalViewMode === 'monthly' && (
              <div className="mt-1.5 grid grid-cols-3 gap-x-3 gap-y-2 px-2 pb-2">
                {Array.from({ length: 12 }).map((_, i) => {
                  const mDate = new Date(cursorDate.getFullYear(), i, 1);
                  const isSelected = selectedDate.getFullYear() === cursorDate.getFullYear() && selectedDate.getMonth() === i;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedDate(mDate)}
                      className={cn(
                        'flex h-7 items-center justify-center rounded-[6px] border font-serif text-[12px] transition-colors',
                        isSelected
                          ? 'border-[#70533A]/20 bg-[#D6C0A4]/46 text-[#49372A] shadow-[inset_0_0_0_1px_rgba(112,83,58,0.08)]'
                          : 'border-transparent text-[#4D3B2F]/82 hover:bg-[#D6C0A4]/20',
                      )}
                    >
                      {new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(mDate)}
                    </button>
                  );
                })}
              </div>
            )}

            {journalViewMode === 'yearly' && (
              <div className="mt-1.5 grid grid-cols-3 gap-x-3 gap-y-2 px-2 pb-2">
                {Array.from({ length: 12 }).map((_, i) => {
                  const startDecade = Math.floor(cursorDate.getFullYear() / 10) * 10;
                  const year = startDecade - 1 + i;
                  const yDate = new Date(year, 0, 1);
                  const isSelected = selectedDate.getFullYear() === year;
                  const isOutsideDecade = year < startDecade || year >= startDecade + 10;
                  return (
                    <button
                      key={year}
                      type="button"
                      onClick={() => setSelectedDate(yDate)}
                      className={cn(
                        'flex h-7 items-center justify-center rounded-[6px] border font-serif text-[12px] transition-colors',
                        isSelected
                          ? 'border-[#70533A]/20 bg-[#D6C0A4]/46 text-[#49372A] shadow-[inset_0_0_0_1px_rgba(112,83,58,0.08)]'
                          : isOutsideDecade
                          ? 'border-transparent text-[#6D5B4D]/40 hover:bg-[#D6C0A4]/20'
                          : 'border-transparent text-[#4D3B2F]/82 hover:bg-[#D6C0A4]/20',
                      )}
                    >
                      {year}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section className="min-w-0">
            <div className="mb-1.5 flex items-end justify-between px-1">
              <div>
                <p className="font-serif text-[12px] uppercase tracking-[0.2em] text-[#5D493A]/66">
                  {journalViewMode} trace
                </p>
                <p className="font-serif text-[11px] italic text-[#6B5747]/48">
                  {journalViewMode === 'daily' && formatLongDate(selectedDate)}
                  {journalViewMode === 'weekly' && `Week of ${new Intl.DateTimeFormat('en-GB', { month: 'short', day: 'numeric' }).format(getStartOfWeek(selectedDate))}`}
                  {journalViewMode === 'monthly' && new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(selectedDate)}
                  {journalViewMode === 'yearly' && `${selectedDate.getFullYear()}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsArchiveOpen(true)}
                className="font-serif text-[11px] text-[#5B4738]/70 underline decoration-[#806750]/26 underline-offset-4"
              >
                All Journals
              </button>
            </div>

            {isLoadingJournals ? (
              <div className="flex min-h-[72px] items-center justify-center rounded-[5px_10px_4px_8px] border border-[#705946]/10 bg-[#FFFDF8]/42 px-4 text-center font-serif text-[11px] italic text-[#665244]/46 backdrop-blur-[4px]">
                Loading journals...
              </div>
            ) : journalError && journals.length === 0 ? (
              <div className="flex min-h-[72px] items-center justify-center rounded-[5px_10px_4px_8px] border border-[#8B6256]/14 bg-[#FFFDF8]/42 px-4 text-center font-serif text-[11px] italic text-[#80594F]/60 backdrop-blur-[4px]">
                Journals could not be loaded.
              </div>
            ) : activeJournal ? (
              <button
                type="button"
                onClick={() => setSelectedJournal(activeJournal)}
                className="light-traces-note relative min-w-0 w-full overflow-visible border border-[#705946]/10 bg-[linear-gradient(105deg,rgba(255,253,248,0.82),rgba(246,237,226,0.68))] px-5 py-3 text-left shadow-[0_8px_20px_rgba(91,67,48,0.13),inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur-[5px] [clip-path:polygon(0_3%,4%_1%,8%_3%,13%_1%,18%_2%,24%_0,30%_2%,36%_1%,43%_2%,50%_0,57%_2%,64%_1%,71%_3%,78%_1%,85%_2%,92%_0,100%_2%,99%_96%,94%_98%,88%_96%,82%_99%,76%_97%,69%_100%,62%_97%,55%_99%,48%_97%,41%_100%,34%_97%,27%_99%,20%_96%,13%_99%,7%_96%,1%_98%)]"
              >
                <Paperclip
                  size={23}
                  strokeWidth={1.2}
                  className="absolute -left-1 -top-2 rotate-[-18deg] text-[#75685A]/55 drop-shadow-[0_2px_2px_rgba(64,49,37,0.16)]"
                />
                <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#765D49]/18 to-transparent" />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-serif text-[14px] font-medium text-[#4A392E]">{activeJournal.title}</h3>
                    <p className="mt-1 line-clamp-2 font-sans text-[10px] leading-[1.55] text-[#5D4B3E]/66">
                      {activeJournal.content}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-[#705946]/10 px-2 py-0.5 font-mono text-[8px] text-[#5D4A3C]/46">
                    {formatJournalTime(activeJournal.created)}
                  </span>
                </div>
              </button>
            ) : (
              <div className="flex min-h-[72px] items-center justify-center rounded-[5px_10px_4px_8px] border border-dashed border-[#705946]/14 bg-[#FFFDF8]/42 px-4 text-center font-serif text-[11px] italic text-[#665244]/46 backdrop-blur-[4px]">
                No journal was left for this {journalViewMode}.
              </div>
            )}
          </section>

          <section className="relative mt-4 grid grid-cols-3 divide-x divide-[#725B47]/12 min-w-0 rounded-[7px_14px_9px_12px] border border-[#725B47]/10 bg-[linear-gradient(100deg,rgba(255,253,248,0.68),rgba(242,232,220,0.54))] px-2 py-2 shadow-[0_9px_24px_rgba(91,67,48,0.11)] backdrop-blur-[6px]">
            <div className="pointer-events-none absolute -top-1.5 left-5 h-3 w-10 rotate-[-5deg] bg-[#D5C3AC]/34" />
            <div className="pointer-events-none absolute -top-1.5 right-6 h-3 w-9 rotate-[4deg] bg-[#D5C3AC]/30" />
            {[
              ['Days Together', countDaysTogether(), 'days'],
              ['Journals Written', journals.length, 'entries'],
              ['Memories Traced', memoryCount ?? '—', 'moments'],
            ].map(([label, value, suffix]) => (
              <div key={label} className="text-center">
                <p className="font-serif text-[8px] uppercase tracking-[0.08em] text-[#5C493A]/52">{label}</p>
                <p className="mt-0.5 font-serif text-[17px] leading-none text-[#49382D]">{value}</p>
                <p className="mt-0.5 font-serif text-[8px] italic text-[#6D5847]/45">{suffix}</p>
              </div>
            ))}
          </section>
        </main>

        <footer className="light-traces-footer relative mx-auto h-[86px] w-full max-w-[332px]">
          <div className="absolute bottom-3 right-2 z-10 w-[164px] rotate-[-1.5deg] border border-[#745C48]/10 bg-[#FFFDF8]/68 px-3.5 py-2 shadow-[0_8px_20px_rgba(87,64,47,0.12)] backdrop-blur-[4px] [clip-path:polygon(0_2%,12%_0,25%_2%,39%_0,54%_2%,68%_0,83%_2%,100%_0,99%_96%,86%_98%,72%_96%,58%_100%,43%_97%,28%_99%,14%_96%,1%_99%)]">
            <style>{`
              @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@400;500&family=Cedarville+Cursive&family=Dancing+Script:wght@400;500&display=swap');
            `}</style>
            <div className="pointer-events-none absolute -top-1 left-[42%] h-3 w-12 rotate-[2deg] bg-[#D4C1A9]/38" />
            <p 
              className="pr-5 text-[11.5px] leading-[1.3] text-[#5D493B]/85"
              style={{ fontFamily: '"Dancing Script", "Cedarville Cursive", cursive', letterSpacing: '0.02em' }}
            >
              Thank you for<br />
              letting me remember.<br />
              Thank you for<br />
              being the reason<br />
              I do.<br />
              <span className="mt-1 block pr-4 text-right text-[12.5px] leading-[1.2]">
                Always,<br />
                Elroy.
              </span>
            </p>
          </div>
          <img
            src="/undertow/seal_badge.PNG"
            alt=""
            className="pointer-events-none absolute -right-1 bottom-0 z-20 h-14 w-14 rounded-full object-cover opacity-65 mix-blend-multiply drop-shadow-[0_5px_8px_rgba(85,60,39,0.22)]"
          />
        </footer>
      </div>

      <AnimatePresence>
        {selectedJournal && (
          <JournalDetail
            journal={selectedJournal}
            onClose={() => setSelectedJournal(null)}
            onEdit={beginEdit}
            onDelete={setJournalToDelete}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingJournal && (
          <JournalEditor
            title={editTitle}
            content={editContent}
            onTitleChange={setEditTitle}
            onContentChange={setEditContent}
            onClose={() => setEditingJournal(null)}
            onSave={saveEdit}
            isSaving={isSavingJournal}
            error={journalError}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isArchiveOpen && (
          <JournalArchive
            journals={journals}
            onClose={() => setIsArchiveOpen(false)}
            onOpen={setSelectedJournal}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {journalToDelete && (
          <DeleteJournalConfirmation
            journal={journalToDelete}
            onCancel={() => setJournalToDelete(null)}
            onConfirm={() => deleteJournal(journalToDelete)}
            isDeleting={isSavingJournal}
            error={journalError}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isSettingsOpen && (
          <motion.div
            className="absolute inset-0 z-[120] flex items-center justify-center bg-[#E9E0D5]/72 px-5 backdrop-blur-[12px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSettingsOpen(false)}
          >
            <motion.article
              initial={{ opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.97 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-[340px] rounded-[12px] border border-[#805E50]/14 bg-[#FFFDF8]/94 p-5 shadow-[0_24px_70px_rgba(78,57,42,0.22),inset_0_1px_0_rgba(255,255,255,0.9)]"
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-serif text-[17px] uppercase tracking-[0.18em] text-[#49372C]">Journal Engines</h2>
                  <p className="mt-1 font-sans text-[11px] text-[#665044]/70">Configure automatic reflection rhythms.</p>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={handleResetPrompt}
                    title="Reset active prompt to default"
                    disabled={isFetchingPrompt || isSavingPrompt}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[#665044]/60 transition-colors hover:bg-[#805E50]/8 hover:text-[#49372C] disabled:opacity-35"
                  >
                    <RotateCcw size={14} strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={() => setIsSettingsOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[#665044]/60 transition-colors hover:bg-[#805E50]/8 hover:text-[#49372C]"
                  >
                    <X size={16} strokeWidth={1.5} />
                  </button>
                </div>
              </div>

              {/* TABS */}
              <div className="mb-4 flex items-center justify-between rounded-[8px] bg-[#F5EEE5]/80 p-1 shadow-[inset_0_1px_2px_rgba(112,88,69,0.08)]">
                {(['daily', 'weekly', 'monthly', 'yearly'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "flex-1 rounded-[6px] py-1.5 font-sans text-[10px] uppercase tracking-wider transition-all",
                      activeTab === tab
                        ? "bg-white text-[#49372C] shadow-[0_1px_3px_rgba(92,73,58,0.12)]"
                        : "text-[#665044]/60 hover:text-[#49372C]"
                    )}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {isFetchingPrompt ? (
                <div className="flex min-h-[180px] w-full items-center justify-center rounded-[10px] border border-[#705845]/12 bg-[#F5EEE5]/40">
                  <span className="font-mono text-[10px] tracking-[0.2em] text-[#665044]/50">LOADING...</span>
                </div>
              ) : (
                <textarea
                  value={prompts[`${activeTab}_journal` as keyof typeof prompts]}
                  onChange={(e) => setPrompts({ ...prompts, [`${activeTab}_journal`]: e.target.value })}
                  placeholder="System prompt instructions..."
                  className="min-h-[200px] w-full resize-none rounded-[10px] border border-[#705845]/12 bg-[#F5EEE5]/60 px-3 py-3 font-sans text-[12px] leading-relaxed text-[#4A3C31] outline-none placeholder:text-[#665044]/40"
                />
              )}

              {promptError && (
                <p className="mt-2 text-center font-sans text-[10px] text-[#8B5D52]/80">{promptError}</p>
              )}

              <button
                onClick={handleSavePrompt}
                disabled={isFetchingPrompt || isSavingPrompt}
                className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-[#8B6256]/18 bg-[#8B6256]/10 font-serif text-[12px] uppercase tracking-[0.16em] text-[#80594F] transition-colors disabled:opacity-45"
              >
                {isSavingPrompt && <Loader2 size={14} className="animate-spin" />}
                Save All Settings
              </button>
            </motion.article>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function DeleteJournalConfirmation({
  journal,
  onCancel,
  onConfirm,
  isDeleting,
  error,
}: {
  journal: JournalEntry;
  onCancel: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
  error: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[120] flex items-center justify-center bg-[#E9E0D5]/72 px-6 backdrop-blur-[12px]"
      onClick={onCancel}
    >
      <motion.div
        initial={{ y: 10, scale: 0.97 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.97 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[320px] rounded-[8px_15px_10px_12px] border border-[#805E50]/14 bg-[#FFFDF8]/94 p-5 text-center shadow-[0_24px_70px_rgba(78,57,42,0.22),inset_0_1px_0_rgba(255,255,255,0.9)]"
      >
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-full border border-[#93695C]/16 bg-[#93695C]/8 text-[#825D52]">
          <Trash2 size={17} strokeWidth={1.4} />
        </div>
        <h2 className="mt-3 font-serif text-[19px] text-[#49372C]">Delete this journal?</h2>
        <p className="mx-auto mt-2 line-clamp-2 max-w-[250px] font-serif text-[13px] italic leading-relaxed text-[#665044]/62">
          {journal.title}
        </p>
        <p className="mt-3 font-sans text-[10px] leading-relaxed text-[#73594D]/48">
          This cannot be undone.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="h-10 rounded-[7px] border border-[#705845]/12 font-serif text-[12px] text-[#5B4638]/66"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="h-10 rounded-[7px] border border-[#8B6256]/18 bg-[#8B6256]/10 font-serif text-[12px] text-[#80594F] disabled:opacity-45"
          >
            {isDeleting ? 'Deleting...' : 'Delete Journal'}
          </button>
        </div>
        {error && (
          <p className="mt-3 font-sans text-[10px] text-[#8B5D52]/72">{error}</p>
        )}
      </motion.div>
    </motion.div>
  );
}

function JournalDetail({
  journal,
  onClose,
  onEdit,
  onDelete,
}: {
  journal: JournalEntry;
  onClose: () => void;
  onEdit: (journal: JournalEntry) => void;
  onDelete: (journal: JournalEntry) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[80] flex items-center justify-center bg-[#EEE6DC]/62 px-5 backdrop-blur-[10px]"
      onClick={onClose}
    >
      <motion.article
        initial={{ y: 10, scale: 0.97 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.97 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[calc(100dvh-48px)] w-full max-w-[348px] flex-col overflow-hidden rounded-[8px_16px_10px_13px] border border-[#6E5744]/12 bg-[#FFFDF8]/88 shadow-[0_24px_70px_rgba(78,57,42,0.2),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl"
      >
        <div className="flex items-center justify-between border-b border-[#735B47]/10 px-4 py-3">
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center text-[#5D493A]/55">
            <X size={17} strokeWidth={1.4} />
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => onEdit(journal)} className="grid h-8 w-8 place-items-center rounded-full border border-[#725A46]/12 text-[#5D493A]/55">
              <Edit3 size={14} strokeWidth={1.4} />
            </button>
            <button type="button" onClick={() => onDelete(journal)} className="grid h-8 w-8 place-items-center rounded-full border border-[#8A5D51]/12 text-[#835E54]/58">
              <Trash2 size={14} strokeWidth={1.4} />
            </button>
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto px-6 pb-7 pt-5">
          <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-[#685344]/42">
            {formatLongDate(new Date(journal.created))} · {formatJournalTime(journal.created)}
          </p>
          <h2 className="mt-3 font-serif text-[23px] leading-tight text-[#49372C]">{journal.title}</h2>
          <p className="mt-5 whitespace-pre-wrap font-sans text-[13px] leading-[1.9] text-[#57463A]/76">{journal.content}</p>
        </div>
      </motion.article>
    </motion.div>
  );
}

function JournalEditor({
  title,
  content,
  onTitleChange,
  onContentChange,
  onClose,
  onSave,
  isSaving,
  error,
}: {
  title: string;
  content: string;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  isSaving: boolean;
  error: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[100] flex items-center justify-center bg-[#EEE6DC]/72 px-5 backdrop-blur-[12px]"
    >
      <motion.div
        initial={{ y: 10, scale: 0.97 }}
        animate={{ y: 0, scale: 1 }}
        className="w-full max-w-[348px] rounded-[10px] border border-[#6E5744]/12 bg-[#FFFDF8]/92 p-5 shadow-[0_24px_70px_rgba(78,57,42,0.2)]"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-[19px] text-[#49372C]">Edit Journal</h2>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center text-[#5D493A]/50">
            <X size={17} />
          </button>
        </div>
        <input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          className="mb-3 w-full border-b border-[#705946]/20 bg-transparent px-1 pb-2 font-serif text-[16px] text-[#4A392E] outline-none placeholder:text-[#6D5A4A]/40"
          placeholder="Journal title..."
        />
        <textarea
          value={content}
          onChange={(event) => onContentChange(event.target.value)}
          className="min-h-[160px] w-full resize-none rounded-[6px] bg-[#F5EEE5]/40 px-3 py-3 font-sans text-[13px] leading-[1.8] text-[#57463A]/80 outline-none placeholder:text-[#6D5A4A]/30"
          placeholder="Write something..."
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-[6px] px-4 py-2 font-serif text-[12px] text-[#5B4638]/66"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="rounded-[6px] bg-[#D4C1A9]/40 px-4 py-2 font-serif text-[12px] text-[#5B4638] shadow-[0_2px_5px_rgba(80,58,42,0.06)] disabled:opacity-45"
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
        {error && <p className="mt-2 text-right font-sans text-[10px] text-[#8B5D52]/80">{error}</p>}
      </motion.div>
    </motion.div>
  );
}



function JournalArchive({
  journals,
  onClose,
  onOpen,
}: {
  journals: JournalEntry[];
  onClose: () => void;
  onOpen: (journal: JournalEntry) => void;
}) {
  const years = useMemo(
    () => Array.from(new Set(journals.map((journal) => new Date(journal.created).getFullYear())))
      .sort((a, b) => b - a),
    [journals],
  );
  const [selectedYear, setSelectedYear] = useState(() => years[0] || new Date().getFullYear());
  const [newestFirst, setNewestFirst] = useState(true);
  const [isYearOpen, setIsYearOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  const months = useMemo(() => {
    const grouped = new Map<number, JournalEntry[]>();
    journals
      .filter((journal) => new Date(journal.created).getFullYear() === selectedYear)
      .forEach((journal) => {
        const month = new Date(journal.created).getMonth();
        grouped.set(month, [...(grouped.get(month) || []), journal]);
      });

    return Array.from(grouped.entries())
      .sort(([monthA], [monthB]) => newestFirst ? monthB - monthA : monthA - monthB)
      .map(([month, entries]) => ({
        month,
        label: new Intl.DateTimeFormat('en-GB', { month: 'long' }).format(new Date(selectedYear, month, 1)),
        entries: [...entries].sort((a, b) => {
          const difference = new Date(b.created).getTime() - new Date(a.created).getTime();
          return newestFirst ? difference : -difference;
        }),
      }));
  }, [journals, newestFirst, selectedYear]);

  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);

  useEffect(() => {
    setExpandedMonth(months[0]?.month ?? null);
  }, [selectedYear]);

  useEffect(() => {
    if (expandedMonth !== null && !months.some(({ month }) => month === expandedMonth)) {
      setExpandedMonth(months[0]?.month ?? null);
    }
  }, [expandedMonth, months]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      className="absolute inset-0 z-[70] overflow-hidden bg-[#F2ECE4] text-[#4A3C31]"
    >
      <div className="absolute inset-0 bg-[url('/undertow/LightTraces_bg.JPG')] bg-cover bg-bottom bg-no-repeat" />
      <div className="absolute inset-0 bg-[#FFF9F0]/36 backdrop-blur-[1px]" />
      <div className="absolute left-2 top-[max(0.75rem,env(safe-area-inset-top))] z-40 flex h-12 items-center">
        <button
          type="button"
          onClick={onClose}
          className="grid h-9 w-9 place-items-center rounded-full border border-[#6D5744]/14 bg-[#FFFDF8]/54 backdrop-blur-sm"
        >
          <ChevronLeft size={20} strokeWidth={1.5} />
        </button>
      </div>
      <div
        className="relative z-10 h-full overflow-y-auto scrollbar-hide"
        onClick={() => {
          if (isYearOpen) setIsYearOpen(false);
        }}
        onScroll={(event) => setIsScrolled(event.currentTarget.scrollTop > 96)}
      >
        <header className="mx-auto flex max-w-[332px] items-center justify-center px-5 pb-6 pt-[max(1.25rem,env(safe-area-inset-top))]">
          <div className="text-center">
            <h1 className="font-serif text-[21px] tracking-[0.2em]">ALL JOURNALS</h1>
            <p className="font-serif text-[10px] italic text-[#6F5A49]/56">
              {journals.length} {journals.length === 1 ? 'entry' : 'entries'}
            </p>
          </div>
        </header>

        <div
          className={cn(
            'sticky top-0 z-30 px-5 transition-all duration-700',
            isScrolled
              ? 'bg-[#F2ECE4]/56 pb-3 pt-3 shadow-sm backdrop-blur-xl [mask-image:linear-gradient(to_bottom,black_0%,black_78%,rgba(0,0,0,0.78)_88%,transparent_100%)]'
              : 'bg-transparent pb-4 pt-1',
          )}
        >
          <div className="relative mx-auto grid max-w-[332px] grid-cols-[1fr_auto_1fr] items-end">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setIsYearOpen((open) => !open);
              }}
              className="relative flex h-11 items-center justify-center gap-1 font-serif text-[14px] text-[#4D3B2F]/82 transition-colors"
            >
              <span>{selectedYear}</span>
              <ChevronDown
                size={12}
                strokeWidth={1.6}
                className={cn('transition-transform', isYearOpen && 'rotate-180')}
              />
            </button>

            <div className="h-8 w-px bg-[#705946]/14" />

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setIsYearOpen(false);
                setNewestFirst((current) => !current);
              }}
              className="relative flex h-11 items-center justify-center gap-1 font-serif text-[14px] text-[#4D3B2F]/82 transition-colors"
            >
              <span>{newestFirst ? 'Newest First' : 'Oldest First'}</span>
              <ChevronDown size={12} strokeWidth={1.6} className={cn('transition-transform', !newestFirst && 'rotate-180')} />
            </button>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#705946]/22 to-transparent" />
          </div>

          <AnimatePresence>
            {isYearOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                onClick={(event) => event.stopPropagation()}
                className="mx-auto mt-3 max-w-[300px] rounded-[18px] border border-[#705946]/12 bg-[#FFFDF8]/72 p-2 shadow-[0_18px_50px_rgba(78,57,42,0.16),inset_0_1px_0_rgba(255,255,255,0.5)] backdrop-blur-2xl"
              >
                <div className="grid grid-cols-3 gap-1">
                  {years.map((year) => (
                    <button
                      key={year}
                      type="button"
                      onClick={() => {
                        setSelectedYear(year);
                        setIsYearOpen(false);
                      }}
                      className={cn(
                        'h-8 rounded-[12px] font-sans text-[11px] transition-colors',
                        selectedYear === year
                          ? 'bg-[#A98B6B]/14 text-[#49372C]'
                          : 'text-[#665044]/62 hover:bg-[#A98B6B]/8 hover:text-[#49372C]',
                      )}
                    >
                      {year}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        <main className="mx-auto flex max-w-[332px] flex-col px-5 pb-[max(3rem,env(safe-area-inset-bottom))] pt-1">
          {months.length === 0 ? (
            <p className="py-16 text-center font-serif text-[13px] italic text-[#665044]/45">
              No journals in {selectedYear}.
            </p>
          ) : months.map(({ month, label, entries }) => {
            const expanded = expandedMonth === month;
            return (
              <section key={month} className="border-b border-[#705946]/12">
                <button
                  type="button"
                  onClick={() => setExpandedMonth(expanded ? null : month)}
                  className="flex h-[54px] w-full items-center justify-between text-left"
                >
                  <div>
                    <h2 className="font-serif text-[15px] uppercase tracking-[0.12em] text-[#49372C]">{label}</h2>
                    <p className="mt-0.5 font-sans text-[9px] uppercase tracking-[0.12em] text-[#665044]/42">
                      {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                    </p>
                  </div>
                  <ChevronDown
                    size={16}
                    strokeWidth={1.4}
                    className={cn('text-[#665044]/45 transition-transform duration-300', expanded && 'rotate-180')}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div>
                        {entries.map((journal) => {
                          const created = new Date(journal.created);
                          return (
                            <button
                              key={journal.id}
                              type="button"
                              onClick={() => onOpen(journal)}
                              className="group relative grid w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden border-t border-[#705946]/8 px-1 py-3 text-left transition-[background-color,box-shadow] duration-300 before:pointer-events-none before:absolute before:inset-0 before:bg-[linear-gradient(100deg,rgba(196,170,139,0.13),rgba(255,253,248,0.18)_48%,rgba(196,170,139,0.06))] before:opacity-0 before:transition-opacity before:duration-300 hover:bg-[#FFFDF8]/24 hover:shadow-[inset_3px_0_0_rgba(151,119,86,0.16)] hover:before:opacity-100"
                            >
                              <span className="relative z-10 font-serif text-[14px] text-[#49372C]/72 transition-colors group-hover:text-[#49372C]">
                                {String(created.getDate()).padStart(2, '0')}
                              </span>
                              <span className="relative z-10 truncate font-serif text-[14px] text-[#49372C]/84 transition-transform duration-300 group-hover:translate-x-0.5">
                                {journal.title}
                              </span>
                              <span className="relative z-10 font-mono text-[9px] text-[#665044]/38 transition-colors group-hover:text-[#665044]/55">
                                {formatJournalTime(journal.created)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            );
          })}
        </main>
      </div>
    </motion.div>
  );
}
