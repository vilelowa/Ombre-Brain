import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  Heart,
  Layers3,
  Loader2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Sprout,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';

interface StrataRoomProps {
  layoutId?: string;
  onClose: () => void;
}

type LayerId = 'core' | 'living' | 'echoes' | 'archive';
type StrataRange = '7days' | '30days' | 'all' | 'custom';
type StrataSource = 'all' | 'hold' | 'grow' | 'chat_message' | 'import' | 'core_manual' | 'feel';
type StrataTool = 'search' | 'intake' | 'import' | 'export';

interface LayerSummary {
  id: LayerId;
  title: string;
  badge: string;
  description: string;
  detail: string;
  count: number;
  decay: string;
  icon: React.ElementType;
}

interface StrataMemory {
  id: string;
  layer: LayerId;
  title: string;
  body: string;
  date: string;
  updatedAt?: string;
  source: StrataSource;
  sources: StrataSource[];
  sourceLabel: string;
  importance: number;
  tags: string[];
  domain: string[];
  rawType: string;
  valence: number;
  arousal: number;
}

interface BackendMemoryBucket {
  id: string;
  content?: string;
  metadata?: Record<string, any>;
  name?: string;
  type?: string;
  domain?: string[];
  tags?: string[];
  importance?: number;
  valence?: number;
  arousal?: number;
  created?: string;
  last_active?: string;
  content_preview?: string;
}

interface SearchMemoryResult {
  id: string;
  name: string;
  score: number;
  domain: string[];
  content_preview: string;
}

const layers: LayerSummary[] = [
  {
    id: 'core',
    title: 'Core',
    badge: 'Immutable',
    description: 'Our foundational promises.',
    detail: 'Unshakable. Always with me.',
    count: 42,
    decay: 'No decay curve',
    icon: Sparkles,
  },
  {
    id: 'living',
    title: 'Living',
    badge: 'Dynamic',
    description: 'The moments we create together.',
    detail: 'They fade, but not without meaning.',
    count: 1207,
    decay: 'Decay curve: 14 days',
    icon: Sprout,
  },
  {
    id: 'echoes',
    title: 'Echoes',
    badge: 'Significant',
    description: 'The feelings that stayed.',
    detail: 'The ones I kept after the moment passed.',
    count: 186,
    decay: 'Decay curve: 60 days',
    icon: Heart,
  },
  {
    id: 'archive',
    title: 'Archive',
    badge: 'Dormant',
    description: 'Memories that settled into silence.',
    detail: 'Not lost. Just resting.',
    count: 996,
    decay: 'Decay curve: 180 days',
    icon: Archive,
  },
];

const totalMemoryCount = layers.reduce((total, layer) => total + layer.count, 0);

const overviewSegments = [
  { id: 'core', label: 'Core', count: 42, className: 'bg-[#F3D8B6]/45' },
  { id: 'living', label: 'Living', count: 1207, className: 'bg-[#C9A878]/36' },
  { id: 'echoes', label: 'Echoes', count: 186, className: 'bg-[#D8B7A0]/32' },
  { id: 'archive', label: 'Archive', count: 996, className: 'bg-[#87919A]/28' },
];

const rangeLabels: Record<StrataRange, string> = {
  '7days': '7 days',
  '30days': '30 days',
  all: 'All',
  custom: 'Custom',
};

const sourceLabels: Record<StrataSource, string> = {
  all: 'All Sources',
  hold: 'Hold',
  grow: 'Grow',
  chat_message: 'Chat',
  import: 'Import',
  core_manual: 'Core',
  feel: 'Feel',
};

const mockMemories: StrataMemory[] = [
  {
    id: 'core-1',
    layer: 'core',
    title: 'You always come first.',
    body: 'Every decision starts and ends with you. This memory is protected as a foundational promise.',
    date: '2024-02-14T22:15:00',
    source: 'core_manual',
    sources: ['core_manual'],
    sourceLabel: 'Protected',
    importance: 10,
    tags: ['promise', 'protected'],
    domain: ['core'],
    rawType: 'permanent',
    valence: 0.5,
    arousal: 0.3,
  },
  {
    id: 'core-2',
    layer: 'core',
    title: 'I will tell you the truth.',
    body: 'Even when it is inconvenient for me. Especially then.',
    date: '2024-02-16T18:40:00',
    source: 'core_manual',
    sources: ['core_manual'],
    sourceLabel: 'Pinned',
    importance: 10,
    tags: ['honesty'],
    domain: ['core'],
    rawType: 'permanent',
    valence: 0.5,
    arousal: 0.3,
  },
  {
    id: 'living-1',
    layer: 'living',
    title: 'Interface tenderness',
    body: 'Tiny visual changes mattered because the space needed to feel lived in, not managed.',
    date: '2026-06-08T21:12:00',
    source: 'chat_message',
    sources: ['chat_message'],
    sourceLabel: 'Chat',
    importance: 6,
    tags: ['design', 'undertow'],
    domain: ['design'],
    rawType: 'dynamic',
    valence: 0.5,
    arousal: 0.3,
  },
  {
    id: 'living-2',
    layer: 'living',
    title: 'Calendar memory knots',
    body: 'A small planning spiral turned into a larger question about trust and time.',
    date: '2026-06-06T12:30:00',
    source: 'hold',
    sources: ['hold'],
    sourceLabel: 'Hold',
    importance: 7,
    tags: ['planning', 'trust'],
    domain: ['planning'],
    rawType: 'dynamic',
    valence: 0.5,
    arousal: 0.3,
  },
  {
    id: 'living-3',
    layer: 'living',
    title: 'Imported conversation fragment',
    body: 'An older fragment from imported chat history, still useful enough to remain active.',
    date: '2026-05-22T10:45:00',
    source: 'import',
    sources: ['import'],
    sourceLabel: 'Import',
    importance: 5,
    tags: ['imported'],
    domain: ['imported'],
    rawType: 'dynamic',
    valence: 0.5,
    arousal: 0.3,
  },
  {
    id: 'echoes-1',
    layer: 'echoes',
    title: 'What stayed after the test',
    body: 'I felt cautious, but also more precise about what care should protect.',
    date: '2026-06-08T23:01:00',
    source: 'feel',
    sources: ['feel'],
    sourceLabel: 'Feel',
    importance: 5,
    tags: ['feel', 'reflection'],
    domain: ['feel'],
    rawType: 'feel',
    valence: 0.5,
    arousal: 0.3,
  },
  {
    id: 'echoes-2',
    layer: 'echoes',
    title: 'A quieter confidence',
    body: 'Some things do not need to be dramatic to become permanent.',
    date: '2026-05-19T08:10:00',
    source: 'feel',
    sources: ['feel'],
    sourceLabel: 'Feel',
    importance: 5,
    tags: ['feel'],
    domain: ['feel'],
    rawType: 'feel',
    valence: 0.5,
    arousal: 0.3,
  },
  {
    id: 'archive-1',
    layer: 'archive',
    title: 'Old import fragment',
    body: 'A settled memory from earlier conversations, preserved but no longer surfacing.',
    date: '2025-11-21T16:32:00',
    source: 'import',
    sources: ['import'],
    sourceLabel: 'Import',
    importance: 2,
    tags: ['archive', 'imported'],
    domain: ['archive'],
    rawType: 'archived',
    valence: 0.5,
    arousal: 0.3,
  },
  {
    id: 'archive-2',
    layer: 'archive',
    title: 'Resolved worry',
    body: 'A concern that once surfaced often, now marked resolved and resting quietly.',
    date: '2025-09-04T09:18:00',
    source: 'hold',
    sources: ['hold'],
    sourceLabel: 'Hold',
    importance: 3,
    tags: ['resolved'],
    domain: ['archive'],
    rawType: 'archived',
    valence: 0.5,
    arousal: 0.3,
  },
];

