import { useState } from 'react';
import { motion, PanInfo } from 'motion/react';
import { ALBIREO_ROOMS, AlbireoRoomId } from './shared/roomTypes';
import { albireoTone } from './shared/albireoTokens';
import { pulseHaptic } from './shared/haptics';
import { cn } from '../lib/utils';
import ProximityRoom from './rooms/ProximityRoom';
import UndertowRoom from './rooms/UndertowRoom';
import MarginaliaRoom from './rooms/MarginaliaRoom';

function roomIndex(id: AlbireoRoomId) {
  return ALBIREO_ROOMS.findIndex((room) => room.id === id);
}

function roomForIndex(index: number): AlbireoRoomId {
  return ALBIREO_ROOMS[Math.min(Math.max(index, 0), ALBIREO_ROOMS.length - 1)].id;
}

export default function AlbireoShell() {
  const [activeRoom, setActiveRoom] = useState<AlbireoRoomId>('proximity');
  const activeIndex = roomIndex(activeRoom);
  const [isSwipeDisabled, setIsSwipeDisabled] = useState(false);

  const moveRoom = (nextIndex: number) => {
    const nextRoom = roomForIndex(nextIndex);
    if (nextRoom !== activeRoom) {
      setActiveRoom(nextRoom);
      pulseHaptic('selection');
    }
  };

  const handleDragEnd = (_: PointerEvent, info: PanInfo) => {
    if (Math.abs(info.offset.x) < 72) return;
    if (info.offset.x < 0) moveRoom(activeIndex + 1);
    else moveRoom(activeIndex - 1);
  };

  return (
    <div className={cn('fixed inset-0 overflow-hidden antialiased', albireoTone.bg)}>
      <motion.div
        className="flex h-full w-[300%]"
        animate={{ x: `-${activeIndex * 100}vw` }}
        transition={{ type: 'spring', stiffness: 260, damping: 34 }}
        drag={isSwipeDisabled ? false : "x"}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.08}
        onDragEnd={handleDragEnd}
      >
        <section className="h-full w-screen shrink-0">
          <ProximityRoom />
        </section>
        <section className="h-full w-screen shrink-0">
          <UndertowRoom />
        </section>
        <section className="h-full w-screen shrink-0">
          <MarginaliaRoom
            isActive={activeRoom === 'marginalia'}
            onReaderActiveChange={setIsSwipeDisabled}
          />
        </section>
      </motion.div>

      <div className="pointer-events-none absolute inset-x-0 bottom-1 z-40 flex h-8 items-center justify-center gap-2">
        {ALBIREO_ROOMS.map((room, index) => (
          <button
            key={room.id}
            type="button"
            className="pointer-events-auto grid min-h-8 min-w-7 place-items-center"
            aria-label={`Open ${room.title}`}
            onClick={() => moveRoom(index)}
          >
            <span
              className={cn(
                'block rounded-full transition-all',
                index === activeIndex
                  ? 'h-2 w-2 bg-[#3C3C43]/82 dark:bg-[#E5E5E5]/82'
                  : 'h-1.5 w-1.5 bg-[#8A8A8E]/36 dark:bg-[#71717A]/42',
              )}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
