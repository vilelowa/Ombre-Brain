import { X } from 'lucide-react';
import { albireoTone } from '../shared/albireoTokens';
import { cn } from '../../lib/utils';
import type { PersonaProfile } from '../../types';

interface QuickEditDirectiveProps {
  persona: PersonaProfile;
  prompt: string;
  saving?: boolean;
  onClose: () => void;
  onPromptChange: (prompt: string) => void;
  onSave: () => void;
}

export default function QuickEditDirective({
  onClose,
  onPromptChange,
  onSave,
  persona,
  prompt,
  saving,
}: QuickEditDirectiveProps) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center px-5">
      <button
        type="button"
        className={cn('absolute inset-0', albireoTone.dim)}
        aria-label="Close quick edit"
        onClick={onClose}
      />

      <div
        className={cn(
          'relative z-10 flex w-full max-w-[520px] flex-col gap-4 rounded-[24px] border p-5 shadow-2xl backdrop-blur-2xl',
          'bg-[#FCF5E7]/86 dark:bg-[#262626]/88',
          albireoTone.hairline,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className={cn('font-serif text-[28px] font-semibold leading-tight', albireoTone.text)}>
              {persona.name}
            </h2>
            <p className={cn('mt-1 text-[13px]', albireoTone.muted)}>Directive surface</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cn('grid min-h-11 min-w-11 place-items-center rounded-full hover:bg-black/5 dark:hover:bg-white/5', albireoTone.text)}
          >
            <X size={18} />
          </button>
        </div>

        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          className={cn(
            'min-h-44 resize-none rounded-2xl border bg-white/36 p-4 text-[14px] leading-relaxed outline-none dark:bg-black/14',
            albireoTone.hairline,
            albireoTone.text,
          )}
        />

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={cn('min-h-11 px-4 text-[14px]', albireoTone.muted)}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="min-h-11 rounded-full bg-[#3C3C43] px-5 text-[14px] font-medium text-[#FCF5E7] dark:bg-[#E5E5E5] dark:text-[#1A1A1A]"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
