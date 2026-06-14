import React, { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';
import { Book, BookChapter, ReadingCategory, ReadingComment } from '../types';
import { cn } from '../lib/utils';
import { 
  ArrowLeft, 
  BookOpen, 
  Upload, 
  Plus, 
  Trash2, 
  Heart, 
  MessageSquare, 
  HelpCircle, 
  Loader2,
  ChevronLeft,
  ChevronRight,
  BookMarked
} from 'lucide-react';

export default function Reading() {
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [selectedChapterIdx, setSelectedChapterIdx] = useState<number>(0);
  const [chapterContent, setChapterContent] = useState<BookChapter | null>(null);
  const [comments, setComments] = useState<ReadingComment[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isChapterLoading, setIsChapterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Comment Form States
  const [selectedText, setSelectedText] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentFlag, setCommentFlag] = useState<ReadingCategory | null>(null);
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readerTextRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadBooks();
  }, []);

  useEffect(() => {
    if (selectedBook) {
      loadChapter(selectedBook.id, selectedChapterIdx);
      loadComments(selectedBook.id);
    } else {
      setChapterContent(null);
      setComments([]);
    }
  }, [selectedBook, selectedChapterIdx]);

  const loadBooks = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.getReadingBooks();
      setBooks(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load books.');
    } finally {
      setIsLoading(false);
    }
  };

  const loadChapter = async (bookId: string, idx: number) => {
    setIsChapterLoading(true);
    try {
      const data = await api.getBookChapter(bookId, idx);
      setChapterContent(data);
      setSelectedText(''); // Clear selection on chapter change
    } catch (e: any) {
      console.error('Failed to load chapter content:', e);
    } finally {
      setIsChapterLoading(false);
    }
  };

  const loadComments = async (bookId: string) => {
    try {
      const data = await api.getReadingComments(bookId);
      setComments(data);
    } catch (e: any) {
      console.error('Failed to load comments:', e);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadBookFile(file);
  };

  const uploadBookFile = async (file: File) => {
    setIsUploading(true);
    setError(null);
    try {
      const res = await api.uploadBook(file);
      if (res.ok) {
        setBooks(prev => [res.book, ...prev]);
      }
    } catch (e: any) {
      setError(e.message || 'Upload failed. Check if pypdf is installed for PDFs.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Text selection handler
  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (selection) {
      const selectedStr = selection.toString().trim();
      if (selectedStr.length > 0) {
        setSelectedText(selectedStr);
      }
    }
  };

  const handleCreateComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBook || !commentText.trim()) return;
    
    setIsSubmittingComment(true);
    try {
      const currentChapterTitle = selectedBook.chapters[selectedChapterIdx]?.title || `Chapter ${selectedChapterIdx + 1}`;
      const res = await api.createReadingComment({
        book_id: selectedBook.id,
        book_name: selectedBook.title,
        chapter: currentChapterTitle,
        original: selectedText,
        comment: commentText.trim(),
        category: commentFlag,
      });

      if (res.ok) {
        setComments(prev => [res.comment, ...prev]);
        setCommentText('');
        setSelectedText('');
        setCommentFlag(null);
      }
    } catch (e: any) {
      alert(e.message || 'Failed to save comment.');
    } finally {
      setIsSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!confirm('Delete this comment from memory?')) return;
    try {
      const res = await api.deleteReadingComment(commentId);
      if (res.ok) {
        setComments(prev => prev.filter(c => c.id !== commentId));
      }
    } catch (e: any) {
      console.error('Failed to delete comment:', e);
    }
  };

  const handlePrevChapter = () => {
    if (selectedChapterIdx > 0) {
      setSelectedChapterIdx(prev => prev - 1);
    }
  };

  const handleNextChapter = () => {
    if (selectedBook && selectedChapterIdx < selectedBook.chapters.length - 1) {
      setSelectedChapterIdx(prev => prev + 1);
    }
  };

  // Procedural gradient generator for covers based on title string hash
  const getCoverGradient = (title: string) => {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = title.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
      'from-primary/80 to-primary-container/90',
      'from-secondary/80 to-secondary-fixed/90',
      'from-tertiary/80 to-tertiary-container/90',
      'from-[#4A5E73] to-[#2E3C4E]',
      'from-[#5F6366] to-[#3A3E40]',
      'from-[#6B5B6D] to-[#463947]',
    ];
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  };

  // Format timestamp helper
  const formatTime = (timeStr: string) => {
    try {
      if (!timeStr) return '';
      const d = new Date(timeStr);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (e) {
      return '';
    }
  };

  return (
    <div className="flex flex-col h-full bg-background relative overflow-hidden">
      
      {/* ── SHELF VIEW ── */}
      {!selectedBook && (
        <div className="flex-1 overflow-y-auto pt-16 px-4 md:px-8 pb-8 flex flex-col gap-6 w-full max-w-3xl mx-auto">
          {/* Header */}
          <header className="fixed top-0 left-0 right-0 w-full md:max-w-3xl md:mx-auto md:left-auto md:right-auto z-40 bg-background/90 backdrop-blur-sm border-b border-hairline border-dotted flex justify-center items-center px-4 h-14">
            <div className="flex flex-col items-center">
              <h1 className="font-sans text-[18px] font-semibold text-primary tracking-tight">Reading Space</h1>
              <span className="font-mono text-[10px] text-muted-gray uppercase tracking-widest mt-0.5">Ciel's Library</span>
            </div>
          </header>

          {error && (
            <div className="bg-secondary-fixed/30 border border-secondary/20 text-secondary p-3 rounded-lg text-center font-sans text-sm animate-fade-in">
              {error}
            </div>
          )}

          {/* Books Shelf Grid */}
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-gray font-mono text-[12px] uppercase tracking-widest">
              <Loader2 className="animate-spin text-primary" size={24} />
              Loading Shelf...
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 mt-4">
              
              {/* Upload Book Card */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className={cn(
                  "aspect-[3/4] flex flex-col items-center justify-center border-2 border-dashed border-outline-variant hover:border-primary/50 bg-surface-container-lowest rounded-xl gap-3 text-muted-gray hover:text-primary transition-all duration-300 relative group cursor-pointer",
                  isUploading && "pointer-events-none opacity-60"
                )}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="animate-spin text-primary" size={28} />
                    <span className="font-mono text-[10px] uppercase tracking-wider">Parsing file...</span>
                  </>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center group-hover:bg-primary/5 transition-colors">
                      <Upload size={20} />
                    </div>
                    <div className="text-center px-4">
                      <span className="block font-sans text-[13px] font-semibold text-charcoal">Import Book</span>
                      <span className="block font-mono text-[9px] text-muted-gray mt-1">EPUB, PDF, TXT, MD</span>
                    </div>
                  </>
                )}
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".epub,.pdf,.txt,.md"
                  className="hidden" 
                />
              </button>

              {/* Uploaded Books List */}
              {books.map(book => (
                <div 
                  key={book.id}
                  onClick={() => {
                    setSelectedBook(book);
                    setSelectedChapterIdx(0);
                  }}
                  className="flex flex-col gap-2 group cursor-pointer animate-fade-in"
                >
                  {/* Procedurally Colored Book Cover */}
                  <div className={cn(
                    "aspect-[3/4] rounded-xl bg-gradient-to-br shadow-sm group-hover:shadow-md transition-all duration-300 relative overflow-hidden flex flex-col justify-between p-4 text-white",
                    getCoverGradient(book.title)
                  )}>
                    <div className="absolute inset-0 bg-black/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    <BookMarked size={18} className="opacity-80" />
                    
                    <div className="flex flex-col gap-1 pr-2">
                      <h2 className="font-sans text-[14px] font-bold leading-tight tracking-tight line-clamp-3">
                        {book.title}
                      </h2>
                      <p className="font-sans text-[10px] opacity-75 mt-1 line-clamp-1 truncate">
                        {book.author}
                      </p>
                    </div>

                    <span className="font-mono text-[9px] uppercase tracking-wider opacity-60 self-end">
                      {book.chapters.length} Ch
                    </span>
                  </div>

                  {/* Book Metadata beneath */}
                  <div className="px-1">
                    <h3 className="font-sans text-[13px] font-semibold text-charcoal truncate" title={book.title}>
                      {book.title}
                    </h3>
                    <span className="font-mono text-[9px] text-muted-gray uppercase tracking-wider block">
                      {book.extension.replace('.', '')} reader
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {books.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center text-center py-12 gap-3 opacity-60 select-none">
              <BookOpen size={36} className="text-muted-gray" />
              <p className="font-sans text-sm text-charcoal">Your reading shelf is empty. Import a book to start!</p>
            </div>
          )}
        </div>
      )}

      {/* ── READER SCREEN ── */}
      {selectedBook && (
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          
          {/* Reader Header */}
          <header className="bg-surface-container-lowest border-b border-hairline/80 px-4 h-14 flex items-center justify-between z-10 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <button 
                onClick={() => setSelectedBook(null)}
                className="text-muted-gray hover:text-charcoal p-1.5 rounded-full hover:bg-surface-container transition-colors cursor-pointer"
                title="Back to shelf"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="flex flex-col min-w-0">
                <h1 className="font-sans text-[14px] font-bold text-charcoal truncate" title={selectedBook.title}>
                  {selectedBook.title}
                </h1>
                {/* Chapter Select Dropdown */}
                <select
                  value={selectedChapterIdx}
                  onChange={(e) => setSelectedChapterIdx(Number(e.target.value))}
                  className="font-mono text-[10px] text-primary bg-transparent border-none outline-none max-w-[180px] p-0 font-semibold cursor-pointer"
                >
                  {selectedBook.chapters.map((ch, idx) => (
                    <option key={idx} value={idx}>
                      Ch {idx + 1}: {ch.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Paging Buttons */}
            <div className="flex items-center gap-1">
              <button
                onClick={handlePrevChapter}
                disabled={selectedChapterIdx === 0}
                className="p-1.5 rounded-md hover:bg-surface-container disabled:opacity-35 text-charcoal cursor-pointer"
                title="Previous Chapter"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="font-mono text-[10px] text-muted-gray px-1">
                {selectedChapterIdx + 1}/{selectedBook.chapters.length}
              </span>
              <button
                onClick={handleNextChapter}
                disabled={selectedChapterIdx === selectedBook.chapters.length - 1}
                className="p-1.5 rounded-md hover:bg-surface-container disabled:opacity-35 text-charcoal cursor-pointer"
                title="Next Chapter"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </header>

          {/* Reader Split Panes Container */}
          <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden relative">
            
            {/* 1. Left Text Reader Pane */}
            <div className="flex-1 overflow-y-auto px-6 py-6 md:px-8 border-b md:border-b-0 md:border-r border-hairline bg-surface/50">
              {isChapterLoading ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-gray font-mono text-[10px] uppercase tracking-wider">
                  <Loader2 className="animate-spin text-primary" size={20} />
                  Loading Chapter...
                </div>
              ) : chapterContent ? (
                <article 
                  ref={readerTextRef}
                  onMouseUp={handleTextSelection}
                  className="prose max-w-none text-[16px] leading-[26px] tracking-wide select-text text-charcoal whitespace-pre-wrap select-text font-sans pb-16"
                >
                  <h2 className="font-sans text-[20px] font-bold text-charcoal border-b border-hairline/80 pb-3 mb-6">
                    {chapterContent.title}
                  </h2>
                  {chapterContent.content}
                </article>
              ) : (
                <div className="text-center py-20 text-muted-gray font-sans text-sm">
                  Failed to load content.
                </div>
              )}
            </div>

            {/* 2. Right Comments Sidebar Pane */}
            <div className="w-full md:w-80 shrink-0 flex flex-col min-h-0 bg-surface-container-lowest">
              
              {/* Comment Input Card Form */}
              <div className="p-4 border-b border-hairline shrink-0">
                <h2 className="font-sans text-[13px] font-bold text-charcoal uppercase tracking-wider mb-3">
                  Write Comment
                </h2>
                
                <form onSubmit={handleCreateComment} className="flex flex-col gap-3">
                  {/* Highlighted text preview block */}
                  {selectedText ? (
                    <div className="bg-surface-container-low border border-hairline rounded-lg p-2.5 relative group">
                      <span className="block font-mono text-[8px] text-muted-gray uppercase tracking-widest">
                        Highlighted Text
                      </span>
                      <p className="font-sans text-[11px] leading-relaxed text-charcoal italic line-clamp-3 mt-1 select-none">
                        "{selectedText}"
                      </p>
                      <button
                        type="button"
                        onClick={() => setSelectedText('')}
                        className="absolute top-1 right-1 text-muted-gray hover:text-charcoal text-[10px] font-mono p-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        title="Clear quote"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="border border-hairline/60 border-dashed rounded-lg p-3 text-center text-muted-gray font-sans text-[11px] select-none bg-surface/30">
                      💡 Select text on the left to add a quote
                    </div>
                  )}

                  <textarea
                    rows={3}
                    placeholder="Share your thoughts..."
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    className="w-full bg-surface-container-low border border-hairline rounded-lg p-2.5 font-sans text-[13px] leading-relaxed text-charcoal focus:outline-none focus:border-primary/50 resize-none"
                    required
                  />

                  {/* Flag selector row */}
                  <div className="flex justify-between items-center gap-1.5">
                    <span className="font-mono text-[9px] text-muted-gray uppercase tracking-wider">
                      Flag Elroy:
                    </span>
                    <div className="flex gap-1">
                      {/* Flag: 想聊 */}
                      <button
                        type="button"
                        onClick={() => setCommentFlag(prev => prev === 'discuss' ? null : 'discuss')}
                        className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center border text-[13px] transition-colors cursor-pointer",
                          commentFlag === 'discuss'
                            ? "bg-primary/10 border-primary text-primary shadow-sm"
                            : "bg-surface-container-low border-hairline hover:bg-surface-container-high text-muted-gray"
                        )}
                        title="💬 Want to chat (Higher priority for Elroy to push)"
                      >
                        💬
                      </button>
                      {/* Flag: 共鳴 */}
                      <button
                        type="button"
                        onClick={() => setCommentFlag(prev => prev === 'resonance' ? null : 'resonance')}
                        className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center border text-[13px] transition-colors cursor-pointer",
                          commentFlag === 'resonance'
                            ? "bg-secondary/10 border-secondary text-secondary shadow-sm"
                            : "bg-surface-container-low border-hairline hover:bg-surface-container-high text-muted-gray"
                        )}
                        title="🤍 Resonance (Becomes dream material)"
                      >
                        🤍
                      </button>
                      {/* Flag: 困惑 */}
                      <button
                        type="button"
                        onClick={() => setCommentFlag(prev => prev === 'question' ? null : 'question')}
                        className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center border text-[13px] transition-colors cursor-pointer",
                          commentFlag === 'question'
                            ? "bg-tertiary/10 border-tertiary-container text-tertiary shadow-sm"
                            : "bg-surface-container-low border-hairline hover:bg-surface-container-high text-muted-gray"
                        )}
                        title="❓ Confusion (Becomes dream material)"
                      >
                        ❓
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSubmittingComment || !commentText.trim()}
                    className="w-full bg-primary hover:bg-primary-container text-on-primary font-mono text-[11px] uppercase tracking-wider py-2 rounded-lg font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
                  >
                    {isSubmittingComment ? 'Saving Note...' : 'Save Thought'}
                  </button>
                </form>
              </div>

              {/* Comments Stream List */}
              <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
                <div className="px-4 py-3 border-b border-hairline/50 bg-surface/30 sticky top-0 z-10 flex items-center justify-between shrink-0">
                  <h3 className="font-sans text-[11px] font-bold text-muted-gray uppercase tracking-wider">
                    Thoughts ({comments.length})
                  </h3>
                </div>

                {comments.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-muted-gray gap-2 select-none">
                    <BookOpen size={20} className="opacity-45" />
                    <p className="font-sans text-[11px]">No notes in this book yet. Highlight text or type thoughts above to save.</p>
                  </div>
                ) : (
                  <div className="flex flex-col min-h-0 divide-y divide-hairline">
                    {comments.map((comment) => (
                      <div 
                        key={comment.id}
                        className="p-4 flex flex-col gap-2 relative group hover:bg-surface-container-lowest transition-colors animate-fade-in"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-[9px] text-primary font-semibold max-w-[170px] truncate">
                            {comment.chapter}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {comment.category && (
                              <span className="text-[11px]" title={comment.category}>
                                {comment.category === 'discuss' ? '💬' : comment.category === 'resonance' ? '🤍' : '❓'}
                              </span>
                            )}
                            <button
                              onClick={() => handleDeleteComment(comment.id)}
                              className="text-muted-gray hover:text-secondary opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-surface-container cursor-pointer"
                              title="Delete comment"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>

                        {comment.original && (
                          <div className="pl-2.5 border-l border-hairline/80 my-0.5">
                            <p className="font-sans text-[11px] leading-relaxed text-muted-gray italic line-clamp-2">
                              "{comment.original}"
                            </p>
                          </div>
                        )}

                        <p className="font-sans text-[13px] leading-relaxed text-charcoal whitespace-pre-wrap">
                          {comment.comment}
                        </p>

                        <span className="font-mono text-[8px] text-muted-gray uppercase tracking-wider self-end mt-1">
                          {formatTime(comment.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
