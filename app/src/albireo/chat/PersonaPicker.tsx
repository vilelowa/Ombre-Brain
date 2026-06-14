import { Flame, Moon, Sparkles, Star, Feather } from 'lucide-react';
import { albireoTone } from '../shared/albireoTokens';
import { cn } from '../../lib/utils';
import type { PersonaProfile } from '../../types';

const icons = {
  Moon,
  Sparkles,
  Flame,
  Feather,
  Star,
};

interface PersonaPickerProps {
  personas: PersonaProfile[];
  activePersonaId: string;
  onSelect: (id: string) => void;
  onQuickEdit: () => void;
}

export default function PersonaPicker({ personas, activePersonaId, onQuickEdit, onSelect }: PersonaPickerProps) {
  return (
    <div
      className={cn(
        'absolute right-4 top-16 z-40 w-52 rounded-2xl border p-1 shadow-2xl backdrop-blur-2xl',
        'bg-white/48 dark:bg-black/38',
        albireoTone.hairline,
      )}
    >
      {personas.map((persona) => {
        const Icon = icons[persona.icon as keyof typeof icons] || Sparkles;
        const selected = persona.id === activePersonaId;
        return (
          <button
            key={persona.id}
            type="button"
            onClick={() => onSelect(persona.id)}
            className={cn(
              'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left font-serif text-[16px] transition',
              selected ? 'bg-black/5 dark:bg-white/8' : 'hover:bg-black/4 dark:hover:bg-white/5',
              albireoTone.text,
            )}
          >
            <Icon size={17} strokeWidth={1.8} />
            <span>{persona.name}</span>
          </button>
        );
      })}
      <div className={cn('mt-1 border-t pt-1', albireoTone.hairline)}>
        <button
          type="button"
          onClick={onQuickEdit}
          className={cn('min-h-10 w-full rounded-xl px-3 text-left text-[13px] transition hover:bg-black/4 dark:hover:bg-white/5', albireoTone.muted)}
        >
          Quick Edit Directive
        </button>
      </div>
    </div>
  );
}
