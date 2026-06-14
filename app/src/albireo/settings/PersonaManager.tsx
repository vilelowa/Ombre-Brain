import { useState } from 'react';
import { Plus, Trash2, Sparkles, Moon, Flame, Feather, Star, Cpu, User, AlignLeft, Settings } from 'lucide-react';
import { cn } from '../../lib/utils';
import { albireoTone } from '../shared/albireoTokens';
import type { useSettingsController } from './useSettingsController';
import type { PersonaProfile } from '../../types';

const ICONS: Record<string, React.FC<any>> = { Moon, Sparkles, Flame, Feather, Star };

export default function PersonaManager({ settings }: { settings: ReturnType<typeof useSettingsController> }) {
  const [editingProfile, setEditingProfile] = useState<Partial<PersonaProfile> | null>(null);
  const [profileToDelete, setProfileToDelete] = useState<PersonaProfile | null>(null);

  if (editingProfile) {
    return (
      <PersonaEditor 
        profile={editingProfile} 
        onClose={() => setEditingProfile(null)} 
        onSave={async (p) => {
          await settings.saveProfile(p);
          setEditingProfile(null);
        }} 
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-[600px] flex-col gap-6 pt-4">
      <div className="flex items-center justify-between px-2">
        <h3 className={cn('text-[13px] font-semibold uppercase tracking-wider', albireoTone.muted)}>Profiles</h3>
        <button
          type="button"
          onClick={() => setEditingProfile({ name: 'New Profile', icon: 'Sparkles', model: 'google/gemini-2.5-flash-lite', base_prompt: '', chat_history_limit: 14, compaction_strategy: 'summarize' })}
          className={cn('flex items-center gap-1 text-[13px] font-medium transition hover:text-black dark:hover:text-white', albireoTone.text)}
        >
          <Plus size={14} /> New
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {settings.profiles.map(p => {
          const Icon = ICONS[p.icon] || Sparkles;
          return (
            <div 
              key={p.id} 
              onClick={() => setEditingProfile(p)} 
              className={cn('group flex cursor-pointer items-center justify-between rounded-2xl border p-4 transition-colors hover:bg-black/5 dark:hover:bg-white/5', albireoTone.surface, albireoTone.hairline)}
            >
              <div className="flex items-center gap-4">
                <div className={cn('grid h-10 w-10 place-items-center rounded-full bg-black/5 dark:bg-white/10', albireoTone.text)}>
                  <Icon size={20} />
                </div>
                <div className="flex flex-col">
                  <span className={cn('font-sans text-[16px] font-semibold', albireoTone.text)}>{p.name}</span>
                  <span className={cn('font-mono text-[11px] mt-0.5 opacity-60', albireoTone.text)}>{p.model}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setProfileToDelete(p as PersonaProfile);
                  }}
                  className="grid h-8 w-8 place-items-center rounded-full text-red-500 opacity-0 transition hover:bg-red-500/10 group-hover:opacity-100"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {profileToDelete && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 backdrop-blur-sm px-4 animate-in fade-in duration-200">
          <div className={cn('flex w-full max-w-[320px] flex-col gap-6 rounded-[24px] border p-6 shadow-2xl animate-in zoom-in-95 duration-200', albireoTone.surface, albireoTone.hairline)}>
            <div className="flex flex-col gap-2">
              <h3 className={cn('font-sans text-[18px] font-semibold', albireoTone.text)}>Delete Persona?</h3>
              <p className={cn('font-sans text-[14px] leading-relaxed', albireoTone.muted)}>
                Are you sure you want to delete <strong className={albireoTone.text}>{profileToDelete.name}</strong>? This cannot be undone.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setProfileToDelete(null)}
                className={cn('flex-1 rounded-xl bg-black/5 dark:bg-white/10 px-4 py-3 font-sans text-[15px] font-semibold transition hover:bg-black/10 dark:hover:bg-white/20', albireoTone.text)}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  settings.deleteProfile(profileToDelete.id!);
                  setProfileToDelete(null);
                }}
                className="flex-1 rounded-xl bg-red-500 px-4 py-3 font-sans text-[15px] font-semibold text-white transition hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PersonaEditor({ profile, onClose, onSave }: { profile: Partial<PersonaProfile>, onClose: () => void, onSave: (p: Partial<PersonaProfile>) => Promise<void> }) {
  const [draft, setDraft] = useState(profile);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(draft);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-[600px] animate-in fade-in slide-in-from-right-4 duration-300 flex-col gap-6 pt-2">
      <div className="flex items-center justify-between px-2">
        <h3 className={cn('text-[15px] font-semibold', albireoTone.text)}>
          {draft.id ? 'Edit Persona' : 'New Persona'}
        </h3>
        <button type="button" onClick={onClose} className={cn('text-[13px] font-medium hover:underline', albireoTone.muted)}>
          Cancel
        </button>
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label className={cn('px-2 font-mono text-[10px] uppercase tracking-wider', albireoTone.muted)}>Name</label>
          <div className="relative">
            <User size={16} className={cn('absolute left-3 top-1/2 -translate-y-1/2 opacity-40', albireoTone.text)} />
            <input 
              value={draft.name || ''} 
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              className={cn('w-full rounded-xl border bg-transparent py-3 pl-10 pr-4 font-sans text-[15px] outline-none transition focus:border-black dark:focus:border-white', albireoTone.hairline, albireoTone.text)}
              placeholder="Persona name"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className={cn('px-2 font-mono text-[10px] uppercase tracking-wider', albireoTone.muted)}>Icon</label>
          <div className="flex gap-2 px-2">
            {Object.keys(ICONS).map(iconName => {
              const Icon = ICONS[iconName];
              const isSelected = draft.icon === iconName;
              return (
                <button
                  key={iconName}
                  type="button"
                  onClick={() => setDraft({ ...draft, icon: iconName })}
                  className={cn(
                    'grid h-11 w-11 place-items-center rounded-xl border transition',
                    isSelected ? 'border-black bg-black/5 text-black dark:border-white dark:bg-white/10 dark:text-white' : cn('border-transparent', albireoTone.muted, 'hover:bg-black/5 dark:hover:bg-white/5')
                  )}
                >
                  <Icon size={20} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className={cn('px-2 font-mono text-[10px] uppercase tracking-wider', albireoTone.muted)}>Model</label>
          <div className="relative">
            <Cpu size={16} className={cn('absolute left-3 top-1/2 -translate-y-1/2 opacity-40', albireoTone.text)} />
            <input 
              value={draft.model || ''} 
              onChange={e => setDraft({ ...draft, model: e.target.value })}
              className={cn('w-full rounded-xl border bg-transparent py-3 pl-10 pr-4 font-mono text-[13px] outline-none transition focus:border-black dark:focus:border-white', albireoTone.hairline, albireoTone.text)}
              placeholder="e.g. google/gemini-2.5-flash"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className={cn('px-2 font-mono text-[10px] uppercase tracking-wider', albireoTone.muted)}>Base Prompt</label>
          <div className="relative">
            <AlignLeft size={16} className={cn('absolute left-3 top-3 opacity-40', albireoTone.text)} />
            <textarea 
              value={draft.base_prompt || ''} 
              onChange={e => setDraft({ ...draft, base_prompt: e.target.value })}
              className={cn('min-h-[160px] w-full resize-none rounded-xl border bg-transparent py-3 pl-10 pr-4 font-mono text-[12px] leading-relaxed outline-none transition focus:border-black dark:focus:border-white', albireoTone.hairline, albireoTone.text)}
              placeholder="System prompt..."
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-2">
            <label className={cn('font-mono text-[10px] uppercase tracking-wider', albireoTone.muted)}>History Limit</label>
            <span className={cn('font-mono text-[12px]', albireoTone.text)}>{draft.chat_history_limit} msgs</span>
          </div>
          <input 
            type="range" min="4" max="40" step="1"
            value={draft.chat_history_limit || 14}
            onChange={e => setDraft({ ...draft, chat_history_limit: parseInt(e.target.value) })}
            className="w-full cursor-pointer px-2"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className={cn('px-2 font-mono text-[10px] uppercase tracking-wider', albireoTone.muted)}>Compaction Strategy</label>
          <div className="relative">
            <Settings size={16} className={cn('absolute left-3 top-1/2 -translate-y-1/2 opacity-40', albireoTone.text)} />
            <select 
              value={draft.compaction_strategy || 'summarize'}
              onChange={e => setDraft({ ...draft, compaction_strategy: e.target.value as any })}
              className={cn('w-full appearance-none rounded-xl border bg-transparent py-3 pl-10 pr-4 font-sans text-[14px] outline-none transition focus:border-black dark:focus:border-white', albireoTone.hairline, albireoTone.text)}
            >
              <option value="summarize">Summarize & Extract</option>
              <option value="hybrid">Hybrid</option>
              <option value="truncate">Truncate</option>
            </select>
          </div>
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className={cn('mt-4 w-full rounded-xl py-3.5 font-sans text-[15px] font-semibold transition', saving ? 'opacity-50' : 'hover:scale-[0.98] active:scale-95', 'bg-black text-white dark:bg-white dark:text-black')}
        >
          {saving ? 'Saving...' : 'Save Persona'}
        </button>
      </div>
    </div>
  );
}
