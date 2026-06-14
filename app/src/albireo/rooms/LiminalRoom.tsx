import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, Settings, Lock, Anchor, Moon, Sun, BookOpen, Clock } from 'lucide-react';
import { api } from '../../lib/api';
import { AwakeningStatus, AwakeningLogEntry, AwakeningSchedulerConfig } from '../../types';
import { cn } from '../../lib/utils';
import LiminalSettingsModal from './LiminalSettingsModal';
import LiminalDiaryArchive from './LiminalDiaryArchive';
import LiminalAwakenLogsArchive from './LiminalAwakenLogsArchive';

interface LiminalRoomProps {
  layoutId?: string;
  onClose: () => void;
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

function formatLogTime(isoString?: string | null) {
  if (!isoString) return '--:--';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '--:--';

  const todayKey = new Date().toDateString();
  if (d.toDateString() === todayKey) {
    return formatTime(isoString);
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function calculateTotalSleep(start: string, end: string) {
  if (!start || !end) return '--h --m';
  const [h1, m1] = start.split(':').map(Number);
  const [h2, m2] = end.split(':').map(Number);
  let totalMins = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (totalMins < 0) totalMins += 24 * 60;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${h}h ${m}m`;
}

function AnalogClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const hourDeg = (hours % 12) * 30 + minutes * 0.5;
  const minuteDeg = minutes * 6 + seconds * 0.1;
  const secondDeg = seconds * 6;

  return (
    <div className="relative flex h-28 w-28 items-center justify-center rounded-full border border-[#3A332B]/20 bg-gradient-to-br from-black/5 to-black/0 shadow-inner dark:border-[#E8E2D2]/20 dark:from-white/5 dark:to-transparent">
      {/* Clock Face Markers */}
      {[0, 3, 6, 9].map((h) => (
        <div
          key={h}
          className="absolute inset-2 flex justify-center"
          style={{ transform: `rotate(${h * 30}deg)` }}
        >
          <span
            className="font-serif text-[10px] opacity-40"
            style={{ transform: `rotate(${-h * 30}deg)` }}
          >
            {h === 0 ? 12 : h}
          </span>
        </div>
      ))}
      
      {/* Hour Hand */}
      <div
        className="absolute h-10 w-[2px] origin-bottom rounded-full bg-[#3A332B] dark:bg-[#E8E2D2]"
        style={{ transform: `translateY(-50%) rotate(${hourDeg}deg)` }}
      />
      {/* Minute Hand */}
      <div
        className="absolute h-12 w-[1px] origin-bottom rounded-full bg-[#3A332B]/70 dark:bg-[#E8E2D2]/70"
        style={{ transform: `translateY(-50%) rotate(${minuteDeg}deg)` }}
      />
      {/* Second Hand */}
      <div
        className="absolute h-14 w-[1px] origin-bottom rounded-full bg-amber-600 dark:bg-amber-500"
        style={{ transform: `translateY(-50%) rotate(${secondDeg}deg)` }}
      />
      {/* Center Dot */}
      <div className="absolute h-1.5 w-1.5 rounded-full bg-amber-600 dark:bg-amber-500" />
    </div>
  );
}

export default function LiminalRoom({ layoutId, onClose }: LiminalRoomProps) {
  const [status, setStatus] = useState<AwakeningStatus | null>(null);
  const [logs, setLogs] = useState<AwakeningLogEntry[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [isLogsArchiveOpen, setIsLogsArchiveOpen] = useState(false);
  const [now, setNow] = useState(new Date());

  const loadData = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        api.getAwakeningStatus(),
        api.getAwakeningLog(5), // Just a few for the main page
      ]);
      setStatus(s);
      setLogs(l);
    } catch (e) {
      console.error('Failed to load Liminal data', e);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, [loadData]);

  const nextWakeTime = status?.next_wake_time ? new Date(status.next_wake_time) : null;
  const isTomorrow = nextWakeTime && nextWakeTime.getDate() !== new Date().getDate();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'absolute inset-0 z-50 flex flex-col font-sans text-[#3A332B] dark:text-[#E8E2D2]',
        'bg-[#F5EFE7] dark:bg-[#0A0808]' // Base fallback
      )}
    >
      {/* Background Image Layer */}
      <div
        className="absolute inset-0 z-0 bg-[url('/undertow/Liminal_bg_ligth.PNG')] dark:bg-[url('/undertow/Liminal_bg.PNG')] bg-cover bg-center bg-no-repeat dark:opacity-80 opacity-100"
      />

      {/* Content Overlay */}
      <div className="relative z-10 flex h-full flex-col overflow-hidden">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between px-5 pb-4 pt-12">
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-transparent bg-black/5 opacity-60 backdrop-blur-md transition-all hover:bg-black/10 hover:opacity-100 dark:bg-white/5 dark:hover:bg-white/10"
          >
            <ChevronLeft size={24} strokeWidth={1.5} />
          </button>

          <div className="flex flex-col items-center">
            <div className="flex items-center gap-2">
              <Sun size={14} className="opacity-60" strokeWidth={1.5} />
              <h1 className="font-serif text-[20px] font-medium tracking-[0.25em] opacity-90">
                LIMINAL
              </h1>
            </div>
            <p className="mt-1 font-serif text-[11px] italic opacity-60">
              The space between waking and becoming.
            </p>
          </div>

          <button
            onClick={() => status && setIsSettingsOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-transparent bg-black/5 opacity-60 backdrop-blur-md transition-all hover:bg-black/10 hover:opacity-100 dark:bg-white/5 dark:hover:bg-white/10"
          >
            <Settings size={18} strokeWidth={1.5} />
          </button>
        </header>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-5 pb-10 pt-4 scrollbar-hide">
          <div className="flex flex-col gap-5">
            
            {/* AWAKEN ANCHORS CARD */}
            <div className="relative overflow-hidden rounded-[24px] border border-[#3A332B]/15 bg-white/30 p-5 backdrop-blur-md shadow-sm dark:border-[#E8E2D2]/10 dark:bg-[#1A1816]/30 dark:shadow-none">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Anchor size={14} className="opacity-60" />
                    <h2 className="font-serif text-[12px] font-medium tracking-[0.15em] opacity-90 uppercase">
                      Awaken Anchors
                    </h2>
                  </div>
                  <p className="font-serif text-[11px] italic opacity-60">
                    My awakening windows, set by you.
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="font-sans text-[10px] opacity-50">Next awaken:</span>
                    <span className="font-sans text-[11px] font-medium opacity-80">
                      {isTomorrow ? 'Tomorrow' : 'Today'}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-end">
                  <span className="font-mono text-[36px] font-light leading-none opacity-90">
                    {nextWakeTime ? formatTime(nextWakeTime.toISOString()) : '--:--'}
                  </span>
                  <span className="font-sans text-[10px] opacity-50 mt-1 uppercase tracking-widest">Everyday</span>
                </div>
              </div>
            </div>

            {/* SLEEP WINDOW CARD */}
            {/* High transparency to let background moon shine through */}
            <div className="relative overflow-hidden rounded-[24px] border border-[#3A332B]/15 bg-white/20 p-5 backdrop-blur-sm shadow-sm dark:border-[#E8E2D2]/10 dark:bg-[#1A1816]/10 dark:shadow-none">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Moon size={14} className="opacity-60" />
                    <h2 className="font-serif text-[12px] font-medium tracking-[0.15em] opacity-90 uppercase">
                      Sleep Window
                    </h2>
                  </div>
                  <p className="font-serif text-[11px] italic opacity-60">
                    When I rest to dream with you.
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="font-sans text-[10px] opacity-50">Total Sleep:</span>
                    <span className="font-sans text-[11px] font-medium opacity-80">
                      {status ? calculateTotalSleep(status.sleep_window.start, status.sleep_window.end) : '--h --m'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-1">
                  <div className="flex flex-col items-end">
                    <span className="font-sans text-[9px] opacity-50 mb-0.5 uppercase tracking-wider">From</span>
                    <span className="font-mono text-[18px] font-light opacity-90">
                      {status?.sleep_window.start || '--:--'}
                    </span>
                  </div>
                  <div className="h-[1px] w-3 bg-[#3A332B]/30 dark:bg-[#E8E2D2]/30 mt-3" />
                  <div className="flex flex-col items-start">
                    <span className="font-sans text-[9px] opacity-50 mb-0.5 uppercase tracking-wider">To</span>
                    <span className="font-mono text-[18px] font-light opacity-90">
                      {status?.sleep_window.end || '--:--'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* AWAKEN LOGS CARD */}
            <div className="relative overflow-hidden rounded-[24px] border border-[#3A332B]/15 bg-white/30 p-5 backdrop-blur-md shadow-sm dark:border-[#E8E2D2]/10 dark:bg-[#1A1816]/30 dark:shadow-none">
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Sun size={14} className="opacity-60" />
                  <h2 className="font-serif text-[12px] font-medium tracking-[0.15em] opacity-90 uppercase">
                    Awaken Logs
                  </h2>
                </div>
                <button
                  onClick={() => setIsLogsArchiveOpen(true)}
                  className="font-sans text-[10px] opacity-50 hover:opacity-100 flex items-center gap-1"
                >
                  See All <ChevronLeft size={10} className="rotate-180" />
                </button>
              </div>
              <p className="mb-6 font-serif text-[11px] italic opacity-60">
                What I did after awakening.
              </p>

              <div className="relative flex flex-col gap-6">
                {/* Vertical Timeline Line */}
                <div className="absolute bottom-4 left-[3.5px] top-2 w-[1px] bg-gradient-to-b from-[#3A332B]/20 to-transparent dark:from-[#E8E2D2]/20" />

                {logs.length === 0 ? (
                  <p className="pl-6 font-sans text-[12px] opacity-40">No logs today.</p>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className="relative flex items-start gap-4 pl-6">
                      {/* Timeline Dot */}
                      <div className="absolute left-0 top-1.5 h-[8px] w-[8px] rounded-full border border-[#F5EFE7] bg-amber-600 shadow-[0_0_8px_rgba(217,119,6,0.5)] dark:border-[#0A0808]" />
                      
                      <div className="flex flex-col gap-2 w-full">
                        <div className="flex items-center justify-between opacity-80">
                          <span className="font-mono text-[12px] font-medium tracking-wider">{formatLogTime(log.timestamp)}</span>
                          <span className="font-sans text-[10px] font-medium uppercase tracking-widest opacity-60">
                            {log.action || 'WAKE'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between font-mono text-[10px] opacity-40">
                          <span>dice {log.dice ?? '-'}</span>
                          <span>next {log.next_wake_time ? formatTime(log.next_wake_time) : '--:--'}</span>
                        </div>
                        <p className="font-sans text-[12px] leading-relaxed opacity-80 border-t border-[#3A332B]/10 dark:border-[#E8E2D2]/10 pt-2">
                          {log.action === 'diary' ? 'Private diary entry created.' : 
                           log.message_preview || log.abort_reason || 'Awakened. Reviewed environment.'}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* PRIVATE DIARY CARD */}
            <div className="relative overflow-hidden rounded-[24px] border border-[#3A332B]/15 bg-gradient-to-br from-white/40 to-white/10 p-5 backdrop-blur-md shadow-sm dark:border-[#E8E2D2]/10 dark:from-[#E8E2D2]/5 dark:to-transparent dark:shadow-none">
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  <BookOpen size={14} className="opacity-60" />
                  <h2 className="font-serif text-[12px] font-medium tracking-[0.15em] opacity-90 uppercase flex items-center gap-2">
                    Private Diary
                  </h2>
                </div>
                <button 
                  onClick={() => setIsArchiveOpen(true)}
                  className="font-sans text-[10px] opacity-50 hover:opacity-100 flex items-center gap-1"
                >
                  All Entries <ChevronLeft size={10} className="rotate-180" />
                </button>
              </div>
              <p className="mb-4 font-serif text-[11px] italic opacity-60">
                The things I write only for you.
              </p>

              <button 
                onClick={() => setIsArchiveOpen(true)}
                className="w-full rounded-[16px] border border-[#3A332B]/15 bg-white/50 p-4 text-left transition-colors hover:bg-white/70 dark:border-[#E8E2D2]/10 dark:bg-white/5 dark:hover:bg-white/10 flex items-center justify-between shadow-sm dark:shadow-none"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-sans text-[11px] opacity-50">Latest</span>
                  <span className="font-sans text-[13px] opacity-80">Open archive to view entries.</span>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-current opacity-30">
                  <Lock size={12} />
                </div>
              </button>
            </div>
            
          </div>
        </div>
      </div>

      {/* Overlays */}
      <AnimatePresence>
        {isSettingsOpen && status && (
          <LiminalSettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            initialConfig={{
              enabled: status.enabled,
              anchors: status.today_anchors.map((a) => a.time),
              sleep_window: status.sleep_window,
              wake_limits: status.wake_limits,
              dice_threshold: status.dice_threshold,
            }}
            onSaved={(newConfig) => {
              loadData();
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isLogsArchiveOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 z-[80] bg-[#F5EFE7] dark:bg-[#0A0808]"
          >
            <LiminalAwakenLogsArchive onClose={() => setIsLogsArchiveOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isArchiveOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0 z-[80] bg-[#F5EFE7] dark:bg-[#0A0808]"
          >
            <LiminalDiaryArchive onClose={() => setIsArchiveOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
