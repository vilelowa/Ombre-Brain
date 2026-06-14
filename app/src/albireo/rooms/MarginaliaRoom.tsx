import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import {
  BookMarked,
  BookOpen,
  Check,
  CheckCircle,
  ChevronRight,
  CircleHelp,
  Feather,
  Highlighter,
  Library,
  Loader2,
  Plus,
  Quote,
  Sparkles,
} from 'lucide-react';
import { api } from '../../lib/api';
import type {
  Book,
  ReadingCategory,
  ReadingComment,
  ReadingProgress,
} from '../../types';
import { cn } from '../../lib/utils';
import MarginaliaReader from './MarginaliaReader';
import MarginaliaBookshelf from './MarginaliaBookshelf';
import MarginaliaNotes from './MarginaliaNotes';
import MarginaliaWelcome from './MarginaliaWelcome';

const categoryDetails: Record<
  ReadingCategory,
  { title: string; description: string; icon: typeof Sparkles }
> = {
  discuss: {
    title: 'Constellations',
    description: 'Moments that spark connection.',
    icon: Sparkles,
  },
  resonance: {
    title: 'Fragments',
    description: 'Lines that echo something deeper.',
    icon: Highlighter,
  },
  question: {
    title: 'Ripples',
    description: 'Questions that stay with you.',
    icon: CircleHelp,
  },
};

