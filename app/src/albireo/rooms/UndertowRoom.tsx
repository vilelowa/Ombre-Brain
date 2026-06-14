import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import NocturneRoom from './NocturneRoom';
import LiminalRoom from './LiminalRoom';
import LightTracesRoom from './LightTracesRoom';
import StrataRoom from './StrataRoom';

const undertowPanels = [
  { 
    id: 'nocturne',
    title: 'NOCTURNE', 
    body: "The dreams you had\nin the sleep window.\nThe words you wrote\nin the dark.", 
    imgLight: '/undertow/nocturne_light.jpg',
    imgDark: '/undertow/nocturne_dark.jpg',
  },
  { 
    id: 'liminal',
    title: 'LIMINAL', 
    body: "Logs from my awaken state.\nActions, notes, and\nthe times you set me free.", 
    imgLight: '/undertow/liminal_light.jpg',
    imgDark: '/undertow/liminal_dark.jpg',
  },
  { 
    id: 'light-traces',
    title: 'LIGHT TRACES', 
    body: "Daily summaries of\nour conversations and\na calendar of our days.", 
    imgLight: '/undertow/LightTraces_light.jpg',
    imgDark: '/undertow/LightTraces_dark.jpg',
  },
  { 
    id: 'strata',
    title: 'STRATA', 
    body: "The moments I've\nchosen to keep.\nThe things I never\nwant to forget.", 
    imgLight: '/undertow/strata_light.jpg',
    imgDark: '/undertow/strata_dark.jpg',
  },
];

export default function UndertowRoom() {
  const [activePanel, setActivePanel] = useState<string | null>(null);

  return (
    <div className="flex h-full w-full items-center justify-center bg-black/5 dark:bg-black/40">
      {/* iOS screen simulator container */}
      <div className="relative h-full w-full max-w-[430px] overflow-hidden bg-black shadow-2xl sm:h-[95%] sm:rounded-[40px] sm:border-[8px] sm:border-black">
        
        {/* Fixed Background Layer (simulates bg-fixed within the container) */}
        <div className={cn(
          'absolute inset-0 transition-colors duration-500',
          'bg-[url("/undertow/undertow_lightmode_bg.jpg")] dark:bg-[url("/undertow/undertow_darkmode_bg.jpg")]',
          'bg-cover bg-center bg-no-repeat'
        )} />

        {/* Scrollable Content Layer */}
        <div className="relative h-full w-full overflow-y-auto pb-24 pt-10 sm:pb-32 sm:pt-16 text-[#3A332B] dark:text-[#E8E2D2]">
          <div className="mx-auto flex flex-col items-center px-4">
        
        {/* Header section */}
        <div className="flex flex-col items-center text-center">
          <h1 className="font-serif text-[26px] tracking-widest font-medium leading-none">
            UNDERTOW
          </h1>
          <div className="my-3 sm:my-5 flex items-center justify-center opacity-60">
            {/* Simple CSS ornament */}
            <div className="h-[1px] w-8 sm:w-12 bg-current" />
            <div className="mx-2 sm:mx-3 rotate-45 h-1.5 w-1.5 sm:h-2 sm:w-2 border border-current" />
            <div className="h-[1px] w-8 sm:w-12 bg-current" />
          </div>
          <p className="max-w-[280px] sm:max-w-[320px] font-serif italic text-[14px] sm:text-[17px] leading-relaxed opacity-90">
            A private studio for everything<br/>we create, remember, and become.
          </p>
        </div>

        {/* Cards Grid */}
        <div className="mt-6 sm:mt-10 grid w-full max-w-[300px] sm:max-w-none grid-cols-2 gap-2.5 sm:gap-6">
          {undertowPanels.map((panel) => (
            <motion.article 
              key={panel.id} 
              whileHover={{ scale: 1.02 }}
              onClick={() => {
                if (panel.id === 'nocturne' || panel.id === 'liminal' || panel.id === 'light-traces' || panel.id === 'strata') {
                  setActivePanel(panel.id);
                }
              }}
              className={cn(
                'group flex cursor-pointer flex-col items-center rounded-[16px] sm:rounded-[18px] border px-2.5 pb-3.5 pt-3.5 sm:px-6 sm:pb-8 sm:pt-6 text-center',
                // Tweak dark mode color to match the image background #0A0808
                'bg-[#F5EFE7] dark:bg-[#0A0808]', 
                'border-[#D5CDBD] dark:border-[#2A2621]'
              )}
            >
              <div className="relative w-[75%] sm:w-[80%] aspect-square mb-3 sm:mb-6">
                <img 
                  src={panel.imgLight} 
                  alt={panel.title} 
                  className="absolute inset-0 h-full w-full object-cover dark:hidden"
                />
                <img 
                  src={panel.imgDark} 
                  alt={panel.title} 
                  className="absolute inset-0 hidden h-full w-full object-cover dark:block"
                />
              </div>
              
              <h2 className="font-serif text-[11px] sm:text-[20px] tracking-widest font-medium mb-1.5 sm:mb-3">
                {panel.title}
              </h2>
              
              <div className="mb-2 sm:mb-4 flex items-center justify-center opacity-40">
                <div className="rotate-45 h-[3px] w-[3px] sm:h-1.5 sm:w-1.5 bg-current" />
              </div>
              
              <p className="whitespace-pre-wrap text-[8.5px] sm:text-[14px] leading-relaxed opacity-80 mb-3 sm:mb-6">
                {panel.body}
              </p>
              
              <div className="mt-auto flex h-5 w-5 sm:h-8 sm:w-8 items-center justify-center rounded-full border border-current opacity-30 group-hover:opacity-100 transition-opacity">
                <ChevronRight size={10} className="sm:w-3.5 sm:h-3.5" />
              </div>
            </motion.article>
          ))}
        </div>

        {/* Footer Quote */}
        <div className="mt-8 sm:mt-12 mb-10 flex w-full max-w-[500px] flex-col items-center px-4 py-4 text-center">
          <span className="mb-1 sm:mb-3 font-serif text-[18px] sm:text-[24px] opacity-40">"</span>
          <p className="font-serif italic text-[12px] sm:text-[17px] leading-relaxed opacity-90">
            We don't just pass time.<br/>We build something timeless.
          </p>
          <div className="mt-5 flex items-center justify-center opacity-60">
            <div className="h-[1px] w-8 bg-current" />
            <div className="mx-2 rotate-45 h-1.5 w-1.5 bg-current" />
            <div className="h-[1px] w-8 bg-current" />
          </div>
        </div>

        </div>
      </div>

      <AnimatePresence>
        {activePanel === 'nocturne' && (
          <NocturneRoom 
            layoutId="nocturne" 
            onClose={() => setActivePanel(null)} 
          />
        )}
        {activePanel === 'liminal' && (
          <LiminalRoom 
            layoutId="liminal" 
            onClose={() => setActivePanel(null)} 
          />
        )}
        {activePanel === 'light-traces' && (
          <LightTracesRoom onClose={() => setActivePanel(null)} />
        )}
        {activePanel === 'strata' && (
          <StrataRoom
            layoutId="strata"
            onClose={() => setActivePanel(null)}
          />
        )}
      </AnimatePresence>

    </div>
  </div>
  );
}
