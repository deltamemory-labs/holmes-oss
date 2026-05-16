import { useCallback, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { ChatView } from "@/components/chat/ChatView";
import { CitationProvider, useCitation } from "@/lib/citations";
import { CitationViewerDrawer } from "@/components/shared/CitationViewerDrawer";

export function AssistantPage() {
  const params = useParams({ strict: false });
  const chatId = (params as { id?: string }).id;
  return (
    <CitationProvider>
      <AssistantBody chatId={chatId} />
    </CitationProvider>
  );
}

function AssistantBody({ chatId }: { chatId?: string }) {
  const { activeCitation, openCitation, clearCitation } = useCitation();
  const [chatProjectId, setChatProjectId] = useState<string | undefined>();

  // ChatView fires this whenever the active project changes — either
  // because the user picked one in the dropdown, or because hydrating
  // an existing chat inferred its project. This is the single source of
  // truth for the drawer's doc-lookup scope.
  const handleProjectChange = useCallback((pid: string | undefined) => {
    setChatProjectId(pid);
  }, []);

  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0 flex flex-col">
        <ChatView
          chatId={chatId}
          onCitationClick={openCitation}
          onProjectChange={handleProjectChange}
        />
      </div>
      {activeCitation && (
        <CitationViewerDrawer
          citation={activeCitation}
          projectId={chatProjectId}
          onClose={clearCitation}
        />
      )}
    </div>
  );
}
