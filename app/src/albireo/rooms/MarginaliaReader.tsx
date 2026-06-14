import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import type { CSSProperties } from 'react';
import {
  X,
  Feather as FeatherIcon,
  Bookmark,
  BookOpenText,
  List,
  Settings2,
  Check,
  Sparkles,
  Highlighter,
  CircleHelp,
  Menu,
  Pencil,
  Trash2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { api } from '../../lib/api';
import type {
  Book,
  BookChapter,
  ReadingBookmark,
  ReadingCategory,
  ReadingComment,
} from '../../types';
import { cn } from '../../lib/utils';

interface MarginaliaReaderProps {
  book: Book;
  onClose: () => void;
}

const PAGE_GAP = 48;
const READER_PADDING_TOP = 112;
const READER_PADDING_BOTTOM = 84;
const READER_PREFERENCES_KEY = 'albireo-reader-preferences';
const NOTE_HIGHLIGHT_NAME = 'marginalia-notes';

type HighlightRegistry = {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => boolean;
};

type HighlightConstructor = new (...ranges: Range[]) => unknown;

type ReaderTheme = 'light' | 'sepia' | 'dark';
type ReaderFont = 'cormorant' | 'noto-serif-tc' | 'georgia' | 'system';

const readerFonts: Record<ReaderFont, { label: string; family: string }> = {
  cormorant: {
    label: 'Cormorant Garamond',
    family: '"Cormorant Garamond", "Noto Serif TC", Georgia, serif',
  },
  'noto-serif-tc': {
    label: 'Noto Serif TC',
    family: '"Noto Serif TC", "Songti TC", serif',
  },
  georgia: {
    label: 'Georgia',
    family: 'Georgia, "Times New Roman", serif',
  },
  system: {
    label: 'System UI',
    family: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  },
};

const readerThemes: Record<ReaderTheme, {
  label: string;
  background: string;
  text: string;
  muted: string;
  control: string;
  controlBorder: string;
  panel: string;
  panelText: string;
  panelMuted: string;
  highlight: string;
}> = {
  light: {
    label: 'Light',
    background: '#eee9e3',
    text: '#2c2825',
    muted: '#756d68',
    control: '#e2dcd5',
    controlBorder: '#d7d0c8',
    panel: '#eee9e3',
    panelText: '#2c2825',
    panelMuted: '#756d68',
    highlight: 'rgba(156, 134, 176, 0.3)',
  },
  sepia: {
    label: 'Sepia',
    background: '#40392f',
    text: '#eee1ce',
    muted: '#b9ad9d',
    control: '#51493d',
    controlBorder: '#655b4c',
    panel: '#4a4237',
    panelText: '#eee1ce',
    panelMuted: '#b9ad9d',
    highlight: 'rgba(184, 156, 205, 0.38)',
  },
  dark: {
    label: 'Dark',
    background: '#1b1b1d',
    text: '#d5d3d7',
    muted: '#aaa8ad',
    control: '#29292c',
    controlBorder: '#3a393e',
    panel: '#252527',
    panelText: '#d5d3d7',
    panelMuted: '#aaa8ad',
    highlight: 'rgba(161, 136, 190, 0.42)',
  },
};

function createTextRange(root: HTMLElement, startOffset: number, length: number) {
  const textLength = root.textContent?.length || 0;
  const safeStart = Math.min(Math.max(startOffset, 0), textLength);
  const safeEnd = Math.min(Math.max(safeStart + length, safeStart), textLength);
  if (safeStart === safeEnd) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cumulativeOffset = 0;
  let startPoint: { node: Text; offset: number } | null = null;
  let endPoint: { node: Text; offset: number } | null = null;
  let node = walker.nextNode();

  while (node) {
    const textNode = node as Text;
    const nodeLength = textNode.nodeValue?.length || 0;
    const nodeEnd = cumulativeOffset + nodeLength;

    if (!startPoint && safeStart <= nodeEnd) {
      startPoint = {
        node: textNode,
        offset: Math.min(nodeLength, Math.max(0, safeStart - cumulativeOffset)),
      };
    }
    if (safeEnd <= nodeEnd) {
      endPoint = {
        node: textNode,
        offset: Math.min(nodeLength, Math.max(0, safeEnd - cumulativeOffset)),
      };
      break;
    }

    cumulativeOffset = nodeEnd;
    node = walker.nextNode();
  }

  if (!startPoint || !endPoint) return null;
  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}

function getStoredReaderPreferences() {
  try {
    const stored = window.localStorage.getItem(READER_PREFERENCES_KEY);
    return stored ? JSON.parse(stored) as Partial<{
      theme: ReaderTheme;
      fontSize: number;
      lineHeight: number;
      fontFamily: ReaderFont | 'serif' | 'sans';
      pageMargin: number;
    }> : {};
  } catch {
    return {};
  }
}

const cleanHTML = (html?: string) => {
  if (!html) return '';
  // If it's raw text without HTML tags
  if (!/<[a-z][\s\S]*>/i.test(html)) {
    return html.split('\n\n').map(p => `<p class="mb-4 indent-6">${p}</p>`).join('');
  }
  // If it's HTML (like from an EPUB), strip head and styles
  return html
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<body[^>]*>/gi, '<div class="epub-content">')
    .replace(/<\/body>/gi, '</div>');
};

