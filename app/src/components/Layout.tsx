import React from 'react';
import { MessageSquare, Sparkles, Sun, Settings } from 'lucide-react';
import { cn } from '../lib/utils';

interface LayoutProps {
  children: React.ReactNode;
  activeTab: 'chat' | 'dreams' | 'awake' | 'settings';
  setActiveTab: (tab: 'chat' | 'dreams' | 'awake' | 'settings') => void;
}

export default function Layout({ children, activeTab, setActiveTab }: LayoutProps) {
  const navItems = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'dreams', label: 'Dreams', icon: Sparkles },
    { id: 'awake', label: 'Awake', icon: Sun },
    { id: 'settings', label: 'Settings', icon: Settings },
  ] as const;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-charcoal font-sans antialiased selection:bg-primary-fixed selection:text-on-primary-fixed relative">
      
      {/* Main Content Area */}
      <main className="flex-1 w-full max-w-3xl mx-auto flex flex-col relative pb-16 md:pb-0 md:pl-24">
        {children}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 w-full z-50 flex justify-around items-center h-16 px-4 bg-surface-container-lowest border-t border-hairline transition-colors">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "flex flex-col items-center justify-center flex-1 h-full pt-1 transition-all duration-200 active:scale-95",
                isActive 
                  ? "text-primary border-t-2 border-primary -mt-[2px]" 
                  : "text-muted-gray hover:text-on-surface-variant"
              )}
            >
              <Icon size={20} className="mb-1" strokeWidth={isActive ? 2.5 : 2} />
              <span className={cn("font-mono text-[10px] tracking-wide", isActive && "font-semibold")}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Desktop Left Rail */}
      <nav className="hidden md:flex fixed left-4 top-1/2 -translate-y-1/2 w-20 py-8 flex-col items-center gap-8 bg-surface-container-lowest border border-hairline border-dotted rounded-xl shadow-sm z-50">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "flex flex-col items-center justify-center w-full relative group transition-colors",
                isActive ? "text-primary" : "text-muted-gray hover:text-primary"
              )}
            >
              {isActive && (
                <div className="absolute -left-4 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-r"></div>
              )}
              <Icon size={24} className="group-hover:scale-110 transition-transform" strokeWidth={isActive ? 2.5 : 2} />
              <span className="font-mono text-[10px] mt-2 opacity-0 group-hover:opacity-100 transition-opacity absolute top-full">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
