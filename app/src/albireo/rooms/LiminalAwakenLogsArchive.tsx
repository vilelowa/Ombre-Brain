import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Sun } from 'lucide-react';
import { api } from '../../lib/api';
import { AwakeningLogEntry } from '../../types';
import { cn } from '../../lib/utils';

interface LiminalAwakenLogsArchiveProps {
  onClose: () => void;
}

const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLogDateKey(log: AwakeningLogEntry) {
  return toDateKey(new Date(log.timestamp));
}

function formatDayLabel(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00`);
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

function formatMonthLabel(month: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(month);
}

function formatTime(isoString?: string | null) {
  if (!isoString) return '--:--';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '--:--';
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function getMonthDays(month: Date) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1);
  const lastDay = new Date(year, monthIndex + 1, 0);
  const mondayOffset = (firstDay.getDay() + 6) % 7;

  const cells: Array<{ key: string; date: Date; inMonth: boolean } | null> = [];
  for (let i = 0; i < mondayOffset; i += 1) cells.push(null);
  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    const date = new Date(year, monthIndex, day);
    cells.push({ key: toDateKey(date), date, inMonth: true });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function describeLog(log: AwakeningLogEntry) {
  if (log.aborted) return log.abort_reason || 'Awakening aborted.';
  if (log.action === 'diary') return 'Private diary entry created.';
  if (log.action === 'push') return log.message_preview || 'Background notification sent.';
  return log.message_preview || 'Awakened. Reviewed environment.';
}

function heatClass(count: number, isSelected: boolean) {
  if (count === 0) {
    return isSelected
      ? 'border-[#3A332B]/30 dark:border-[#E8E2D2]/34 bg-[#3A332B]/10 dark:bg-[#E8E2D2]/10 text-[#2D2822] dark:text-[#F4F0E8]'
      : 'border-[#3A332B]/15 dark:border-[#E8E2D2]/8 bg-white/25 dark:bg-[#E8E2D2]/[0.025] text-[#3A332B]/50 dark:text-[#E8E2D2]/34';
  }
  if (count === 1) return 'border-amber-700/30 dark:border-[#D8CBB7]/18 bg-amber-700/20 dark:bg-[#D8CBB7]/12 text-[#2D2822] dark:text-[#F4F0E8]';
  if (count === 2) return 'border-amber-700/40 dark:border-[#D8CBB7]/24 bg-amber-700/30 dark:bg-[#D8CBB7]/20 text-[#2D2822] dark:text-[#F4F0E8]';
  if (count <= 4) return 'border-amber-700/50 dark:border-[#D8CBB7]/32 bg-amber-700/40 dark:bg-[#D8CBB7]/30 text-[#1A1816] dark:text-[#F8F3EA]';
  return 'border-amber-700/60 dark:border-[#D8CBB7]/42 bg-amber-700/50 dark:bg-[#D8CBB7]/42 text-white dark:text-[#0A0808]';
}

export default function LiminalAwakenLogsArchive({ onClose }: LiminalAwakenLogsArchiveProps) {
  const [logs, setLogs] = useState<AwakeningLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [month, setMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));

  useEffect(() => {
    const loadLogs = async () => {
      try {
        const data = await api.getAwakeningLog(180);
        setLogs(data);
        if (data.length > 0) {
          const firstDate = new Date(data[0].timestamp);
          if (!Number.isNaN(firstDate.getTime())) {
            setSelectedDate(toDateKey(firstDate));
            setMonth(new Date(firstDate.getFullYear(), firstDate.getMonth(), 1));
          }
        }
      } catch (err) {
        console.error('Failed to load awakening logs:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadLogs();
  }, []);

  const logsByDay = useMemo(() => {
    const grouped = new Map<string, AwakeningLogEntry[]>();
    logs.forEach((log) => {
      const key = getLogDateKey(log);
      grouped.set(key, [...(grouped.get(key) || []), log]);
    });
    grouped.forEach((dayLogs, key) => {
      grouped.set(
        key,
        [...dayLogs].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
      );
    });
    return grouped;
  }, [logs]);

  const monthCells = useMemo(() => getMonthDays(month), [month]);
  const selectedLogs = logsByDay.get(selectedDate) || [];
  const maxCount = useMemo(() => {
    return Math.max(1, ...Array.from(logsByDay.values()).map((dayLogs) => dayLogs.length));
  }, [logsByDay]);

  const shiftMonth = (delta: number) => {
    setMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  };

  return (
    <div className="relative h-full overflow-hidden bg-[#F5EFE7] dark:bg-[#0A0808] text-[#3A332B] dark:text-[#E8E2D2]">
      <div className="absolute inset-0 bg-[url('/undertow/Liminal_bg_ligth.PNG')] dark:bg-[url('/undertow/Liminal_bg.PNG')] bg-cover bg-center bg-no-repeat opacity-[0.75] dark:opacity-80" />
      <div className="absolute inset-0 bg-[#F5EFE7]/40 dark:bg-[#071017]/28 backdrop-blur-[3px] dark:backdrop-blur-[1px]" />

      <div className="absolute left-2 top-0 z-40 flex h-14 items-center">
        <button
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-transparent bg-black/5 opacity-60 backdrop-blur-md transition-all hover:bg-black/10 hover:opacity-100 dark:bg-white/5 dark:hover:bg-white/10 dark:text-[#E8E2D2]/68 dark:hover:text-[#F4F0E8]"
        >
          <ChevronLeft size={24} strokeWidth={1.5} />
        </button>
      </div>

      <div className="relative z-10 h-full overflow-y-auto px-6 pb-10 pt-20 scrollbar-hide">
        <header className="mb-8 flex flex-col items-center text-center">
          <div className="flex items-center gap-2">
            <Sun size={15} strokeWidth={1.5} className="text-[#3A332B]/60 dark:text-[#D8CBB7]/75" />
            <h1 className="font-serif text-[20px] font-medium tracking-[0.28em] text-[#2D2822] dark:text-[#F4F0E8]">
              AWAKEN LOGS
            </h1>
          </div>
          <p className="mt-2 font-serif text-[13px] italic text-[#3A332B]/70 dark:text-[#E8E2D2]/68">
            What I did after awakening.
          </p>
        </header>

        <section className="mx-auto w-full max-w-[323px]">
          <div className="mb-5 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[#3A332B]/15 dark:border-[#E8E2D2]/12 bg-black/5 dark:bg-[#0A0808]/12 text-[#3A332B]/60 dark:text-[#E8E2D2]/62 backdrop-blur-md transition-colors hover:bg-black/10 dark:hover:bg-[#E8E2D2]/8 hover:text-[#3A332B] dark:hover:text-[#F4F0E8]"
            >
              <ChevronLeft size={16} strokeWidth={1.5} />
            </button>

            <div className="text-center">
              <p className="font-serif text-[15px] text-[#2D2822] dark:text-[#F4F0E8]/90">{formatMonthLabel(month)}</p>
              <p className="mt-1 font-sans text-[10px] uppercase tracking-[0.22em] text-[#3A332B]/50 dark:text-[#E8E2D2]/42">
                {logs.length} awakenings loaded
              </p>
            </div>

            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-[#3A332B]/15 dark:border-[#E8E2D2]/12 bg-black/5 dark:bg-[#0A0808]/12 text-[#3A332B]/60 dark:text-[#E8E2D2]/62 backdrop-blur-md transition-colors hover:bg-black/10 dark:hover:bg-[#E8E2D2]/8 hover:text-[#3A332B] dark:hover:text-[#F4F0E8]"
            >
              <ChevronRight size={16} strokeWidth={1.5} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1.5">
            {weekdayLabels.map((label) => (
              <div key={label} className="pb-1 text-center font-sans text-[9px] uppercase tracking-wider text-[#3A332B]/50 dark:text-[#E8E2D2]/38">
                {label}
              </div>
            ))}

            {monthCells.map((cell, index) => {
              if (!cell) return <div key={`blank-${index}`} className="aspect-square" />;
              const count = logsByDay.get(cell.key)?.length || 0;
              const isSelected = cell.key === selectedDate;
              const depth = count > 0 ? Math.min(1, count / maxCount) : 0;

              return (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => setSelectedDate(cell.key)}
                  className={cn(
                    'relative aspect-square rounded-[8px] border text-center font-mono text-[11px] transition-colors',
                    heatClass(count, isSelected),
                    isSelected && 'shadow-sm dark:shadow-[0_0_18px_rgba(216,203,183,0.16)]',
                  )}
                  style={count > 0 ? { opacity: 0.52 + depth * 0.42 } : undefined}
                >
                  <span className="relative z-10">{cell.date.getDate()}</span>
                  {count > 0 && (
                    <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-current opacity-60" />
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section className="mx-auto mt-8 w-full max-w-[320px]">
          <div className="mb-4 flex items-end justify-between border-b border-[#3A332B]/15 dark:border-[#E8E2D2]/12 pb-3">
            <div>
              <h2 className="font-serif text-[17px] text-[#2D2822] dark:text-[#F4F0E8]/92">{formatDayLabel(selectedDate)}</h2>
              <p className="mt-1 font-sans text-[10px] uppercase tracking-[0.2em] text-[#3A332B]/50 dark:text-[#E8E2D2]/42">
                {selectedLogs.length === 1 ? '1 awakening' : `${selectedLogs.length} awakenings`}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4].map((level) => (
                <span
                  key={level}
                  className="block h-2.5 w-2.5 rounded-[3px] border border-amber-700/20 dark:border-[#D8CBB7]/16 bg-amber-700 dark:bg-[#D8CBB7]"
                  style={{ opacity: 0.12 + level * 0.16 }}
                />
              ))}
            </div>
          </div>

          {isLoading ? (
            <p className="font-sans text-[12px] text-[#3A332B]/60 dark:text-[#E8E2D2]/46">Loading logs...</p>
          ) : selectedLogs.length === 0 ? (
            <p className="font-sans text-[12px] text-[#3A332B]/50 dark:text-[#E8E2D2]/42">No awakenings recorded for this day.</p>
          ) : (
            <div className="divide-y divide-[#3A332B]/10 dark:divide-[#E8E2D2]/10">
              {selectedLogs.map((log, index) => (
                <div key={`${log.timestamp}-${index}`} className="py-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-mono text-[13px] tracking-wider text-[#2D2822] dark:text-[#F4F0E8]/86">
                      {formatTime(log.timestamp)}
                    </span>
                    <span className="font-sans text-[10px] uppercase tracking-[0.22em] text-[#3A332B]/50 dark:text-[#E8E2D2]/46">
                      {log.aborted ? 'ABORTED' : log.action || 'WAKE'}
                    </span>
                  </div>
                  <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-[#3A332B]/40 dark:text-[#E8E2D2]/38">
                    <span>dice {log.dice ?? '-'}</span>
                    <span>next {log.next_wake_time ? formatTime(log.next_wake_time) : '--:--'}</span>
                  </div>
                  <p className="font-sans text-[12px] leading-relaxed text-[#3A332B]/80 dark:text-[#E8E2D2]/72">
                    {describeLog(log)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