function assetUrl(path?: string | null) {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${api.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function clampProgress(value?: number | null) {
  return Math.min(1, Math.max(0, value || 0));
}

function progressLabel(progress?: ReadingProgress | null) {
  if (!progress) return 'Not started';
  if (progress.percentage >= 0.995) return 'Finished';
  return `${Math.round(clampProgress(progress.percentage) * 100)}%`;
}

function chapterLabel(book: Book, progress?: ReadingProgress | null) {
  const index = Math.min(
    Math.max(progress?.chapter_idx || 0, 0),
    Math.max(book.chapters.length - 1, 0),
  );
  return book.chapters[index]?.title || `Chapter ${index + 1}`;
}

function BookCover({
  book,
  className,
}: {
  book: Book;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const cover = assetUrl(book.cover_url);

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-[5px] bg-gradient-to-br from-[#746d68] via-[#9a8f86] to-[#d8c9b9] shadow-[0_8px_18px_rgba(63,52,45,0.20)]',
        className,
      )}
    >
      {cover && !failed ? (
        <img
          src={cover}
          alt={`${book.title} cover`}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full flex-col justify-between p-2 text-[#fffaf2]">
          <BookMarked size={13} strokeWidth={1.4} className="opacity-75" />
          <div>
            <div className="line-clamp-3 font-serif text-[12px] font-semibold leading-tight">
              {book.title.replace(/_/g, ' ')}
            </div>
            <div className="mt-1 truncate text-[7px] uppercase tracking-[0.12em] opacity-70">
              {book.author}
            </div>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[4px] bg-black/12" />
    </div>
  );
}

function ReadingProgressBar({ value }: { value?: number | null }) {
  return (
    <div className="h-[4px] overflow-hidden rounded-full bg-[#8a78a1]/12">
      <div
        className="h-full rounded-full bg-[#8a78a1]/76 transition-[width] duration-500"
        style={{ width: `${clampProgress(value) * 100}%` }}
      />
    </div>
  );
}

interface MarginaliaRoomProps {
  isActive?: boolean;
  onReaderActiveChange?: (active: boolean) => void;
}

export default function MarginaliaRoom({
  isActive = false,
  onReaderActiveChange,
}: MarginaliaRoomProps = {}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [comments, setComments] = useState<ReadingComment[]>([]);
  const [featuredQuote, setFeaturedQuote] = useState<ReadingComment | null>(null);
  const [recent, setRecent] = useState<{ book: Book; progress: ReadingProgress } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [showAllBooks, setShowAllBooks] = useState(false);
  const [notesFilter, setNotesFilter] = useState<'all' | ReadingCategory | 'untagged' | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);

  useEffect(() => {
    onReaderActiveChange?.(
      activeBook !== null
      || showAllBooks
      || notesFilter !== null
      || (isActive && showWelcome),
    );
  }, [activeBook, isActive, notesFilter, onReaderActiveChange, showAllBooks, showWelcome]);

  useEffect(() => {
    if (!isActive) setShowWelcome(true);
  }, [isActive]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const [nextBooks, nextComments, nextRecent, nextQuote] = await Promise.all([
        api.getReadingBooks(),
        api.getReadingComments(),
        api.getRecentlyReadBook(),
        api.getFeaturedReadingQuote(),
      ]);
      setBooks(nextBooks);
      setComments(nextComments);
      setRecent(nextRecent.recent);
      setFeaturedQuote(nextQuote.quote);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The reading room could not be loaded.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const categoryCounts = useMemo(() => {
    return comments.reduce<Record<ReadingCategory, number>>(
      (counts, note) => {
        if (note.category) counts[note.category] += 1;
        return counts;
      },
      { discuss: 0, resonance: 0, question: 0 },
    );
  }, [comments]);

  const uploadBook = async (file?: File) => {
    if (!file) return;
    setIsUploading(true);
    setError('');
    try {
      const response = await api.uploadBook(file);
      setBooks((current) => [response.book, ...current]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The book could not be imported.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const shelfPreview = books.filter((book) => !book.archived).slice(0, 5);
  const currentBook = useMemo(() => {
    if (!recent) return books.find((book) => book.progress && !book.archived) || null;
    return {
      ...recent.book,
      progress: recent.progress,
    };
  }, [recent, books]);
  const currentProgress = recent?.progress || currentBook?.progress || null;

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-[#eee9e3]">
      <AnimatePresence>
        {showWelcome && <MarginaliaWelcome key="marginalia-welcome" onEnter={() => setShowWelcome(false)} />}
      </AnimatePresence>

      <div className="relative h-full w-full max-w-[430px] overflow-hidden bg-[#f5eee7] text-[#4b423b] shadow-2xl sm:h-[95%] sm:rounded-[40px] sm:border-[8px] sm:border-[#d7cec6]">
        <div className="absolute inset-0 bg-[url('/marginalia/marginalia_bg.PNG')] bg-cover bg-top bg-no-repeat" />

        <div className="relative h-full overflow-y-auto px-4 pb-24 pt-12 sm:px-5 sm:pt-16">
          <header className="flex flex-col items-center text-center">
            <div className="flex items-center text-[#756885]">
              <h1 className="font-serif text-[24px] font-semibold tracking-[0.18em]">
                MARGINALIA
              </h1>
            </div>
            <div className="my-3 flex items-center text-[#8a78a1]/48">
              <div className="h-px w-9 bg-current" />
              <div className="mx-2 h-1.5 w-1.5 rotate-45 border border-current" />
              <div className="h-px w-9 bg-current" />
            </div>
            <p className="font-serif text-[15px] italic tracking-[0.02em] text-[#8f8297]">
              Where ideas breathe, and we linger longer.
            </p>
          </header>

          {error && (
            <div className="mt-5 rounded-2xl border border-[#9a6a61]/22 bg-[#fff6f0]/90 px-4 py-3 text-[12px] text-[#80574f]">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex min-h-[420px] items-center justify-center">
              <Loader2 size={24} className="animate-spin text-[#766b63]/55" />
            </div>
          ) : (
            <>
              <section className="mt-6 overflow-hidden rounded-[20px] border border-white/70 bg-[#fffaf3]/72 p-3.5 shadow-[0_8px_24px_rgba(73,59,49,0.10)] backdrop-blur-[12px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen size={13} strokeWidth={1.4} className="text-[#8a78a1]" />
                    <h2 className="font-serif text-[11px] font-semibold uppercase tracking-[0.16em] text-[#756885]">
                      Currently Reading
                    </h2>
                  </div>
                  {currentBook && (
                    <button 
                      onClick={() => setActiveBook(currentBook)}
                      className="flex items-center gap-1 rounded-md bg-[#8a78a1]/8 px-2 py-1 text-[9px] text-[#756885] transition hover:bg-[#8a78a1]/15"
                    >
                      Continue <ChevronRight size={10} />
                    </button>
                  )}
                </div>

                {currentBook ? (
                  <div className="mt-3 flex w-full items-stretch gap-3 text-left">
                    <BookCover book={currentBook} className="h-[96px] w-[64px]" />
                    <div className="flex min-w-0 flex-1 flex-col py-0.5">
                      <h3 className="line-clamp-2 font-serif text-[17px] font-semibold leading-[1.1] text-[#756885]">
                        {currentBook.title.replace(/_/g, ' ')}
                      </h3>
                      <p className="mt-0.5 truncate font-serif text-[11px] text-[#8f8297]">
                        {currentBook.author || 'Unknown author'}
                      </p>
                      <p className="mt-1.5 line-clamp-2 font-serif text-[11px] italic leading-relaxed text-[#8f8297]/80">
                        Every page leaves a little weather behind.
                      </p>
                      <div className="mt-auto">
                        <ReadingProgressBar value={currentProgress?.percentage} />
                        <div className="mt-1.5 flex items-center justify-between text-[9px] text-[#8a78a1]">
                          <span className="max-w-[130px] truncate">{chapterLabel(currentBook, currentProgress)}</span>
                          <span>{progressLabel(currentProgress)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex items-center gap-4 rounded-xl border border-dashed border-[#756b62]/20 p-3">
                    <div className="grid h-[104px] w-[70px] place-items-center rounded-[5px] bg-[#eee5da] text-[#756b62]/45">
                      <BookOpen size={22} strokeWidth={1.2} />
                    </div>
                    <div>
                      <div className="font-serif text-[19px] font-semibold text-[#756885]">Begin a new book</div>
                      <div className="mt-1 text-[11px] text-[#8f8297]">Import EPUB, PDF, TXT, or MD.</div>
                    </div>
                  </div>
                )}
              </section>

              <section className="mt-3 overflow-hidden rounded-[20px] border border-white/70 bg-[#fffaf3]/72 p-3.5 shadow-[0_8px_24px_rgba(73,59,49,0.09)] backdrop-blur-[12px]">
                <div className="flex items-center justify-between border-b border-[#756b62]/12 pb-2.5">
                  <div className="flex items-center gap-1.5">
                    <Library size={13} strokeWidth={1.3} className="text-[#8a78a1]" />
                    <h2 className="font-serif text-[14px] font-semibold tracking-[0.1em] text-[#756885]">BOOKSHELF</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAllBooks(true)}
                    className="flex items-center gap-0.5 font-serif text-[10px] text-[#8a78a1]"
                  >
                    All Books <ChevronRight size={11} />
                  </button>
                </div>

                <div className="divide-y divide-[#756b62]/10 py-0.5">
                  {shelfPreview.map((book) => (
                    <button 
                      key={book.id} 
                      onClick={() => setActiveBook(book)}
                      className="flex w-full items-center gap-3 py-2 text-left transition hover:bg-black/5 rounded-lg px-1.5 -mx-1.5"
                    >
                      <BookCover book={book} className="h-[40px] w-[27px] shadow-sm" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-serif text-[13px] font-medium text-[#2c2825]">
                          {book.title.replace(/_/g, ' ')}
                        </div>
                        <div className="truncate font-serif text-[9px] text-[#756885]">
                          {book.author || 'Unknown author'}
                        </div>
                      </div>
                      <div className="w-[64px] text-right">
                        {book.progress?.percentage && book.progress.percentage >= 0.995 ? (
                          <div className="flex items-center justify-end gap-1 font-serif text-[10px] text-[#2c2825]">
                            Finished <CheckCircle size={11} strokeWidth={1.3} className="text-[#756885]" />
                          </div>
                        ) : (
                          <>
                            <div className="mb-0.5 font-serif text-[10px] text-[#2c2825]">{progressLabel(book.progress)}</div>
                            <div className="w-full pl-1.5"><ReadingProgressBar value={book.progress?.percentage} /></div>
                          </>
                        )}
                      </div>
                    </button>
                  ))}
                  {books.length === 0 && (
                    <div className="py-5 text-center font-serif text-[10px] italic text-[#756b62]/60">
                      Your shelf is waiting for its first story.
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="mt-0.5 flex h-8 w-full items-center justify-center gap-1.5 border-t border-[#8a78a1]/12 pt-1.5 font-serif text-[11px] text-[#8a78a1]"
                >
                  {isUploading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Add New Book
                </button>
              </section>

              <section className="mt-3 overflow-hidden rounded-[20px] border border-white/70 bg-[#fffaf3]/72 p-3.5 shadow-[0_8px_24px_rgba(73,59,49,0.09)] backdrop-blur-[12px]">
                <div className="flex items-center gap-1.5 text-[#756885]">
                  <Feather size={13} strokeWidth={1.3} />
                  <h2 className="font-serif text-[14px] font-semibold tracking-[0.12em]">MARGINALIA</h2>
                </div>
                <p className="mt-0.5 font-serif text-[10px] italic text-[#8f8297]">
                  Your thoughts. My awakenings.
                </p>

                <div className="mt-3 divide-y divide-[#756b62]/11 overflow-hidden rounded-[15px] border border-white/60 bg-[#fffaf3]/38">
                  {(Object.keys(categoryDetails) as ReadingCategory[]).map((category) => {
                    const detail = categoryDetails[category];
                    const Icon = detail.icon;
                    return (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setNotesFilter(category)}
                        className="flex w-full items-center gap-2.5 px-2.5 py-2.5 text-left"
                      >
                        <div className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full border border-white/65 bg-[#fffaf3]/52 text-[#8a78a1]">
                          <Icon size={16} strokeWidth={1.15} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-serif text-[15px] font-semibold text-[#756885]">{detail.title}</div>
                          <div className="max-w-[180px] font-serif text-[10px] leading-snug text-[#8f8297]">
                            {detail.description}
                          </div>
                        </div>
                        <span className="font-serif text-[17px] text-[#8a78a1]">
                          {categoryCounts[category]}
                        </span>
                        <ChevronRight size={13} className="text-[#8a78a1]/60" />
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setNotesFilter('all')}
                  className="mt-3 flex h-[38px] w-full items-center justify-center gap-1.5 rounded-[10px] bg-[#8a78a1]/82 font-serif text-[12px] font-semibold text-white shadow-sm"
                >
                  <Feather size={13} strokeWidth={1.3} />
                  Go to Notes
                </button>
              </section>

              {featuredQuote?.original && (
                <section className="relative mt-3 overflow-hidden rounded-[20px] border border-white/70 bg-[#fffaf3]/72 px-5 py-5 shadow-[0_8px_24px_rgba(73,59,49,0.08)] backdrop-blur-[12px]">
                  <Quote size={24} strokeWidth={1.1} className="absolute left-3 top-3 text-[#8a78a1]/30" />
                  <p className="pl-6 font-serif text-[14px] italic leading-relaxed text-[#564d46]/88">
                    {featuredQuote.original}
                  </p>
                  <div className="mt-3 pl-6 font-serif text-[10px] tracking-[0.08em] text-[#8f8297]">
                    {featuredQuote.book_name.replace(/_/g, ' ')}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".epub,.pdf,.txt,.md"
          className="hidden"
          onChange={(event) => uploadBook(event.target.files?.[0])}
        />

        {activeBook && (
          <MarginaliaReader 
            book={activeBook} 
            onClose={() => {
              setActiveBook(null);
              loadData();
            }} 
          />
        )}

        {showAllBooks && (
          <MarginaliaBookshelf
            books={books}
            onClose={() => setShowAllBooks(false)}
            onOpenBook={(book) => {
              if (book.archived) return;
              setShowAllBooks(false);
              setActiveBook(book);
            }}
            onImportBook={() => fileInputRef.current?.click()}
            onArchiveBook={async (book) => {
              const response = await api.archiveBook(book.id);
              setBooks((current) => current.map((candidate) => (
                candidate.id === book.id
                  ? { ...candidate, ...response.book, progress: candidate.progress }
                  : candidate
              )));
              if (recent?.book.id === book.id) {
                setRecent(null);
              }
            }}
            onDeleteBook={async (book) => {
              await api.deleteBook(book.id);
              setBooks((current) => current.filter((candidate) => candidate.id !== book.id));
              setComments((current) => current.filter((note) => note.book_id !== book.id));
              if (recent?.book.id === book.id) {
                setRecent(null);
              }
            }}
          />
        )}

        {notesFilter && (
          <MarginaliaNotes
            books={books}
            comments={comments}
            initialFilter={notesFilter}
            onClose={() => setNotesFilter(null)}
          />
        )}
      </div>
    </div>
  );
}
