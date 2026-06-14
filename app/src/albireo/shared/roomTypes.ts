import type { LucideIcon } from 'lucide-react';
import { BookOpen, Brain, MessageCircle } from 'lucide-react';

export type AlbireoRoomId = 'proximity' | 'undertow' | 'marginalia';

export interface AlbireoRoom {
  id: AlbireoRoomId;
  title: string;
  subtitle: string;
  icon: LucideIcon;
}

export const ALBIREO_ROOMS: AlbireoRoom[] = [
  {
    id: 'proximity',
    title: 'Proximity',
    subtitle: 'The chat interface',
    icon: MessageCircle,
  },
  {
    id: 'undertow',
    title: 'Undertow',
    subtitle: 'Memory, calendar, and logs',
    icon: Brain,
  },
  {
    id: 'marginalia',
    title: 'Marginalia',
    subtitle: 'The reading room',
    icon: BookOpen,
  },
];
