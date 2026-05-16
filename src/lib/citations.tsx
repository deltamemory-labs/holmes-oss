import { createContext, useContext, useState, type ReactNode } from "react";

export interface Citation {
  ref: number;
  doc_id: string;
  page: number | string;
  quote: string;
}

interface CitationContextType {
  openCitation: (citation: Citation) => void;
  activeCitation: Citation | null;
  clearCitation: () => void;
}

const Ctx = createContext<CitationContextType>({
  openCitation: () => {},
  activeCitation: null,
  clearCitation: () => {},
});

export function CitationProvider({ children }: { children: ReactNode }) {
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null);
  return (
    <Ctx.Provider
      value={{
        activeCitation,
        openCitation: setActiveCitation,
        clearCitation: () => setActiveCitation(null),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useCitation() {
  return useContext(Ctx);
}

/** Parse <CITATIONS> block from assistant message text */
export function parseCitations(text: string): Citation[] {
  const match = text.match(/<CITATIONS>\s*([\s\S]*?)\s*<\/CITATIONS>/);
  if (!match) return [];
  try {
    return JSON.parse(match[1]);
  } catch {
    return [];
  }
}

/** Strip <CITATIONS> block from display text */
export function stripCitations(text: string): string {
  return text.replace(/<CITATIONS>[\s\S]*?<\/CITATIONS>/g, "").trim();
}
