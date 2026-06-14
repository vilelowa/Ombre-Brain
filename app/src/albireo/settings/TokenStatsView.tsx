import { cn } from '../../lib/utils';
import { albireoTone } from '../shared/albireoTokens';
import type { useSettingsController } from './useSettingsController';
import { Zap, Coins, TrendingDown, Clock } from 'lucide-react';

export default function TokenStatsView({ settings }: { settings: ReturnType<typeof useSettingsController> }) {
  const { savingsStats, usageStats } = settings;

  const savings = savingsStats?.data || {};
  const usage = usageStats?.data || [];

  // Group usage by date
  const byDate: Record<string, number> = {};
  let maxTokens = 0;
  
  if (Array.isArray(usage)) {
    for (const row of usage) {
      const total = row.input_tokens + row.output_tokens + row.cache_creation_tokens;
      byDate[row.date] = (byDate[row.date] || 0) + total;
      if (byDate[row.date] > maxTokens) {
        maxTokens = byDate[row.date];
      }
    }
  }

  const sortedDates = Object.keys(byDate).sort();

  return (
    <div className="mx-auto flex max-w-[600px] flex-col gap-6 pt-4 animate-in fade-in slide-in-from-right-4 duration-300">
      
      {/* Overview Cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className={cn('flex flex-col gap-2 rounded-2xl border p-4', albireoTone.surface, albireoTone.hairline)}>
          <div className="flex items-center gap-2">
            <Coins size={16} className={cn(albireoTone.muted)} />
            <span className={cn('font-mono text-[11px] uppercase tracking-wider', albireoTone.muted)}>Billed Input</span>
          </div>
          <span className={cn('font-sans text-[20px] font-semibold', albireoTone.text)}>
            {(savings.total_input_billed || 0).toLocaleString()}
          </span>
        </div>

        <div className={cn('flex flex-col gap-2 rounded-2xl border p-4', albireoTone.surface, albireoTone.hairline)}>
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-yellow-500" />
            <span className={cn('font-mono text-[11px] uppercase tracking-wider', albireoTone.muted)}>Cache Hits</span>
          </div>
          <span className={cn('font-sans text-[20px] font-semibold text-yellow-600 dark:text-yellow-500')}>
            {(savings.total_cache_read || 0).toLocaleString()}
          </span>
        </div>
      </div>

      <div className={cn('flex flex-col gap-4 rounded-2xl border p-5', albireoTone.surface, albireoTone.hairline)}>
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h4 className={cn('font-mono text-[11px] uppercase tracking-wider', albireoTone.muted)}>Cache Hit Rate</h4>
            <span className={cn('font-sans text-[28px] font-bold', albireoTone.text)}>
              {savings.cache_hit_rate_pct || 0}%
            </span>
          </div>
          <div className="grid h-12 w-12 place-items-center rounded-full bg-green-500/10 text-green-500">
            <TrendingDown size={24} />
          </div>
        </div>
        <p className={cn('font-sans text-[13px] leading-relaxed', albireoTone.muted)}>
          Context Caching has saved you from processing <strong className={albireoTone.text}>{(savings.total_cache_read || 0).toLocaleString()}</strong> tokens over the last {savings.period_days || 30} days.
        </p>
      </div>

      {/* Daily Usage Chart (Simplified) */}
      <div className={cn('flex flex-col gap-4 rounded-2xl border p-5', albireoTone.surface, albireoTone.hairline)}>
        <div className="flex items-center gap-2 border-b pb-3" style={{ borderColor: 'inherit' }}>
          <Clock size={16} className={cn(albireoTone.muted)} />
          <span className={cn('font-mono text-[11px] uppercase tracking-wider', albireoTone.muted)}>Daily Usage (Last 7 Days)</span>
        </div>
        
        {sortedDates.length === 0 ? (
          <div className={cn('py-8 text-center font-sans text-[13px]', albireoTone.muted)}>
            No usage data recorded yet.
          </div>
        ) : (
          <div className="flex h-[120px] items-end gap-2 pt-4">
            {sortedDates.map(date => {
              const val = byDate[date];
              const heightPct = maxTokens > 0 ? (val / maxTokens) * 100 : 0;
              const displayDate = date.split('-').slice(1).join('/'); // MM/DD
              return (
                <div key={date} className="group relative flex flex-1 flex-col items-center justify-end gap-2">
                  <div 
                    className="w-full min-w-[8px] max-w-[24px] rounded-t-md bg-black/20 transition-all hover:bg-black/40 dark:bg-white/20 dark:hover:bg-white/40"
                    style={{ height: `${Math.max(heightPct, 4)}%` }}
                  >
                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-black px-2 py-1 font-mono text-[10px] text-white opacity-0 transition group-hover:opacity-100 dark:bg-white dark:text-black">
                      {val.toLocaleString()}
                    </div>
                  </div>
                  <span className={cn('font-mono text-[9px]', albireoTone.muted)}>{displayDate}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
