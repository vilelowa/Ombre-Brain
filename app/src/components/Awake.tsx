import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { AwakeningLogEntry, AwakeningSchedulerConfig, AwakeningStatus, PrivateDiaryEntry } from '../types';
import { AlertCircle, ArrowLeft, BookOpen, Calendar, Check, Hourglass, Lock, Moon, Play, Plus, Radio, RefreshCw, Save, Settings2, Trash2, X } from 'lucide-react';
import { cn } from '../lib/utils';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function formatClock(value?: string | null) {
  if (!value) return 'Pending';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatStamp(value?: string | null) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatDuration(minutes?: number | null) {
  if (minutes == null || minutes < 0) return 'Unknown';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function minutesSince(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
}

function isInsideWindow(time: string, start: string, end: string) {
  const toMinutes = (clock: string) => {
    const [hours, minutes] = clock.split(':').map(Number);
    return hours * 60 + minutes;
  };
  const current = toMinutes(time);
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);

  if (startMinutes > endMinutes) {
    return current >= startMinutes || current <= endMinutes;
  }
  return current >= startMinutes && current <= endMinutes;
}

function statusLabel(status: AwakeningStatus | null, hasError: boolean) {
  if (!status) return hasError ? 'Offline' : 'Loading';
  if (!status.enabled) return 'Disabled';
  if (!status.running) return 'Paused';
  const currentClock = formatClock(status.current_time);
  if (isInsideWindow(currentClock, status.sleep_window.start, status.sleep_window.end)) {
    return 'Sleeping';
  }
  return 'Awake';
}

function actionLabel(entry: AwakeningLogEntry) {
  if (entry.aborted) return 'aborted';
  return entry.action || 'idle';
}

function formatTimeRemaining(lockedUntilStr?: string | null) {
  if (!lockedUntilStr) return 'Locked';
  const target = new Date(lockedUntilStr);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return 'Unlocking...';

  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m remaining`;

  const diffHours = Math.floor(diffMins / 60);
  const remainingMins = diffMins % 60;
  if (diffHours < 24) {
    return `${diffHours}h ${remainingMins}m remaining`;
  }

  const diffDays = Math.floor(diffHours / 24);
  const remainingHours = diffHours % 24;
  return `${diffDays}d ${remainingHours}h remaining`;
}

function configFromStatus(status: AwakeningStatus): AwakeningSchedulerConfig {
  return {
    enabled: status.enabled,
    anchors: status.today_anchors.map((anchor) => anchor.time),
    sleep_window: {...status.sleep_window},
    wake_limits: {...status.wake_limits},
    dice_threshold: status.dice_threshold,
  };
}

export default function Awake() {
  const [pushStatus, setPushStatus] = useState<'Subscribed' | 'Not Subscribed' | 'Denied' | 'Loading' | 'Testing...'>('Loading');
  const [awakeningStatus, setAwakeningStatus] = useState<AwakeningStatus | null>(null);
  const [awakeningLog, setAwakeningLog] = useState<AwakeningLogEntry[]>([]);
  const [isLoadingAwakening, setIsLoadingAwakening] = useState(true);
  const [awakeningError, setAwakeningError] = useState<string | null>(null);
  const [isTriggering, setIsTriggering] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [draftConfig, setDraftConfig] = useState<AwakeningSchedulerConfig | null>(null);
  const [persistConfig, setPersistConfig] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [diaryEntries, setDiaryEntries] = useState<PrivateDiaryEntry[]>([]);
  const [selectedDiaryId, setSelectedDiaryId] = useState<string | null>(null);
  const [isDiaryOpen, setIsDiaryOpen] = useState(false);
  const [isLoadingDiary, setIsLoadingDiary] = useState(false);
  const [diaryError, setDiaryError] = useState<string | null>(null);
  const [diaryViewMode, setDiaryViewMode] = useState<'list' | 'detail'>('list');

  const loadAwakening = useCallback(async () => {
    try {
      setAwakeningError(null);
      const [status, log] = await Promise.all([
        api.getAwakeningStatus(),
        api.getAwakeningLog(12),
      ]);
      setAwakeningStatus(status);
      setAwakeningLog(log);
    } catch (err: any) {
      console.error('Failed to load awakening state:', err);
      setAwakeningError(err?.message || 'Awakening API unavailable');
    } finally {
      setIsLoadingAwakening(false);
    }
  }, []);

  useEffect(() => {
    const checkSubscription = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setPushStatus('Denied');
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          setPushStatus('Subscribed');
        } else {
          setPushStatus(Notification.permission === 'denied' ? 'Denied' : 'Not Subscribed');
        }
      } catch (err) {
        console.error('Failed to check push subscription:', err);
        setPushStatus('Not Subscribed');
      }
    };
    checkSubscription();
  }, []);

  useEffect(() => {
    loadAwakening();
    const interval = window.setInterval(loadAwakening, 60000);
    return () => window.clearInterval(interval);
  }, [loadAwakening]);

  const currentStatus = statusLabel(awakeningStatus, Boolean(awakeningError));
  const lastSync = useMemo(() => {
    const mins = minutesSince(awakeningStatus?.current_time);
    return mins == null ? 'Unknown' : mins === 0 ? 'Just now' : `${formatDuration(mins)} ago`;
  }, [awakeningStatus?.current_time]);

  const handleTestSignal = async () => {
    if (pushStatus === 'Testing...') return;
    setPushStatus('Testing...');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('Service Worker or Push Notifications are not supported in this browser');
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();

      if (!sub) {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setPushStatus('Denied');
          alert('Notification permission was denied. Please allow notifications in your browser settings to test.');
          return;
        }

        const { public_key } = await api.getPushPublicKey();
        if (!public_key) {
          throw new Error('VAPID public key not found on server');
        }

        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(public_key)
        });

        await api.subscribePush(sub);
      }

      const res = await api.testPush();
      if (res.ok) {
        setPushStatus('Subscribed');
      } else {
        alert(`Test push failed: ${res.error || res.reason}`);
        setPushStatus('Subscribed');
      }
    } catch (err: any) {
      console.error('Failed to register or test push:', err);
      alert(`Push Notification Error: ${err?.message || err}`);
      setPushStatus('Not Subscribed');
    }
  };

  const handleTriggerAwakening = async () => {
    if (isTriggering) return;
    setIsTriggering(true);
    try {
      const res = await api.triggerAwakening();
      if (!res.ok) {
        throw new Error(res.error || 'Manual awakening failed');
      }
      await loadAwakening();
    } catch (err: any) {
      console.error('Failed to trigger awakening:', err);
      alert(`Awakening Error: ${err?.message || err}`);
    } finally {
      setIsTriggering(false);
    }
  };

  const openConfig = () => {
    if (!awakeningStatus) return;
    setDraftConfig(configFromStatus(awakeningStatus));
    setIsConfigOpen(true);
  };

  const updateDraft = (updater: (current: AwakeningSchedulerConfig) => AwakeningSchedulerConfig) => {
    setDraftConfig((current) => current ? updater(current) : current);
  };

  const handleAnchorChange = (index: number, value: string) => {
    updateDraft((current) => ({
      ...current,
      anchors: current.anchors.map((anchor, anchorIndex) => anchorIndex === index ? value : anchor),
    }));
  };

  const handleAddAnchor = () => {
    updateDraft((current) => ({
      ...current,
      anchors: [...current.anchors, '12:00'].slice(0, 8),
    }));
  };

  const handleRemoveAnchor = (index: number) => {
    updateDraft((current) => ({
      ...current,
      anchors: current.anchors.filter((_, anchorIndex) => anchorIndex !== index),
    }));
  };

  const handleSaveConfig = async () => {
    if (!draftConfig || isSavingConfig) return;
    setIsSavingConfig(true);
    try {
      const normalizedDraft = {
        ...draftConfig,
        anchors: Array.from(new Set(draftConfig.anchors.filter(Boolean))).sort(),
      };
      const res = await api.configureAwakening(normalizedDraft, persistConfig);
      if (!res.ok) {
        throw new Error(res.error || 'Awakening configuration failed');
      }
      if (res.status) {
        setAwakeningStatus(res.status);
      }
      await loadAwakening();
      setIsConfigOpen(false);
    } catch (err: any) {
      console.error('Failed to save awakening config:', err);
      alert(`Awakening Config Error: ${err?.message || err}`);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const openDiary = async (entryId?: string | null) => {
    setIsDiaryOpen(true);
    setSelectedDiaryId(entryId || null);
    setDiaryViewMode(entryId ? 'detail' : 'list');
    setIsLoadingDiary(true);
    setDiaryError(null);
    try {
      const entries = await api.getPrivateDiary(20, true);
      setDiaryEntries(entries);
      if (entryId) {
        const found = entries.some(e => e.id === entryId);
        if (found) {
          setSelectedDiaryId(entryId);
        } else if (entries.length > 0) {
          setSelectedDiaryId(entries[0].id);
          setDiaryViewMode('list');
        }
      } else if (entries.length > 0) {
        setSelectedDiaryId(entries[0].id);
      }
    } catch (err: any) {
      console.error('Failed to load private diary:', err);
      setDiaryError(err?.message || 'Private diary unavailable');
    } finally {
      setIsLoadingDiary(false);
    }
  };

  const selectedDiary = useMemo(() => {
    return diaryEntries.find((entry) => entry.id === selectedDiaryId) || null;
  }, [diaryEntries, selectedDiaryId]);

  return (
    <div className="flex flex-col h-full bg-background relative pt-14 px-4 overflow-y-auto">
      <header className="fixed top-0 left-0 right-0 w-full md:max-w-3xl md:mx-auto md:left-auto md:right-auto z-40 bg-background/90 backdrop-blur-sm border-b border-hairline flex flex-col justify-center px-4 h-14">
        <div className="flex items-center justify-center">
          <h1 className="font-sans text-[18px] font-semibold text-primary tracking-tight">Elroy</h1>
        </div>
      </header>

      <main className="flex-1 w-full max-w-lg mx-auto py-6 flex flex-col gap-10 pb-12">
        <div className="w-full flex justify-between items-center border-b border-hairline pb-2">
          <span className="font-mono text-[12px] text-muted-gray uppercase tracking-wider">System Status</span>
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-2 h-2 rounded-full",
              currentStatus === 'Awake' && "bg-primary-container",
              currentStatus === 'Sleeping' && "bg-unresolved-violet",
              currentStatus !== 'Awake' && currentStatus !== 'Sleeping' && "bg-muted-gray"
            )}></div>
            <span className={cn(
              "font-mono text-[12px] font-medium tracking-wide",
              currentStatus === 'Awake' ? "text-primary" : "text-muted-gray"
            )}>
              {currentStatus}
            </span>
          </div>
        </div>

        {awakeningError && (
          <div className="flex items-start gap-2 border border-secondary/25 bg-secondary/5 rounded-[4px] p-3">
            <AlertCircle size={16} className="text-secondary mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="font-mono text-[10px] text-secondary uppercase tracking-wider">Awakening API</p>
              <p className="font-sans text-[13px] text-charcoal break-words">{awakeningError}</p>
            </div>
          </div>
        )}

        <section className="flex flex-col gap-4">
          <h2 className="font-sans text-[18px] font-semibold text-on-surface">Today's Anchors</h2>
          <div className="flex flex-col border border-hairline rounded-[4px] overflow-hidden bg-surface-container-lowest shadow-sm">
            {(awakeningStatus?.today_anchors || []).map((anchor, index, anchors) => (
              <div
                key={anchor.time}
                className={cn(
                  "flex items-center justify-between p-3 relative",
                  index < anchors.length - 1 && "border-b border-hairline",
                  anchor.status === 'upcoming' && "bg-surface-container-lowest/60"
                )}
              >
                {anchor.status === 'current' && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-primary"></div>}
                <span className={cn(
                  "font-mono text-[12px] w-16",
                  anchor.status === 'current' ? "text-primary font-medium" : "text-muted-gray"
                )}>
                  {anchor.time}
                </span>
                <span className="font-sans text-[14px] text-charcoal flex-grow capitalize">{anchor.status} Anchor</span>
                {anchor.status === 'passed' && <Check size={16} className="text-muted-gray" />}
                {anchor.status === 'current' && <Hourglass size={16} className="text-primary" />}
              </div>
            ))}

            {!isLoadingAwakening && !awakeningStatus?.today_anchors.length && (
              <div className="p-3 font-sans text-[14px] text-muted-gray">No anchors configured.</div>
            )}

            {isLoadingAwakening && (
              <div className="p-3 font-sans text-[14px] text-muted-gray">Loading anchors...</div>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="font-sans text-[18px] font-semibold text-on-surface">System Windows</h2>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-end border-b border-hairline pb-2 gap-4">
              <span className="font-sans text-[14px] text-muted-gray">Next Wake</span>
              <span className="font-mono text-[12px] text-charcoal text-right">{formatClock(awakeningStatus?.next_wake_time)}</span>
            </div>
            <div className="flex justify-between items-end border-b border-hairline pb-2 gap-4">
              <span className="font-sans text-[14px] text-muted-gray">Sleep Window</span>
              <span className="font-mono text-[12px] text-charcoal text-right">
                {awakeningStatus ? `${awakeningStatus.sleep_window.start} - ${awakeningStatus.sleep_window.end}` : 'Pending'}
              </span>
            </div>
            <div className="flex justify-between items-end border-b border-hairline pb-2 gap-4">
              <span className="font-sans text-[14px] text-muted-gray">Wake Limits</span>
              <span className="font-mono text-[12px] text-charcoal text-right">
                {awakeningStatus
                  ? `${formatDuration(awakeningStatus.wake_limits.min_minutes)} - ${formatDuration(awakeningStatus.wake_limits.max_minutes)}`
                  : 'Pending'}
              </span>
            </div>
            <div className="flex justify-between items-end border-b border-hairline pb-2 gap-4">
              <span className="font-sans text-[14px] text-muted-gray">Model</span>
              <span className="font-mono text-[12px] text-charcoal text-right break-all">{awakeningStatus?.model || 'Pending'}</span>
            </div>
          </div>
          <div className="flex justify-between mt-2 gap-2">
            <button
              onClick={handleTriggerAwakening}
              disabled={isTriggering}
              className="font-mono text-[10px] text-charcoal border border-hairline px-3 py-1.5 rounded-[4px] hover:bg-surface-container transition-colors uppercase flex items-center gap-1.5 disabled:opacity-50"
              title="Run one awakening cycle now"
            >
              <Play size={12} /> {isTriggering ? 'Waking' : 'Trigger'}
            </button>
            <button
              onClick={openConfig}
              disabled={!awakeningStatus}
              className="font-mono text-[10px] text-charcoal border border-hairline px-3 py-1.5 rounded-[4px] hover:bg-surface-container transition-colors uppercase flex items-center gap-1.5 disabled:opacity-50 disabled:text-muted-gray"
              title="Adjust awakening anchors and sleep window"
            >
              <Settings2 size={12} /> Adjust Cycle
            </button>
          </div>

          {isConfigOpen && draftConfig && (
            <div className="border border-hairline bg-surface-container-lowest rounded-[4px] p-4 flex flex-col gap-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[10px] text-muted-gray uppercase tracking-wider">Cycle Settings</span>
                <button
                  onClick={() => setIsConfigOpen(false)}
                  className="w-7 h-7 flex items-center justify-center border border-hairline rounded-[4px] hover:bg-surface-container transition-colors"
                  title="Close settings"
                >
                  <X size={13} className="text-charcoal" />
                </button>
              </div>

              <label className="flex items-center justify-between gap-4 border-b border-hairline pb-2">
                <span className="font-sans text-[14px] text-muted-gray">Scheduler</span>
                <input
                  type="checkbox"
                  checked={draftConfig.enabled}
                  onChange={(event) => updateDraft((current) => ({...current, enabled: event.target.checked}))}
                  className="h-4 w-4 accent-primary"
                />
              </label>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="font-sans text-[14px] text-muted-gray">Anchors</span>
                  <button
                    onClick={handleAddAnchor}
                    disabled={draftConfig.anchors.length >= 8}
                    className="w-7 h-7 flex items-center justify-center border border-hairline rounded-[4px] hover:bg-surface-container transition-colors disabled:opacity-50"
                    title="Add anchor"
                  >
                    <Plus size={13} className="text-charcoal" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {draftConfig.anchors.map((anchor, index) => (
                    <div key={`${anchor}-${index}`} className="flex items-center gap-1">
                      <input
                        type="time"
                        value={anchor}
                        onChange={(event) => handleAnchorChange(index, event.target.value)}
                        className="min-w-0 flex-1 border border-hairline rounded-[4px] bg-background px-2 py-1.5 font-mono text-[12px] text-charcoal"
                      />
                      <button
                        onClick={() => handleRemoveAnchor(index)}
                        disabled={draftConfig.anchors.length <= 1}
                        className="w-8 h-8 flex items-center justify-center border border-hairline rounded-[4px] hover:bg-surface-container transition-colors disabled:opacity-40"
                        title="Remove anchor"
                      >
                        <Trash2 size={12} className="text-muted-gray" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="font-sans text-[13px] text-muted-gray">Sleep Start</span>
                  <input
                    type="time"
                    value={draftConfig.sleep_window.start}
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      sleep_window: {...current.sleep_window, start: event.target.value},
                    }))}
                    className="border border-hairline rounded-[4px] bg-background px-2 py-1.5 font-mono text-[12px] text-charcoal"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-sans text-[13px] text-muted-gray">Sleep End</span>
                  <input
                    type="time"
                    value={draftConfig.sleep_window.end}
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      sleep_window: {...current.sleep_window, end: event.target.value},
                    }))}
                    className="border border-hairline rounded-[4px] bg-background px-2 py-1.5 font-mono text-[12px] text-charcoal"
                  />
                </label>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="font-sans text-[13px] text-muted-gray">Min Wake</span>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={draftConfig.wake_limits.min_minutes}
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      wake_limits: {...current.wake_limits, min_minutes: Number(event.target.value)},
                    }))}
                    className="border border-hairline rounded-[4px] bg-background px-2 py-1.5 font-mono text-[12px] text-charcoal"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-sans text-[13px] text-muted-gray">Max Wake</span>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={draftConfig.wake_limits.max_minutes}
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      wake_limits: {...current.wake_limits, max_minutes: Number(event.target.value)},
                    }))}
                    className="border border-hairline rounded-[4px] bg-background px-2 py-1.5 font-mono text-[12px] text-charcoal"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-sans text-[13px] text-muted-gray">Dice Gate</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={draftConfig.dice_threshold}
                    onChange={(event) => updateDraft((current) => ({
                      ...current,
                      dice_threshold: Number(event.target.value),
                    }))}
                    className="border border-hairline rounded-[4px] bg-background px-2 py-1.5 font-mono text-[12px] text-charcoal"
                  />
                </label>
              </div>

              <label className="flex items-center justify-between gap-4 border-t border-hairline pt-3">
                <span className="font-sans text-[14px] text-muted-gray">Persist to config.yaml</span>
                <input
                  type="checkbox"
                  checked={persistConfig}
                  onChange={(event) => setPersistConfig(event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
              </label>

              <div className="flex justify-end">
                <button
                  onClick={handleSaveConfig}
                  disabled={isSavingConfig || draftConfig.anchors.length === 0}
                  className="font-mono text-[10px] text-charcoal border border-hairline px-3 py-1.5 rounded-[4px] hover:bg-surface-container transition-colors uppercase flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save size={12} /> {isSavingConfig ? 'Saving' : 'Save Cycle'}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-sans text-[18px] font-semibold text-on-surface">Awakening Log</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => openDiary(null)}
                className="font-mono text-[10px] text-charcoal border border-hairline px-2.5 py-1.5 rounded-[4px] hover:bg-surface-container transition-colors uppercase flex items-center gap-1"
                title="View private diary entries"
              >
                <BookOpen size={12} className="text-unresolved-violet" /> Diary
              </button>
              <button
                onClick={loadAwakening}
                className="w-8 h-8 flex items-center justify-center border border-hairline rounded-[4px] hover:bg-surface-container transition-colors"
                title="Refresh awakening state"
              >
                <RefreshCw size={14} className="text-charcoal" />
              </button>
            </div>
          </div>
          <div className="flex flex-col border border-hairline rounded-[4px] overflow-hidden bg-surface-container-lowest shadow-sm">
            {awakeningLog.map((entry, index) => (
              <div
                key={`${entry.timestamp}-${index}`}
                className={cn(
                  "p-3 flex flex-col gap-2 transition-colors duration-150",
                  index < awakeningLog.length - 1 && "border-b border-hairline",
                  entry.action === 'diary' && "cursor-pointer hover:bg-unresolved-violet/5"
                )}
                onClick={() => {
                  if (entry.action === 'diary') {
                    openDiary(entry.private_entry_id);
                  }
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {entry.aborted ? (
                      <Moon size={14} className="text-muted-gray shrink-0" />
                    ) : (
                      <Radio size={14} className="text-primary shrink-0" />
                    )}
                    <span className="font-mono text-[12px] text-charcoal truncate">{formatStamp(entry.timestamp)}</span>
                  </div>
                  <span className={cn(
                    "font-mono text-[10px] uppercase tracking-wider shrink-0 flex items-center gap-1.5",
                    entry.action === 'push' && "text-primary",
                    entry.action === 'diary' && "text-unresolved-violet font-semibold",
                    (entry.action === 'idle' || entry.aborted || !entry.action) && "text-muted-gray"
                  )}>
                    {entry.action === 'diary' && (
                      entry.private_entry_id ? <BookOpen size={10} className="stroke-[2.5px]" /> : <Lock size={10} />
                    )}
                    {actionLabel(entry)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 font-mono text-[10px] text-muted-gray">
                  <span>dice {entry.dice ?? '-'}</span>
                  <span>next {formatClock(entry.next_wake_time)}</span>
                </div>
                {(entry.message_preview || entry.abort_reason) && (
                  <p className="font-sans text-[13px] leading-[19px] text-charcoal/80 break-words">
                    {entry.message_preview || entry.abort_reason}
                  </p>
                )}
              </div>
            ))}

            {!isLoadingAwakening && awakeningLog.length === 0 && (
              <div className="p-3 font-sans text-[14px] text-muted-gray">No awakening cycles logged yet.</div>
            )}

            {isLoadingAwakening && (
              <div className="p-3 font-sans text-[14px] text-muted-gray">Loading log...</div>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="font-sans text-[18px] font-semibold text-on-surface">Diagnostics</h2>
          <div className="p-4 border border-hairline bg-surface-container-lowest rounded-[4px] flex flex-col gap-4 shadow-sm">
            <div className="flex justify-between items-center gap-4">
              <span className="font-mono text-[10px] text-muted-gray uppercase tracking-wider">Push Notifications</span>
              <span className={cn("font-mono text-[10px] text-right", pushStatus === 'Testing...' ? 'text-unresolved-violet animate-pulse' : 'text-primary')}>
                {pushStatus}
              </span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="font-mono text-[10px] text-muted-gray uppercase tracking-wider">Last Sync</span>
              <span className="font-mono text-[10px] text-charcoal text-right">{lastSync}</span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="font-mono text-[10px] text-muted-gray uppercase tracking-wider">Dice Gate</span>
              <span className="font-mono text-[10px] text-charcoal text-right">
                {awakeningStatus ? `${awakeningStatus.dice_threshold + 1}-6` : 'Pending'}
              </span>
            </div>
            <div className="mt-2 flex justify-end">
              <button
                onClick={handleTestSignal}
                disabled={pushStatus === 'Testing...'}
                className="font-mono text-[10px] text-charcoal border border-hairline px-3 py-1.5 rounded-[4px] hover:bg-surface-container transition-colors disabled:opacity-50"
              >
                Test Signal
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Backdrop */}
      {isDiaryOpen && (
        <div 
          className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 transition-opacity duration-300 ease-out cursor-pointer"
          onClick={() => setIsDiaryOpen(false)}
        />
      )}

      {/* Drawer Panel */}
      <div className={cn(
        "fixed inset-y-0 right-0 z-50 w-full sm:max-w-md bg-surface-container-lowest border-l border-hairline shadow-2xl flex flex-col h-full transition-all duration-300 ease-out transform",
        isDiaryOpen ? "translate-x-0 opacity-100" : "translate-x-full opacity-0 pointer-events-none"
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-hairline shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-unresolved-violet" />
            <h3 className="font-sans text-[15px] font-semibold text-primary">Private Diary</h3>
          </div>
          <button
            onClick={() => setIsDiaryOpen(false)}
            className="w-8 h-8 flex items-center justify-center border border-hairline rounded-[4px] hover:bg-surface-container transition-colors"
            title="Close Diary"
          >
            <X size={14} className="text-charcoal" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto flex flex-col">
          {isLoadingDiary ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 gap-2">
              <RefreshCw size={24} className="text-unresolved-violet animate-spin" />
              <span className="font-mono text-[10px] text-muted-gray uppercase tracking-wider">Syncing diary...</span>
            </div>
          ) : diaryError ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 gap-3 text-center">
              <AlertCircle size={28} className="text-secondary" />
              <div>
                <p className="font-mono text-[10px] text-secondary uppercase tracking-wider font-semibold">Error Loading Diary</p>
                <p className="font-sans text-[13px] text-charcoal/80 mt-1">{diaryError}</p>
              </div>
              <button 
                onClick={() => openDiary(selectedDiaryId)}
                className="mt-2 font-mono text-[10px] text-charcoal border border-hairline px-3 py-1.5 rounded-[4px] hover:bg-surface-container transition-colors uppercase"
              >
                Retry
              </button>
            </div>
          ) : diaryEntries.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-2">
              <BookOpen size={28} className="text-muted-gray" />
              <p className="font-sans text-[14px] text-muted-gray">No diary entries found.</p>
            </div>
          ) : diaryViewMode === 'list' ? (
            /* LIST VIEW */
            <div className="flex flex-col p-4 gap-3">
              <span className="font-mono text-[10px] text-muted-gray uppercase tracking-wider border-b border-hairline pb-1.5">
                Recent Entries ({diaryEntries.length})
              </span>
              <div className="flex flex-col gap-2.5">
                {diaryEntries.map((entry) => (
                  <div
                    key={entry.id}
                    onClick={() => {
                      setSelectedDiaryId(entry.id);
                      setDiaryViewMode('detail');
                    }}
                    className={cn(
                      "p-3 rounded-[4px] border transition-all duration-200 cursor-pointer text-left flex flex-col gap-2",
                      entry.id === selectedDiaryId
                        ? "border-unresolved-violet/45 bg-unresolved-violet/5 shadow-sm"
                        : "border-hairline hover:bg-surface-container-low"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-sans text-[14px] font-semibold text-charcoal truncate">
                        {entry.name || `Diary Entry`}
                      </span>
                      <span className="font-mono text-[10px] text-muted-gray shrink-0 mt-0.5">
                        {formatStamp(entry.created)}
                      </span>
                    </div>

                    {entry.locked ? (
                      <div className="flex items-center gap-1.5 text-unresolved-violet font-mono text-[10px]">
                        <Lock size={12} className="shrink-0" />
                        <span>Locked • {formatTimeRemaining(entry.locked_until)}</span>
                      </div>
                    ) : (
                      <p className="font-sans text-[12px] text-charcoal/70 line-clamp-2 leading-relaxed">
                        {entry.content || "Empty content"}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* DETAIL VIEW */
            <div className="flex flex-col h-full">
              {/* Back Bar */}
              <div className="px-4 py-2 border-b border-hairline bg-surface-container-low/50 flex items-center shrink-0">
                <button
                  onClick={() => setDiaryViewMode('list')}
                  className="font-mono text-[10px] text-charcoal hover:text-primary transition-colors flex items-center gap-1 uppercase"
                >
                  <ArrowLeft size={12} /> Back to list
                </button>
              </div>

              {/* Entry View */}
              {selectedDiary ? (
                <div className="flex-1 p-5 flex flex-col gap-4 overflow-y-auto">
                  <div className="flex flex-col gap-1.5 border-b border-hairline pb-3.5">
                    <div className="flex items-start justify-between gap-4">
                      <h4 className="font-sans text-[16px] font-bold text-charcoal leading-snug">
                        {selectedDiary.name || `Diary Entry`}
                      </h4>
                      {selectedDiary.locked && (
                        <span className="bg-unresolved-violet/10 text-unresolved-violet px-1.5 py-0.5 rounded-[3px] font-mono text-[9px] uppercase tracking-wider font-semibold flex items-center gap-1 shrink-0">
                          <Lock size={10} /> Locked
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-muted-gray font-mono text-[10px]">
                      <Calendar size={11} />
                      <span>{formatStamp(selectedDiary.created)}</span>
                    </div>
                  </div>

                  {selectedDiary.locked ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center my-auto">
                      <div className="w-12 h-12 rounded-full bg-unresolved-violet/10 flex items-center justify-center text-unresolved-violet mb-4 animate-pulse">
                        <Lock size={20} className="stroke-[2.5px]" />
                      </div>
                      <h5 className="font-sans text-[15px] font-semibold text-charcoal mb-1">Time-Locked Memory</h5>
                      <p className="font-sans text-[12px] text-charcoal/70 max-w-[280px] leading-relaxed mb-4">
                        Elroy has locked this diary entry to process his internal thoughts. It will automatically unlock for Ciel to read when the timer expires.
                      </p>
                      <div className="bg-surface-container border border-hairline rounded-[4px] px-4 py-2.5 font-mono text-[11px] text-unresolved-violet font-semibold">
                        {formatTimeRemaining(selectedDiary.locked_until)}
                      </div>
                      <span className="font-mono text-[9px] text-muted-gray mt-2">
                        Unlocks at {new Date(selectedDiary.locked_until || '').toLocaleString()}
                      </span>
                    </div>
                  ) : (
                    <div className="flex-1 font-sans text-[13.5px] leading-[22px] text-charcoal/90 whitespace-pre-wrap font-normal tracking-wide break-words">
                      {selectedDiary.content || (
                        <span className="italic text-muted-gray">Empty diary content.</span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center p-6">
                  <p className="font-sans text-[13px] text-muted-gray">No entry selected.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
