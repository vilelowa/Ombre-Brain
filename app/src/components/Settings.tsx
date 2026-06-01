import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Play } from 'lucide-react';
import { api } from '../lib/api';

export default function Settings() {
  const [autoReconnect, setAutoReconnect] = useState(true);
  const [isSystemDiagnosticsOpen, setIsSystemDiagnosticsOpen] = useState(false);

  const systemLogs = [
    { time: '10:42:01', level: 'INIT', color: 'text-primary-fixed-dim', message: 'Core processes\nstabilized.' },
    { time: '10:42:05', level: 'WARN', color: 'text-tertiary-fixed-dim', message: 'Memory fragmentation\napproaching minor\nthreshold.' },
    { time: '10:43:12', level: 'SYNC', color: 'text-primary-fixed-dim', message: 'Connected to upstream\nregistry.' },
    { time: '10:45:00', level: 'EVAL', color: 'text-muted-gray', message: 'Running routine garbage\ncollection...' },
  ];

  return (
    <div className="flex flex-col h-full bg-background relative pt-14 px-4 overflow-y-auto">
      <header className="fixed top-0 left-0 right-0 w-full md:max-w-3xl md:mx-auto md:left-auto md:right-auto z-40 bg-background/90 backdrop-blur-sm border-b border-hairline flex flex-col justify-center px-4 h-14">
        <div className="flex items-center justify-center">
            <h1 className="font-sans text-[18px] font-semibold text-primary tracking-tight">Elroy</h1>
        </div>
      </header>

      <main className="flex-1 w-full max-w-lg mx-auto py-8 flex flex-col gap-10 pb-12">
        
        {/* Core Config */}
        <section className="flex flex-col gap-6">
          <h2 className="font-mono text-[12px] text-muted-gray uppercase tracking-widest border-b border-hairline border-dotted pb-2">Core Config</h2>
          
          <div className="flex flex-col gap-6">
            <div className="flex justify-between items-center">
              <span className="font-sans text-[14px] text-charcoal">Backend URL</span>
              <span className="font-mono text-[12px] bg-surface-container text-primary px-2 py-1 rounded-[4px]">{api.baseUrl}</span>
            </div>

            <div className="flex justify-between items-center">
              <span className="font-sans text-[14px] text-charcoal">Connection Status</span>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary"></div>
                <span className="font-mono text-[12px] text-primary">Connected</span>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <span className="font-sans text-[14px] text-charcoal">Auto-Reconnect</span>
              <button 
                onClick={() => setAutoReconnect(!autoReconnect)}
                className={`w-10 h-5 rounded-full flex items-center px-0.5 transition-colors ${autoReconnect ? 'bg-primary' : 'bg-outline-variant'}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full transition-transform ${autoReconnect ? 'translate-x-5' : 'translate-x-0'}`}></div>
              </button>
            </div>
          </div>
        </section>

        {/* Persona */}
        <section className="flex flex-col gap-6">
          <h2 className="font-mono text-[12px] text-muted-gray uppercase tracking-widest border-b border-hairline border-dotted pb-2">Persona</h2>
          
          <div className="flex flex-col gap-6">
            <div className="flex justify-between items-center">
              <span className="font-sans text-[14px] text-charcoal">Active Profile</span>
              <span className="font-mono text-[12px] bg-surface-container text-charcoal px-2 py-1 rounded-[4px] border border-hairline">Elroy_Base</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-sans text-[14px] text-charcoal">Model Routing</span>
              <span className="font-mono text-[12px] bg-surface-container text-charcoal px-2 py-1 rounded-[4px] border border-hairline">gpt-4o-mini</span>
            </div>
          </div>
        </section>

        {/* Diagnostics */}
        <section className="flex flex-col gap-6">
          <h2 className="font-mono text-[12px] text-muted-gray uppercase tracking-widest border-b border-hairline border-dotted pb-2">Diagnostics</h2>
          
          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-center">
              <span className="font-sans text-[14px] text-charcoal">SW Status</span>
              <span className="font-mono text-[12px] text-muted-gray">Indexing...</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-sans text-[14px] text-charcoal">Local Cache</span>
              <span className="font-mono text-[12px] text-charcoal">24.5 MB</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-sans text-[14px] text-charcoal">Build Version</span>
              <span className="font-mono text-[12px] text-muted-gray">v1.2.4-alpha</span>
            </div>
            
            <button className="mt-4 w-full py-2 border border-secondary text-secondary hover:bg-secondary/5 font-mono text-[12px] rounded-[4px] transition-colors">
               Clear Cache & Restart
            </button>
          </div>
        </section>

        {/* System Diagnostics */}
        <div className="mt-4 pt-6 border-t border-hairline flex flex-col gap-4">
          <button 
            onClick={() => setIsSystemDiagnosticsOpen(!isSystemDiagnosticsOpen)}
            className="flex justify-between items-center w-full group"
          >
            <span className="font-mono text-[12px] text-muted-gray uppercase tracking-widest group-hover:text-charcoal transition-colors">System Diagnostics</span>
            {isSystemDiagnosticsOpen ? (
              <ChevronUp size={16} className="text-muted-gray group-hover:text-charcoal" />
            ) : (
              <ChevronDown size={16} className="text-muted-gray group-hover:text-charcoal" />
            )}
          </button>

          {isSystemDiagnosticsOpen && (
            <div className="bg-inverse-surface rounded-[4px] p-4 flex flex-col gap-4">
              <div className="flex flex-col gap-3 font-mono text-[12px] leading-[18px]">
                {systemLogs.map((log, i) => (
                  <div key={i} className="flex gap-3">
                    <span className="text-muted-gray/70 shrink-0">[{log.time}]</span>
                    <span className={`${log.color} w-10 shrink-0`}>{log.level}</span>
                    <span className="text-inverse-on-surface whitespace-pre-wrap">{log.message}</span>
                  </div>
                ))}
              </div>
              
              <div className="border-t border-outline-variant/30 mt-1 pt-4">
                <button className="w-full flex justify-center items-center gap-2 border border-outline-variant/30 text-inverse-on-surface py-2 rounded-[4px] hover:bg-white/10 active:scale-[0.99] cursor-pointer transition-all font-mono text-[12px] tracking-wider">
                  <Play size={10} className="fill-current text-primary-fixed-dim" /> RUN DIAGNOSTIC
                </button>
              </div>
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