export default function MarginaliaReader({ book, onClose }: MarginaliaReaderProps) {
  const initialPreferences = useRef(getStoredReaderPreferences()).current;
  const [currentChapterIdx, setCurrentChapterIdx] = useState(book.progress?.chapter_idx || 0);
  const [chapter, setChapter] = useState<BookChapter | null>(null);
  const [loadedChapterIdx, setLoadedChapterIdx] = useState<number | null>(null);
  const [showUI, setShowUI] = useState(false);
  
  // UI States
  const [showSettings, setShowSettings] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [showBookNotes, setShowBookNotes] = useState(false);
  const [showReaderMenu, setShowReaderMenu] = useState(false);
  const [showFullPageCount, setShowFullPageCount] = useState(false);
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>(
    initialPreferences.theme && readerThemes[initialPreferences.theme]
      ? initialPreferences.theme
      : 'light',
  );
  const [fontSize, setFontSize] = useState(initialPreferences.fontSize || 18);
  const [lineHeight, setLineHeight] = useState(initialPreferences.lineHeight || 1.8);
  const [fontFamily, setFontFamily] = useState<ReaderFont>(() => {
    if (initialPreferences.fontFamily === 'sans') return 'system';
    if (initialPreferences.fontFamily === 'serif') return 'georgia';
    return initialPreferences.fontFamily && readerFonts[initialPreferences.fontFamily]
      ? initialPreferences.fontFamily
      : 'georgia';
  });
  const [pageMargin, setPageMargin] = useState(initialPreferences.pageMargin || 24);
  const [bookNotes, setBookNotes] = useState<ReadingComment[]>([]);
  const [bookmarks, setBookmarks] = useState<ReadingBookmark[]>([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [editingNoteCategory, setEditingNoteCategory] = useState<ReadingCategory | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isSavingBookmark, setIsSavingBookmark] = useState(false);

  // Marginalia
  const [selectedText, setSelectedText] = useState('');
  const [selectedTextOffset, setSelectedTextOffset] = useState<number | null>(null);
  const [showAddNote, setShowAddNote] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [noteCategory, setNoteCategory] = useState<ReadingCategory | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Progress
  const [progressPct, setProgressPct] = useState(0);

  // Paging States
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [isContentReady, setIsContentReady] = useState(false);

  // Selection FAB
  const [hasSelection, setHasSelection] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const isFirstLoad = useRef(true);
  const positionedChapterIdx = useRef<number | null>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const suppressPagingUntil = useRef(0);
  const pendingChapterDestination = useRef<'start' | 'end'>('start');
  const pendingTextAnchor = useRef<number | null>(null);
  const pendingReadingLocation = useRef<{
    characterOffset?: number | null;
    original?: string;
  } | null>(null);
  const chapterCache = useRef(new Map<number, BookChapter>());
  const chapterRequests = useRef(new Map<number, Promise<BookChapter>>());
  
  // Track latest progress state to save instantly on unmount or page change
  const latestProgress = useRef({ chapterIdx: currentChapterIdx, pct: progressPct });
  latestProgress.current = { chapterIdx: currentChapterIdx, pct: progressPct };
  const theme = readerThemes[readerTheme];
  const themeStyle = {
    '--reader-bg': theme.background,
    '--reader-text': theme.text,
    '--reader-muted': theme.muted,
    '--reader-control': theme.control,
    '--reader-control-border': theme.controlBorder,
    '--reader-panel': theme.panel,
    '--reader-panel-text': theme.panelText,
    '--reader-panel-muted': theme.panelMuted,
    '--reader-highlight': theme.highlight,
  } as CSSProperties;

  const getContentWidth = () => {
    const viewportWidth = containerWidth > 0
      ? containerWidth
      : scrollRef.current?.clientWidth || window.innerWidth;
    return Math.max(1, viewportWidth - (pageMargin * 2));
  };

  const getPageStep = useCallback(
    () => getContentWidth() + PAGE_GAP,
    [containerWidth, pageMargin],
  );

  const measureTotalPages = useCallback(() => {
    const content = contentRef.current;
    if (!content) return 1;
    const pageStep = getPageStep();
    return Math.max(1, Math.ceil((content.scrollWidth + PAGE_GAP - 1) / pageStep));
  }, [getPageStep]);

  const getCharacterPage = useCallback((node: Text, offset: number) => {
    const scroll = scrollRef.current;
    if (!scroll || !node.nodeValue?.length) return null;

    const safeOffset = Math.min(Math.max(offset, 0), node.nodeValue.length - 1);
    const range = document.createRange();
    range.setStart(node, safeOffset);
    range.setEnd(node, safeOffset + 1);
    const rect = Array.from(range.getClientRects()).find(
      (candidate) => candidate.width > 0 && candidate.height > 0,
    );
    if (!rect) return null;

    const scrollRect = scroll.getBoundingClientRect();
    const absoluteLeft = rect.left - scrollRect.left + scroll.scrollLeft - pageMargin;
    return Math.max(0, Math.round(absoluteLeft / getPageStep()));
  }, [getPageStep, pageMargin]);

  const captureCurrentTextAnchor = useCallback(() => {
    const root = contentRef.current;
    if (!root || !isContentReady) return null;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let cumulativeOffset = 0;
    let node = walker.nextNode();

    while (node) {
      const textNode = node as Text;
      const length = textNode.nodeValue?.length || 0;
      if (length > 0) {
        const wholeNodeRange = document.createRange();
        wholeNodeRange.selectNodeContents(textNode);
        const touchesCurrentPage = Array.from(wholeNodeRange.getClientRects()).some(
          (rect) => rect.width > 0
            && rect.height > 0
            && Math.max(
              0,
              Math.round(
                (
                  rect.left
                  - (scrollRef.current?.getBoundingClientRect().left || 0)
                  + (scrollRef.current?.scrollLeft || 0)
                  - pageMargin
                ) / getPageStep(),
              ),
            ) === currentPage,
        );

        if (touchesCurrentPage) {
          for (let offset = 0; offset < length; offset += 1) {
            if (getCharacterPage(textNode, offset) === currentPage) {
              return cumulativeOffset + offset;
            }
          }
        }
      }
      cumulativeOffset += length;
      node = walker.nextNode();
    }

    return null;
  }, [
    currentPage,
    getCharacterPage,
    getPageStep,
    isContentReady,
    pageMargin,
  ]);

  const getPageForTextAnchor = useCallback((anchorOffset: number) => {
    const root = contentRef.current;
    if (!root) return null;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let cumulativeOffset = 0;
    let node = walker.nextNode();

    while (node) {
      const textNode = node as Text;
      const length = textNode.nodeValue?.length || 0;
      if (anchorOffset <= cumulativeOffset + length && length > 0) {
        const localOffset = Math.min(
          length - 1,
          Math.max(0, anchorOffset - cumulativeOffset),
        );
        for (let distance = 0; distance < length; distance += 1) {
          const forward = localOffset + distance;
          if (forward < length) {
            const forwardPage = getCharacterPage(textNode, forward);
            if (forwardPage !== null) return forwardPage;
          }
          const backward = localOffset - distance;
          if (backward >= 0) {
            const backwardPage = getCharacterPage(textNode, backward);
            if (backwardPage !== null) return backwardPage;
          }
        }
        return null;
      }
      cumulativeOffset += length;
      node = walker.nextNode();
    }

    return null;
  }, [getCharacterPage]);

  const rememberReadingAnchor = useCallback(() => {
    const anchor = captureCurrentTextAnchor();
    if (anchor !== null) pendingTextAnchor.current = anchor;
  }, [captureCurrentTextAnchor]);

  const getSelectionCharacterOffset = useCallback(() => {
    const root = contentRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const selectedRange = selection.getRangeAt(0);
    if (!root.contains(selectedRange.startContainer)) return null;

    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(root);
    prefixRange.setEnd(selectedRange.startContainer, selectedRange.startOffset);
    return prefixRange.toString().length;
  }, []);

  const findTextOffset = useCallback((searchText?: string | null) => {
    const text = contentRef.current?.textContent || '';
    const needle = searchText?.trim() || '';
    if (!needle) return null;

    const exact = text.indexOf(needle);
    if (exact >= 0) return exact;

    const normalizedNeedle = needle.replace(/\s+/g, ' ');
    let normalizedText = '';
    const sourceOffsets: number[] = [];
    let previousWasWhitespace = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const isWhitespace = /\s/.test(character);
      if (isWhitespace) {
        if (previousWasWhitespace) continue;
        normalizedText += ' ';
        sourceOffsets.push(index);
        previousWasWhitespace = true;
      } else {
        normalizedText += character;
        sourceOffsets.push(index);
        previousWasWhitespace = false;
      }
    }

    const normalizedIndex = normalizedText.indexOf(normalizedNeedle);
    return normalizedIndex >= 0 ? sourceOffsets[normalizedIndex] : null;
  }, []);

  const getExcerptAtOffset = useCallback((characterOffset: number) => {
    const text = contentRef.current?.textContent || '';
    return text
      .slice(characterOffset, characterOffset + 180)
      .replace(/\s+/g, ' ')
      .trim();
  }, []);

  const getWholeBookProgress = useCallback((chapterIdx: number, chapterPct: number) => {
    const chapterCount = Math.max(book.chapters.length, 1);
    const chapterFraction = Math.min(1, Math.max(0, chapterPct / 100));
    return Math.min(1, Math.max(0, (chapterIdx + chapterFraction) / chapterCount));
  }, [book.chapters.length]);

  const saveLatestProgress = useCallback(async () => {
    const latest = latestProgress.current;
    return api.saveReadingProgress(book.id, {
      chapter_idx: latest.chapterIdx,
      percentage: getWholeBookProgress(latest.chapterIdx, latest.pct),
    });
  }, [book.id, getWholeBookProgress]);

  const loadChapter = useCallback((chapterIdx: number) => {
    const cached = chapterCache.current.get(chapterIdx);
    if (cached) return Promise.resolve(cached);

    const pending = chapterRequests.current.get(chapterIdx);
    if (pending) return pending;

    const request = api.getBookChapter(book.id, chapterIdx)
      .then((data) => {
        chapterCache.current.set(chapterIdx, data);
        chapterRequests.current.delete(chapterIdx);
        return data;
      })
      .catch((error) => {
        chapterRequests.current.delete(chapterIdx);
        throw error;
      });
    chapterRequests.current.set(chapterIdx, request);
    return request;
  }, [book.id]);

  const changeChapter = useCallback((
    nextChapterIdx: number,
    destination: 'start' | 'end' = 'start',
  ) => {
    const boundedIndex = Math.min(
      Math.max(nextChapterIdx, 0),
      Math.max(book.chapters.length - 1, 0),
    );
    if (boundedIndex === latestProgress.current.chapterIdx) return;
    void saveLatestProgress().catch(console.error);
    pendingChapterDestination.current = destination;
    setIsContentReady(false);
    const cached = chapterCache.current.get(boundedIndex);
    setChapter(cached || null);
    setLoadedChapterIdx(cached ? boundedIndex : null);
    setProgressPct(0);
    setCurrentPage(0);
    setTotalPages(1);
    setCurrentChapterIdx(boundedIndex);
  }, [book.chapters.length, saveLatestProgress]);

  const closeReader = useCallback(async () => {
    try {
      await saveLatestProgress();
    } catch (error) {
      console.error('Failed to save reading progress before closing', error);
    } finally {
      onClose();
    }
  }, [onClose, saveLatestProgress]);

  const cleanedContent = useMemo(() => cleanHTML(chapter?.content), [chapter?.content]);

  useEffect(() => {
    const handleSelection = () => {
      const sel = window.getSelection();
      const selected = !!(sel && !sel.isCollapsed && sel.toString().trim().length > 0);
      setHasSelection(selected);
      if (selected) {
        suppressPagingUntil.current = Date.now() + 400;
      }
    };

    document.addEventListener('selectionchange', handleSelection);
    return () => {
      document.removeEventListener('selectionchange', handleSelection);
    };
  }, []);

  useEffect(() => {
    if (!showUI) setShowReaderMenu(false);
  }, [showUI]);

  useEffect(() => {
    window.localStorage.setItem(READER_PREFERENCES_KEY, JSON.stringify({
      theme: readerTheme,
      fontSize,
      lineHeight,
      fontFamily,
      pageMargin,
    }));
  }, [fontFamily, fontSize, lineHeight, pageMargin, readerTheme]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getReadingBookmarks(book.id),
      api.getReadingComments(book.id),
    ])
      .then(([nextBookmarks, notes]) => {
        if (cancelled) return;
        setBookmarks(nextBookmarks);
        setBookNotes(notes);
      })
      .catch((error) => console.error('Failed to load bookmarks and notes', error));
    return () => {
      cancelled = true;
    };
  }, [book.id]);

  // Measure container width dynamically to support centered PWA desktop constraints
  useEffect(() => {
    if (!scrollRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(scrollRef.current?.clientWidth || entry.contentRect.width);
      }
    });
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const cached = chapterCache.current.get(currentChapterIdx);
    setChapter(cached || null);
    setLoadedChapterIdx(cached ? currentChapterIdx : null);

    let cancelled = false;
    loadChapter(currentChapterIdx)
      .then((data) => {
        if (cancelled) return;
        setChapter(data);
        setLoadedChapterIdx(currentChapterIdx);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [currentChapterIdx, loadChapter]);

  // Keep only the current chapter and its immediate neighbours warm.
  useEffect(() => {
    if (!chapter || loadedChapterIdx !== currentChapterIdx) return;

    const neighbours = [currentChapterIdx - 1, currentChapterIdx + 1]
      .filter((idx) => idx >= 0 && idx < book.chapters.length);
    neighbours.forEach((idx) => {
      void loadChapter(idx).catch((error) => {
        console.error(`Failed to prefetch chapter ${idx}`, error);
      });
    });

    const retained = new Set([currentChapterIdx, ...neighbours]);
    chapterCache.current.forEach((_value, idx) => {
      if (!retained.has(idx)) {
        chapterCache.current.delete(idx);
      }
    });
  }, [
    book.chapters.length,
    chapter,
    currentChapterIdx,
    loadedChapterIdx,
    loadChapter,
  ]);

  // Measure and position before paint so a previous chapter never flashes at page one.
  useLayoutEffect(() => {
    if (
      isContentReady
      && positionedChapterIdx.current === currentChapterIdx
    ) return;

    if (
      chapter
      && loadedChapterIdx === currentChapterIdx
      && scrollRef.current
      && contentRef.current
      && containerWidth > 0
    ) {
      const pageStep = getPageStep();
      const total = measureTotalPages();
      let targetPage = 0;

      if (isFirstLoad.current) {
        if (book.progress?.percentage) {
          const wholeBookFraction = book.progress.percentage > 1
            ? book.progress.percentage / 100
            : book.progress.percentage;
          const inferredChapterFraction =
            (wholeBookFraction * Math.max(book.chapters.length, 1)) - currentChapterIdx;
          const chapterFraction = inferredChapterFraction >= 0 && inferredChapterFraction <= 1
            ? inferredChapterFraction
            : wholeBookFraction;
          targetPage = Math.round(chapterFraction * (total - 1));
        }
        isFirstLoad.current = false;
      } else {
        const location = pendingReadingLocation.current;
        pendingReadingLocation.current = null;
        if (location) {
          const characterOffset = location.characterOffset
            ?? findTextOffset(location.original);
          targetPage = characterOffset !== null && characterOffset !== undefined
            ? getPageForTextAnchor(characterOffset) ?? 0
            : 0;
        } else {
          const destination = pendingChapterDestination.current;
          targetPage = destination === 'end' ? total - 1 : 0;
        }
        pendingChapterDestination.current = 'start';
      }

      scrollRef.current.scrollLeft = targetPage * pageStep;
      setTotalPages(total);
      setCurrentPage(targetPage);
      setProgressPct(
        total > 1 ? Math.round((targetPage / (total - 1)) * 100) : 100,
      );
      positionedChapterIdx.current = currentChapterIdx;
      setIsContentReady(true);
    }
  }, [
    chapter,
    loadedChapterIdx,
    book.chapters.length,
    book.progress?.percentage,
    containerWidth,
    currentChapterIdx,
    findTextOffset,
    getPageForTextAnchor,
    getPageStep,
    isContentReady,
    measureTotalPages,
  ]);

  // Re-measure after typography or viewport changes without resetting the chapter.
  useLayoutEffect(() => {
    if (
      !isContentReady
      || !scrollRef.current
      || !contentRef.current
      || containerWidth <= 0
    ) return;

    const total = measureTotalPages();
    const pageStep = getPageStep();
    const anchor = pendingTextAnchor.current;
    const anchoredPage = anchor !== null ? getPageForTextAnchor(anchor) : null;
    pendingTextAnchor.current = null;
    const page = Math.min(total - 1, Math.max(
      0,
      anchoredPage ?? Math.round(scrollRef.current.scrollLeft / pageStep),
    ));
    scrollRef.current.scrollLeft = page * pageStep;
    setTotalPages(total);
    setCurrentPage(page);
    setProgressPct(total > 1 ? Math.round((page / (total - 1)) * 100) : 100);
  }, [
    containerWidth,
    fontFamily,
    fontSize,
    getPageForTextAnchor,
    getPageStep,
    isContentReady,
    lineHeight,
    measureTotalPages,
    pageMargin,
  ]);

  // Auto-save progress (debounced)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (chapter) {
        saveLatestProgress().catch(console.error);
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [currentChapterIdx, progressPct, chapter, saveLatestProgress]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const pageStep = getPageStep();
    const { scrollLeft } = scrollRef.current;
    const total = measureTotalPages();
    const page = Math.min(total - 1, Math.max(0, Math.round(scrollLeft / pageStep)));
    setCurrentPage(page);
    setTotalPages(total);
    
    const pct = total > 1 ? Math.round((page / (total - 1)) * 100) : 100;
    setProgressPct(pct);
  };

  const handleFeatherClick = () => {
    const selectionText = window.getSelection()?.toString() || '';
    const text = selectionText.trim();
    if (text) {
      setSelectedText(text);
      const selectionOffset = getSelectionCharacterOffset();
      const leadingWhitespace = selectionText.indexOf(text);
      setSelectedTextOffset(
        selectionOffset === null ? null : selectionOffset + Math.max(leadingWhitespace, 0),
      );
      setShowAddNote(true);
      setShowUI(false);
    } else {
      alert("Please long-press to select some text first.");
    }
  };

  const submitNote = async () => {
    if (!selectedText) return;
    setIsSubmitting(true);
    try {
      const response = await api.createReadingComment({
        book_id: book.id,
        book_name: book.title,
        chapter: chapter?.title || 'Chapter',
        chapter_idx: currentChapterIdx,
        character_offset: selectedTextOffset ?? undefined,
        original: selectedText,
        comment: commentText,
        category: noteCategory
      });
      setBookNotes((current) => [
        response.comment,
        ...current.filter((note) => note.id !== response.comment.id),
      ]);
      setShowAddNote(false);
      setCommentText('');
      setSelectedTextOffset(null);
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      console.error(e);
      alert("Failed to save note");
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleUI = () => {
    if (showReaderMenu) {
      setShowReaderMenu(false);
      return;
    }
    if (showSettings) {
      setShowSettings(false);
      return;
    }
    if (showTOC) {
      setShowTOC(false);
      return;
    }
    if (showAddNote) return;
    setShowUI((prev) => !prev);
  };

  const openBookNotes = async () => {
    setShowReaderMenu(false);
    setShowBookNotes(true);
    setIsLoadingNotes(true);
    try {
      const [notes, nextBookmarks] = await Promise.all([
        api.getReadingComments(book.id),
        api.getReadingBookmarks(book.id),
      ]);
      setBookNotes(notes);
      setBookmarks(nextBookmarks);
    } catch (error) {
      console.error('Failed to load book notes', error);
      setBookNotes([]);
    } finally {
      setIsLoadingNotes(false);
    }
  };

  const resolveNoteChapterIdx = useCallback((note: ReadingComment) => {
    if (
      note.chapter_idx !== null
      && note.chapter_idx !== undefined
      && note.chapter_idx >= 0
      && note.chapter_idx < book.chapters.length
    ) {
      return note.chapter_idx;
    }

    const target = note.chapter.trim().toLowerCase();
    const exact = book.chapters.findIndex(
      (candidate) => candidate.title.trim().toLowerCase() === target,
    );
    if (exact >= 0) return exact;
    return book.chapters.findIndex((candidate) => (
      candidate.title.trim().toLowerCase().includes(target)
      || target.includes(candidate.title.trim().toLowerCase())
    ));
  }, [book.chapters]);

  useLayoutEffect(() => {
    const registry = (
      CSS as typeof CSS & { highlights?: HighlightRegistry }
    ).highlights;
    const HighlightClass = (
      window as Window & { Highlight?: HighlightConstructor }
    ).Highlight;

    if (!registry || !HighlightClass) return;
    registry.delete(NOTE_HIGHLIGHT_NAME);

    const root = contentRef.current;
    if (!root || !isContentReady) return;

    const ranges = bookNotes
      .filter((note) => resolveNoteChapterIdx(note) === currentChapterIdx)
      .map((note) => {
        const offset = note.character_offset ?? findTextOffset(note.original);
        if (offset === null || offset === undefined) return null;
        return createTextRange(root, offset, note.original.length);
      })
      .filter((range): range is Range => range !== null);

    if (ranges.length > 0) {
      registry.set(NOTE_HIGHLIGHT_NAME, new HighlightClass(...ranges));
    }

    return () => {
      registry.delete(NOTE_HIGHLIGHT_NAME);
    };
  }, [
    bookNotes,
    currentChapterIdx,
    findTextOffset,
    isContentReady,
    resolveNoteChapterIdx,
  ]);

  const jumpToReadingLocation = useCallback((
    chapterIdx: number,
    characterOffset?: number | null,
    original?: string,
  ) => {
    const boundedChapterIdx = Math.min(
      Math.max(chapterIdx, 0),
      Math.max(book.chapters.length - 1, 0),
    );
    setShowBookNotes(false);
    setShowUI(false);

    if (boundedChapterIdx !== currentChapterIdx) {
      pendingReadingLocation.current = { characterOffset, original };
      changeChapter(boundedChapterIdx, 'start');
      return;
    }

    const resolvedOffset = characterOffset ?? findTextOffset(original);
    if (resolvedOffset === null || resolvedOffset === undefined || !scrollRef.current) return;
    const targetPage = getPageForTextAnchor(resolvedOffset);
    if (targetPage === null) return;
    scrollRef.current.scrollTo({
      left: targetPage * getPageStep(),
      behavior: 'smooth',
    });
  }, [
    book.chapters.length,
    changeChapter,
    currentChapterIdx,
    findTextOffset,
    getPageForTextAnchor,
    getPageStep,
  ]);

  const deleteBookmark = async (bookmarkId: string) => {
    setIsSavingBookmark(true);
    try {
      await api.deleteReadingBookmark(bookmarkId);
      setBookmarks((current) => current.filter((bookmark) => bookmark.id !== bookmarkId));
    } catch (error) {
      console.error('Failed to delete bookmark', error);
    } finally {
      setIsSavingBookmark(false);
    }
  };

  const currentPageBookmark = useMemo(() => {
    if (!isContentReady) return null;
    return bookmarks.find((bookmark) => (
      bookmark.chapter_idx === currentChapterIdx
      && getPageForTextAnchor(bookmark.character_offset) === currentPage
    )) || null;
  }, [
    bookmarks,
    currentChapterIdx,
    currentPage,
    getPageForTextAnchor,
    isContentReady,
  ]);

  const toggleCurrentPageBookmark = async () => {
    if (isSavingBookmark) return;
    if (currentPageBookmark) {
      await deleteBookmark(currentPageBookmark.id);
      return;
    }

    const characterOffset = captureCurrentTextAnchor();
    if (characterOffset === null) return;
    setIsSavingBookmark(true);
    try {
      const response = await api.createReadingBookmark({
        book_id: book.id,
        book_name: book.title,
        chapter: chapter?.title || book.chapters[currentChapterIdx]?.title || 'Chapter',
        chapter_idx: currentChapterIdx,
        character_offset: characterOffset,
        excerpt: getExcerptAtOffset(characterOffset),
      });
      setBookmarks((current) => [
        response.bookmark,
        ...current.filter((bookmark) => bookmark.id !== response.bookmark.id),
      ]);
    } catch (error) {
      console.error('Failed to create bookmark', error);
    } finally {
      setIsSavingBookmark(false);
    }
  };

  const startEditingNote = (note: ReadingComment) => {
    setDeletingNoteId(null);
    setEditingNoteId(note.id);
    setEditingNoteText(note.comment);
    setEditingNoteCategory(note.category);
  };

  const saveEditedNote = async () => {
    if (!editingNoteId || !editingNoteText.trim()) return;
    setIsSavingNote(true);
    try {
      const response = await api.updateReadingComment(editingNoteId, {
        comment: editingNoteText.trim(),
        category: editingNoteCategory,
      });
      setBookNotes((current) => current.map((note) => (
        note.id === editingNoteId ? response.comment : note
      )));
      setEditingNoteId(null);
    } catch (error) {
      console.error('Failed to update note', error);
    } finally {
      setIsSavingNote(false);
    }
  };

  const deleteNote = async (noteId: string) => {
    setIsSavingNote(true);
    try {
      await api.deleteReadingComment(noteId);
      setBookNotes((current) => current.filter((note) => note.id !== noteId));
      setDeletingNoteId(null);
      if (editingNoteId === noteId) setEditingNoteId(null);
    } catch (error) {
      console.error('Failed to delete note', error);
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleReaderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrollRef.current) return;

    const selection = window.getSelection();
    const hasActiveSelection = !!(
      selection
      && !selection.isCollapsed
      && selection.toString().trim().length > 0
    );
    if (hasActiveSelection || Date.now() < suppressPagingUntil.current) {
      return;
    }
    
    // Check if the click was on a button or link or other interactive element
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('a') || target.closest('select')) {
      return;
    }
    
    const rect = scrollRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const leftThreshold = width * 0.25;
    const rightThreshold = width * 0.75;
    
    if (clickX < leftThreshold) {
      if (currentPage === 0 && currentChapterIdx > 0) {
        changeChapter(currentChapterIdx - 1, 'end');
      } else {
        const targetPage = Math.max(0, currentPage - 1);
        scrollRef.current.scrollTo({ left: targetPage * getPageStep(), behavior: 'smooth' });
      }
    } else if (clickX > rightThreshold) {
      if (
        currentPage === totalPages - 1
        && currentChapterIdx < book.chapters.length - 1
      ) {
        changeChapter(currentChapterIdx + 1, 'start');
      } else {
        const targetPage = Math.min(totalPages - 1, currentPage + 1);
        scrollRef.current.scrollTo({ left: targetPage * getPageStep(), behavior: 'smooth' });
      }
    } else {
      // Toggle UI
      toggleUI();
    }
  };

  const handleReaderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerStart.current = { x: event.clientX, y: event.clientY };
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) {
      suppressPagingUntil.current = Date.now() + 400;
    }
  };

  const handleReaderPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;
    const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (distance > 6) {
      suppressPagingUntil.current = Date.now() + 400;
    }
  };

  const readerContentView = useMemo(() => {
    if (!chapter) {
      return (
        <div className="flex h-full w-full items-center justify-center text-[#756885]/50 font-serif">
          Opening book...
        </div>
      );
    }
    const colWidth = `${getContentWidth()}px`;
    return (
      <div
        ref={contentRef}
        className="h-full selection:bg-[#8a78a1]/30 select-text"
        style={{
          columnWidth: colWidth, // width of one page
          columnGap: `${PAGE_GAP}px`, // spacing between pages
          columnFill: 'auto',
          width: colWidth,
          height: '100%',
          visibility: isContentReady ? 'visible' : 'hidden',
          fontSize: `${fontSize}px`,
          lineHeight: lineHeight,
          fontFamily: readerFonts[fontFamily].family,
          wordBreak: 'break-word',
          WebkitUserSelect: 'text',
          userSelect: 'text',
        }}
      >
        <div 
          className="select-text"
          style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
          dangerouslySetInnerHTML={{ __html: cleanedContent }} 
        />
      </div>
    );
  }, [
    chapter,
    cleanedContent,
    fontSize,
    lineHeight,
    fontFamily,
    containerWidth,
    isContentReady,
    pageMargin,
  ]);

  return (
    <div 
      className="marginalia-reader absolute inset-0 z-[100] flex flex-col overflow-hidden bg-[var(--reader-bg)] text-[var(--reader-text)] antialiased select-text transition-colors duration-200"
      style={{ ...themeStyle, WebkitUserSelect: 'text', userSelect: 'text' }}
    >
      
      <div className="absolute bottom-6 inset-x-0 z-10 flex justify-center select-none">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setShowFullPageCount((visible) => !visible);
          }}
          className="min-w-8 rounded-full px-2 py-1 font-serif text-[12px] tracking-wide text-[var(--reader-muted)] transition-colors"
          aria-label={showFullPageCount ? 'Show current page only' : 'Show total page count'}
        >
          {showFullPageCount
            ? `${currentPage + 1} of ${totalPages}`
            : currentPage + 1}
        </button>
      </div>

      {/* Top controls */}
      <div className="absolute top-0 inset-x-0 z-20 grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-3 px-5 pt-12 pb-4">
        <button
          onClick={closeReader}
          className={cn(
            "grid h-11 w-11 place-items-center rounded-full border border-[var(--reader-control-border)] bg-[var(--reader-control)] text-[var(--reader-muted)] shadow-[0_5px_14px_rgba(20,18,16,0.18)] transition-all duration-200 active:scale-95",
            showUI
              ? "visible opacity-100"
              : "invisible pointer-events-none opacity-0",
          )}
          aria-label="Close reader"
        >
          <X size={22} strokeWidth={1.5} />
        </button>
        <div className="pointer-events-none min-w-0 text-center">
          <span className="block truncate font-serif text-[13px] uppercase tracking-widest text-[var(--reader-muted)] opacity-75">
            {book.title.replace(/_/g, ' ')}
          </span>
        </div>
        <button
          type="button"
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            void toggleCurrentPageBookmark();
          }}
          disabled={isSavingBookmark}
          className={cn(
            "grid h-11 w-11 place-items-center rounded-full border border-[var(--reader-control-border)] bg-[var(--reader-control)] text-[var(--reader-muted)] shadow-[0_5px_14px_rgba(20,18,16,0.18)] transition-all duration-200 active:scale-95",
            showUI
              ? "visible opacity-100"
              : "invisible pointer-events-none opacity-0",
            currentPageBookmark && "text-[#9c86b0]",
          )}
          aria-label={currentPageBookmark ? 'Remove bookmark' : 'Bookmark this page'}
        >
          <Bookmark
            size={19}
            strokeWidth={1.5}
            fill={currentPageBookmark ? 'currentColor' : 'none'}
          />
        </button>
      </div>

      {/* Reader Content Area (Horizontal Columns) */}
      <div 
        ref={scrollRef}
        onScroll={handleScroll}
        onPointerDown={handleReaderPointerDown}
        onPointerUp={handleReaderPointerUp}
        onClick={handleReaderClick}
        className="w-full flex-1 overflow-x-auto overflow-y-hidden select-text"
        style={{
          scrollSnapType: 'x mandatory',
          overscrollBehaviorX: 'none',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          paddingTop: `${READER_PADDING_TOP}px`,
          paddingBottom: `${READER_PADDING_BOTTOM}px`,
          paddingLeft: `${pageMargin}px`,
          paddingRight: `${pageMargin}px`,
        }}
      >
        {readerContentView}
      </div>

      {/* Reader menu */}
      <div
        className={cn(
          "absolute bottom-8 right-5 z-30 flex flex-col items-end gap-2.5 transition-all duration-200",
          showUI
            ? "visible translate-y-0 opacity-100"
            : "invisible translate-y-3 opacity-0 pointer-events-none",
        )}
      >
        <AnimatePresence>
          {showReaderMenu && (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
              className="w-[226px] space-y-1.5 rounded-[22px] border border-[var(--reader-control-border)] bg-[var(--reader-panel)] p-2 text-[var(--reader-panel-text)] shadow-[0_14px_36px_rgba(20,18,16,0.3)]"
            >
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowReaderMenu(false);
                  setShowTOC(true);
                }}
                className="flex h-11 w-full items-center gap-3 rounded-[15px] px-3.5 text-left font-serif text-[13px] hover:bg-white/8"
              >
                <List size={17} strokeWidth={1.5} />
                <span className="flex-1">Contents</span>
                <span className="text-[10px] text-[var(--reader-panel-muted)]">{progressPct}%</span>
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void openBookNotes();
                }}
                className="flex h-11 w-full items-center gap-3 rounded-[15px] px-3.5 text-left font-serif text-[13px] hover:bg-white/8"
              >
                <BookOpenText size={17} strokeWidth={1.5} />
                <span className="flex-1">Bookmarks & Notes</span>
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowReaderMenu(false);
                  setShowSettings(true);
                }}
                className="flex h-11 w-full items-center gap-3 rounded-[15px] px-3.5 text-left font-serif text-[13px] hover:bg-white/8"
              >
                <Settings2 size={17} strokeWidth={1.5} />
                <span className="flex-1">Customise Theme</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setShowReaderMenu((open) => !open);
          }}
          className="grid h-12 w-12 place-items-center rounded-full border border-[var(--reader-control-border)] bg-[var(--reader-control)] text-[var(--reader-muted)] shadow-[0_7px_18px_rgba(20,18,16,0.26)] active:scale-95"
          aria-label={showReaderMenu ? 'Close reader menu' : 'Open reader menu'}
          aria-expanded={showReaderMenu}
        >
          {showReaderMenu
            ? <X size={20} strokeWidth={1.6} />
            : <Menu size={21} strokeWidth={1.6} />}
        </button>
      </div>

      {/* Floating Selection Action Button */}
      <AnimatePresence>
        {hasSelection && (
          <motion.button
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleFeatherClick(); }}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 rounded-full bg-[#8a78a1] px-6 py-3.5 text-[14px] font-medium tracking-wide text-white shadow-[0_8px_24px_rgba(138,120,161,0.4)] transition-transform active:scale-95"
          >
            <FeatherIcon size={16} strokeWidth={2} />
            <span>Add Marginalia</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Settings Modal (Bottom Sheet) */}
      <AnimatePresence>
        {showSettings && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 z-40 bg-black/30"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="absolute inset-x-0 bottom-0 z-50 flex max-h-[82%] flex-col overflow-hidden rounded-t-3xl border-t border-[var(--reader-control-border)] bg-[var(--reader-panel)] text-[var(--reader-panel-text)] shadow-2xl"
            >
              <div className="relative z-10 flex shrink-0 items-center justify-between border-b border-[var(--reader-control-border)] bg-[var(--reader-panel)] px-6 py-4">
                <button onClick={() => setShowSettings(false)} className="-ml-2 rounded-full bg-[var(--reader-control)] p-2 text-[var(--reader-muted)] transition-colors">
                  <X size={18} />
                </button>
                <h3 className="font-serif font-semibold tracking-widest text-[13px] uppercase opacity-80">Customise Theme</h3>
                <button onClick={() => setShowSettings(false)} className="-mr-2 rounded-full bg-[var(--reader-control)] p-2 text-[var(--reader-muted)] transition-colors">
                  <Check size={18} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 pb-8 pt-6">
              <div className="mb-7">
                <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[var(--reader-panel-muted)]">
                  Reading Theme
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(readerThemes) as ReaderTheme[]).map((id) => {
                    const option = readerThemes[id];
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setReaderTheme(id)}
                        className={cn(
                          "rounded-[16px] border p-2 text-left transition",
                          readerTheme === id
                            ? "border-[#9c86b0] ring-1 ring-[#9c86b0]/35"
                            : "border-[var(--reader-control-border)]",
                        )}
                      >
                        <span
                          className="block h-12 rounded-[10px] border"
                          style={{
                            backgroundColor: option.background,
                            borderColor: option.controlBorder,
                          }}
                        >
                          <span
                            className="mx-auto mt-[22px] block h-[2px] w-7 rounded-full"
                            style={{ backgroundColor: option.text }}
                          />
                        </span>
                        <span className="mt-2 block text-center font-serif text-[10px]">
                          {option.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Sample preview text */}
              <div 
                 className="mb-8 border-l-2 border-[#9c86b0] pl-4 font-serif opacity-80"
                 style={{ fontSize: `${fontSize}px`, lineHeight: lineHeight, fontFamily: readerFonts[fontFamily].family }}
              >
                 Lately I have been trying to learn something about the fundamental impermanence of all things...
              </div>

              <div className="space-y-6">
                <div>
                  <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[var(--reader-panel-muted)]">Text</div>
                  <div className="overflow-hidden rounded-xl border border-[var(--reader-control-border)] bg-[var(--reader-control)]">
                    {(Object.keys(readerFonts) as ReaderFont[]).map((id) => {
                      const option = readerFonts[id];
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            rememberReadingAnchor();
                            setFontFamily(id);
                          }}
                          className={cn(
                            "flex min-h-12 w-full items-center gap-3 border-b border-[var(--reader-control-border)] px-4 text-left last:border-b-0",
                            fontFamily === id && "bg-[#9c86b0]/14",
                          )}
                        >
                          <span
                            className="flex-1 text-[16px]"
                            style={{ fontFamily: option.family }}
                          >
                            {option.label}
                          </span>
                          {fontFamily === id && (
                            <Check size={14} strokeWidth={1.8} className="text-[#9c86b0]" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[var(--reader-panel-muted)]">Layout Options</div>
                  <div className="space-y-6 rounded-xl border border-[var(--reader-control-border)] bg-[var(--reader-control)] p-4">
                    <div>
                      <div className="flex justify-between text-xs mb-3 opacity-70">
                        <span>Font Size</span>
                        <span>{fontSize}px</span>
                      </div>
                      <input 
                        type="range" min="12" max="32" value={fontSize} 
                        onChange={(e) => {
                          rememberReadingAnchor();
                          setFontSize(Number(e.target.value));
                        }}
                        className="w-full accent-[#9c86b0]"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-3 opacity-70">
                        <span>Line Spacing</span>
                        <span>{lineHeight}</span>
                      </div>
                      <input 
                        type="range" min="1.0" max="2.5" step="0.1" value={lineHeight} 
                        onChange={(e) => {
                          rememberReadingAnchor();
                          setLineHeight(Number(e.target.value));
                        }}
                        className="w-full accent-[#9c86b0]"
                      />
                    </div>
                    <div>
                      <div className="mb-3 flex justify-between text-xs opacity-70">
                        <span>Margins</span>
                        <span>
                          {pageMargin}px
                          {containerWidth > 0
                            ? ` · ${Math.round((pageMargin / containerWidth) * 100)}%`
                            : ''}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="12"
                        max="52"
                        step="2"
                        value={pageMargin}
                        onChange={(e) => {
                          rememberReadingAnchor();
                          setPageMargin(Number(e.target.value));
                        }}
                        className="w-full accent-[#9c86b0]"
                      />
                    </div>
                  </div>
                </div>
              </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Table of Contents */}
      <AnimatePresence>
        {showTOC && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowTOC(false)}
              className="absolute inset-0 z-40 bg-black/24"
            />
            <motion.div 
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 240 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="reader-contents-title"
              className="absolute inset-x-0 bottom-0 z-50 flex max-h-[78%] flex-col rounded-t-[28px] border-t border-[var(--reader-control-border)] bg-[var(--reader-panel)] text-[var(--reader-panel-text)] shadow-[0_-18px_50px_rgba(20,18,16,0.28)]"
            >
              <div className="flex items-center justify-between border-b border-[var(--reader-control-border)] px-5 py-4">
                <div>
                  <h3 id="reader-contents-title" className="font-serif text-[16px] font-semibold">
                    Contents
                  </h3>
                  <p className="mt-0.5 font-serif text-[10px] italic text-[var(--reader-panel-muted)]">
                    {bookmarks.length} bookmarks · {bookNotes.length} notes
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTOC(false)}
                  className="grid h-9 w-9 place-items-center rounded-full bg-[var(--reader-control)] text-[var(--reader-muted)]"
                  aria-label="Close contents"
                >
                  <X size={17} strokeWidth={1.5} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-3 pb-10 pt-2">
                {book.chapters.map((ch, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      changeChapter(idx);
                      setShowTOC(false);
                      setShowUI(false);
                    }}
                    className={cn(
                      "flex min-h-12 w-full items-center gap-3 rounded-[14px] px-3 py-3 text-left font-serif text-[14px] transition-colors",
                      currentChapterIdx === idx
                        ? "bg-[#8a78a1]/10 font-semibold text-[#8a78a1]"
                        : "text-[var(--reader-panel-text)] hover:bg-white/8"
                    )}
                  >
                    <span className="w-6 shrink-0 text-right font-sans text-[9px] tabular-nums opacity-45">
                      {idx + 1}
                    </span>
                    <span className="min-w-0 flex-1">{ch.title}</span>
                    {currentChapterIdx === idx && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#8a78a1]" />
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Bookmarks & Notes */}
      <AnimatePresence>
        {showBookNotes && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowBookNotes(false)}
              className="absolute inset-0 z-40 bg-black/24"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 240 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="reader-notes-title"
              className="absolute inset-x-0 bottom-0 z-50 flex max-h-[72%] flex-col rounded-t-[28px] border-t border-[var(--reader-control-border)] bg-[var(--reader-panel)] text-[var(--reader-panel-text)] shadow-[0_-18px_50px_rgba(20,18,16,0.28)]"
            >
              <div className="flex items-center justify-between border-b border-[var(--reader-control-border)] px-5 py-4">
                <div>
                  <h3 id="reader-notes-title" className="font-serif text-[16px] font-semibold">
                    Bookmarks & Notes
                  </h3>
                  <p className="mt-0.5 font-serif text-[10px] italic text-[var(--reader-panel-muted)]">
                    {book.title.replace(/_/g, ' ')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBookNotes(false)}
                  className="grid h-9 w-9 place-items-center rounded-full bg-[var(--reader-control)] text-[var(--reader-muted)]"
                  aria-label="Close bookmarks and notes"
                >
                  <X size={17} strokeWidth={1.5} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 pb-10 pt-3">
                {isLoadingNotes ? (
                  <div className="py-16 text-center font-serif text-[12px] italic text-[var(--reader-panel-muted)]">
                    Gathering notes...
                  </div>
                ) : bookmarks.length > 0 || bookNotes.length > 0 ? (
                  <div className="space-y-5">
                    {bookmarks.length > 0 && (
                      <section>
                        <div className="pb-1 font-serif text-[9px] uppercase tracking-[0.14em] text-[#806f91]">
                          Bookmarks
                        </div>
                        <div className="divide-y divide-[#756885]/12">
                          {bookmarks.map((bookmark) => (
                            <div key={bookmark.id} className="flex items-start gap-2 py-3">
                              <button
                                type="button"
                                onClick={() => jumpToReadingLocation(
                                  bookmark.chapter_idx,
                                  bookmark.character_offset,
                                )}
                                className="min-w-0 flex-1 text-left"
                              >
                                <div className="font-serif text-[9px] italic text-[var(--reader-panel-muted)]">
                                  {bookmark.chapter}
                                </div>
                                <p className="mt-1.5 line-clamp-3 font-serif text-[12px] leading-relaxed">
                                  {bookmark.excerpt || 'Saved reading position'}
                                </p>
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteBookmark(bookmark.id)}
                                disabled={isSavingBookmark}
                                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#8a5555]/65 hover:bg-[#a95858]/8 disabled:opacity-40"
                                aria-label="Delete bookmark"
                              >
                                <Trash2 size={13} strokeWidth={1.5} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}

                    {bookNotes.length > 0 && (
                    <section>
                    <div className="pb-1 font-serif text-[9px] uppercase tracking-[0.14em] text-[#806f91]">
                      Notes
                    </div>
                    <div className="divide-y divide-[#756885]/12">
                    {bookNotes.map((note) => (
                      <article
                        key={note.id}
                        onClick={(event) => {
                          if (
                            editingNoteId === note.id
                            || (event.target as HTMLElement).closest('button, textarea, input')
                          ) return;
                          const chapterIdx = resolveNoteChapterIdx(note);
                          if (chapterIdx >= 0) {
                            jumpToReadingLocation(
                              chapterIdx,
                              note.character_offset,
                              note.original,
                            );
                          }
                        }}
                        className={cn(
                          "py-4",
                          editingNoteId !== note.id && "cursor-pointer",
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-serif text-[9px] uppercase tracking-[0.12em] text-[#806f91]">
                            {note.category === 'discuss'
                              ? 'Constellations'
                              : note.category === 'resonance'
                                ? 'Fragments'
                                : note.category === 'question'
                                  ? 'Ripples'
                                  : 'Note'}
                          </span>
                          <span className="truncate font-serif text-[9px] italic text-[var(--reader-panel-muted)]">
                            {note.chapter}
                          </span>
                        </div>
                        {note.original && (
                          <blockquote className="mt-2.5 border-l border-[#8a78a1]/30 pl-3 font-serif text-[12px] italic leading-relaxed text-[var(--reader-panel-muted)]">
                            {note.original}
                          </blockquote>
                        )}
                        {editingNoteId === note.id ? (
                          <div className="mt-3">
                            <textarea
                              value={editingNoteText}
                              onChange={(event) => setEditingNoteText(event.target.value)}
                              className="min-h-[96px] w-full resize-none rounded-[14px] border border-[#8a78a1]/18 bg-[var(--reader-control)] px-3 py-2.5 font-serif text-[13px] leading-relaxed text-[var(--reader-panel-text)] outline-none focus:border-[#8a78a1]/40"
                              aria-label="Edit note"
                              autoFocus
                            />
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {[
                                { id: 'discuss', label: 'Constellations', icon: Sparkles },
                                { id: 'resonance', label: 'Fragments', icon: Highlighter },
                                { id: 'question', label: 'Ripples', icon: CircleHelp },
                              ].map((category) => (
                                <button
                                  key={category.id}
                                  type="button"
                                  onClick={() => {
                                    const nextCategory = category.id as ReadingCategory;
                                    setEditingNoteCategory((current) => (
                                      current === nextCategory ? null : nextCategory
                                    ));
                                  }}
                                  className={cn(
                                    "flex h-7 items-center gap-1 rounded-full border px-2.5 font-serif text-[9px] transition",
                                    editingNoteCategory === category.id
                                      ? "border-transparent bg-[#8a78a1] text-white"
                                      : "border-[#8a78a1]/18 text-[#756885]",
                                  )}
                                >
                                  <category.icon size={10} strokeWidth={1.6} />
                                  {category.label}
                                </button>
                              ))}
                            </div>
                            <div className="mt-3 flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingNoteId(null)}
                                className="h-8 rounded-full px-3 font-serif text-[10px] text-[#756885]"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => void saveEditedNote()}
                                disabled={isSavingNote || !editingNoteText.trim()}
                                className="flex h-8 items-center gap-1.5 rounded-full bg-[#8a78a1] px-3.5 font-serif text-[10px] text-white disabled:opacity-45"
                              >
                                <Check size={11} strokeWidth={1.8} />
                                {isSavingNote ? 'Saving' : 'Save'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="mt-2.5 whitespace-pre-wrap font-serif text-[13px] leading-relaxed text-[var(--reader-panel-text)]">
                              {note.comment}
                            </p>
                            {deletingNoteId === note.id ? (
                              <div className="mt-3 flex items-center justify-between gap-3 rounded-[12px] bg-[#a95858]/8 px-3 py-2">
                                <span className="font-serif text-[10px] text-[#8a5555]">
                                  Delete this note?
                                </span>
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setDeletingNoteId(null)}
                                    className="h-7 rounded-full px-2.5 font-serif text-[9px] text-[#756885]"
                                  >
                                    Keep
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void deleteNote(note.id)}
                                    disabled={isSavingNote}
                                    className="h-7 rounded-full bg-[#9b5d5d] px-3 font-serif text-[9px] text-white disabled:opacity-45"
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="mt-2 flex justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => startEditingNote(note)}
                                  className="grid h-8 w-8 place-items-center rounded-full text-[#756885]/70 hover:bg-[#8a78a1]/8 hover:text-[#756885]"
                                  aria-label="Edit note"
                                >
                                  <Pencil size={13} strokeWidth={1.5} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingNoteId(null);
                                    setDeletingNoteId(note.id);
                                  }}
                                  className="grid h-8 w-8 place-items-center rounded-full text-[#8a5555]/65 hover:bg-[#a95858]/8 hover:text-[#8a5555]"
                                  aria-label="Delete note"
                                >
                                  <Trash2 size={13} strokeWidth={1.5} />
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </article>
                    ))}
                    </div>
                    </section>
                    )}
                  </div>
                ) : (
                  <div className="flex min-h-[240px] flex-col items-center justify-center text-center">
                    <div className="grid h-12 w-12 place-items-center rounded-full bg-[var(--reader-control)] text-[var(--reader-muted)]">
                      <Bookmark size={19} strokeWidth={1.4} />
                    </div>
                    <h4 className="mt-3 font-serif text-[14px] font-semibold">
                      Nothing marked yet
                    </h4>
                    <p className="mt-1 max-w-[220px] font-serif text-[10px] italic leading-relaxed text-[var(--reader-panel-muted)]">
                      Select a passage and add marginalia to find it here.
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Add Note Modal */}
      <AnimatePresence>
        {showAddNote && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddNote(false)}
              className="absolute inset-0 z-40 bg-black/50 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="absolute inset-x-4 top-[20%] z-50 m-auto flex h-fit max-h-[60%] max-w-sm flex-col rounded-[24px] border border-[var(--reader-control-border)] bg-[var(--reader-panel)] p-5 text-[var(--reader-panel-text)] shadow-2xl"
            >
               <div className="flex items-center justify-between mb-4">
                  <div className="font-semibold text-xs tracking-widest uppercase opacity-70">Note</div>
                  <button onClick={() => setShowAddNote(false)} className="-mr-2 rounded-full bg-[var(--reader-control)] p-2 text-[var(--reader-muted)] transition-colors">
                    <X size={14} />
                  </button>
               </div>
               
               <div className="border-l-2 border-[#8a78a1] pl-3 mb-5 max-h-24 overflow-y-auto text-sm opacity-80 font-serif italic leading-relaxed">
                 {selectedText}
               </div>

               <textarea
                 value={commentText}
                 onChange={(e) => setCommentText(e.target.value)}
                 placeholder="Add a marginalia..."
                 className="w-full bg-transparent outline-none resize-none min-h-[100px] text-[15px] placeholder:opacity-30 leading-relaxed"
                 autoFocus
               />

               <div className="flex gap-2 mt-4 overflow-x-auto pb-2 scrollbar-hide">
                 {[
                   { id: 'discuss', label: 'Discuss', icon: Sparkles },
                   { id: 'resonance', label: 'Resonance', icon: Highlighter },
                   { id: 'question', label: 'Question', icon: CircleHelp }
                 ].map(cat => (
                   <button 
                     key={cat.id}
                     onClick={() => {
                       const category = cat.id as ReadingCategory;
                       setNoteCategory((current) => current === category ? null : category);
                     }}
                     className={cn(
                       "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium whitespace-nowrap transition-all duration-200 border",
                       noteCategory === cat.id 
                         ? "bg-[#8a78a1] text-white border-transparent shadow-[0_0_12px_rgba(138,120,161,0.4)]" 
                         : "border-[var(--reader-control-border)] bg-transparent text-[var(--reader-panel-muted)] hover:bg-white/10"
                     )}
                   >
                     <cat.icon size={12} strokeWidth={2} /> {cat.label}
                   </button>
                 ))}
               </div>

               <button
                 onClick={submitNote}
                 disabled={isSubmitting || !commentText.trim()}
                 className="mt-4 w-full rounded-xl bg-[#8a78a1] py-3.5 text-[13px] font-semibold text-white transition-all disabled:opacity-50 active:scale-[0.98]"
               >
                 {isSubmitting ? 'Saving...' : 'Save Note'}
               </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

    </div>
  );
}
