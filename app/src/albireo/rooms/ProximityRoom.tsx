import { Menu, Sparkles } from 'lucide-react';
import { useState } from 'react';
import AlbireoDrawer from '../AlbireoDrawer';
import ChatComposer from '../chat/ChatComposer';
import ChatMessageList from '../chat/ChatMessageList';
import PersonaPicker from '../chat/PersonaPicker';
import QuickEditDirective from '../chat/QuickEditDirective';
import { useChatController } from '../chat/useChatController';
import { useSettingsController } from '../settings/useSettingsController';
import MeridianScreen from '../settings/MeridianScreen';
import { albireoIconButton, albireoTone } from '../shared/albireoTokens';
import { pulseHaptic } from '../shared/haptics';
import { cn } from '../../lib/utils';

export default function ProximityRoom() {
  const chat = useChatController();
  const settings = useSettingsController();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [quickEditOpen, setQuickEditOpen] = useState(false);

  return (
    <div className={cn('relative flex h-full min-h-0 flex-col overflow-hidden', albireoTone.bg)}>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-24 backdrop-blur-md [mask-image:linear-gradient(to_bottom,black_0%,black_30%,transparent_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-28 backdrop-blur-md [mask-image:linear-gradient(to_top,black_62%,transparent_100%)]" />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex min-h-20 items-start justify-between px-5 pt-7">
        <button
          type="button"
          onClick={() => {
            setDrawerOpen(true);
            pulseHaptic('selection');
          }}
          className={cn(albireoIconButton, albireoTone.text, 'pointer-events-auto hover:bg-black/5 dark:hover:bg-white/5')}
          aria-label="Open drawer"
        >
          <Menu size={20} />
        </button>

        <button
          type="button"
          onClick={() => setPersonaOpen((value) => !value)}
          className={cn('pointer-events-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-full font-serif text-[17px] font-semibold', albireoTone.text, 'hover:bg-black/5 dark:hover:bg-white/5')}
          aria-label="Open persona picker"
        >
          <Sparkles size={17} />
        </button>
      </header>

      {personaOpen && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[35] bg-transparent"
            aria-label="Close persona picker"
            onClick={() => setPersonaOpen(false)}
          />
          <PersonaPicker
            personas={chat.profiles}
            activePersonaId={chat.activeProfileId}
            onSelect={async (id) => {
              await chat.selectPersona(id);
              setPersonaOpen(false);
            }}
            onQuickEdit={() => {
              chat.openQuickEdit();
              setPersonaOpen(false);
              setQuickEditOpen(true);
            }}
          />
        </>
      )}

      <ChatMessageList
        messages={chat.messages}
        splitEnabled={chat.splitEnabled}
        startupContext={chat.startupContext}
        isSending={chat.isSending}
        isHistoryLoading={chat.isHistoryLoading}
        error={chat.error}
        onFlagDream={chat.flagDream}
        onUnflagDream={chat.unflagDream}
        onRegenerate={chat.regenerateMessage}
      />

      <ChatComposer
        draft={chat.draft}
        draftAttachments={chat.draftAttachments}
        onDraftAttachmentsChange={chat.setDraftAttachments}
        isSending={chat.isSending}
        splitEnabled={chat.splitEnabled}
        relayEnabled={chat.relayEnabled}
        modelName={chat.activeProfile?.name || 'Elroy'}
        onDraftChange={chat.setDraft}
        onKeyDown={chat.handleDraftKeyDown}
        onSend={chat.sendMessage}
        onToggleSplit={() => chat.setSplitEnabled((value) => !value)}
        onToggleRelay={() => chat.setRelayEnabled((value) => !value)}
      />

      <AlbireoDrawer
        open={drawerOpen}
        activeConversationId={chat.activeConversationId}
        conversations={chat.conversations}
        folders={chat.folders}
        relayEnabled={chat.relayEnabled}
        onCreateFolder={chat.createFolder}
        onDeleteFolder={chat.deleteFolder}
        onDeleteConversation={chat.deleteConversation}
        onNewConversation={() => {
          chat.startNewConversation();
          setDrawerOpen(false);
        }}
        onMoveConversation={chat.moveConversationToFolder}
        onRenameConversation={chat.renameConversation}
        onSelectConversation={chat.selectConversation}
        onToggleRelay={() => chat.setRelayEnabled((value) => !value)}
        onClose={() => setDrawerOpen(false)}
        onOpenMeridian={() => {
          setDrawerOpen(false);
          settings.openMeridian();
        }}
      />

      <MeridianScreen
        settings={settings}
        onClose={settings.closeMeridian}
      />

      {quickEditOpen && (
        chat.activeProfile && (
          <QuickEditDirective
            persona={chat.activeProfile}
            prompt={chat.quickEditPrompt}
            saving={chat.isQuickSaving}
            onPromptChange={chat.setQuickEditPrompt}
            onSave={async () => {
              await chat.saveQuickEdit();
              setQuickEditOpen(false);
            }}
            onClose={() => setQuickEditOpen(false)}
          />
        )
      )}
    </div>
  );
}
