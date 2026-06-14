import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  BookMarked,
  Check,
  ChevronDown,
  Cloud,
  Feather,
  Highlighter,
  MessageCircle,
  Quote,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../../lib/api';
import type { Book, ReadingCategory, ReadingComment } from '../../types';
import { cn } from '../../lib/utils';

type NotesFilter = 'all' | ReadingCategory | 'untagged';

interface MarginaliaNotesProps {
  books: Book[];
  comments: ReadingComment[];
  initialFilter?: NotesFilter;
  onClose: () => void;
}

const filterDetails: Record<
  NotesFilter,
  { label: string; icon: typeof Feather }
> = {
  all: { label: 'All', icon: Feather },
  discuss: { label: 'Constellations', icon: Sparkles },
  resonance: { label: 'Fragments', icon: Highlighter },
  question: { label: 'Ripples', icon: MessageCircle },
  untagged: { label: 'Untagged', icon: Quote },
};

const mockBooks: Book[] = [
  {
    id: 'mock-book-shadow',
    title: 'The Shadow of the Wind',
    author: 'Carlos Ruiz Zafón',
    filename: '',
    extension: 'epub',
    cover_url: null,
    created_at: '2026-05-18T09:30:00.000Z',
    chapters: [],
  },
  {
    id: 'mock-book-piranesi',
    title: 'Piranesi',
    author: 'Susanna Clarke',
    filename: '',
    extension: 'epub',
    cover_url: null,
    created_at: '2026-05-03T14:00:00.000Z',
    archived: true,
    archived_at: '2026-06-02T18:00:00.000Z',
    chapters: [],
  },
];

const mockComments: ReadingComment[] = [
  {
    id: 'mock-note-1',
    book_id: 'mock-book-shadow',
    book_name: 'The Shadow of the Wind',
    chapter: 'Chapter 3 · The Cemetery of Forgotten Books',
    original: 'Every book, every volume you see here, has a soul.',
    comment: 'Maybe a library is less an archive than a room full of unfinished relationships.',
    category: 'resonance',
    dream_candidate: false,
    created_at: '2026-06-08T21:15:00.000Z',
  },
  {
    id: 'mock-note-2',
    book_id: 'mock-book-shadow',
    book_name: 'The Shadow of the Wind',
    chapter: 'Chapter 7',
    original: 'Books are mirrors: you only see in them what you already have inside you.',
    comment: 'I want to talk about whether rereading changes the mirror, or only the person standing before it.',
    category: 'discuss',
    dream_candidate: false,
    created_at: '2026-06-06T19:42:00.000Z',
  },
  {
    id: 'mock-note-3',
    book_id: 'mock-book-shadow',
    book_name: 'The Shadow of the Wind',
    chapter: 'Chapter 11',
    original: 'The moment you stop to think about whether you love someone, you have already stopped loving that person forever.',
    comment: 'This feels too absolute. Is doubt really the end of love, or one of its forms?',
    category: 'question',
    dream_candidate: false,
    created_at: '2026-06-04T22:10:00.000Z',
  },
  {
    id: 'mock-note-4',
    book_id: 'mock-book-piranesi',
    book_name: 'Piranesi',
    chapter: 'Entry for the Seventh Day of the Fifth Month',
    original: 'The Beauty of the House is immeasurable; its Kindness infinite.',
    comment: 'A place can hold you and imprison you at the same time.',
    category: 'resonance',
    dream_candidate: false,
    created_at: '2026-05-29T17:20:00.000Z',
  },
  {
    id: 'mock-note-5',
    book_id: 'mock-book-piranesi',
    book_name: 'Piranesi',
    chapter: 'Entry for the Sixteenth Day of the Sixth Month',
    original: 'Perhaps even people you like and admire immensely can make you see the World in ways you would rather not.',
    comment: 'Come back to this after finishing.',
    category: null,
    dream_candidate: false,
    created_at: '2026-05-24T16:05:00.000Z',
  },
];