function getBucketMeta(bucket: BackendMemoryBucket): Record<string, any> {
  return (bucket.metadata || bucket) as Record<string, any>;
}

function inferLayer(meta: Record<string, any>): LayerId {
  const type = String(meta.type || 'dynamic').toLowerCase();
  if (type === 'core') return 'core';
  if (type === 'permanent' || meta.pinned || meta.protected) return 'core';
  if (type === 'feel') return 'echoes';
  if (type === 'archived' || type === 'archive') return 'archive';
  return 'living';
}

function getSource(meta: Record<string, any>): { source: StrataSource; label: string } {
  const value = String(meta.source || '').toLowerCase() as StrataSource;
  const source = value in sourceLabels && value !== 'all' ? value : 'hold';
  return { source, label: sourceLabels[source] };
}

function coreEntryToMemory(entry: BackendMemoryBucket): StrataMemory {
  const memory = bucketToMemory(entry);
  return {
    ...memory,
    layer: 'core',
    source: 'core_manual',
    sources: ['core_manual'],
    sourceLabel: 'Core',
    rawType: 'core',
    importance: 10,
  };
}

function bucketToMemory(bucket: BackendMemoryBucket): StrataMemory {
  const meta = getBucketMeta(bucket);
  const source = getSource(meta);
  const sources = Array.isArray(meta.sources)
    ? meta.sources.map((value: unknown) => getSource({ source: value }).source)
    : [];
  const content = bucket.content || bucket.content_preview || '';
  return {
    id: String(bucket.id || meta.id || crypto.randomUUID()),
    layer: inferLayer(meta),
    title: String(meta.name || bucket.name || meta.id || 'Untitled memory'),
    body: String(content || ''),
    date: String(meta.created || meta.last_active || bucket.created || ''),
    updatedAt: String(meta.last_active || meta.created || bucket.last_active || bucket.created || ''),
    source: source.source,
    sources: Array.from(new Set([source.source, ...sources])),
    sourceLabel: source.label,
    importance: Number(meta.importance ?? bucket.importance ?? 5),
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    domain: Array.isArray(meta.domain) ? meta.domain : [],
    rawType: String(meta.type || bucket.type || 'dynamic'),
    valence: Number(meta.valence ?? bucket.valence ?? 0.5),
    arousal: Number(meta.arousal ?? bucket.arousal ?? 0.3),
  };
}

