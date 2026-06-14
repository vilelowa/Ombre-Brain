import { useState } from 'react';
import { Cpu, Globe, Key, Sliders, Gauge, Activity, Save } from 'lucide-react';
import { cn } from '../../lib/utils';
import { albireoTone } from '../shared/albireoTokens';
import type { useSettingsController, TabConfig, ApiConfig } from './useSettingsController';

export default function CoreConfigEditor({ settings }: { settings: ReturnType<typeof useSettingsController> }) {
  const [configTab, setConfigTab] = useState<'dehydration' | 'awakening' | 'dreaming' | 'chat'>('chat');
  
  // We use a local draft state to hold edits before saving
  const [draft, setDraft] = useState<ApiConfig>(settings.config || {});
  const [testStatus, setTestStatus] = useState<{ loading: boolean; success: boolean; msg: string }>({ loading: false, success: false, msg: '' });
  const [saving, setSaving] = useState(false);

  const currentTabDraft = draft[configTab] || {} as TabConfig;

  const updateTab = (updates: Partial<TabConfig>) => {
    setDraft(prev => ({
      ...prev,
      [configTab]: { ...(prev[configTab] || {} as TabConfig), ...updates }
    }));
  };

  const handleTest = async () => {
    if (!currentTabDraft.model || !currentTabDraft.base_url) return;
    setTestStatus({ loading: true, success: false, msg: '' });
    try {
      const apiKey = currentTabDraft.api_key || currentTabDraft._api_key_input || "";
      const res = await settings.testConnection(configTab, currentTabDraft.model, currentTabDraft.base_url, apiKey);
      setTestStatus({ loading: false, success: res.ok, msg: res.message || (res.ok ? 'Connection successful!' : 'Connection failed') });
    } catch (e: any) {
      setTestStatus({ loading: false, success: false, msg: e.message || 'Error connecting' });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = { persist: true, [configTab]: { ...currentTabDraft } };
      if (currentTabDraft._api_key_input) {
        payload[configTab].api_key = currentTabDraft._api_key_input;
      }
      await settings.saveConfig(payload);
      setTestStatus({ loading: false, success: true, msg: 'Saved successfully!' });
    } catch (e: any) {
      setTestStatus({ loading: false, success: false, msg: e.message || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-[600px] flex-col gap-6 pt-4">
      {/* Tabs */}
      <div className={cn('flex overflow-hidden rounded-xl border p-1', albireoTone.surface, albireoTone.hairline)}>
        {(['chat', 'dreaming', 'awakening', 'dehydration'] as const).map(tab => {
          const isActive = configTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => { setConfigTab(tab); setTestStatus({ loading: false, success: false, msg: '' }); }}
              className={cn(
                'flex-1 rounded-lg py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-all',
                isActive ? 'bg-black text-white shadow-sm dark:bg-white dark:text-black' : cn('hover:bg-black/5 dark:hover:bg-white/5', albireoTone.muted)
              )}
            >
              {tab}
            </button>
          );
        })}
      </div>

      <div className="flex animate-in fade-in slide-in-from-right-2 duration-300 flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label className={cn('px-2 font-mono text-[10px] uppercase tracking-wider', albireoTone.muted)}>Model</label>
          <div className="relative">
            <Cpu size={16} className={cn('absolute left-3 top-1/2 -translate-y-1/2 opacity-40', albireoTone.text)} />
            <input 
              value={currentTabDraft.model || ''} 
              onChange={e => updateTab({ model: e.target.value })}
              className={cn('w-full rounded-xl border bg-transparent py-3 pl-10 pr-4 font-mono text-[13px] outline-none transition focus:border-black dark:focus:border-white', albireoTone.hairline, albireoTone.text)}
              placeholder="e.g. google/gemini-2.5-pro"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className={cn('px-2 font-mono text-[10px] uppercase tracking-wider', albireoTone.muted)}>Base URL</label>
          <div className="relative">
            <Globe size={16} className={cn('absolute left-3 top-1/2 -translate-y-1/2 opacity-40', albireoTone.text)} />
            <input 
              value={currentTabDraft.base_url || ''} 
              onChange={e => updateTab({ base_url: e.target.value })}
              className={cn('w-full rounded-xl border bg-transparent py-3 pl-10 pr-4 font-mono text-[13px] outline-none transition focus:border-black dark:focus:border-white', albireoTone.hairline, albireoTone.text)}
              placeholder="e.g. https://openrouter.ai/api/v1"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className={cn('px-2 font-mono text-[10px] uppercase tracking-wider', albireoTone.muted)}>API Key</label>
          <div className="relative">
            <Key size={16} className={cn('absolute left-3 top-1/2 -translate-y-1/2 opacity-40', albireoTone.text)} />
            <input 
              type="password"
              value={currentTabDraft._api_key_input || ''} 
              onChange={e => updateTab({ _api_key_input: e.target.value })}
              className={cn('w-full rounded-xl border bg-transparent py-3 pl-10 pr-4 font-mono text-[13px] outline-none transition focus:border-black dark:focus:border-white', albireoTone.hairline, albireoTone.text)}
              placeholder={currentTabDraft.api_key_masked || "Enter new API key"}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className={cn('px-2 font-mono text-[10px] uppercase tracking-wider', albireoTone.muted)}>Max Tokens</label>
          <div className="relative">
            <Sliders size={16} className={cn('absolute left-3 top-1/2 -translate-y-1/2 opacity-40', albireoTone.text)} />
            <input 
              type="number"
              value={currentTabDraft.max_tokens || ''} 
              onChange={e => updateTab({ max_tokens: parseInt(e.target.value) })}
              className={cn('w-full rounded-xl border bg-transparent py-3 pl-10 pr-4 font-mono text-[13px] outline-none transition focus:border-black dark:focus:border-white', albireoTone.hairline, albireoTone.text)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className={cn('px-2 font-mono text-[10px] uppercase tracking-wider', albireoTone.muted)}>Temperature</label>
          <div className="relative">
            <Gauge size={16} className={cn('absolute left-3 top-1/2 -translate-y-1/2 opacity-40', albireoTone.text)} />
            <input 
              type="number" step="0.1"
              value={currentTabDraft.temperature ?? ''} 
              onChange={e => updateTab({ temperature: parseFloat(e.target.value) })}
              className={cn('w-full rounded-xl border bg-transparent py-3 pl-10 pr-4 font-mono text-[13px] outline-none transition focus:border-black dark:focus:border-white', albireoTone.hairline, albireoTone.text)}
            />
          </div>
        </div>

        {testStatus.msg && (
          <div className={cn('rounded-xl border p-3 font-mono text-[12px]', testStatus.success ? 'border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-400' : 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400')}>
            {testStatus.msg}
          </div>
        )}

        <div className="mt-2 flex gap-3">
          <button
            type="button"
            disabled={testStatus.loading || !currentTabDraft.model || !currentTabDraft.base_url}
            onClick={handleTest}
            className={cn('flex flex-1 items-center justify-center gap-2 rounded-xl border py-3.5 font-sans text-[15px] font-semibold transition', testStatus.loading ? 'opacity-50' : 'hover:scale-[0.98] active:scale-95', albireoTone.hairline, albireoTone.text)}
          >
            <Activity size={18} />
            {testStatus.loading ? 'Testing...' : 'Test'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className={cn('flex flex-1 items-center justify-center gap-2 rounded-xl py-3.5 font-sans text-[15px] font-semibold transition', saving ? 'opacity-50' : 'hover:scale-[0.98] active:scale-95', 'bg-black text-white dark:bg-white dark:text-black')}
          >
            <Save size={18} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
