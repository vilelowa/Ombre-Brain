import { Brain } from 'lucide-react';
import { useState } from 'react';
import { albireoTone } from '../shared/albireoTokens';
import { cn } from '../../lib/utils';

interface ThinkingBlockProps {
  reasoning: string;
  seconds?: number;
  defaultOpen?: boolean;
}

export default function ThinkingBlock({ reasoning, seconds = 7, defaultOpen = false }: ThinkingBlockProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <button
      type="button"
      onClick={() => setOpen((value) => !value)}
      className={cn('max-w-[320px] text-left text-[13px] leading-relaxed', albireoTone.muted)}
    >
      <span className="inline-flex min-h-8 items-center gap-1.5">
        <Brain size={14} strokeWidth={1.6} />
        <span>Thought for {seconds}s</span>
        <span className="text-[11px]">{open ? '↑' : '↓'}</span>
      </span>
      {open && (
        <span className="block pb-1 pl-0.5 pr-3 text-[13px] leading-[1.55] opacity-80">
          {reasoning}
        </span>
      )}
    </button>
  );
}