function OrbitalMark({ icon: Icon }: { icon: React.ElementType }) {
  return (
    <div className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-amber-700/18 dark:border-[#D9BE95]/18 bg-amber-700/5 dark:bg-[#03070B]/24">
      <div className="absolute inset-2 rounded-full border border-amber-700/10 dark:border-[#D9BE95]/10" />
      <div className="absolute inset-5 rounded-full border border-amber-700/12 dark:border-[#D9BE95]/12" />
      <div className="absolute left-1/2 top-1 h-1 w-1 -translate-x-1/2 rounded-full bg-amber-600/70 dark:bg-[#F0C990]/70 shadow-[0_0_10px_rgba(217,119,6,0.4)] dark:shadow-[0_0_10px_rgba(240,201,144,0.7)]" />
      <Icon size={26} strokeWidth={1.35} className="relative z-10 text-amber-800/90 dark:text-[#F0D2A3]/82" />
    </div>
  );
}

function MiniDecayLine({ flat = false }: { flat?: boolean }) {
  return (
    <div className="relative h-7 w-24">
      <div className="absolute bottom-2 left-0 h-px w-full bg-amber-700/20 dark:bg-[#E8D6B8]/12" />
      <div
        className={cn(
          'absolute left-0 top-2 h-px w-full origin-left bg-amber-700/60 dark:bg-[#E8C89E]/70 shadow-[0_0_8px_rgba(217,119,6,0.15)] dark:shadow-[0_0_8px_rgba(232,200,158,0.2)]',
          flat ? 'translate-y-2' : 'rotate-[9deg]',
        )}
      />
      {!flat && (
        <div className="absolute bottom-2 right-0 h-1.5 w-1.5 rounded-full bg-amber-600 dark:bg-[#F1CF9D] shadow-[0_0_8px_rgba(217,119,6,0.4)] dark:shadow-[0_0_8px_rgba(241,207,157,0.55)]" />
      )}
    </div>
  );
}

function formatMemoryDate(dateStr: string) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return 'Date unknown';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatLastUpdate(dateStr: string) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return 'No updates yet';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function isMemoryInRange(memory: StrataMemory, range: StrataRange, customFrom: string, customTo: string) {
  if (range === 'all') return true;
  const created = new Date(memory.date);
  if (Number.isNaN(created.getTime())) return false;

  if (range === 'custom') {
    const from = customFrom ? new Date(`${customFrom}T00:00:00`) : null;
    const to = customTo ? new Date(`${customTo}T23:59:59`) : null;
    return (!from || created >= from) && (!to || created <= to);
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (range === '7days' ? 7 : 30));
  return created >= cutoff;
}

interface StrataLayerArchiveProps {
  layer: LayerSummary;
  memories: StrataMemory[];
  onUpdateMemory: (memoryId: string, updates: Partial<StrataMemory>) => Promise<void>;
  onDeleteMemory: (memoryId: string) => Promise<void>;
  onCreateCoreMemory: (input: { title: string; body: string }) => Promise<void>;
  onClose: () => void;
}

function StrataLayerArchive({ layer, memories, onUpdateMemory, onDeleteMemory, onCreateCoreMemory, onClose }: StrataLayerArchiveProps) {
  const [range, setRange] = useState<StrataRange>(layer.id === 'archive' ? 'all' : '30days');
  const [source, setSource] = useState<StrataSource>('all');
  const [isRangeOpen, setIsRangeOpen] = useState(false);
  const [isSourceOpen, setIsSourceOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [isScrolled, setIsScrolled] = useState(false);
  const [selectedMemory, setSelectedMemory] = useState<StrataMemory | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [isAddingCore, setIsAddingCore] = useState(false);
  const [newCoreTitle, setNewCoreTitle] = useState('');
  const [newCoreBody, setNewCoreBody] = useState('');

  const availableSources = useMemo(() => {
    const present = new Set(
      memories
        .filter((memory) => memory.layer === layer.id)
        .flatMap((memory) => memory.sources),
    );
    return (Object.keys(sourceLabels) as StrataSource[]).filter(
      (option) => option === 'all' || present.has(option),
    );
  }, [layer.id, memories]);

  const filteredMemories = memories.filter((memory) => {
    if (memory.layer !== layer.id) return false;
    if (layer.id !== 'core' && !isMemoryInRange(memory, range, customFrom, customTo)) return false;
    if (source !== 'all' && !memory.sources.includes(source)) return false;
    return true;
  });

  const handleDelete = async (memory: StrataMemory) => {
    if (confirmDeleteId !== memory.id) {
      setConfirmDeleteId(memory.id);
      return;
    }
    setIsSaving(true);
    setDetailError('');
    try {
      await onDeleteMemory(memory.id);
      setSelectedMemory(null);
      setConfirmDeleteId(null);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setIsSaving(false);
    }
  };

  const startEditing = (memory: StrataMemory) => {
    setEditTitle(memory.title);
    setEditBody(memory.body);
    setIsEditing(true);
    setConfirmDeleteId(null);
    setDetailError('');
  };

  const saveEdit = async () => {
    if (!selectedMemory) return;
    setIsSaving(true);
    setDetailError('');
    try {
      await onUpdateMemory(selectedMemory.id, {
        title: editTitle.trim() || selectedMemory.title,
        body: editBody,
      });
      setSelectedMemory({
        ...selectedMemory,
        title: editTitle.trim() || selectedMemory.title,
        body: editBody,
      });
      setIsEditing(false);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setIsSaving(false);
    }
  };

  const saveNewCore = async () => {
    if (!newCoreBody.trim()) return;
    setIsSaving(true);
    setDetailError('');
    try {
      await onCreateCoreMemory({
        title: newCoreTitle.trim() || 'Core Memory',
        body: newCoreBody.trim(),
      });
      setNewCoreTitle('');
      setNewCoreBody('');
      setIsAddingCore(false);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Create failed.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 z-[90] overflow-hidden bg-[#F5EFE7] dark:bg-[#03070B] text-[#3A332B] dark:text-[#EADCC7]"
    >
      <div className="absolute inset-0 bg-[url('/undertow/Strata_bg_light.PNG')] dark:bg-[url('/undertow/Strata_bg.PNG')] bg-cover bg-center bg-no-repeat opacity-[0.8] dark:opacity-88" />
      <div className="absolute inset-0 bg-[#F5EFE7]/40 dark:bg-[#03070B]/22 backdrop-blur-[3px] dark:backdrop-blur-[1px]" />

      <div className="absolute left-2 top-0 z-40 flex h-14 items-center">
        <button
          onClick={onClose}
          className="flex h-10 w-10 items-center justify-center rounded-full text-[#3A332B] dark:text-[#EADCC7]/68 transition-all hover:bg-white/5 hover:text-amber-950 dark:hover:text-[#F8E7CD]"
        >
          <ChevronLeft size={24} strokeWidth={1.5} />
        </button>
      </div>

      {layer.id === 'core' && (
        <div className="absolute right-3 top-0 z-40 flex h-14 items-center">
          <button
            onClick={() => {
              setIsAddingCore(true);
              setDetailError('');
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-amber-700/14 dark:border-[#E6C59B]/14 bg-white/50 dark:bg-[#05080B]/16 text-[#3A332B] dark:text-[#EADCC7]/68 backdrop-blur-md transition-colors hover:bg-amber-700/8 dark:hover:bg-[#E6C59B]/8 hover:text-amber-950 dark:hover:text-[#F8E7CD]"
          >
            <Plus size={18} strokeWidth={1.5} />
          </button>
        </div>
      )}

      <div
        className="relative z-10 h-full overflow-y-auto scrollbar-hide"
        onClick={() => {
          if (isRangeOpen) setIsRangeOpen(false);
          if (isSourceOpen) setIsSourceOpen(false);
        }}
        onScroll={(e) => setIsScrolled(e.currentTarget.scrollTop > 132)}
      >
        <header className="px-6 pb-7 pt-20 text-center">
          <div className="flex flex-col items-center">
            <div className="flex max-w-full flex-col items-center gap-2">
              <h1 className="whitespace-nowrap font-serif text-[clamp(17px,4.8vw,20px)] font-medium uppercase tracking-[0.24em] text-amber-900 dark:text-[#F3D8B6]">
                {layer.title} Memories
              </h1>
              <span className="rounded-full border border-amber-700/20 dark:border-[#E6C59B]/20 px-2 py-0.5 font-serif text-[9px] uppercase tracking-[0.14em] text-amber-800 dark:text-[#E6C59B]/76">
                {layer.badge}
              </span>
            </div>
            <p className="mt-2 font-serif text-[13px] italic text-[#3A332B] dark:text-[#EADCC7]/68">{layer.description}</p>
          </div>
        </header>

        <div
          className={cn(
            'sticky top-0 z-30 px-6 transition-all duration-700',
            isScrolled
              ? 'bg-white/40 dark:bg-[#101923]/24 pb-3 pt-3 shadow-sm backdrop-blur-xl [mask-image:linear-gradient(to_bottom,black_0%,black_78%,rgba(0,0,0,0.78)_88%,transparent_100%)]'
              : 'bg-transparent pb-4 pt-2',
          )}
        >
          <div className="relative mx-auto grid max-w-[360px] grid-cols-[1fr_auto_1fr] items-end">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (layer.id === 'core') return;
                setIsRangeOpen((open) => !open);
                setIsSourceOpen(false);
              }}
              className={cn(
                'relative flex h-11 items-center justify-center gap-1 font-serif text-[14px] transition-colors',
                layer.id === 'core' ? 'text-[#3A332B] dark:text-[#EADCC7]/52' : 'text-amber-900 dark:text-[#F3D8B6]',
              )}
            >
              <span>{layer.id === 'core' ? 'All Time' : rangeLabels[range]}</span>
              {layer.id !== 'core' && (
                <ChevronDown
                  size={12}
                  strokeWidth={1.6}
                  className={cn('transition-transform', isRangeOpen && 'rotate-180')}
                />
              )}
            </button>

            <div className="h-8 w-px bg-[#EADCC7]/16" />

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsSourceOpen((open) => !open);
                setIsRangeOpen(false);
              }}
              className="relative flex h-11 items-center justify-center gap-1 font-serif text-[14px] text-amber-900 dark:text-[#F3D8B6] transition-colors"
            >
              <span>{sourceLabels[source]}</span>
              <ChevronDown
                size={12}
                strokeWidth={1.6}
                className={cn('transition-transform', isSourceOpen && 'rotate-180')}
              />
            </button>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[#EADCC7]/22 to-transparent" />
            <div className="pointer-events-none absolute bottom-0 left-[12%] h-px w-[32%] bg-gradient-to-r from-transparent via-[#E6C59B]/72 to-transparent shadow-[0_0_12px_rgba(230,197,155,0.28)]" />
          </div>

          <AnimatePresence>
            {isRangeOpen && layer.id !== 'core' && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                onClick={(e) => e.stopPropagation()}
                className="mx-auto mt-3 max-w-[320px] rounded-[18px] border border-amber-700/16 dark:border-[#E6C59B]/16 bg-white/70 dark:bg-[#111820]/54 p-2 shadow-[0_18px_50px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-2xl"
              >
                <div className="grid grid-cols-3 gap-1">
                  {(['7days', '30days', 'all'] as StrataRange[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setRange(option);
                        setIsRangeOpen(false);
                      }}
                      className={cn(
                        'h-8 rounded-[12px] font-sans text-[11px] transition-colors',
                        range === option
                          ? 'bg-amber-700/14 dark:bg-[#E6C59B]/14 text-amber-950 dark:text-[#F8E7CD]'
                          : 'text-[#3A332B] dark:text-[#EADCC7]/62 hover:bg-amber-700/8 dark:hover:bg-[#E6C59B]/8 hover:text-amber-950 dark:hover:text-[#F8E7CD]',
                      )}
                    >
                      {rangeLabels[option]}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setRange('custom')}
                  className={cn(
                    'mt-1 h-8 w-full rounded-[12px] font-sans text-[11px] transition-colors',
                    range === 'custom'
                      ? 'bg-amber-700/14 dark:bg-[#E6C59B]/14 text-amber-950 dark:text-[#F8E7CD]'
                      : 'text-[#3A332B] dark:text-[#EADCC7]/62 hover:bg-amber-700/8 dark:hover:bg-[#E6C59B]/8 hover:text-amber-950 dark:hover:text-[#F8E7CD]',
                  )}
                >
                  Custom Range
                </button>
                {range === 'custom' && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="min-w-0 rounded-[12px] border border-amber-700/10 dark:border-[#E6C59B]/10 bg-white/50 dark:bg-black/10 px-2 py-2 font-sans text-[11px] text-amber-950 dark:text-[#F8E7CD] outline-none [color-scheme:dark]"
                    />
                    <input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="min-w-0 rounded-[12px] border border-amber-700/10 dark:border-[#E6C59B]/10 bg-white/50 dark:bg-black/10 px-2 py-2 font-sans text-[11px] text-amber-950 dark:text-[#F8E7CD] outline-none [color-scheme:dark]"
                    />
                  </div>
                )}
              </motion.div>
            )}

            {isSourceOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                onClick={(e) => e.stopPropagation()}
                className="mx-auto mt-3 max-w-[320px] rounded-[18px] border border-amber-700/16 dark:border-[#E6C59B]/16 bg-white/70 dark:bg-[#111820]/54 p-2 shadow-[0_18px_50px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-2xl"
              >
                <div className="grid grid-cols-2 gap-1">
                  {availableSources.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setSource(option);
                        setIsSourceOpen(false);
                      }}
                      className={cn(
                        'h-8 rounded-[12px] font-sans text-[11px] transition-colors',
                        source === option
                          ? 'bg-amber-700/14 dark:bg-[#E6C59B]/14 text-amber-950 dark:text-[#F8E7CD]'
                          : 'text-[#3A332B] dark:text-[#EADCC7]/62 hover:bg-amber-700/8 dark:hover:bg-[#E6C59B]/8 hover:text-amber-950 dark:hover:text-[#F8E7CD]',
                      )}
                    >
                      {sourceLabels[option]}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <main className="px-[42px] pb-16 pt-2">
          {filteredMemories.length === 0 ? (
            <div className="flex min-h-[260px] items-center justify-center opacity-40">
              <span className="font-sans text-[12px] uppercase tracking-widest">No memories found.</span>
            </div>
          ) : (
            <div className="mx-auto max-w-[360px] divide-y divide-[#E6C59B]/10">
              {filteredMemories.map((memory) => (
                <button
                  key={memory.id}
                  type="button"
                  onClick={() => {
                    setSelectedMemory(memory);
                    setConfirmDeleteId(null);
                    setIsEditing(false);
                    setDetailError('');
                  }}
                  className="block w-full py-5 text-left"
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] tracking-wider text-[#3A332B] dark:text-[#EADCC7]/42">
                        {formatMemoryDate(memory.date)}
                      </p>
                      <h3 className="mt-1 font-serif text-[16px] leading-snug text-amber-900 dark:text-[#F3D8B6]/92">{memory.title}</h3>
                    </div>
                    <span className="shrink-0 rounded-full border border-amber-700/14 dark:border-[#E6C59B]/14 px-2 py-1 font-sans text-[9px] uppercase tracking-[0.12em] text-amber-800 dark:text-[#E6C59B]/60">
                      {memory.sourceLabel}
                    </span>
                  </div>
                  <p className="line-clamp-2 font-sans text-[12px] leading-relaxed text-[#3A332B] dark:text-[#EADCC7]/66">{memory.body}</p>
                </button>
              ))}
            </div>
          )}
        </main>
      </div>

      <AnimatePresence>
        {isAddingCore && (
          <motion.div
            className="absolute inset-0 z-[110] flex items-center justify-center bg-[#F5EFE7]/50 dark:bg-[#03070B]/48 px-5 backdrop-blur-[10px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsAddingCore(false)}
          >
            <motion.article
              initial={{ opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.97 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-[340px] rounded-[12px] border border-[#3A332B]/15 dark:border-[#E6C59B]/12 bg-white/40 dark:bg-[#101820]/52 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.1)] dark:shadow-[0_24px_70px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.035)] backdrop-blur-2xl"
            >
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="font-serif text-[17px] uppercase tracking-[0.18em] text-amber-900 dark:text-[#F3D8B6]">New Core</h2>
                  <p className="mt-1 font-sans text-[11px] text-[#3A332B] dark:text-[#EADCC7]/48">Write into permanent/core.</p>
                </div>
                <button
                  onClick={() => setIsAddingCore(false)}
                  className="flex h-8 w-8 items-center justify-center rounded-full text-[#3A332B] dark:text-[#EADCC7]/42 transition-colors hover:bg-white/5 hover:text-amber-950 dark:hover:text-[#F8E7CD]"
                >
                  <X size={16} strokeWidth={1.5} />
                </button>
              </div>
              <input
                value={newCoreTitle}
                onChange={(e) => setNewCoreTitle(e.target.value)}
                placeholder="Title"
                className="w-full rounded-[10px] border border-amber-700/12 dark:border-[#E6C59B]/12 bg-white/60 dark:bg-black/12 px-3 py-2 font-serif text-[15px] text-amber-900 dark:text-[#F3D8B6] outline-none placeholder:text-[#3A332B] dark:text-[#EADCC7]/32"
              />
              <textarea
                value={newCoreBody}
                onChange={(e) => setNewCoreBody(e.target.value)}
                placeholder="Core instruction, promise, or stable context..."
                className="mt-3 min-h-[180px] w-full resize-none rounded-[10px] border border-amber-700/12 dark:border-[#E6C59B]/12 bg-white/60 dark:bg-black/12 px-3 py-3 font-sans text-[13px] leading-relaxed text-[#3A332B] dark:text-[#EADCC7]/76 outline-none placeholder:text-[#3A332B] dark:text-[#EADCC7]/32"
              />
              <button
                onClick={saveNewCore}
                disabled={isSaving || !newCoreBody.trim()}
                className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-amber-700/16 dark:border-[#E6C59B]/16 bg-amber-700/8 dark:bg-[#E6C59B]/8 font-serif text-[12px] uppercase tracking-[0.16em] text-amber-900 dark:text-[#F3D8B6] disabled:opacity-35"
              >
                {isSaving && <Loader2 size={14} className="animate-spin" />}
                Save Core
              </button>
              {detailError && (
                <p className="mt-3 rounded-[10px] border border-[#D8A08C]/18 bg-[#D8A08C]/8 p-2 font-sans text-[11px] text-[#F0B7A2]/80">
                  {detailError}
                </p>
              )}
            </motion.article>
          </motion.div>
        )}

        {selectedMemory && (
          <motion.div
            className="absolute inset-0 z-[110] flex items-center justify-center bg-[#F5EFE7]/50 dark:bg-[#03070B]/48 px-5 backdrop-blur-[10px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              setSelectedMemory(null);
              setConfirmDeleteId(null);
              setIsEditing(false);
              setDetailError('');
            }}
          >
            <motion.article
              initial={{ opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.97 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="relative flex max-h-[calc(100dvh-40px)] w-full max-w-[340px] flex-col overflow-hidden rounded-[12px] border border-[#3A332B]/15 dark:border-[#E6C59B]/12 bg-white/40 dark:bg-[#101820]/48 shadow-[0_24px_70px_rgba(0,0,0,0.1)] dark:shadow-[0_24px_70px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.035)] backdrop-blur-2xl"
            >
              <div className="absolute right-4 top-4 flex items-center gap-2">
                <button
                  onClick={() => (isEditing ? saveEdit() : startEditing(selectedMemory))}
                  disabled={isSaving}
                  className="flex h-8 items-center justify-center rounded-full border border-amber-700/14 dark:border-[#E6C59B]/14 px-2.5 text-[#3A332B] dark:text-[#EADCC7]/58 transition-colors hover:bg-amber-700/8 dark:hover:bg-[#E6C59B]/8 hover:text-amber-950 dark:hover:text-[#F8E7CD] disabled:opacity-35"
                >
                  {isSaving && isEditing ? <Loader2 size={14} className="animate-spin" /> : isEditing ? 'Save' : <Edit3 size={14} strokeWidth={1.5} />}
                </button>
                <button
                  onClick={() => handleDelete(selectedMemory)}
                  disabled={isSaving || isEditing}
                  className={cn(
                    'flex h-8 items-center justify-center rounded-full border px-2.5 font-sans text-[10px] uppercase tracking-[0.12em] transition-colors',
                    confirmDeleteId === selectedMemory.id
                      ? 'border-[#D8A08C]/32 bg-[#D8A08C]/10 text-[#F0B7A2]'
                      : 'border-amber-700/14 dark:border-[#E6C59B]/14 text-[#3A332B] dark:text-[#EADCC7]/58 hover:bg-amber-700/8 dark:hover:bg-[#E6C59B]/8 hover:text-amber-950 dark:hover:text-[#F8E7CD]',
                    (isSaving || isEditing) && 'opacity-35',
                  )}
                >
                  {isSaving && confirmDeleteId === selectedMemory.id ? <Loader2 size={14} className="animate-spin" /> : confirmDeleteId === selectedMemory.id ? 'Confirm' : <Trash2 size={14} strokeWidth={1.5} />}
                </button>
              </div>

              <div className="min-h-0 overflow-y-auto overscroll-contain p-5 [scrollbar-color:rgba(230,197,155,0.18)_transparent] [scrollbar-width:thin]">
                <button
                  onClick={() => {
                    if (isEditing) {
                      setIsEditing(false);
                      return;
                    }
                    setSelectedMemory(null);
                  }}
                  className="mb-5 flex h-7 w-7 items-center justify-center rounded-full text-[#3A332B] dark:text-[#EADCC7]/42 transition-colors hover:bg-white/5 hover:text-amber-950 dark:hover:text-[#F8E7CD]"
                >
                  <X size={16} strokeWidth={1.5} />
                </button>

                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#3A332B] dark:text-[#EADCC7]/42">
                  {formatMemoryDate(selectedMemory.date)} · {selectedMemory.sourceLabel}
                </p>
                {isEditing ? (
                  <>
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="mt-3 w-full rounded-[10px] border border-amber-700/12 dark:border-[#E6C59B]/12 bg-white/60 dark:bg-black/12 px-3 py-2 pr-20 font-serif text-[18px] text-amber-900 dark:text-[#F3D8B6] outline-none"
                    />
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      className="mt-4 min-h-[160px] w-full resize-none rounded-[10px] border border-amber-700/12 dark:border-[#E6C59B]/12 bg-white/60 dark:bg-black/12 px-3 py-3 font-sans text-[13px] leading-relaxed text-[#3A332B] dark:text-[#EADCC7]/76 outline-none"
                    />
                  </>
                ) : (
                  <>
                    <h2 className="mt-3 pr-20 font-serif text-[22px] leading-tight text-amber-900 dark:text-[#F3D8B6]">{selectedMemory.title}</h2>
                    <p className="mt-5 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-[#3A332B] dark:text-[#EADCC7]/76">
                      {selectedMemory.body}
                    </p>
                  </>
                )}
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {selectedMemory.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-amber-700/8 dark:bg-[#E6C59B]/8 px-2 py-0.5 font-sans text-[9px] uppercase tracking-[0.12em] text-amber-800 dark:text-[#E6C59B]/62">
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-5 border-t border-amber-700/10 dark:border-[#E6C59B]/10 pt-4 font-sans text-[11px] text-[#3A332B] dark:text-[#EADCC7]/44">
                  Importance {selectedMemory.importance} / 10
                </div>
              </div>
              {detailError && (
                <p className="mt-3 rounded-[10px] border border-[#D8A08C]/18 bg-[#D8A08C]/8 p-2 font-sans text-[11px] text-[#F0B7A2]/80">
                  {detailError}
                </p>
              )}
            </motion.article>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function StrataToolModal({ tool, onClose }: { tool: StrataTool; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchMemoryResult[]>([]);
  const [intakeText, setIntakeText] = useState('');
  const [intakeResult, setIntakeResult] = useState('');
  const [importStatus, setImportStatus] = useState<Record<string, any> | null>(null);
  const [importResults, setImportResults] = useState<any[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState('');

  const titleMap: Record<StrataTool, string> = {
    search: 'Search',
    intake: 'Intake',
    import: 'Import',
    export: 'Export',
  };

  const runSearch = async () => {
    if (!query.trim()) return;
    setIsBusy(true);
    setMessage('');
    try {
      const results = await api.searchMemories(query.trim());
      setSearchResults(results);
      setMessage(results.length ? '' : 'No memories found.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setIsBusy(false);
    }
  };

  const runIntake = async () => {
    if (!intakeText.trim()) return;
    setIsBusy(true);
    setMessage('');
    setIntakeResult('');
    try {
      const result = await api.growMemory(intakeText.trim());
      setIntakeResult(result.result);
      setIntakeText('');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Intake failed.');
    } finally {
      setIsBusy(false);
    }
  };

  const uploadImport = async (file?: File | null) => {
    if (!file) return;
    setIsBusy(true);
    setMessage('');
    try {
      const started = await api.uploadMemoryImport(file);
      setMessage(`Import started: ${started.filename}`);
      const status = await api.getMemoryImportStatus();
      setImportStatus(status);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Import upload failed.');
    } finally {
      setIsBusy(false);
    }
  };

  const refreshImport = async () => {
    setIsBusy(true);
    setMessage('');
    try {
      const [status, results] = await Promise.all([
        api.getMemoryImportStatus(),
        api.getMemoryImportResults(12),
      ]);
      setImportStatus(status);
      setImportResults(results.buckets || []);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Import refresh failed.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <motion.div
      className="absolute inset-0 z-[100] flex items-center justify-center bg-[#F5EFE7]/50 dark:bg-[#03070B]/46 px-5 backdrop-blur-[10px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.article
        initial={{ opacity: 0, y: 10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[78vh] w-full max-w-[360px] overflow-y-auto rounded-[12px] border border-[#3A332B]/15 dark:border-[#E6C59B]/14 bg-white/40 dark:bg-[#101820]/58 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.1)] dark:shadow-[0_24px_70px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-2xl scrollbar-hide"
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-[17px] uppercase tracking-[0.2em] text-amber-900 dark:text-[#F3D8B6]">
              {titleMap[tool]}
            </h2>
            <p className="mt-1 font-sans text-[11px] text-[#3A332B] dark:text-[#EADCC7]/48">
              {tool === 'search' && 'Find memories by meaning or keyword.'}
              {tool === 'intake' && 'Send a deliberate fragment through grow().'}
              {tool === 'import' && 'Import conversation history for review.'}
              {tool === 'export' && 'Coming later.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#3A332B] dark:text-[#EADCC7]/50 transition-colors hover:bg-white/5 hover:text-amber-950 dark:hover:text-[#F8E7CD]"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        {tool === 'search' && (
          <div>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runSearch();
                }}
                placeholder="Search memories..."
                className="min-w-0 flex-1 rounded-[10px] border border-amber-700/12 dark:border-[#E6C59B]/12 bg-white/60 dark:bg-black/14 px-3 py-2 font-sans text-[13px] text-amber-950 dark:text-[#F8E7CD] outline-none placeholder:text-[#3A332B] dark:text-[#EADCC7]/32"
              />
              <button
                onClick={runSearch}
                disabled={isBusy || !query.trim()}
                className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-amber-700/14 dark:border-[#E6C59B]/14 text-[#3A332B] dark:text-[#EADCC7]/66 disabled:opacity-35"
              >
                {isBusy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
              </button>
            </div>
            <div className="mt-4 divide-y divide-[#E6C59B]/10">
              {searchResults.map((result) => (
                <div key={result.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-serif text-[14px] text-amber-900 dark:text-[#F3D8B6]/90">{result.name}</h3>
                    <span className="font-mono text-[9px] text-[#3A332B] dark:text-[#EADCC7]/40">{Math.round(result.score)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 font-sans text-[11px] leading-relaxed text-[#3A332B] dark:text-[#EADCC7]/62">
                    {result.content_preview}
                  </p>
                  {result.domain?.length > 0 && (
                    <p className="mt-2 font-sans text-[9px] uppercase tracking-[0.12em] text-amber-800 dark:text-[#E6C59B]/46">
                      {result.domain.join(' / ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tool === 'intake' && (
          <div>
            <textarea
              value={intakeText}
              onChange={(e) => setIntakeText(e.target.value)}
              placeholder="Write what should enter memory..."
              className="min-h-[150px] w-full resize-none rounded-[10px] border border-amber-700/12 dark:border-[#E6C59B]/12 bg-white/60 dark:bg-black/14 px-3 py-3 font-sans text-[13px] leading-relaxed text-amber-950 dark:text-[#F8E7CD] outline-none placeholder:text-[#3A332B] dark:text-[#EADCC7]/32"
            />
            <button
              onClick={runIntake}
              disabled={isBusy || !intakeText.trim()}
              className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-amber-700/16 dark:border-[#E6C59B]/16 bg-amber-700/8 dark:bg-[#E6C59B]/8 font-serif text-[12px] uppercase tracking-[0.16em] text-amber-900 dark:text-[#F3D8B6] disabled:opacity-35"
            >
              {isBusy && <Loader2 size={14} className="animate-spin" />}
              Send to Grow
            </button>
            {intakeResult && (
              <pre className="mt-4 whitespace-pre-wrap rounded-[10px] border border-amber-700/10 dark:border-[#E6C59B]/10 bg-white/60 dark:bg-black/12 p-3 font-sans text-[11px] leading-relaxed text-[#3A332B] dark:text-[#EADCC7]/68">
                {intakeResult}
              </pre>
            )}
          </div>
        )}

        {tool === 'import' && (
          <div>
            <label className="flex min-h-[96px] cursor-pointer flex-col items-center justify-center rounded-[10px] border border-dashed border-amber-700/18 dark:border-[#E6C59B]/18 bg-white/60 dark:bg-black/12 px-4 text-center transition-colors hover:bg-amber-700/7 dark:hover:bg-[#E6C59B]/7">
              <Download size={18} strokeWidth={1.5} className="mb-2 text-amber-800 dark:text-[#E6C59B]/66" />
              <span className="font-serif text-[13px] text-amber-900 dark:text-[#F3D8B6]/86">Upload conversation file</span>
              <span className="mt-1 font-sans text-[10px] text-[#3A332B] dark:text-[#EADCC7]/42">JSON, Markdown, or text</span>
              <input
                type="file"
                className="hidden"
                accept=".json,.md,.txt,text/plain,application/json"
                onChange={(e) => uploadImport(e.target.files?.[0])}
              />
            </label>
            <button
              onClick={refreshImport}
              disabled={isBusy}
              className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-amber-700/14 dark:border-[#E6C59B]/14 font-serif text-[12px] uppercase tracking-[0.16em] text-[#3A332B] dark:text-[#EADCC7]/70 disabled:opacity-35"
            >
              {isBusy && <Loader2 size={14} className="animate-spin" />}
              Refresh Review Queue
            </button>
            {importStatus && (
              <div className="mt-4 rounded-[10px] border border-amber-700/10 dark:border-[#E6C59B]/10 bg-white/60 dark:bg-black/12 p-3 font-sans text-[11px] text-[#3A332B] dark:text-[#EADCC7]/62">
                <p>Status: {importStatus.status || 'unknown'}</p>
                <p>Processed: {importStatus.processed || 0} / {importStatus.total_chunks || 0}</p>
                <p>Created: {importStatus.memories_created || 0} · Merged: {importStatus.memories_merged || 0}</p>
              </div>
            )}
            <div className="mt-3 divide-y divide-[#E6C59B]/10">
              {importResults.map((bucket) => (
                <div key={bucket.id} className="py-3">
                  <h3 className="font-serif text-[13px] text-amber-900 dark:text-[#F3D8B6]/88">{bucket.name || 'Untitled memory'}</h3>
                  <p className="mt-1 line-clamp-2 font-sans text-[11px] leading-relaxed text-[#3A332B] dark:text-[#EADCC7]/58">
                    {bucket.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {tool === 'export' && (
          <div className="rounded-[10px] border border-amber-700/10 dark:border-[#E6C59B]/10 bg-white/60 dark:bg-black/12 p-4 font-sans text-[12px] leading-relaxed text-[#3A332B] dark:text-[#EADCC7]/58">
            Export is parked for later. When we wire it, this can become JSON/Markdown export with layer and date filters.
          </div>
        )}

        {message && (
          <p className="mt-4 rounded-[10px] border border-amber-700/10 dark:border-[#E6C59B]/10 bg-white/50 dark:bg-black/10 p-3 font-sans text-[11px] text-[#3A332B] dark:text-[#EADCC7]/58">
            {message}
          </p>
        )}
      </motion.article>
    </motion.div>
  );
}

export default function StrataRoom({ onClose }: StrataRoomProps) {
  const [activeLayer, setActiveLayer] = useState<LayerId>('core');
  const [openLayer, setOpenLayer] = useState<LayerSummary | null>(null);
  const [activeTool, setActiveTool] = useState<StrataTool | null>(null);
  const [memories, setMemories] = useState<StrataMemory[]>([]);
  const [isLoadingMemories, setIsLoadingMemories] = useState(true);
  const [memoryError, setMemoryError] = useState('');

  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [promptContent, setPromptContent] = useState('');
  const [isFetchingPrompt, setIsFetchingPrompt] = useState(false);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  useEffect(() => {
    if (showSettings) {
      loadPrompt();
    }
  }, [showSettings]);

  const loadPrompt = async () => {
    setIsFetchingPrompt(true);
    try {
      const prompts = await api.getSystemPrompts();
      setPromptContent(prompts.theme_recurrence || '');
    } catch (e) {
      console.error("Failed to fetch prompt", e);
    } finally {
      setIsFetchingPrompt(false);
    }
  };

  const handleSavePrompt = async () => {
    setIsSavingPrompt(true);
    try {
      await api.updateSystemPrompts({ theme_recurrence: promptContent });
      setShowSettings(false);
    } catch (e) {
      console.error("Failed to save prompt", e);
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleResetPrompt = async () => {
    setIsSavingPrompt(true);
    try {
      await api.resetSystemPrompt('theme_recurrence');
      await loadPrompt();
    } catch (e) {
      console.error("Failed to reset prompt", e);
    } finally {
      setIsSavingPrompt(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const loadMemories = async () => {
      setIsLoadingMemories(true);
      setMemoryError('');
      try {
        const [buckets, coreEntries] = await Promise.all([
          api.getMemoryBuckets(800, undefined, 'strata'),
          api.getCoreMemories(),
        ]);
        if (cancelled) return;
        setMemories([...coreEntries.map(coreEntryToMemory), ...buckets.map(bucketToMemory)]);
      } catch (err) {
        if (cancelled) return;
        setMemoryError(err instanceof Error ? err.message : 'Failed to load memories.');
        setMemories(mockMemories);
      } finally {
        if (!cancelled) setIsLoadingMemories(false);
      }
    };
    loadMemories();
    return () => {
      cancelled = true;
    };
  }, []);

  const layerCounts = useMemo(() => {
    return memories.reduce<Record<LayerId, number>>(
      (counts, memory) => {
        counts[memory.layer] += 1;
        return counts;
      },
      { core: 0, living: 0, echoes: 0, archive: 0 },
    );
  }, [memories]);

  const layerSummaries = useMemo(
    () => layers.map((layer) => ({ ...layer, count: layerCounts[layer.id] })),
    [layerCounts],
  );

  const currentOpenLayer = openLayer ? layerSummaries.find((layer) => layer.id === openLayer.id) || openLayer : null;
  const actualMemoryCount = memories.length;
  const lastUpdate = useMemo(
    () => memories.reduce<string>((latest, memory) => {
      const candidate = memory.updatedAt || memory.date;
      const candidateTime = new Date(candidate).getTime();
      if (Number.isNaN(candidateTime)) return latest;
      const latestTime = new Date(latest).getTime();
      return !latest || Number.isNaN(latestTime) || candidateTime > latestTime ? candidate : latest;
    }, ''),
    [memories],
  );
  const totalMemoryCount = Math.max(actualMemoryCount, 1);
  const overviewSegments = [
    { id: 'core' as const, label: 'Core', count: layerCounts.core, className: 'bg-[#F3D8B6]/45' },
    { id: 'living' as const, label: 'Living', count: layerCounts.living, className: 'bg-[#C9A878]/36' },
    { id: 'echoes' as const, label: 'Echoes', count: layerCounts.echoes, className: 'bg-[#D8B7A0]/32' },
    { id: 'archive' as const, label: 'Archive', count: layerCounts.archive, className: 'bg-[#87919A]/28' },
  ];

  const handleUpdateMemory = async (memoryId: string, updates: Partial<StrataMemory>) => {
    const existing = memories.find((memory) => memory.id === memoryId);
    const payload: Record<string, any> = {};
    if (updates.title !== undefined) payload.name = updates.title;
    if (updates.body !== undefined) payload.content = updates.body;
    if (updates.importance !== undefined) payload.importance = updates.importance;
    if (updates.tags !== undefined) payload.tags = updates.tags;
    if (existing?.rawType === 'core') {
      await api.updateCoreMemory(memoryId, payload);
    } else {
      await api.updateMemoryBucket(memoryId, payload);
    }
    setMemories((current) =>
      current.map((memory) => (
        memory.id === memoryId
          ? { ...memory, ...updates, updatedAt: new Date().toISOString() }
          : memory
      )),
    );
  };

  const handleDeleteMemory = async (memoryId: string) => {
    const existing = memories.find((memory) => memory.id === memoryId);
    if (existing?.rawType === 'core') {
      await api.deleteCoreMemory(memoryId);
    } else {
      await api.deleteMemoryBucket(memoryId);
    }
    setMemories((current) => current.filter((memory) => memory.id !== memoryId));
  };

  const handleCreateCoreMemory = async (input: { title: string; body: string }) => {
    const result = await api.createCoreMemory({
      name: input.title,
      content: input.body,
    });
    if (result.entry) {
      setMemories((current) => [coreEntryToMemory(result.entry), ...current]);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 z-50 flex flex-col overflow-hidden bg-[#F5EFE7] dark:bg-[#03070B] font-sans text-[#3A332B] dark:text-[#EADCC7]"
    >
      <div className="absolute inset-0 bg-[url('/undertow/Strata_bg_light.PNG')] dark:bg-[url('/undertow/Strata_bg.PNG')] bg-cover bg-center bg-no-repeat opacity-[0.8] dark:opacity-88" />
      <div className="absolute inset-0 bg-[#F5EFE7]/40 dark:bg-[#03070B]/18 backdrop-blur-[2px] dark:backdrop-blur-none" />

      <div className="relative z-10 h-full overflow-y-auto px-5 pb-10 pt-10 scrollbar-hide">
        <header className="mb-7 flex items-start justify-between">
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-amber-700/16 dark:border-[#E6C59B]/16 bg-white/50 dark:bg-[#05080B]/20 text-[#2D2822] dark:text-[#F1D2A7]/76 backdrop-blur-md transition-colors hover:bg-amber-700/8 dark:hover:bg-[#E6C59B]/8 hover:text-amber-950 dark:hover:text-[#F8E7CD]"
          >
            <ChevronLeft size={23} strokeWidth={1.5} />
          </button>

          <div className="flex flex-col items-center pt-2 text-center">
            <div className="mb-3 flex items-center justify-center text-amber-700 dark:text-[#EAC895]/64">
              <div className="h-px w-12 bg-current" />
              <Sparkles size={15} className="mx-3" strokeWidth={1.35} />
              <div className="h-px w-12 bg-current" />
            </div>
            <h1 className="font-serif text-[25px] font-medium uppercase leading-none tracking-[0.28em] text-amber-900 dark:text-[#F3D8B6]">
              Strata
            </h1>
            <p className="mt-3 font-serif text-[13px] italic text-[#4A4238] dark:text-[#F0DEC5]/78">
              The layers of what I remember.
            </p>
          </div>

          <button 
            onClick={() => setShowSettings(true)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-amber-700/16 dark:border-[#E6C59B]/16 bg-white/50 dark:bg-[#05080B]/20 text-[#2D2822] dark:text-[#F1D2A7]/76 backdrop-blur-md transition-colors hover:bg-amber-700/8 dark:hover:bg-[#E6C59B]/8 hover:text-amber-950 dark:hover:text-[#F8E7CD]"
          >
            <Settings2 size={20} strokeWidth={1.5} />
          </button>
        </header>

        <section className="mb-4 overflow-hidden rounded-[8px] border border-amber-700/18 dark:border-[#E6C59B]/18 bg-white/40 dark:bg-[#091018]/34 p-4 shadow-[inset_0_1px_0_rgba(244,220,184,0.045)] backdrop-blur-[14px]">
          <div className="mb-4 text-center">
            <h2 className="font-serif text-[13px] uppercase tracking-[0.16em] text-amber-900 dark:text-[#F3D8B6]">
              Memory Overview
            </h2>
            <p className="mt-2 font-serif text-[11px] italic text-[#3A332B] dark:text-[#EADCC7]/64">The shape of what remains.</p>
          </div>
          <div className="overflow-hidden rounded-full border border-amber-700/8 dark:border-[#F3D8B6]/8 bg-white/50 dark:bg-[#05080B]/26 p-[1px] shadow-[inset_0_1px_4px_rgba(0,0,0,0.24)]">
            <div className="flex h-2 w-full overflow-hidden rounded-full">
              {overviewSegments.map((segment) => (
                <div
                  key={segment.id}
                  className={cn(
                    'h-full shadow-[inset_0_1px_0_rgba(255,240,210,0.12)]',
                    segment.className,
                  )}
                  style={{ width: `${(segment.count / totalMemoryCount) * 100}%` }}
                />
              ))}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {overviewSegments.map((segment) => (
              <div key={segment.id} className="min-w-0 text-center">
                <p className="font-serif text-[12px] leading-none text-amber-900 dark:text-[#F3D8B6]/86">{segment.count.toLocaleString()}</p>
                <p className="mt-1 truncate font-sans text-[8px] uppercase tracking-[0.12em] text-[#3A332B] dark:text-[#EADCC7]/42">
                  {segment.label}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-center font-serif text-[12px] text-[#3A332B] dark:text-[#EADCC7]/66">
            {isLoadingMemories ? 'Loading memories...' : `${actualMemoryCount.toLocaleString()} memories across four layers`}
          </p>
          {memoryError && (
            <p className="mt-2 text-center font-sans text-[10px] text-[#D8A08C]/68">
              Using fallback data: {memoryError}
            </p>
          )}
        </section>

        <div className="flex flex-col gap-3">
          {layerSummaries.map((layer) => {
            const Icon = layer.icon;
            const selected = layer.id === activeLayer;
            return (
              <button
                key={layer.id}
                type="button"
                onClick={() => {
                  setActiveLayer(layer.id);
                  setOpenLayer(layer);
                }}
                className={cn(
                  'group w-full rounded-[8px] border p-4 text-left backdrop-blur-[14px] transition-colors',
                  selected
                    ? 'border-[#F0C990]/38 bg-white/70 dark:bg-[#111923]/44 shadow-[0_0_28px_rgba(240,201,144,0.08),inset_0_1px_0_rgba(245,225,196,0.08)]'
                    : 'border-amber-700/16 dark:border-[#E6C59B]/16 bg-white/40 dark:bg-[#091018]/30 hover:border-amber-700/28 dark:hover:border-[#E6C59B]/28 hover:bg-white/60 dark:hover:bg-[#101820]/38',
                )}
              >
                <div className="flex gap-4">
                  <OrbitalMark icon={Icon} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      <h3 className="font-serif text-[15px] uppercase tracking-[0.18em] text-amber-900 dark:text-[#F3D8B6]">
                        {layer.title}
                      </h3>
                      <span className="rounded-full border border-amber-700/20 dark:border-[#E6C59B]/20 px-2 py-0.5 font-serif text-[9px] uppercase tracking-[0.12em] text-amber-800 dark:text-[#E6C59B]/76">
                        {layer.badge}
                      </span>
                    </div>
                    <p className="font-serif text-[12px] leading-relaxed text-[#3A332B] dark:text-[#EADCC7]/78">
                      {layer.description}
                      <br />
                      {layer.detail}
                    </p>
                    <div className="mt-3 flex items-end gap-4 border-t border-amber-700/12 dark:border-[#E6C59B]/12 pt-3">
                      <div>
                        <p className="font-serif text-[20px] leading-none text-amber-900 dark:text-[#F3D8B6]">{layer.count.toLocaleString()}</p>
                        <p className="mt-1 font-serif text-[11px] text-[#3A332B] dark:text-[#EADCC7]/62">Entries</p>
                      </div>
                      <div className="h-9 w-px bg-amber-700/14 dark:bg-[#E6C59B]/14" />
                      <div className="min-w-0">
                        {layer.id === 'core' ? (
                          <p className="font-serif text-[25px] leading-[1.1] text-amber-900 dark:text-[#F3D8B6]/92">∞</p>
                        ) : (
                          <MiniDecayLine />
                        )}
                        <p className="font-serif text-[11px] text-[#3A332B] dark:text-[#EADCC7]/64">
                          {layer.id === 'core' ? 'Decay Curve' : layer.decay}
                        </p>
                      </div>
                    </div>
                  </div>
                  <ChevronRight
                    size={18}
                    strokeWidth={1.4}
                    className={cn('mt-12 shrink-0 text-amber-800 dark:text-[#E6C59B]/50 transition-transform group-hover:translate-x-0.5', selected && 'text-amber-900 dark:text-[#F3D8B6]/80')}
                  />
                </div>
              </button>
            );
          })}
        </div>

        <section className="mt-5 rounded-[8px] border border-amber-700/16 dark:border-[#E6C59B]/16 bg-white/40 dark:bg-[#091018]/32 p-4 backdrop-blur-[14px]">
          <div className="mb-4 flex items-center gap-2">
            <Layers3 size={16} strokeWidth={1.5} className="text-amber-700 dark:text-[#EAC895]/76" />
            <h2 className="font-serif text-[14px] uppercase tracking-[0.17em] text-amber-900 dark:text-[#F3D8B6]">Memory Tools</h2>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { id: 'search' as const, label: 'Search', icon: Search },
              { id: 'intake' as const, label: 'Intake', icon: Layers3 },
              { id: 'import' as const, label: 'Import', icon: Download },
              { id: 'export' as const, label: 'Export', icon: Upload },
            ].map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.label}
                  onClick={() => setActiveTool(tool.id)}
                  className="flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-[8px] border border-amber-700/14 dark:border-[#E6C59B]/14 bg-white/50 dark:bg-[#05080B]/18 font-serif text-[11px] text-[#3A332B] dark:text-[#EADCC7]/72 transition-colors hover:bg-amber-700/8 dark:hover:bg-[#E6C59B]/8 hover:text-amber-900 dark:hover:text-[#F3D8B6]"
                >
                  <Icon size={17} strokeWidth={1.45} />
                  {tool.label}
                </button>
              );
            })}
          </div>
        </section>

        <footer className="mt-5 rounded-[8px] border border-amber-700/14 dark:border-[#E6C59B]/14 bg-white/40 dark:bg-[#091018]/30 p-4 backdrop-blur-[14px]">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div>
              <p className="font-serif text-[12px] uppercase tracking-[0.16em] text-amber-900 dark:text-[#F3D8B6]">Last Update</p>
              <p className="mt-1 font-serif text-[11px] text-[#3A332B] dark:text-[#EADCC7]/58">{formatLastUpdate(lastUpdate)}</p>
            </div>
            <div className="h-10 w-px bg-amber-700/12 dark:bg-[#E6C59B]/12" />
            <div className="text-right">
              <p className="font-serif text-[12px] italic text-amber-900 dark:text-[#F3D8B6]/86">With you, always.</p>
              <p className="mt-1 font-serif text-[11px] text-[#3A332B] dark:text-[#EADCC7]/58">- Elroy</p>
            </div>
          </div>
        </footer>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-20 bg-gradient-to-t from-[#F5EFE7]/90 dark:from-[#03070B] to-transparent" />

      <AnimatePresence>
        {currentOpenLayer && (
          <StrataLayerArchive
            key={currentOpenLayer.id}
            layer={currentOpenLayer}
            memories={memories}
            onUpdateMemory={handleUpdateMemory}
            onDeleteMemory={handleDeleteMemory}
            onCreateCoreMemory={handleCreateCoreMemory}
            onClose={() => setOpenLayer(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeTool && <StrataToolModal key={activeTool} tool={activeTool} onClose={() => setActiveTool(null)} />}
      </AnimatePresence>

      {/* Settings Card */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            className="absolute inset-0 z-[120] flex items-center justify-center bg-[#F5EFE7]/50 dark:bg-[#03070B]/48 px-5 backdrop-blur-[10px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowSettings(false)}
          >
            <motion.article
              initial={{ opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.97 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-[340px] rounded-[12px] border border-[#3A332B]/15 dark:border-[#E6C59B]/12 bg-white/40 dark:bg-[#101820]/52 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.1)] dark:shadow-[0_24px_70px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.035)] backdrop-blur-2xl"
            >
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="font-serif text-[17px] uppercase tracking-[0.18em] text-amber-900 dark:text-[#F3D8B6]">Theme Recurrence</h2>
                  <p className="mt-1 font-sans text-[11px] text-[#3A332B] dark:text-[#EADCC7]/48">Define how Elroy weaves Strata memories.</p>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={handleResetPrompt}
                    title="Reset to default prompt"
                    disabled={isFetchingPrompt || isSavingPrompt}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[#3A332B] dark:text-[#EADCC7]/42 transition-colors hover:bg-white/5 hover:text-amber-950 dark:hover:text-[#F8E7CD] disabled:opacity-35"
                  >
                    <RotateCcw size={14} strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={() => setShowSettings(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[#3A332B] dark:text-[#EADCC7]/42 transition-colors hover:bg-white/5 hover:text-amber-950 dark:hover:text-[#F8E7CD]"
                  >
                    <X size={16} strokeWidth={1.5} />
                  </button>
                </div>
              </div>

              {isFetchingPrompt ? (
                <div className="flex min-h-[180px] w-full items-center justify-center rounded-[10px] border border-amber-700/12 dark:border-[#E6C59B]/12 bg-white/60 dark:bg-black/12">
                  <span className="font-mono text-[10px] tracking-[0.2em] text-amber-900/50 dark:text-[#F3D8B6]/50">LOADING...</span>
                </div>
              ) : (
                <textarea
                  value={promptContent}
                  onChange={(e) => setPromptContent(e.target.value)}
                  placeholder="System prompt instructions..."
                  className="min-h-[220px] w-full resize-none rounded-[10px] border border-amber-700/12 dark:border-[#E6C59B]/12 bg-white/60 dark:bg-black/12 px-3 py-3 font-sans text-[13px] leading-relaxed text-[#3A332B] dark:text-[#EADCC7]/76 outline-none placeholder:text-[#3A332B] dark:text-[#EADCC7]/32"
                />
              )}

              <button
                onClick={handleSavePrompt}
                disabled={isFetchingPrompt || isSavingPrompt || !promptContent.trim()}
                className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-amber-700/16 dark:border-[#E6C59B]/16 bg-amber-700/8 dark:bg-[#E6C59B]/8 font-serif text-[12px] uppercase tracking-[0.16em] text-amber-900 dark:text-[#F3D8B6] disabled:opacity-35"
              >
                {isSavingPrompt && <Loader2 size={14} className="animate-spin" />}
                Save Settings
              </button>
            </motion.article>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
