import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Dream } from '../types';
import { cn } from '../lib/utils';

export default function Dreams() {
  const [dreams, setDreams] = useState<Dream[]>([]);
  const [filter, setFilter] = useState<'all' | 'tone' | 'attention' | 'unresolved'>('all');

  useEffect(() => {
    api.getDreams().then(setDreams);
  }, []);

  const filteredDreams = dreams.filter(d => filter === 'all' || d.influenceType === filter);

  const formatDate = (dateStr: string) => {
    try {
      if (!dateStr) return 'Unknown Date';
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return 'Unknown Date';
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(d);
    } catch (e) {
      return 'Unknown Date';
    }
  };

  return (
    <div className="flex flex-col h-full bg-background relative pt-14 px-4 overflow-y-auto">
      {/* Top Header */}
      <header className="fixed top-0 left-0 right-0 w-full md:max-w-3xl md:mx-auto md:left-auto md:right-auto z-40 bg-background/90 backdrop-blur-sm border-b border-hairline border-dotted flex justify-center items-center px-4 h-14">
        <div className="flex flex-col items-center">
          <h1 className="font-sans text-[18px] font-semibold text-primary tracking-tight">Dreams</h1>
          <span className="font-mono text-[10px] text-muted-gray uppercase tracking-widest mt-0.5">Memory Instrument</span>
        </div>
      </header>

      {/* Filter Bar */}
      <div className="w-full max-w-md mx-auto py-4 mt-2">
        <div className="flex bg-surface-container rounded-[4px] p-1">
          {['all', 'tone', 'attention', 'unresolved'].map(f => (
            <button
               key={f}
               onClick={() => setFilter(f as any)}
               className={cn(
                 "flex-1 text-center py-1.5 px-3 rounded-[4px] font-mono text-[12px] capitalize transition-all duration-200",
                 filter === f 
                  ? "bg-surface shadow-sm text-primary" 
                  : "text-muted-gray hover:text-charcoal"
               )}
            >
               {f}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <main className="flex-1 w-full max-w-md mx-auto py-6 flex flex-col gap-6 relative pb-12">
         {/* Desktop Timeline Line */}
         <div className="absolute left-[18px] top-6 bottom-0 w-px bg-border-hairline border-r border-dotted hidden md:block"></div>
         
         {filteredDreams.map(dream => (
           <article key={dream.id} className="flex flex-col gap-3 group relative pl-0 md:pl-10">
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-[2px] font-mono text-[10px] uppercase tracking-wider border",
                    dream.influenceType === 'attention' && "bg-primary/5 text-primary border-primary/20",
                    dream.influenceType === 'tone' && "bg-secondary/5 text-secondary border-secondary/20",
                    dream.influenceType === 'unresolved' && "bg-unresolved-violet/5 text-unresolved-violet border-unresolved-violet/20",
                  )}>
                    {dream.influenceType}
                  </span>
                  <span className="font-mono text-[12px] text-muted-gray">
                     {formatDate(dream.createdAt)}
                  </span>
                </div>
              </div>

              <div className={cn(
                "pl-3 border-l-[3px] py-1 transition-opacity",
                dream.influenceType === 'attention' && "border-primary/40",
                dream.influenceType === 'tone' && "border-secondary/40",
                dream.influenceType === 'unresolved' && "border-unresolved-violet/40",
              )}>
                 <p className={cn(
                    "font-sans text-[16px] leading-[24px] text-charcoal",
                    dream.influenceType === 'unresolved' && "italic opacity-80"
                 )}>
                    {dream.text}
                 </p>
              </div>
              
              <hr className="border-t border-hairline border-dotted mt-2 group-last:hidden" />
           </article>
         ))}

         <div className="flex justify-center py-8">
            <div className="w-2 h-2 rounded-full bg-border-hairline"></div>
         </div>
      </main>
    </div>
  );
}
