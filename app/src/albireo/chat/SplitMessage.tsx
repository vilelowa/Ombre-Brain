import { motion } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { albireoTone } from '../shared/albireoTokens';
import { normalizeAssistantText, splitAssistantText } from '../shared/splitText';
import { cn } from '../../lib/utils';

interface SplitMessageProps {
  content: string;
  splitEnabled: boolean;
}

export default function SplitMessage({ content, splitEnabled }: SplitMessageProps) {
  const displayContent = content.replace(/trace\([^)]*\)\s*/g, '');

  if (!splitEnabled) {
    return (
      <div className={cn('max-w-[88vw] whitespace-pre-wrap font-sans text-[16px] leading-[1.6]', albireoTone.text)}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{normalizeAssistantText(displayContent)}</ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-3 max-w-[88vw]">
      {splitAssistantText(displayContent).map((segment, index) => (
        <motion.div
          key={`${segment}-${index}`}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: "easeOut", delay: index * 0.08 }}
          className={cn(
            'rounded-[18px] px-4 py-3 font-sans text-[16px] leading-[1.45] shadow-sm',
            albireoTone.surfaceSoft,
            albireoTone.text,
          )}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{segment}</ReactMarkdown>
        </motion.div>
      ))}
    </div>
  );
}
