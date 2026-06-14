import { useMemo, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  BookMarked,
  Check,
  Cloud,
  Library,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import { api } from '../../lib/api';
import type { Book } from '../../types';
import { cn } from '../../lib/utils';

type ShelfFilter = 'all' | 'reading' | 'finished';

interface MarginaliaBookshelfProps {
  books: Book[];
  onClose: () => void;
  onOpenBook: (book: Book) => void;
  onImportBook: () => void;
  onArchiveBook: (book: Book) => Promise<void>;
  onDeleteBook: (book: Book) => Promise<void>;
}

function assetUrl(path?: string | null) {
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  return `${api.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function isFinished(book: Book) {
  return Boolean(book.archived) || (book.progress?.percentage || 0) >= 0.995;
}

function progressPercent(book: Book) {
  return Math.round(Math.min(1, Math.max(0, book.progress?.percentage || 0)) * 100);
}

function ShelfCover({ book }: { book: Book }) {
  const [failed, setFailed] = useState(false);
  const cover = assetUrl(book.cover_url);

  return (
    <div className="relative aspect-[2/3] w-full overflow-hidden rounded-[8px] bg-gradient-to-br from-[#746d68] via-[#9a8f86] to-[#d8c9b9] shadow-[0_12px_28px_rgba(62,48,66,0.18)]">
      {cover && !failed ? (
        <img
          src={cover}
          alt={`${book.title} cover`}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full flex-col justify-between p-3 text-[#fffaf2]">
          <BookMarked size={17} strokeWidth={1.3} className="opacity-75" />
          <div>
            <div className="line-clamp-4 font-serif text-[17px] font-semibold leading-tight">
              {book.title.replace(/_/g, ' ')}
            </div>
            <div className="mt-2 truncate text-[8px] uppercase tracking-[0.14em] opacity-70">
              {book.author || 'Unknown author'}
            </div>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[5px] bg-black/12" />

      {book.archived && (
        <div className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full border border-white/70 bg-[#f8f1f5]/88 text-[#8a78a1] shadow-sm backdrop-blur-md">
          <Cloud size={15} strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
}

export default function MarginaliaBookshelf({
  books,
  onClose,
  onOpenBook,
  onImportBook,
  onArchiveBook,
  onDeleteBook,
}: MarginaliaBookshelfProps) {
  const [filter, setFilter] = useState<ShelfFilter>('all');
  const [query, setQuery] = useState('');
  const [archiveTarget, setArchiveTarget] = useState<Book | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Book | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const counts = useMemo(() => ({
    all: books.length,
    reading: books.filter((book) => book.progress && !isFinished(book) && !book.archived).length,
    finished: books.filter(isFinished).length,
  }), [books]);

  const visibleBooks = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return books.filter((book) => {
      if (filter === 'reading' && (!book.progress || isFinished(book) || book.archived)) return false;
      if (filter === 'finished' && !isFinished(book)) return false;
      if (!normalizedQuery) return true;
      return `${book.title} ${book.author}`.toLowerCase().includes(normalizedQuery);
    });
  }, [books, filter, query]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-0 z-[90] flex flex-col overflow-hidden bg-[#f4ede7] text-[#302a31]"
    >
      <div className="absolute inset-0 bg-[url('/marginalia/marginalia_bg.PNG')] bg-cover bg-top bg-no-repeat" />
      <div className="absolute inset-0 bg-[#fffaf3]/38 backdrop-blur-[4px]" />

      <div className="relative z-10 flex h-full flex-col">
        <header className="shrink-0 px-5 pb-3 pt-11 sm:pt-14">
          <div className="grid grid-cols-[40px_1fr_40px] items-center">
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
                <Library size={15} strokeWidth={1.3} />
                <h1 className="font-serif text-[20px] font-semibold tracking-[0.16em]">
                  ALL BOOKS
                </h1>
              </div>
              <p className="mt-1 font-serif text-[11px] italic text-[#8f8297]">
                Every world you have carried home.
              </p>
            </div>

            <button
              type="button"
              onClick={onImportBook}
              className="grid h-10 w-10 place-items-center rounded-full border border-white/55 bg-[#fffaf3]/52 text-[#756885] shadow-sm backdrop-blur-md"
              aria-label="Add a new book"
            >
              <Plus size={19} strokeWidth={1.5} />
            </button>
          </div>

          <label className="mt-5 flex h-10 items-center gap-2.5 rounded-[13px] border border-white/68 bg-[#fffaf3]/62 px-3 text-[#756885] shadow-sm backdrop-blur-[10px]">
            <Search size={14} strokeWidth={1.5} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a title or author"
              className="min-w-0 flex-1 bg-transparent font-serif text-[12px] text-[#4b423b] outline-none placeholder:text-[#8f8297]/65"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="grid h-7 w-7 place-items-center">
                <X size={13} />
              </button>
            )}
          </label>

          <div className="mt-3 grid grid-cols-3 rounded-[13px] border border-white/58 bg-[#fffaf3]/42 p-1 backdrop-blur-[10px]">
            {([
              ['all', 'All'],
              ['reading', 'Reading'],
              ['finished', 'Finished'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={cn(
                  'flex h-8 items-center justify-center gap-1.5 rounded-[9px] font-serif text-[10px] transition',
                  filter === id
                    ? 'bg-[#fffaf3]/86 text-[#756885] shadow-sm'
                    : 'text-[#8f8297]',
                )}
              >
                {label}
                <span className="text-[8px] opacity-65">{counts[id]}</span>
              </button>
            ))}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 pb-12 pt-3">
          {visibleBooks.length > 0 ? (
            <div className="grid grid-cols-3 gap-x-3 gap-y-6">
              {visibleBooks.map((book) => {
                const finished = isFinished(book);
                const percentage = progressPercent(book);
                return (
                  <article key={book.id} className="group relative min-w-0 text-left">
                    <button
                      type="button"
                      onClick={() => {
                        if (!book.archived) onOpenBook(book);
                      }}
                      className={cn('block w-full text-left', book.archived && 'cursor-default')}
                    >
                      <ShelfCover book={book} />
                    </button>

                    {!book.archived && (
                      <button
                        type="button"
                        onClick={() => setArchiveTarget(book)}
                        className="absolute left-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full border border-white/65 bg-[#fffaf3]/82 text-[#756885]/75 shadow-sm backdrop-blur-md transition hover:text-[#756885]"
                        aria-label={`Archive ${book.title}`}
                      >
                        <Archive size={12} strokeWidth={1.5} />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setDeleteTarget(book)}
                      className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full border border-white/65 bg-[#fffaf3]/82 text-[#9b5d61]/75 shadow-sm backdrop-blur-md transition hover:text-[#9b5d61]"
                      aria-label={`Permanently delete ${book.title}`}
                    >
                      <Trash2 size={12} strokeWidth={1.5} />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (!book.archived) onOpenBook(book);
                      }}
                      disabled={book.archived}
                      className="block w-full text-left disabled:cursor-default"
                    >
                    <div className="mt-2 flex items-start gap-1">
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate font-serif text-[12px] font-semibold text-[#443b45]">
                          {book.title.replace(/_/g, ' ')}
                        </h2>
                        <p className="truncate font-serif text-[8px] text-[#8f8297]">
                          {book.author || 'Unknown author'}
                        </p>
                      </div>
                      {finished && !book.archived && <Check size={10} strokeWidth={1.4} className="mt-0.5 shrink-0 text-[#8a78a1]" />}
                    </div>

                    <div className="mt-1.5">
                      <div className="h-[2px] overflow-hidden rounded-full bg-[#8a78a1]/12">
                        <div
                          className="h-full rounded-full bg-[#8a78a1]/72"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <div className="mt-1 flex items-center justify-between font-serif text-[7px] text-[#8f8297]">
                        <span>{book.archived ? 'Cloud archive' : finished ? 'Finished' : book.progress ? 'In progress' : 'Not started'}</span>
                        <span>{percentage}%</span>
                      </div>
                    </div>
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
              <div className="grid h-16 w-16 place-items-center rounded-full border border-white/65 bg-[#fffaf3]/52 text-[#8a78a1] backdrop-blur-md">
                {filter === 'finished' ? <Cloud size={25} strokeWidth={1.2} /> : <Library size={24} strokeWidth={1.2} />}
              </div>
              <h2 className="mt-4 font-serif text-[17px] font-semibold text-[#756885]">
                {query ? 'No matching books' : filter === 'finished' ? 'No finished books yet' : 'This shelf is quiet'}
              </h2>
              <p className="mt-1 max-w-[230px] font-serif text-[11px] italic leading-relaxed text-[#8f8297]">
                {filter === 'finished'
                  ? 'Completed stories will rest here with a cloud mark.'
                  : 'Add a book when another story calls.'}
              </p>
            </div>
          )}
        </div>
      </div>

      {archiveTarget && (
        <div className="absolute inset-0 z-30 flex items-end justify-center bg-[#302838]/22 p-4 backdrop-blur-[2px]">
          <div className="w-full rounded-[22px] border border-white/70 bg-[#fffaf3]/96 p-5 shadow-[0_24px_70px_rgba(55,43,59,0.24)]">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-[#8a78a1]/10 text-[#8a78a1]">
                <Cloud size={20} strokeWidth={1.4} />
              </div>
              <div className="min-w-0">
                <h2 className="font-serif text-[17px] font-semibold text-[#756885]">Move to Cloud Archive?</h2>
                <p className="mt-0.5 truncate font-serif text-[11px] text-[#8f8297]">
                  {archiveTarget.title.replace(/_/g, ' ')}
                </p>
              </div>
            </div>
            <p className="mt-4 font-serif text-[12px] leading-relaxed text-[#5f555f]">
              The book file and readable chapters will be removed. Its cover, details, progress, and all marginalia will remain.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isArchiving}
                onClick={() => setArchiveTarget(null)}
                className="h-10 rounded-xl border border-[#8a78a1]/14 font-serif text-[12px] text-[#756885]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isArchiving}
                onClick={async () => {
                  setIsArchiving(true);
                  try {
                    await onArchiveBook(archiveTarget);
                    setArchiveTarget(null);
                    setFilter('finished');
                  } finally {
                    setIsArchiving(false);
                  }
                }}
                className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#8a78a1] font-serif text-[12px] text-white disabled:opacity-50"
              >
                {isArchiving ? 'Archiving...' : 'Archive'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="absolute inset-0 z-30 flex items-end justify-center bg-[#302838]/28 p-4 backdrop-blur-[2px]">
          <div className="w-full rounded-[22px] border border-[#b26b70]/18 bg-[#fffaf3]/98 p-5 shadow-[0_24px_70px_rgba(55,43,59,0.26)]">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-[#a85f64]/10 text-[#a85f64]">
                <Trash2 size={20} strokeWidth={1.4} />
              </div>
              <div className="min-w-0">
                <h2 className="font-serif text-[17px] font-semibold text-[#8f4f55]">Delete permanently?</h2>
                <p className="mt-0.5 truncate font-serif text-[11px] text-[#8f8297]">
                  {deleteTarget.title.replace(/_/g, ' ')}
                </p>
              </div>
            </div>
            <p className="mt-4 font-serif text-[12px] leading-relaxed text-[#654f52]">
              This permanently deletes the book, cover, reading progress, and every Marginalia note linked to it. Nothing can be recovered.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteTarget(null)}
                className="h-10 rounded-xl border border-[#8a78a1]/14 font-serif text-[12px] text-[#756885]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={async () => {
                  setIsDeleting(true);
                  try {
                    await onDeleteBook(deleteTarget);
                    setDeleteTarget(null);
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#a85f64] font-serif text-[12px] text-white disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
