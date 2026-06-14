import { X, ChevronRight, User, Settings, ShieldAlert, Cpu } from 'lucide-react';
import { cn } from '../../lib/utils';
import { albireoTone } from '../shared/albireoTokens';
import type { useSettingsController } from './useSettingsController';
import PersonaManager from './PersonaManager';
import CoreConfigEditor from './CoreConfigEditor';
import SystemDiagnostics from './SystemDiagnostics';
import TokenStatsView from './TokenStatsView';
import { useEffect, useState, useRef } from 'react';

export default function MeridianScreen({
  settings,
  onClose,
}: {
  settings: ReturnType<typeof useSettingsController>;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [renderOpen, setRenderOpen] = useState(false);
  const [activeView, setActiveView] = useState<'main' | 'personas' | 'config' | 'diagnostics' | 'token_stats'>('main');
  const [dragY, setDragY] = useState(0);
  const touchStartY = useRef(0);

  useEffect(() => {
    if (settings.isOpen) {
      setMounted(true);
      setActiveView('main');
      // Small delay to ensure the DOM is ready for transition
      const timer = setTimeout(() => setRenderOpen(true), 10);
      return () => clearTimeout(timer);
    } else {
      setRenderOpen(false);
      const timer = setTimeout(() => setMounted(false), 300);
      return () => clearTimeout(timer);
    }
  }, [settings.isOpen]);

  if (!mounted) return null;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const delta = e.touches[0].clientY - touchStartY.current;
    if (delta > 0) { // Only allow dragging downwards
      setDragY(delta);
    }
  };

  const handleTouchEnd = () => {
    if (dragY > 80) {
      onClose(); // Trigger close if dragged down enough
    }
    setDragY(0);
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col justify-end">
      {/* Backdrop */}
      <div 
        className={cn('absolute inset-0 transition-opacity duration-300', renderOpen ? 'bg-black/40 opacity-100' : 'bg-transparent opacity-0')} 
        onClick={onClose}
      />
      
      {/* Modal */}
      <div 
        className={cn(
          'relative flex mt-6 h-[calc(100dvh-24px)] w-full flex-col overflow-hidden rounded-t-[32px] shadow-2xl cubic-bezier(0.32, 0.72, 0, 1)',
          albireoTone.bg,
          renderOpen && dragY === 0 ? 'translate-y-0 transition-transform duration-300' : '',
          !renderOpen ? 'translate-y-full transition-transform duration-300' : ''
        )}
        style={{ transform: dragY > 0 ? `translateY(${dragY}px)` : undefined }}
      >
        {/* Header (Drag Handle) */}
        <div 
          className="flex shrink-0 flex-col items-center px-6 pb-4 pt-3"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Drag pill */}
          <div className="mb-3 h-1 w-10 rounded-full bg-black/10 dark:bg-white/10" />
          
          <div className="flex w-full items-center justify-between">
            <div className="w-8">
              {activeView !== 'main' && (
                <button 
                  type="button" 
                  onClick={() => {
                    if (activeView === 'token_stats') {
                      setActiveView('diagnostics');
                    } else {
                      setActiveView('main');
                    }
                  }}
                  className={cn('grid h-8 w-8 place-items-center rounded-full bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20 transition', albireoTone.text)}
                >
                  <ChevronRight size={18} className="rotate-180" />
                </button>
              )}
            </div>
            <h2 className={cn('font-sans text-[17px] font-semibold', albireoTone.text)}>
              {activeView === 'main' && 'Settings'}
              {activeView === 'personas' && 'Persona Profiles'}
              {activeView === 'config' && 'Background APIs'}
              {activeView === 'diagnostics' && 'System Diagnostics'}
              {activeView === 'token_stats' && 'Token Stats'}
            </h2>
            <button 
              type="button" 
              onClick={onClose}
              className={cn('grid h-8 w-8 place-items-center rounded-full bg-black/5 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20 transition', albireoTone.text)}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 pb-20">
          {activeView === 'main' && (
            <div className="mx-auto max-w-[600px] flex flex-col gap-8 pt-6">
              
              {/* System & Customization */}
              <div>
                <h3 className={cn('mb-3 px-4 font-sans text-[15px] font-semibold', albireoTone.text)}>System & Customization</h3>
                <div className={cn('overflow-hidden rounded-2xl', albireoTone.surface)}>
                  <FormRow 
                    icon={<User size={20} />} 
                    label="Persona Profiles" 
                    onClick={() => setActiveView('personas')} 
                  />
                  <FormDivider />
                  <FormRow 
                    icon={<Settings size={20} />} 
                    label="Background APIs" 
                    onClick={() => setActiveView('config')} 
                  />
                  <FormDivider />
                  <FormRow 
                    icon={<Cpu size={20} />} 
                    label="System Diagnostics" 
                    onClick={() => setActiveView('diagnostics')} 
                  />
                </div>
              </div>

              {/* Account */}
              <div>
                <h3 className={cn('mb-3 px-4 font-sans text-[15px] font-semibold', albireoTone.text)}>Account</h3>
                <div className={cn('overflow-hidden rounded-2xl', albireoTone.surface)}>
                  <FormRow 
                    icon={<ShieldAlert size={20} />} 
                    label="Change Password" 
                    onClick={() => alert('Change password placeholder')} 
                  />
                </div>
              </div>
            </div>
          )}

          {activeView === 'personas' && (
            <PersonaManager settings={settings} />
          )}

          {activeView === 'config' && (
            <CoreConfigEditor settings={settings} />
          )}

          {activeView === 'diagnostics' && (
            <SystemDiagnostics settings={settings} onNavigate={setActiveView} />
          )}

          {activeView === 'token_stats' && (
            <TokenStatsView settings={settings} />
          )}
        </div>
      </div>
    </div>
  );
}

function FormRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button 
      type="button" 
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-4 px-4 py-4 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5',
        albireoTone.text
      )}
    >
      <div className={cn(albireoTone.muted)}>{icon}</div>
      <span className="flex-1 font-sans text-[16px] font-medium">{label}</span>
      <ChevronRight size={18} className={cn('opacity-40 transition-opacity group-hover:opacity-100', albireoTone.text)} />
    </button>
  );
}

function FormDivider() {
  return <div className={cn('ml-14 mr-4 h-[1px]', albireoTone.hairline)} />;
}
