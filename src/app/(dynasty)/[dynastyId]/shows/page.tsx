"use client";

// Broadcast shows: pick a segment, generate the transcript from the real week
// (ingest/gen/shows.js), render it with the existing TranscriptViewer.

import { useCallback, useEffect, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useIssueTab } from "@/components/dynasty/use-issue-tab";
import { SectionHeader } from "@/components/ui/section-header";
import { TranscriptViewer } from "@/components/shows/transcript-viewer";
import { SHOW_CONFIGS, type ShowTranscript, type ShowType } from "@/lib/shows/types";
import { getPortal } from "@/lib/dynasty/client";
import { cn } from "@/lib/utils";

const LAST_SHOW_KEY = "dw.shows.last";

export default function ShowsPage() {
  const { needsOnboarding, generate, currentSavePath } = useDynasty();
  const [transcript, setTranscript] = useState<ShowTranscript | null>(null);
  const [loadingType, setLoadingType] = useState<ShowType | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Restore the last-watched show from the persisted issue cache (localStorage remembers
  // which segment was on the air; the transcript itself lives in the issue store).
  // `dismissed` breaks the restore loop: without it, the back button cleared the transcript
  // and this effect immediately re-hydrated it — users were stuck on the show forever,
  // across restarts. Back now dismisses AND clears the last-show pointer.
  const [dismissed, setDismissed] = useState(false);
  const [lastType] = useState<ShowType | null>(() =>
    typeof window !== "undefined" ? (localStorage.getItem(LAST_SHOW_KEY) as ShowType | null) : null
  );
  const cachedTranscript = useIssueTab<ShowTranscript>(
    "shows",
    lastType ? { showType: lastType } : undefined
  );
  useEffect(() => {
    // Shape-guard: transcripts cached by older builds may lack personas — never hydrate those.
    if (
      !dismissed &&
      !transcript &&
      lastType &&
      cachedTranscript &&
      !cachedTranscript.error &&
      Array.isArray(cachedTranscript.personas) &&
      Array.isArray(cachedTranscript.dialogue)
    ) {
      setTranscript(cachedTranscript);
    }
  }, [cachedTranscript, transcript, lastType, dismissed]);

  const goBack = useCallback(() => {
    setDismissed(true);
    setTranscript(null);
    try { localStorage.removeItem(LAST_SHOW_KEY); } catch { /* private mode */ }
  }, []);

  const run = useCallback(
    async (showType: ShowType) => {
      setLoadingType(showType);
      setError(null);
      try {
        // The Portal Insider is a league-wide, data-real show: pull the actual portal board
        // (depth-chart flight risk across every program) and hand it to the generator.
        const extra: Record<string, unknown> = { showType };
        if (showType === "portal" && currentSavePath) {
          try {
            extra.portalData = await getPortal(currentSavePath);
          } catch {
            /* board unavailable — the show falls back to general portal talk */
          }
        }
        const data = await generate<ShowTranscript>("shows", extra);
        if (!data || data.error || !Array.isArray(data.dialogue) || data.dialogue.length === 0) {
          setError("The broadcast didn't come together. Try again.");
        } else {
          setTranscript(data);
          try { localStorage.setItem(LAST_SHOW_KEY, showType); } catch { /* private mode */ }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't reach the generator. Check your save + API key.");
      } finally {
        setLoadingType(null);
      }
    },
    [generate, currentSavePath]
  );

  return (
    <div>
      <SectionHeader title="THE STUDIO" subtitle="Your dynasty on the air" variant="shows" />

      {needsOnboarding ? (
        <div className="mt-6 rounded border border-dw-border bg-paper2 px-6 py-12 text-center font-serif text-ink2">
          Set up your save + API key in settings to put your program on the air.
        </div>
      ) : transcript ? (
        <div className="mt-4">
          <TranscriptViewer transcript={transcript} onBack={goBack} />
        </div>
      ) : (
        <>
          {error && <div className="mt-4 rounded border border-dw-red/30 bg-dw-red/10 px-6 py-6 text-center font-serif text-dw-red">{error}</div>}
          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {SHOW_CONFIGS.map((s) => (
              <button
                key={s.type}
                type="button"
                onClick={() => void run(s.type)}
                disabled={loadingType !== null}
                className={cn(
                  "rounded border border-dw-border bg-paper2 p-5 text-left transition-colors hover:border-dw-accent disabled:opacity-50",
                  loadingType === s.type && "border-dw-accent"
                )}
              >
                <p className="font-headline text-sm uppercase tracking-wide text-ink">{s.title}</p>
                <p className="mt-0.5 font-sans text-xs text-ink3">{s.subtitle}</p>
                <p className="mt-2 font-serif text-sm text-ink2">{s.description}</p>
                {loadingType === s.type && <p className="mt-2 font-sans text-xs text-dw-accent">Rolling tape…</p>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
