import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Trash2, Save, RotateCcw } from 'lucide-react';
import { AwakeningSchedulerConfig } from '../../types';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';

interface LiminalSettingsModalProps {
  initialConfig: AwakeningSchedulerConfig;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (newConfig: AwakeningSchedulerConfig) => void;
}

const fieldChrome =
  'border border-[#3A332B]/10 dark:border-[#D8D5CD]/20 bg-white/30 dark:bg-[#151514]/30 shadow-sm dark:shadow-[inset_0_1px_0_rgba(240,236,226,0.04)] backdrop-blur-md transition-colors focus-within:border-[#3A332B]/25 dark:focus-within:border-[#E4DFD4]/34 focus-within:bg-white/50 dark:focus-within:bg-[#1B1A19]/36';
const timeInputChrome =
  'bg-transparent font-mono text-[#3A332B] dark:text-[#ECE8DF] outline-none';
const numberInputChrome =
  'w-full appearance-none bg-transparent text-center font-mono text-[12px] text-[#3A332B] dark:text-[#ECE8DF] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
const sectionLabel = 'font-sans text-[13px] text-[#3A332B]/70 dark:text-[#D1CEC6]/78';

function normalizeTimeInput(value: string) {
  const cleaned = value.replace(/[^\d:]/g, '').slice(0, 5);
  if (/^\d{3,4}$/.test(cleaned)) {
    return `${cleaned.slice(0, 2)}:${cleaned.slice(2, 4)}`;
  }
  return cleaned;
}

interface TimeFieldProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

function TimeField({
  value,
  onChange,
  className,
}: TimeFieldProps) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(normalizeTimeInput(e.target.value))}
      placeholder="00:00"
      className={cn('min-w-0 flex-1 px-1', timeInputChrome, className)}
    />
  );
}

