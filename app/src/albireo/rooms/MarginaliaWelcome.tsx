import { motion } from 'framer-motion';

interface MarginaliaWelcomeProps {
  onEnter: () => void;
}

export default function MarginaliaWelcome({ onEnter }: MarginaliaWelcomeProps) {
  return (
    <motion.button
      type="button"
      onClick={onEnter}
      aria-label="Enter the Reading Room"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className="absolute inset-0 z-[100] block h-full w-full cursor-pointer overflow-hidden bg-[#f5eee7] p-0 text-left"
    >
      <div
        className="absolute inset-0 h-full w-full bg-[url('/marginalia/marginalia_welcome2.PNG')] bg-cover bg-center bg-no-repeat"
      />
    </motion.button>
  );
}
