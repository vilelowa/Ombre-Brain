import { ChevronDown, Folder, Link2, Plus, Search, Settings2, Trash2, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { albireoTone } from './shared/albireoTokens';
import { pulseHaptic } from './shared/haptics';
import { cn } from '../lib/utils';
import type { Conversation, ConversationFolder } from '../types';

interface AlbireoDrawerProps {
  open: boolean;
  activeConversationId?: string | null;
  conversations: Conversation[];
  folders: ConversationFolder[];
  relayEnabled: boolean;
  onClose: () => void;
  onCreateFolder: (name: string) => Promise<ConversationFolder>;
  onDeleteFolder?: (id: string) => Promise<void>;
  onDeleteConversation: (id: string) => Promise<void>;
  onMoveConversation: (id: string, folderId: string | null) => Promise<void>;
  onNewConversation: () => void;
  onRenameConversation: (id: string, title: string) => Promise<void>;
  onSelectConversation: (id: string) => void;
  onToggleRelay: () => void;
  onOpenMeridian?: () => void;
}

function formatDrawerDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' });
}

export default function AlbireoDrawer({
  activeConversationId,
  conversations,
  folders,
  onClose,
  onCreateFolder,
  onDeleteFolder,
  onDeleteConversation,
  onMoveConversation,
  onNewConversation,
  onRenameConversation,
  onSelectConversation,
  onToggleRelay,
  onOpenMeridian,
  open,
  relayEnabled,
}: AlbireoDrawerProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({ root: true });
  const [createOpen, setCreateOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [editing, setEditing] = useState<Conversation | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [folderDropdownOpen, setFolderDropdownOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteType, setConfirmDeleteType] = useState<'conversation' | 'folder' | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null | undefined>(undefined);
  const longPressRef = useRef<number | null>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);

  const filteredConversations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((conversation) => conversation.title.toLowerCase().includes(needle));
  }, [conversations, query]);

  const sections = useMemo(() => {
    const source = searchOpen ? filteredConversations : conversations;
    return [
      {
        id: null,
        name: 'Conversations',
        conversations: source.filter((conversation) => !conversation.folder_id),
      },
      ...folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        conversations: source.filter((conversation) => conversation.folder_id === folder.id),
      })),
    ];
  }, [conversations, filteredConversations, folders, searchOpen]);

  const openEditor = (conversation: Conversation) => {
    setEditing(conversation);
    setEditingTitle(conversation.title);
    setEditingFolderId(conversation.folder_id || null);
    setFolderDropdownOpen(false);
    pulseHaptic('selection');
  };

  const clearLongPress = () => {
    if (longPressRef.current) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const handleDrop = async (folderId: string | null) => {
    if (!draggedId) return;
    setDropTargetId(undefined);
    const movingId = draggedId;
    setDraggedId(null);
    await onMoveConversation(movingId, folderId);
  };

  return (
    <>
      <button
        type="button"
        className={cn('fixed inset-0 z-40 transition-opacity duration-200', open ? 'opacity-100' : 'pointer-events-none opacity-0', albireoTone.dim)}
        aria-label="Close drawer"
        onClick={onClose}
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[min(360px,90vw)] flex-col border-r px-5 pb-6 pt-14 shadow-2xl transition-transform duration-300',
          albireoTone.bg,
          albireoTone.hairline,
        )}
        style={{ transform: open ? 'translateX(0)' : 'translateX(-100%)' }}
        onClick={() => {
          if (searchOpen) setSearchOpen(false);
        }}
      >
        <div className="flex min-h-12 items-center gap-3" onClick={(event) => event.stopPropagation()}>
          {searchOpen ? (
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={cn('min-h-11 min-w-0 flex-1 bg-transparent text-[18px] font-medium outline-none', albireoTone.text)}
              placeholder="Search"
              autoFocus
            />
          ) : (
            <h1 className={cn('font-sans text-[34px] font-semibold leading-none tracking-tight', albireoTone.text)}>Proximity</h1>
          )}

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className={cn('grid min-h-11 min-w-11 place-items-center rounded-full hover:bg-black/5 dark:hover:bg-white/5', albireoTone.text)}
            aria-label="Create folder"
          >
            <Folder size={18} />
          </button>

          <button
            type="button"
            onClick={() => setSearchOpen((value) => !value)}
            className={cn('grid min-h-11 min-w-11 place-items-center rounded-full hover:bg-black/5 dark:hover:bg-white/5', albireoTone.text)}
            aria-label={searchOpen ? 'Close drawer search' : 'Open drawer search'}
          >
            {searchOpen ? <X size={18} /> : <Search size={18} />}
          </button>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            className={cn('grid min-h-11 min-w-11 place-items-center rounded-full border', albireoTone.hairline, albireoTone.text)}
            aria-label="New chat"
            onClick={onNewConversation}
          >
            <Plus size={19} />
          </button>
          <button
            type="button"
            onClick={() => {
              onToggleRelay();
              pulseHaptic('selection');
            }}
            className={cn(
              'inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-[13px]',
              relayEnabled ? 'bg-black/5 dark:bg-white/8' : '',
              albireoTone.hairline,
              albireoTone.text,
            )}
          >
            <Link2 size={15} />
            Relay
          </button>
        </div>

        <div
          ref={listScrollRef}
          className="mt-7 min-h-0 flex-1 overflow-y-auto"
          onDragOver={(event) => {
            if (!draggedId || !listScrollRef.current) return;
            const rect = listScrollRef.current.getBoundingClientRect();
            const threshold = 60;
            const y = event.clientY;
            if (y - rect.top < threshold) {
              listScrollRef.current.scrollTop -= 12;
            } else if (rect.bottom - y < threshold) {
              listScrollRef.current.scrollTop += 12;
            }
          }}
        >
          {sections.map((section) => {
            const sectionKey = section.id || 'root';
            const expanded = expandedFolders[sectionKey] ?? true;
            return (
              <section
                key={sectionKey}
                className="mb-4"
                onDragOver={(event) => {
                  event.preventDefault();
                  setDropTargetId(section.id);
                }}
                onDragLeave={() => setDropTargetId(undefined)}
                onDrop={(event) => {
                  event.preventDefault();
                  void handleDrop(section.id);
                }}
              >
                <button
                  type="button"
                  onClick={() => setExpandedFolders((current) => ({ ...current, [sectionKey]: !expanded }))}
                  className={cn(
                    'group flex min-h-10 w-full items-center gap-2 rounded-xl px-1 text-left font-sans text-[17px] font-semibold transition',
                    dropTargetId === section.id && 'bg-black/5 dark:bg-white/8',
                    albireoTone.text,
                  )}
                >
                  <ChevronDown size={15} className={cn('shrink-0 transition-transform', !expanded && '-rotate-90')} />
                  <span className="min-w-0 flex-1 truncate">{section.name}</span>
                  <span className="relative min-w-[28px] text-right">
                    <span className={cn('block text-[12px] font-medium transition', section.id ? 'group-hover:opacity-0' : '', albireoTone.muted)}>
                      {section.conversations.length}
                    </span>
                    {section.id && (
                      <span
                        role="button"
                        tabIndex={0}
                        className={cn('absolute inset-y-0 right-0 grid min-h-7 min-w-7 translate-y-[-5px] translate-x-[2px] place-items-center rounded-full opacity-0 transition group-hover:opacity-100', albireoTone.muted, 'hover:bg-black/6 dark:hover:bg-white/8')}
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(section.id);
                          setConfirmDeleteType('folder');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            setConfirmDeleteId(section.id);
                            setConfirmDeleteType('folder');
                          }
                        }}
                      >
                        <Trash2 size={13} />
                      </span>
                    )}
                  </span>
                </button>

                {expanded && (
                  <div className="mt-1 flex flex-col gap-1">
                    {section.conversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        type="button"
                        draggable
                        onDragStart={(event) => {
                          setDraggedId(conversation.id);
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => {
                          setDraggedId(null);
                          setDropTargetId(undefined);
                        }}
                        onPointerDown={() => {
                          clearLongPress();
                          longPressRef.current = window.setTimeout(() => openEditor(conversation), 520);
                        }}
                        onPointerUp={clearLongPress}
                        onPointerLeave={clearLongPress}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          openEditor(conversation);
                        }}
                        onClick={() => {
                          onSelectConversation(conversation.id);
                          onClose();
                        }}
                        className={cn(
                          'group grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2 text-left transition hover:bg-black/4 dark:hover:bg-white/5',
                          activeConversationId === conversation.id && 'bg-black/5 dark:bg-white/8',
                        )}
                      >
                        <span className={cn('min-w-0 truncate text-[14px]', albireoTone.text)}>{conversation.title}</span>
                        <span className="relative min-w-[74px] text-right">
                          <span className={cn('block text-[12px] transition group-hover:opacity-0', albireoTone.muted)}>
                            {formatDrawerDate(conversation.updated_at)}
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            className={cn('absolute inset-y-0 right-0 grid min-h-8 min-w-8 translate-y-[-4px] place-items-center rounded-full opacity-0 transition group-hover:opacity-100', albireoTone.muted, 'hover:bg-black/6 dark:hover:bg-white/8')}
                            onClick={(event) => {
                              event.stopPropagation();
                              setConfirmDeleteId(conversation.id);
                              setConfirmDeleteType('conversation');
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                event.stopPropagation();
                                setConfirmDeleteId(conversation.id);
                                setConfirmDeleteType('conversation');
                              }
                            }}
                            aria-label="Delete conversation"
                          >
                            <Trash2 size={14} />
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            onOpenMeridian?.();
            pulseHaptic('selection');
          }}
          className={cn('mt-auto flex min-h-11 items-center gap-2 text-[14px] hover:text-charcoal dark:hover:text-white transition-colors', albireoTone.muted)}
        >
          <Settings2 size={16} />
          Meridian
        </button>
      </aside>

      {confirmDeleteId && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/35 px-5" onClick={() => setConfirmDeleteId(null)}>
          <div
            className={cn('w-full max-w-[320px] rounded-2xl border p-5 shadow-2xl', albireoTone.bg, albireoTone.hairline)}
            onClick={(event) => event.stopPropagation()}
          >
            <div className={cn('text-[16px] font-semibold', albireoTone.text)}>
              Delete {confirmDeleteType === 'folder' ? 'folder' : 'conversation'}?
            </div>
            <p className={cn('mt-2 text-[14px]', albireoTone.muted)}>
              This action cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={cn('min-h-10 rounded-full px-4 text-[14px]', albireoTone.muted)} onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="min-h-10 rounded-full bg-red-500 px-4 text-[14px] font-medium text-white hover:bg-red-600 transition"
                onClick={async () => {
                  if (confirmDeleteType === 'folder' && onDeleteFolder) {
                    await onDeleteFolder(confirmDeleteId);
                  } else if (confirmDeleteType === 'conversation') {
                    await onDeleteConversation(confirmDeleteId);
                  }
                  setConfirmDeleteId(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/35 px-5" onClick={() => setCreateOpen(false)}>
          <form
            className={cn('w-full max-w-sm rounded-2xl border p-4 shadow-2xl', albireoTone.bg, albireoTone.hairline)}
            onClick={(event) => event.stopPropagation()}
            onSubmit={async (event) => {
              event.preventDefault();
              const name = folderName.trim();
              if (!name) return;
              await onCreateFolder(name);
              setFolderName('');
              setCreateOpen(false);
            }}
          >
            <div className={cn('text-[15px] font-semibold', albireoTone.text)}>Create folder</div>
            <input
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              className={cn('mt-4 min-h-11 w-full rounded-xl border bg-transparent px-3 text-[15px] outline-none', albireoTone.hairline, albireoTone.text)}
              placeholder="Folder name"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={cn('min-h-10 rounded-full px-4 text-[14px]', albireoTone.muted)} onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
              <button type="submit" className={cn('min-h-10 rounded-full bg-white/85 px-4 text-[14px] font-medium text-black dark:bg-white')}>
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-black/35 px-5" onClick={() => setEditing(null)}>
          <form
            className={cn('w-full max-w-sm rounded-2xl border p-4 shadow-2xl', albireoTone.bg, albireoTone.hairline)}
            onClick={(event) => event.stopPropagation()}
            onSubmit={async (event) => {
              event.preventDefault();
              const title = editingTitle.trim();
              if (title && title !== editing.title) {
                await onRenameConversation(editing.id, title);
              }
              if ((editing.folder_id || null) !== editingFolderId) {
                await onMoveConversation(editing.id, editingFolderId);
              }
              setEditing(null);
            }}
          >
            <div className={cn('text-[15px] font-semibold', albireoTone.text)}>Edit conversation</div>
            <input
              value={editingTitle}
              onChange={(event) => setEditingTitle(event.target.value)}
              className={cn('mt-4 min-h-11 w-full rounded-xl border bg-transparent px-3 text-[15px] outline-none', albireoTone.hairline, albireoTone.text)}
              autoFocus
            />
            <div className="relative mt-3">
              <button
                type="button"
                className={cn('flex min-h-11 w-full items-center justify-between rounded-xl border bg-transparent px-3 text-[15px] outline-none', albireoTone.hairline, albireoTone.text)}
                onClick={() => setFolderDropdownOpen((v) => !v)}
              >
                <span>
                  {editingFolderId
                    ? folders.find((f) => f.id === editingFolderId)?.name || 'Unknown folder'
                    : 'No folder'}
                </span>
                <ChevronDown size={16} className={cn('transition-transform', folderDropdownOpen && 'rotate-180')} />
              </button>
              {folderDropdownOpen && (
                <div className={cn('absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-y-auto rounded-xl border p-1 shadow-xl', albireoTone.bg, albireoTone.hairline)}>
                  <button
                    type="button"
                    className={cn('flex w-full items-center rounded-lg px-2 py-2 text-left text-[14px] hover:bg-black/5 dark:hover:bg-white/5', albireoTone.text)}
                    onClick={() => {
                      setEditingFolderId(null);
                      setFolderDropdownOpen(false);
                    }}
                  >
                    No folder
                  </button>
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      className={cn('flex w-full items-center rounded-lg px-2 py-2 text-left text-[14px] hover:bg-black/5 dark:hover:bg-white/5', albireoTone.text)}
                      onClick={() => {
                        setEditingFolderId(folder.id);
                        setFolderDropdownOpen(false);
                      }}
                    >
                      {folder.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={cn('min-h-10 rounded-full px-4 text-[14px]', albireoTone.muted)} onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="min-h-10 rounded-full bg-white/85 px-4 text-[14px] font-medium text-black dark:bg-white">
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