export default function LiminalSettingsModal({
  initialConfig,
  isOpen,
  onClose,
  onSaved,
}: LiminalSettingsModalProps) {
  const [draftConfig, setDraftConfig] = useState<AwakeningSchedulerConfig>(initialConfig);
  const [isSaving, setIsSaving] = useState(false);
  const [persistConfig, setPersistConfig] = useState(false);

  // Prompt state
  const [promptContent, setPromptContent] = useState('');
  const [isFetchingPrompt, setIsFetchingPrompt] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setDraftConfig(initialConfig);
      setPersistConfig(false);
      loadPrompt();
    }
  }, [isOpen, initialConfig]);

  const loadPrompt = async () => {
    setIsFetchingPrompt(true);
    try {
      const prompts = await api.getSystemPrompts();
      setPromptContent(prompts.awakening || '');
    } catch (e) {
      console.error("Failed to fetch prompt", e);
    } finally {
      setIsFetchingPrompt(false);
    }
  };

  const handleResetPrompt = async (e: React.MouseEvent) => {
    e.preventDefault();
    setIsFetchingPrompt(true);
    try {
      await api.resetSystemPrompt('awakening');
      await loadPrompt();
    } catch (err) {
      console.error("Failed to reset prompt", err);
      setIsFetchingPrompt(false);
    }
  };

  const updateDraft = (updater: (current: AwakeningSchedulerConfig) => AwakeningSchedulerConfig) => {
    setDraftConfig((current) => updater(current));
  };

  const handleAnchorChange = (index: number, value: string) => {
    updateDraft((current) => ({
      ...current,
      anchors: current.anchors.map((anchor, i) => (i === index ? value : anchor)),
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
      anchors: current.anchors.filter((_, i) => i !== index),
    }));
  };

  const handleSaveConfig = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const normalizedDraft = {
        ...draftConfig,
        anchors: Array.from(new Set(draftConfig.anchors.filter((anchor) => /^\d{2}:\d{2}$/.test(anchor)))).sort(),
      };
      const res = await api.configureAwakening(normalizedDraft, persistConfig);
      if (!res.ok) {
        throw new Error(res.error || 'Awakening configuration failed');
      }

      // Save prompt configuration
      await api.updateSystemPrompts({ awakening: promptContent });

      onSaved(normalizedDraft);
      onClose();
    } catch (err: any) {
      console.error('Failed to save awakening config:', err);
      alert(`Awakening Config Error: ${err?.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-white/20 dark:bg-[#070706]/28 px-4 backdrop-blur-[12px]"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="relative flex max-h-[85vh] w-full max-w-[420px] flex-col overflow-hidden rounded-[24px] border border-[#3A332B]/10 dark:border-[#D8D5CD]/22 bg-gradient-to-br from-white/40 to-white/10 dark:bg-[linear-gradient(145deg,rgba(14,14,13,0.58),rgba(26,25,24,0.42)_54%,rgba(41,38,35,0.28))] text-[#3A332B] dark:text-[#ECE8DF] shadow-[0_18px_60px_rgba(0,0,0,0.1)] dark:shadow-[0_28px_90px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(242,238,228,0.05)] backdrop-blur-2xl"
          >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#3A332B]/10 dark:border-[#D8D5CD]/15 bg-[#3A332B]/5 dark:bg-[#F0ECE2]/[0.026] px-5 py-4">
            <h3 className="font-serif text-[16px] font-medium tracking-widest text-[#3A332B] dark:text-[#F1EDE4]">
              ADJUST CYCLE
            </h3>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-[#3A332B]/60 dark:text-[#D1CEC6]/68 transition-colors hover:border-[#3A332B]/20 dark:hover:border-[#E4DFD4]/28 hover:bg-[#3A332B]/5 dark:hover:bg-[#F0ECE2]/8 hover:text-[#3A332B] dark:hover:text-[#F1EDE4]"
            >
              <X size={14} />
            </button>
          </div>

          {/* Content */}
          <div className="flex flex-col gap-6 overflow-y-auto px-5 py-5 scrollbar-hide">
            {/* Master Switch */}
            <label className="flex items-center justify-between">
              <span className={sectionLabel}>Awakening Engine</span>
              <input
                type="checkbox"
                checked={draftConfig.enabled}
                onChange={(e) => updateDraft((c) => ({ ...c, enabled: e.target.checked }))}
                className="h-4 w-4 rounded border-[#3A332B]/15 dark:border-[#D8D5CD]/34 bg-white/40 dark:bg-[#151514]/38 accent-amber-700 dark:accent-[#C9C3B8]"
              />
            </label>

            {/* Anchors */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className={sectionLabel}>Time Anchors</span>
                <button
                  onClick={handleAddAnchor}
                  disabled={draftConfig.anchors.length >= 8}
                  className="flex h-6 w-6 items-center justify-center rounded-full border border-[#3A332B]/15 dark:border-[#D8D5CD]/20 text-[#3A332B]/60 dark:text-[#D1CEC6]/70 transition-colors hover:border-[#3A332B]/30 dark:hover:border-[#E4DFD4]/34 hover:bg-[#3A332B]/5 dark:hover:bg-[#F0ECE2]/8 hover:text-[#3A332B] dark:hover:text-[#F1EDE4] disabled:opacity-30"
                >
                  <Plus size={12} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {draftConfig.anchors.map((anchor, index) => (
                  <div
                    key={`${anchor}-${index}`}
                    onClick={(e) => e.stopPropagation()}
                    className={cn('flex items-center gap-1.5 rounded-[12px] p-1.5', fieldChrome)}
                  >
                    <TimeField
                      value={anchor}
                      onChange={(nextValue) => handleAnchorChange(index, nextValue)}
                      className="text-[12px]"
                    />
                    <button
                      onClick={() => handleRemoveAnchor(index)}
                      disabled={draftConfig.anchors.length <= 1}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#3A332B]/40 dark:text-[#D1CEC6]/44 transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:bg-[#F0ECE2]/8 dark:hover:text-[#ECE8DF] disabled:opacity-20"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Sleep Window */}
            <div className="flex flex-col gap-3">
              <span className={sectionLabel}>Sleep Window</span>
              <div className="grid grid-cols-2 gap-3">
                <label
                  onClick={(e) => e.stopPropagation()}
                  className={cn('flex flex-col gap-1.5 rounded-[12px] p-3', fieldChrome)}
                >
                  <span className="font-sans text-[11px] text-[#3A332B]/60 dark:text-[#D1CEC6]/56">From</span>
                  <TimeField
                    value={draftConfig.sleep_window.start}
                    onChange={(nextValue) =>
                      updateDraft((c) => ({
                        ...c,
                        sleep_window: { ...c.sleep_window, start: nextValue },
                      }))
                    }
                    className="text-[14px]"
                  />
                </label>
                <label
                  onClick={(e) => e.stopPropagation()}
                  className={cn('flex flex-col gap-1.5 rounded-[12px] p-3', fieldChrome)}
                >
                  <span className="font-sans text-[11px] text-[#3A332B]/60 dark:text-[#D1CEC6]/56">To</span>
                  <TimeField
                    value={draftConfig.sleep_window.end}
                    onChange={(nextValue) =>
                      updateDraft((c) => ({
                        ...c,
                        sleep_window: { ...c.sleep_window, end: nextValue },
                      }))
                    }
                    className="text-[14px]"
                  />
                </label>
              </div>
            </div>

            {/* Limits & Dice */}
            <div className="grid grid-cols-3 gap-2">
              <label className={cn('flex flex-col gap-1 rounded-[12px] p-2 text-center', fieldChrome)}>
                <span className="font-sans text-[10px] text-[#3A332B]/60 dark:text-[#D1CEC6]/56">Min (m)</span>
                <input
                  type="number"
                  min={1}
                  value={draftConfig.wake_limits.min_minutes}
                  onChange={(e) =>
                    updateDraft((c) => ({
                      ...c,
                      wake_limits: { ...c.wake_limits, min_minutes: Number(e.target.value) },
                    }))
                  }
                  className={numberInputChrome}
                />
              </label>
              <label className={cn('flex flex-col gap-1 rounded-[12px] p-2 text-center', fieldChrome)}>
                <span className="font-sans text-[10px] text-[#3A332B]/60 dark:text-[#D1CEC6]/56">Max (m)</span>
                <input
                  type="number"
                  min={1}
                  value={draftConfig.wake_limits.max_minutes}
                  onChange={(e) =>
                    updateDraft((c) => ({
                      ...c,
                      wake_limits: { ...c.wake_limits, max_minutes: Number(e.target.value) },
                    }))
                  }
                  className={numberInputChrome}
                />
              </label>
              <label className={cn('flex flex-col gap-1 rounded-[12px] p-2 text-center', fieldChrome)}>
                <span className="font-sans text-[10px] text-[#3A332B]/60 dark:text-[#D1CEC6]/56">Dice ≤</span>
                <input
                  type="number"
                  min={0}
                  max={5}
                  value={draftConfig.dice_threshold}
                  onChange={(e) =>
                    updateDraft((c) => ({ ...c, dice_threshold: Number(e.target.value) }))
                  }
                  className={numberInputChrome}
                />
              </label>
            </div>

            {/* System Prompt */}
            <div className="flex flex-col gap-3 border-t border-[#3A332B]/10 dark:border-[#D8D5CD]/15 pt-5">
              <div className="flex items-center justify-between">
                <span className={sectionLabel}>Awakening Prompt</span>
                <button
                  onClick={handleResetPrompt}
                  disabled={isFetchingPrompt}
                  className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[#3A332B]/50 dark:text-[#D1CEC6]/50 hover:text-[#3A332B] dark:hover:text-[#F1EDE4] transition-colors disabled:opacity-30"
                >
                  <RotateCcw size={10} /> Default
                </button>
              </div>
              {isFetchingPrompt ? (
                <div className="flex justify-center items-center h-[120px] opacity-40 font-mono text-[10px] tracking-wider">
                  LOADING PROMPT...
                </div>
              ) : (
                <textarea
                  value={promptContent}
                  onChange={(e) => setPromptContent(e.target.value)}
                  className="w-full h-[140px] resize-none rounded-[12px] bg-[#3A332B]/5 dark:bg-[#151514]/40 p-3 text-[12px] font-sans leading-relaxed outline-none focus:ring-1 focus:ring-current/20 transition-all opacity-90 text-[#3A332B] dark:text-[#ECE8DF] placeholder:opacity-30"
                  placeholder="Enter system prompt instructions..."
                />
              )}
            </div>

            {/* Persist toggle */}
            <label className="flex items-center justify-between border-t border-[#3A332B]/10 dark:border-[#D8D5CD]/15 pt-5">
              <span className="font-sans text-[12px] text-[#3A332B]/70 dark:text-[#D1CEC6]/64">Persist to config.yaml</span>
              <input
                type="checkbox"
                checked={persistConfig}
                onChange={(e) => setPersistConfig(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-[#3A332B]/15 dark:border-[#D8D5CD]/34 bg-white/40 dark:bg-[#151514]/38 accent-amber-700 dark:accent-[#C9C3B8]"
              />
            </label>
          </div>

          {/* Footer */}
          <div className="flex border-t border-[#3A332B]/10 dark:border-[#D8D5CD]/15 bg-[#3A332B]/5 dark:bg-[#F0ECE2]/[0.032]">
            <button
              onClick={handleSaveConfig}
              disabled={isSaving || draftConfig.anchors.length === 0}
              className="flex w-full items-center justify-center gap-2 py-4 font-sans text-[12px] uppercase tracking-wider text-[#3A332B] dark:text-[#F1EDE4] transition-colors hover:bg-[#3A332B]/10 dark:hover:bg-[#F0ECE2]/8 disabled:opacity-40"
            >
              <Save size={14} />
              {isSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
