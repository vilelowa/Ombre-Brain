import React, { useState } from 'react';
import { api } from '../lib/api';
import { Check, Hourglass, Settings2 } from 'lucide-react';
import { cn } from '../lib/utils';

export default function Awake() {
  const [pushStatus, setPushStatus] = useState('Subscribed');

  const handleTestSignal = async () => {
    setPushStatus('Testing...');
    await api.testPush();
    setPushStatus('Subscribed');
  };

  return (
    <div className="flex flex-col h-full bg-background relative pt-14 px-4 overflow-y-auto">
      <header className="fixed top-0 left-0 right-0 w-full md:max-w-3xl md:mx-auto md:left-auto md:right-auto z-40 bg-background/90 backdrop-blur-sm border-b border-hairline flex flex-col justify-center px-4 h-14">
        <div className="flex items-center justify-center">
            <h1 className="font-sans text-[18px] font-semibold text-primary tracking-tight">Elroy</h1>
        </div>
      </header>

      <main className="flex-1 w-full max-w-lg mx-auto py-6 flex flex-col gap-10 pb-12">
        {/* Top Status */}
        <div className="w-full flex justify-between items-center border-b border-hairline pb-2">
          <span className="font-mono text-[12px] text-muted-gray uppercase tracking-wider">System Status</span>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary-container"></div>
            <span className="font-mono text-[12px] text-primary font-medium tracking-wide">Awake</span>
          </div>
        </div>

        {/* Section 1 */}
        <section className="flex flex-col gap-4">
          <h2 className="font-sans text-[18px] font-semibold text-on-surface">Today's Anchors</h2>
          <div className="flex flex-col border border-hairline rounded-[4px] overflow-hidden bg-surface-container-lowest shadow-sm">
            
            <div className="flex items-center justify-between p-3 border-b border-hairline">
              <span className="font-mono text-[12px] text-muted-gray w-16">08:00</span>
              <span className="font-sans text-[14px] text-charcoal flex-grow">Morning Sync</span>
              <Check size={16} className="text-muted-gray" />
            </div>

            <div className="flex items-center justify-between p-3 border-b border-hairline relative">
              <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-primary"></div>
              <span className="font-mono text-[12px] text-primary w-16 font-medium">12:00</span>
              <span className="font-sans text-[14px] text-charcoal flex-grow">Midday Check-in</span>
              <Hourglass size={16} className="text-primary" />
            </div>

            <div className="flex items-center justify-between p-3 border-b border-hairline bg-surface-container-lowest/60">
              <span className="font-mono text-[12px] text-muted-gray w-16">19:00</span>
              <span className="font-sans text-[14px] text-charcoal flex-grow">Evening Reflection</span>
            </div>

            <div className="flex items-center justify-between p-3 bg-surface-container-lowest/60">
              <span className="font-mono text-[12px] text-muted-gray w-16">22:00</span>
              <span className="font-sans text-[14px] text-charcoal flex-grow">Sleep Initiation</span>
            </div>
          </div>
        </section>

        {/* Section 2 */}
        <section className="flex flex-col gap-4">
          <h2 className="font-sans text-[18px] font-semibold text-on-surface">System Windows</h2>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-end border-b border-hairline pb-2">
              <span className="font-sans text-[14px] text-muted-gray">Next Wake</span>
              <span className="font-mono text-[12px] text-charcoal">07:30</span>
            </div>
            <div className="flex justify-between items-end border-b border-hairline pb-2">
              <span className="font-sans text-[14px] text-muted-gray">Sleep Window</span>
              <span className="font-mono text-[12px] text-charcoal">22:30 - 06:30</span>
            </div>
            <div className="flex justify-between items-end border-b border-hairline pb-2">
              <span className="font-sans text-[14px] text-muted-gray">Current Uptime</span>
              <span className="font-mono text-[12px] text-charcoal">4h 12m</span>
            </div>
          </div>
          <div className="flex justify-start mt-2">
            <button className="font-mono text-[10px] text-charcoal border border-hairline px-3 py-1.5 rounded-[4px] hover:bg-surface-container transition-colors uppercase flex items-center gap-1.5">
              <Settings2 size={12} /> Adjust Cycle
            </button>
          </div>
        </section>

        {/* Section 3 */}
        <section className="flex flex-col gap-4">
          <h2 className="font-sans text-[18px] font-semibold text-on-surface">Diagnostics</h2>
          <div className="p-4 border border-hairline bg-surface-container-lowest rounded-[4px] flex flex-col gap-4 shadow-sm">
            <div className="flex justify-between items-center">
               <span className="font-mono text-[10px] text-muted-gray uppercase tracking-wider">Push Notifications</span>
               <span className={cn("font-mono text-[10px]", pushStatus === 'Testing...' ? 'text-unresolved-violet animate-pulse' : 'text-primary')}>
                  {pushStatus}
               </span>
            </div>
            <div className="flex justify-between items-center">
               <span className="font-mono text-[10px] text-muted-gray uppercase tracking-wider">Last Sync</span>
               <span className="font-mono text-[10px] text-charcoal">10 min ago</span>
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
    </div>
  );
}
