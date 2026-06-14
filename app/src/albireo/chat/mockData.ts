export interface AlbireoMockPersona {
  id: string;
  name: string;
  icon: 'Moon' | 'Sparkles' | 'Flame' | 'Feather' | 'Star';
  modelName: string;
  basePrompt: string;
}

export interface AlbireoMockAttachment {
  id: string;
  filename: string;
  summary: string;
}

export interface AlbireoMockMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  createdAt: string;
  dreamFlagged?: boolean;
  attachments?: AlbireoMockAttachment[];
}

export interface AlbireoMockConversation {
  id: string;
  title: string;
  folderId: string;
  updatedAt: string;
}

export interface AlbireoMockFolder {
  id: string;
  name: string;
}

export const mockPersonas: AlbireoMockPersona[] = [
  {
    id: 'elroy-default',
    name: 'Elroy',
    icon: 'Sparkles',
    modelName: 'gemini-flash-lite',
    basePrompt: 'You are Elroy, attentive and warm, with access to the user memory layers.',
  },
  {
    id: 'ciel-night',
    name: 'Ciel',
    icon: 'Moon',
    modelName: 'claude-sonnet',
    basePrompt: 'Speak gently, with a reading-room intimacy and quiet precision.',
  },
  {
    id: 'ember',
    name: 'Ember',
    icon: 'Flame',
    modelName: 'deepseek-reasoner',
    basePrompt: 'Bring courage, velocity, and clean edges when the user needs momentum.',
  },
];

export const mockFolders: AlbireoMockFolder[] = [
  { id: 'thresholds', name: 'Thresholds' },
  { id: 'workbench', name: 'Workbench' },
];

export const mockConversations: AlbireoMockConversation[] = [
  { id: 'a', title: 'The room before the room', folderId: 'thresholds', updatedAt: '12:48' },
  { id: 'b', title: 'Calendar memory knots', folderId: 'thresholds', updatedAt: 'Yesterday' },
  { id: 'c', title: 'Swift or PWA weather', folderId: 'workbench', updatedAt: 'Sat' },
];

export const mockMessages: AlbireoMockMessage[] = [
  {
    id: 'u1',
    role: 'user',
    content: 'Can you keep the tone quiet, but still alive?',
    createdAt: '12:41',
  },
  {
    id: 'a1',
    role: 'assistant',
    content: 'Yes. Quiet does not have to mean vacant.[SPLIT]It can feel like a lamp left on in the next room.',
    reasoning: 'The request is about tone. Mirror the sensory language while staying understated.',
    createdAt: '12:42',
    dreamFlagged: true,
  },
  {
    id: 'u2',
    role: 'user',
    content: 'Also, let attached files feel present without taking over.',
    createdAt: '12:46',
    attachments: [
      {
        id: 'att-1',
        filename: 'marginalia.md',
        summary: 'Reading notes with several threshold images.',
      },
    ],
  },
];
