import { ArrowDown } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useState } from 'react';
import { albireoTone } from '../shared/albireoTokens';
import { cn } from '../../lib/utils';
import ChatMessageTurn from './ChatMessageTurn';
import type { Message, StartupContext } from '../../types';

interface ChatMessageListProps {
  error?: string | null;
  isHistoryLoading?: boolean;
  isSending?: boolean;
  messages: Message[];
  startupContext?: StartupContext | null;
  splitEnabled: boolean;
  onFlagDream?: (message: Message) => void;
  onUnflagDream?: (message: Message) => void;
  onRegenerate?: () => void;
}

function dayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  if (dayKey(value) === dayKey(today.toISOString())) return 'TODAY';
  return date.toLocaleDateString(undefined, { month: 'short', day: '2-digit' }).toUpperCase();
}

export default function ChatMessageList({
  error,
  isHistoryLoading,
  isSending,
  messages,
  onFlagDream,
  onUnflagDream,
  onRegenerate,
  splitEnabled,
  startupContext,
}: ChatMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const isAtBottomRef = useRef(true);

  const updateScrollState = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const isAtBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 180;
    isAtBottomRef.current = isAtBottom;
    setShowScrollBottom(!isAtBottom);
  };

  useEffect(() => {
    if (isAtBottomRef.current) {
      const scroller = scrollRef.current;
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
      }
    }
  }, [error, messages, startupContext]);

  useEffect(() => {
    if (isSending) {
      setTimeout(() => {
        const scroller = scrollRef.current;
        if (scroller) {
          scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
        }
      }, 50);
    }
  }, [isSending]);

  return (
    <div ref={scrollRef} onScroll={updateScrollState} className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-64 pt-24">
      <div className="mx-auto flex w-full max-w-[740px] flex-col gap-6">
        {isHistoryLoading ? (
          <div className="grid min-h-[58dvh] place-items-center px-8 text-center">
            <p className={cn('font-sans text-[18px] font-light opacity-40', albireoTone.text)}>Loading history...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="grid min-h-[58dvh] place-items-center px-8 text-center">
            <p className={cn('max-w-[340px] font-sans text-[18px] font-light leading-relaxed opacity-40', albireoTone.text)}>
              I am here. Even before you drop your first word, I am already looking at you.
            </p>
          </div>
        ) : (
          messages.map((message, index) => {
            const previous = messages[index - 1];
            const needsDivider = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
            return (
              <div key={message.id} className="flex flex-col gap-4">
                {needsDivider && (
                  <div className={cn('flex items-center gap-3 py-1 text-center text-[11px] font-medium tracking-[0.22em]', albireoTone.muted)}>
                    <span className="h-px flex-1 bg-current opacity-20" />
                    <span>{dayLabel(message.createdAt)}</span>
                    <span className="h-px flex-1 bg-current opacity-20" />
                  </div>
                )}
                <ChatMessageTurn
                  message={message}
                  splitEnabled={splitEnabled}
                  onFlagDream={onFlagDream}
                  onUnflagDream={onUnflagDream}
                  onRegenerate={onRegenerate}
                />
              </div>
            );
          })
        )}

        {startupContext && (
          <div className="flex flex-col gap-1">
            {(Object.keys(startupContext) as (keyof StartupContext)[]).map((key) => {
              const status = startupContext[key];
              if (status === 'done') return null;
              return (
                <div
                  key={key}
                  className={cn('font-sans text-[13px] font-medium leading-none', 'bg-gradient-to-r from-[#8A8A8E]/45 to-[#3C3C43]/58 bg-clip-text text-transparent dark:from-[#71717A]/50 dark:to-[#E5E5E5]/60')}
                >
                  Loading {key}...
                </div>
              );
            })}
          </div>
        )}

        {isSending && !startupContext && messages[messages.length - 1]?.role === 'user' && (
          <div className={cn('max-w-[320px] font-sans text-[16px] opacity-45', albireoTone.text)}>Listening...</div>
        )}

        {error && (
          <div className="max-w-[340px] rounded-2xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-[13px] text-red-400">
            {error}
          </div>
        )}

        <div ref={endRef} />
      </div>
      {showScrollBottom && (
        <button
          type="button"
          onClick={() => {
            const scroller = scrollRef.current;
            if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
          }}
          className={cn('absolute bottom-[160px] left-1/2 z-30 grid min-h-9 min-w-9 -translate-x-1/2 place-items-center rounded-full border shadow-md backdrop-blur-md transition hover:scale-[1.05] active:scale-95 opacity-80 hover:opacity-100', albireoTone.surface, albireoTone.hairline, albireoTone.text)}
          aria-label="Scroll to bottom"
        >
          <ArrowDown size={15} />
        </button>
      )}
    </div>
  );
}
