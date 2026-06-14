import { Activity, Database, Server, Terminal, Coins, Bell, Zap, Play } from 'lucide-react';
import { cn } from '../../lib/utils';
import { albireoTone } from '../shared/albireoTokens';
import type { useSettingsController } from './useSettingsController';
import { useState } from 'react';

export default function SystemDiagnostics({ 
  settings, 
  onNavigate 
}: { 
  settings: ReturnType<typeof useSettingsController>;
  onNavigate?: (view: 'token_stats') => void;
}) {
  const { status, hostVault, savingsStats, awakeningLog } = settings;
  const [pushing, setPushing] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const handleTestPush = async () => {
    setPushing(true);
    try {
      const result = await settings.testPushNotification();
      if (!result.ok) {
        throw new Error(result.error || result.reason || 'Push test failed');
      }
    } catch (e: any) {
      alert(e.message || 'Failed to test push');
    } finally {
      setPushing(false);
    }
  };

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await settings.triggerAwakening();
    } catch (e: any) {
      alert(e.message || 'Failed to trigger awakening');
    } finally {
      setTriggering(false);
    }
  };

  const savings = savingsStats?.data || {};

  return (
    <div className="mx-auto flex max-w-[600px] flex-col gap-6 pt-4">
      {/* System Status Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className={cn('flex flex-col gap-2 rounded-2xl border p-4', albireoTone.surface, albireoTone.hairline)}>
          <div className="flex items-center gap-2">
            <Server size={16} className={cn(albireoTone.muted)} />
            <span className={cn('font-mono text-[11px] uppercase tracking-wider', albireoTone.muted)}>Decay Engine</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={cn('h-2 w-2 rounded-full', status?.decay_engine === 'running' ? 'bg-green-500' : 'bg-red-500')} />
            <span className={cn('font-sans text-[15px] font-semibold capitalize', albireoTone.text)}>
              {status?.decay_engine || 'Unknown'}
            </span>
          </div>
        </div>

        <div className={cn('flex flex-col gap-2 rounded-2xl border p-4', albireoTone.surface, albireoTone.hairline)}>
          <div className="flex items-center gap-2">
            <Database size={16} className={cn(albireoTone.muted)} />
            <span className={cn('font-mono text-[11px] uppercase tracking-wider', albireoTone.muted)}>Embeddings</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={cn('h-2 w-2 rounded-full', status?.embedding_enabled ? 'bg-green-500' : 'bg-gray-400')} />
            <span className={cn('font-sans text-[15px] font-semibold', albireoTone.text)}>
              {status?.embedding_enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>
      </div>

      {/* Token Stats Summary (Clickable) */}
      <button 
        type="button"
        onClick={() => onNavigate?.('token_stats')}
        className={cn('group flex items-center justify-between rounded-2xl border p-5 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5', albireoTone.surface, albireoTone.hairline)}
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Coins size={16} className={cn(albireoTone.muted)} />
            <span className={cn('font-mono text-[11px] uppercase tracking-wider', albireoTone.muted)}>Token Economy & Cache</span>
          </div>
          <span className={cn('font-sans text-[15px] font-semibold', albireoTone.text)}>
            {savings.cache_hit_rate_pct || 0}% Hit Rate
          </span>
          <span className={cn('font-sans text-[12px] opacity-70', albireoTone.text)}>
            Saved {(savings.total_cache_read || 0).toLocaleString()} tokens
          </span>
        </div>
        <div className={cn('grid h-8 w-8 place-items-center rounded-full transition-transform group-hover:translate-x-1', albireoTone.text)}>
          <Activity size={18} />
        </div>
      </button>

      {/* Push Notifications */}
      <div className={cn('flex items-center justify-between rounded-2xl border p-5', albireoTone.surface, albireoTone.hairline)}>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Bell size={16} className={cn(albireoTone.muted)} />
            <span className={cn('font-mono text-[11px] uppercase tracking-wider', albireoTone.muted)}>Push Notifications</span>
          </div>
          <span className={cn('font-sans text-[12px] opacity-70', albireoTone.text)}>
            {settings.pushStatus === 'subscribed'
              ? 'Subscribed for background awakening alerts'
              : settings.pushStatus === 'denied'
                ? 'Notifications are blocked in browser settings'
                : settings.pushStatus === 'unsupported'
                  ? 'Push notifications are unavailable in this browser'
                  : 'Tap Test Push to subscribe this device'}
          </span>
        </div>
        <button
          type="button"
          disabled={pushing}
          onClick={handleTestPush}
          className={cn('rounded-lg px-4 py-2 font-sans text-[13px] font-semibold transition', pushing ? 'opacity-50' : 'hover:bg-black/10 dark:hover:bg-white/20', 'bg-black/5 text-black dark:bg-white/10 dark:text-white')}
        >
          {pushing ? 'Testing...' : 'Test Push'}
        </button>
      </div>
      {/* Tailscale Placeholder */}
      <div className={cn('flex items-center justify-between rounded-2xl border p-5', albireoTone.surface, albireoTone.hairline)}>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Server size={16} className={cn(albireoTone.muted)} />
            <span className={cn('font-mono text-[11px] uppercase tracking-wider', albireoTone.muted)}>Tailscale Network</span>
          </div>
          <span className={cn('font-sans text-[12px] opacity-70', albireoTone.text)}>Node status monitoring</span>
        </div>
        <span className={cn('font-mono text-[11px] italic', albireoTone.muted)}>Coming Soon</span>
      </div>

      {/* Awakening Logs Terminal / Hub Placeholder */}
      <div className={cn('flex flex-col gap-3 rounded-2xl border bg-[#111] p-5 text-gray-300 dark:bg-black', albireoTone.hairline)}>
        <div className="flex items-center justify-between border-b border-gray-800 pb-3">
          <div className="flex items-center gap-2">
            <Terminal size={14} className="text-gray-500" />
            <span className="font-mono text-[11px] uppercase tracking-wider text-gray-500">System Event Stream (Hub)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
            <span className="font-mono text-[10px] text-green-500">Live</span>
          </div>
        </div>
        <div className="flex max-h-[200px] flex-col gap-2 overflow-y-auto font-mono text-[11px] leading-relaxed">
          {!awakeningLog || awakeningLog.length === 0 ? (
            <span className="text-gray-600">No recent events found.</span>
          ) : (
            awakeningLog.map((log, i) => {
              const time = new Date(log.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              const level = log.aborted ? 'ABORT' : (log.action ? log.action.toUpperCase() : 'INFO');
              
              // Simplify the message to just show the action type/status
              const simpleMessage = log.aborted 
                ? `Aborted: ${log.abort_reason}` 
                : log.action === 'diary' ? 'Generated new diary entry'
                : log.action === 'push' ? 'Sent background notification'
                : `Executed action: ${log.action}`;
              
              return (
                <div key={i} className="flex gap-3">
                  <span className="shrink-0 text-gray-600">[{time}]</span>
                  <span className={cn('w-12 shrink-0 font-semibold', log.aborted ? 'text-red-500' : 'text-blue-500')}>{level}</span>
                  <span className="whitespace-pre-wrap">{simpleMessage}</span>
                </div>
              );
            })
          )}
        </div>
        <div className="mt-3 flex justify-center border-t border-gray-800 pt-3">
          <button 
            type="button"
            disabled={triggering}
            onClick={handleTrigger}
            className={cn("flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 font-mono text-[11px] transition hover:bg-white/20", triggering ? 'opacity-50' : '')}
          >
            {triggering ? <Activity size={12} className="animate-spin" /> : <Play size={12} />}
            {triggering ? 'Triggering...' : 'Force Awakening'}
          </button>
        </div>
      </div>
    </div>
  );
}