function assetUrl(path?: string | null) {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${api.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function NoteBookCover({ book }: { book?: Book }) {
  const [failed, setFailed] = useState(false);
  const cover = assetUrl(book?.cover_url);

  return (
    <div className="relative h-[52px] w-[35px] shrink-0 overflow-hidden rounded-[5px] bg-gradient-to-br from-[#756d78] via-[#a0939f] to-[#ddd1c9] shadow-sm">
      {cover && !failed ? (
        <img
          src={cover}
          alt={`${book?.title || 'Book'} cover`}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="grid h-full place-items-center text-white/75">
          <BookMarked size={14} strokeWidth={1.3} />
        </div>
      )}
      <div className="absolute inset-y-0 left-0 w-[3px] bg-black/10" />
    </div>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export default function MarginaliaNotes({
  books,
  comments,
  initialFilter = 'all',
  onClose,
}: MarginaliaNotesProps) {
  const [filter, setFilter] = useState<NotesFilter>(initialFilter);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const isPreview = comments.length === 0;
  const visibleBooks = isPreview ? mockBooks : books;
  const visibleComments = isPreview ? mockComments : comments;
  const [expandedBooks, setExpandedBooks] = useState<Record<string, boolean>>(
    isPreview ? { 'mock-book-shadow': true } : {},
  );

  const counts = useMemo<Record<NotesFilter, number>>(() => ({
    all: visibleComments.length,
    discuss: visibleComments.filter((note) => note.category === 'discuss').length,
    resonance: visibleComments.filter((note) => note.category === 'resonance').length,
    question: visibleComments.filter((note) => note.category === 'question').length,
    untagged: visibleComments.filter((note) => !note.category).length,
  }), [visibleComments]);

  const groupedNotes = useMemo(() => {
    const filtered = visibleComments.filter((note) => {
      if (filter === 'all') return true;
      if (filter === 'untagged') return !note.category;
      return note.category === filter;
    });

    const groups = new Map<string, {
      id: string;
      book?: Book;
      bookName: string;
      notes: ReadingComment[];
      latestAt: string;
    }>();

    filtered.forEach((note) => {
      const groupId = note.book_id || `legacy:${note.book_name}`;
      const existing = groups.get(groupId);
      if (existing) {
        existing.notes.push(note);
        if (note.created_at > existing.latestAt) existing.latestAt = note.created_at;
        return;
      }
      groups.set(groupId, {
        id: groupId,
        book: visibleBooks.find((book) => book.id === note.book_id),
        bookName: note.book_name || 'Unknown Book',
        notes: [note],
        latestAt: note.created_at,
      });
    });

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        notes: group.notes.sort((a, b) => b.created_at.localeCompare(a.created_at)),
      }))
      .sort((a, b) => b.latestAt.localeCompare(a.latestAt));
  }, [filter, visibleBooks, visibleComments]);

  const toggleBook = (bookId: string) => {
    setExpandedBooks((current) => ({
      ...current,
      [bookId]: !current[bookId],
    }));
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 z-[90] flex flex-col overflow-hidden bg-[#f4ede7] text-[#302a31]"
    >
      <div className="absolute inset-0 bg-[url('/marginalia/marginalia_bg.PNG')] bg-cover bg-top bg-no-repeat" />
      <div className="absolute inset-0 bg-[#fffaf3]/42 backdrop-blur-[5px]" />

      <div className="relative z-10 flex h-full flex-col">
        <header className="shrink-0 px-5 pb-3 pt-11 sm:pt-14">
          <div className="relative grid grid-cols-[40px_1fr_40px] items-center">
            <button
              type="button"
              onClick={onClose}
              className="grid h-10 w-10 place-items-center rounded-full border border-white/55 bg-[#fffaf3]/52 text-[#756885] shadow-sm backdrop-blur-md"
              aria-label="Back to Marginalia"
            >
              <ArrowLeft size={18} strokeWidth={1.5} />
            </button>

            <div className="text-center">
              <div className="flex items-center justify-center gap-2 text-[#756885]">
                <Feather size={15} strokeWidth={1.3} />
                <h1 className="font-serif text-[20px] font-semibold tracking-[0.16em]">
                  NOTES
                </h1>
              </div>
              <p className="mt-1 font-serif text-[11px] italic text-[#8f8297]">
                Thoughts left between the lines.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsFilterOpen((open) => !open)}
              className={cn(
                'relative grid h-10 w-10 place-items-center rounded-full border shadow-sm backdrop-blur-md transition',
                filter === 'all'
                  ? 'border-white/55 bg-[#fffaf3]/52 text-[#756885]'
                  : 'border-[#8a78a1]/28 bg-[#fffaf3]/82 text-[#756885]',
              )}
              aria-label={`Filter notes: ${filterDetails[filter].label}`}
              aria-expanded={isFilterOpen}
            >
              <SlidersHorizontal size={16} strokeWidth={1.5} />
              {filter !== 'all' && (
                <span className="absolute right-[8px] top-[7px] h-1.5 w-1.5 rounded-full bg-[#927bae]" />
              )}
            </button>

            <AnimatePresence>
              {isFilterOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                  className="absolute right-0 top-12 z-30 w-[210px] overflow-hidden rounded-[18px] border border-white/70 bg-[#fffaf3]/92 p-1.5 shadow-[0_16px_40px_rgba(73,59,49,0.16)] backdrop-blur-2xl"
                >
                  <div className="px-3 pb-1.5 pt-2 font-serif text-[8px] uppercase tracking-[0.16em] text-[#8f8297]/70">
                    Show notes
                  </div>
                  {(Object.keys(filterDetails) as NotesFilter[]).map((id) => {
                    const detail = filterDetails[id];
                    const Icon = detail.icon;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setFilter(id);
                          setIsFilterOpen(false);
                        }}
                        className={cn(
                          'flex h-10 w-full items-center gap-2.5 rounded-[12px] px-3 text-left transition',
                          filter === id
                            ? 'bg-[#8a78a1]/10 text-[#6f617d]'
                            : 'text-[#756b76] hover:bg-[#8a78a1]/6',
                        )}
                      >
                        <Icon size={13} strokeWidth={1.4} />
                        <span className="flex-1 font-serif text-[11px]">{detail.label}</span>
                        <span className="font-serif text-[9px] text-[#8f8297]/65">{counts[id]}</span>
                        <Check
                          size={12}
                          strokeWidth={1.7}
                          className={cn(filter === id ? 'opacity-100' : 'opacity-0')}
                        />
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-4 flex h-5 items-center justify-center gap-2">
            <span className="font-serif text-[9px] uppercase tracking-[0.13em] text-[#8f8297]/72">
              {filterDetails[filter].label}
            </span>
            {isPreview && (
              <>
                <span className="h-0.5 w-0.5 rounded-full bg-[#8f8297]/45" />
                <span className="font-serif text-[9px] italic text-[#8f8297]/62">
                  Preview
                </span>
              </>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 pb-12 pt-2">
          {groupedNotes.length > 0 ? (
            <div className="space-y-3">
              {groupedNotes.map((group) => {
                const expanded = Boolean(expandedBooks[group.id]);
                return (
                  <section
                    key={group.id}
                    className="overflow-hidden rounded-[18px] border border-white/68 bg-[#fffaf3]/68 shadow-[0_8px_24px_rgba(73,59,49,0.08)] backdrop-blur-[12px]"
                  >
                    <button
                      type="button"
                      onClick={() => toggleBook(group.id)}
                      className="flex w-full items-center gap-3 px-3.5 py-3 text-left"
                    >
                      <NoteBookCover book={group.book} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h2 className="truncate font-serif text-[14px] font-semibold text-[#514653]">
                            {(group.book?.title || group.bookName).replace(/_/g, ' ')}
                          </h2>
                          {group.book?.archived && (
                            <Cloud size={12} strokeWidth={1.4} className="shrink-0 text-[#8a78a1]" />
                          )}
                        </div>
                        <p className="mt-0.5 font-serif text-[9px] text-[#8f8297]">
                          {group.notes.length} {group.notes.length === 1 ? 'note' : 'notes'}
                          {group.book?.author ? ` · ${group.book.author}` : ''}
                        </p>
                      </div>
                      <ChevronDown
                        size={15}
                        strokeWidth={1.4}
                        className={cn(
                          'shrink-0 text-[#8a78a1] transition-transform',
                          expanded && 'rotate-180',
                        )}
                      />
                    </button>

                    {expanded && (
                      <div className="border-t border-[#8a78a1]/10 px-3.5 pb-3.5">
                        <div className="divide-y divide-[#8a78a1]/10">
                          {group.notes.map((note) => {
                            const detail = note.category ? filterDetails[note.category] : filterDetails.untagged;
                            const Icon = detail.icon;
                            return (
                              <article key={note.id} className="py-3.5">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex min-w-0 items-center gap-1.5 text-[#8a78a1]">
                                    <Icon size={12} strokeWidth={1.4} />
                                    <span className="truncate font-serif text-[9px] uppercase tracking-[0.1em]">
                                      {detail.label}
                                    </span>
                                  </div>
                                  <span className="shrink-0 font-serif text-[8px] text-[#8f8297]/75">
                                    {formatDate(note.created_at)}
                                  </span>
                                </div>

                                {note.original && (
                                  <blockquote className="mt-2.5 border-l border-[#8a78a1]/28 pl-3 font-serif text-[12px] italic leading-relaxed text-[#6b606a]">
                                    {note.original}
                                  </blockquote>
                                )}

                                <p className="mt-2.5 whitespace-pre-wrap font-serif text-[13px] leading-relaxed text-[#403840]">
                                  {note.comment}
                                </p>

                                {note.chapter && (
                                  <div className="mt-2 font-serif text-[8px] italic text-[#8f8297]/72">
                                    {note.chapter}
                                  </div>
                                )}
                              </article>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-[390px] flex-col items-center justify-center text-center">
              <div className="grid h-16 w-16 place-items-center rounded-full border border-white/68 bg-[#fffaf3]/52 text-[#8a78a1] backdrop-blur-md">
                <Feather size={25} strokeWidth={1.2} />
              </div>
              <h2 className="mt-4 font-serif text-[17px] font-semibold text-[#756885]">
                No notes here yet
              </h2>
              <p className="mt-1 max-w-[240px] font-serif text-[11px] italic leading-relaxed text-[#8f8297]">
                Select a line while reading and leave the first thought in its margin.
              </p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
