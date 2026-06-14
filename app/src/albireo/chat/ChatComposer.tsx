import { ArrowUp, Camera, FileText, Image, Link2, PanelTop, Plus } from 'lucide-react';
import type { KeyboardEvent, ChangeEvent } from 'react';
import { useState } from 'react';
import { albireoFocusRing, albireoTone } from '../shared/albireoTokens';
import { pulseHaptic } from '../shared/haptics';
import { cn } from '../../lib/utils';

import { api } from '../../lib/api';

interface ChatComposerProps {
  draft: string;
  draftAttachments?: string[];
  isSending?: boolean;
  splitEnabled: boolean;
  relayEnabled: boolean;
  modelName: string;
  onDraftChange: (value: string) => void;
  onDraftAttachmentsChange?: (attachments: string[]) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onToggleSplit: () => void;
  onToggleRelay: () => void;
}

export default function ChatComposer({
  draft,
  draftAttachments = [],
  isSending,
  modelName,
  onDraftChange,
  onDraftAttachmentsChange,
  onKeyDown,
  onSend,
  onToggleRelay,
  onToggleSplit,
  relayEnabled,
  splitEnabled,
}: ChatComposerProps) {
  const [attachmentOpen, setAttachmentOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setAttachmentOpen(false);
    try {
      const response = await api.uploadAttachment(file);
      if (response.ok && onDraftAttachmentsChange) {
        onDraftAttachmentsChange([...draftAttachments, response.url]);
      }
    } catch (err) {
      console.error('Failed to upload attachment:', err);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-8 z-30 px-4">
      <div className="pointer-events-auto mx-auto max-w-[720px]">
        {attachmentOpen && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setAttachmentOpen(false)} 
            />
            <div className="relative z-50 mb-3 ml-2 flex items-center gap-3">
              {[
                { icon: Camera, label: 'Camera' },
                { icon: Image, label: 'Photo', accept: 'image/*' },
                { icon: FileText, label: 'File', accept: '*/*' },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <label
                    key={item.label}
                    className={cn('grid min-h-11 min-w-11 place-items-center rounded-full shadow-lg cursor-pointer transition active:scale-95 hover:brightness-110', albireoTone.surface, albireoTone.text)}
                    aria-label={item.label}
                  >
                    <Icon size={17} />
                    <input
                      type="file"
                      className="hidden"
                      accept={item.accept}
                      onChange={handleFileUpload}
                    />
                  </label>
                );
              })}
            </div>
          </>
        )}

        <div
          className={cn(
            'flex items-end gap-2 rounded-[28px] border px-2.5 py-2 shadow-xl backdrop-blur-2xl',
            'bg-white/42 dark:bg-white/8',
            albireoTone.hairline,
          )}
        >
          <button
            type="button"
            onClick={() => {
              setAttachmentOpen((value) => !value);
              pulseHaptic('selection');
            }}
            className={cn('grid min-h-10 min-w-10 place-items-center rounded-full transition active:scale-95', albireoTone.text, 'hover:bg-black/5 dark:hover:bg-white/5')}
            aria-label="Open attachments"
          >
            <Plus size={19} />
          </button>

          <div className="min-w-0 flex-1 py-1">
            {draftAttachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {draftAttachments.map((url) => (
                  <div key={url} className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium shadow-sm', albireoTone.surface, albireoTone.text)}>
                    <span>{url.replace('/attachments/', '')}</span>
                    <button
                      type="button"
                      onClick={() => onDraftAttachmentsChange?.(draftAttachments.filter((u) => u !== url))}
                      className="ml-1 opacity-60 hover:opacity-100"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
            {isUploading && (
              <div className={cn('mb-2 text-[12px] animate-pulse', albireoTone.muted)}>Uploading...</div>
            )}
            <textarea
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Say it here"
              className={cn(
                'max-h-28 min-h-9 w-full resize-none bg-transparent px-1 py-2 text-[16px] leading-relaxed outline-none',
                albireoTone.text,
                'placeholder:text-[#8A8A8E]/65 dark:placeholder:text-[#71717A]/70',
              )}
            />

            <div className={cn('flex items-center gap-1.5 pl-0.5 text-[12px]', albireoTone.muted)}>
              <div className="inline-flex min-h-7 items-center gap-1 px-2">
                <Link2 size={13} />
                {modelName}
              </div>
              <button
                type="button"
                onClick={onToggleSplit}
                className={cn('inline-flex min-h-7 items-center gap-1 rounded-full px-2 transition', splitEnabled && 'bg-black/5 text-[#3C3C43] dark:bg-white/8 dark:text-[#E5E5E5]')}
              >
                <PanelTop size={13} />
                Split
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onSend}
            disabled={isSending || !draft.trim()}
            className={cn(
              'mb-0.5 grid min-h-10 min-w-10 place-items-center rounded-full bg-[#3C3C43] text-[#FCF5E7] transition active:scale-95 disabled:opacity-45 dark:bg-[#E5E5E5] dark:text-[#1A1A1A]',
              albireoFocusRing,
            )}
            aria-label="Send mock message"
          >
            <ArrowUp size={17} strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </div>
  );
}
