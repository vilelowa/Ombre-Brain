import { Copy, Moon, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { albireoTone } from '../shared/albireoTokens';
import { pulseHaptic } from '../shared/haptics';
import { cn } from '../../lib/utils';
import type { Message } from '../../types';
import SplitMessage from './SplitMessage';
import ThinkingBlock from './ThinkingBlock';

interface ChatMessageTurnProps {
  message: Message;
  splitEnabled: boolean;
  onFlagDream?: (message: Message) => void;
  onUnflagDream?: (message: Message) => void;
  onRegenerate?: () => void;
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function ChatMessageTurn({ message, onFlagDream, onUnflagDream, onRegenerate, splitEnabled }: ChatMessageTurnProps) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const isUser = message.role === 'user';

  return (
    <article
      className={cn('group flex w-full flex-col gap-2', isUser ? 'items-end' : 'items-start')}
      onClick={() => {
        setActionsOpen((value) => !value);
        pulseHaptic('selection');
      }}
    >
      {!isUser && message.reasoning && (
        <ThinkingBlock reasoning={message.reasoning} seconds={5} />
      )}

      {isUser ? (
        <div className={cn('max-w-[310px] rounded-[22px] px-4 py-3 font-sans text-[16px] leading-relaxed shadow-sm', albireoTone.surface, albireoTone.text)}>
          <p className="whitespace-pre-wrap">{message.content}</p>
          {message.attachments?.map((attachment) => (
            <div
              key={attachment}
              className={cn('mt-3 rounded-xl px-3 py-2 text-[12px]', 'bg-[#FCF5E7]/70 dark:bg-black/15')}
            >
              <div className="font-medium">{attachment.replace('/attachments/', '')}</div>
            </div>
          ))}
        </div>
      ) : message.content.trim() ? (
        <SplitMessage content={message.content} splitEnabled={splitEnabled} />
      ) : (
        <div className={cn('h-1 w-1 rounded-full opacity-40', albireoTone.surface)} />
      )}

      <div className={cn('flex min-h-5 items-center gap-2 text-[11px]', albireoTone.muted)}>
        <span>{formatMessageTime(message.createdAt)}</span>
        {message.dreamFlagged && <span>flagged</span>}
      </div>

      {actionsOpen && (
        <div
          className={cn('flex items-center gap-1 text-[13px]', albireoTone.muted)}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" className="grid min-h-8 min-w-8 place-items-center rounded-full hover:bg-black/5 dark:hover:bg-white/5">
            <Copy size={14} />
          </button>
          <button
            type="button"
            onClick={() => message.dreamFlagged ? onUnflagDream?.(message) : onFlagDream?.(message)}
            disabled={!message.content.trim()}
            className={cn("grid min-h-8 min-w-8 place-items-center rounded-full hover:bg-black/5 disabled:opacity-45 dark:hover:bg-white/5", message.dreamFlagged && "text-amber-500/80")}
          >
            <Moon size={14} fill={message.dreamFlagged ? 'currentColor' : 'none'} />
          </button>
          {!isUser && (
            <button type="button" className="grid min-h-8 min-w-8 place-items-center rounded-full hover:bg-black/5 dark:hover:bg-white/5">
              <RefreshCw size={14} />
            </button>
          )}
        </div>
      )}
    </article>
  );
}
