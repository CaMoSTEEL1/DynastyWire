"use client";

// Broadcast shows: pick a segment, generate the transcript from the real week
// (ingest/gen/shows.js), render it with the existing TranscriptViewer.

import { useCallback, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { SectionHeader } from "@/components/ui/section-header";
import { TranscriptViewer } from "@/components/shows/transcript-viewer";
import { SHOW_CONFIGS, type ShowTranscript, type ShowType } from "@/lib/shows/types";
import { cn } from "@/lib/utils";

export default function ShowsPage() {
  const { needsOnboarding, generate } = useDynasty();
  const [transcript, setTranscript] = useState<ShowTranscript | null>(null);
  const [loadingType, setLoadingType] = useState<ShowType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (showType: ShowType) => {
      setLoadingType(showType);
      setError(null);
      try {
        const data = await generate<ShowTranscript>("shows", { showType });
        if (!data || data.error || !Array.isArray(data.dialogue) || data.dialogue.length === 0) {
          setError("The broadcast didn't come together. Try again.");
        } else {
          setTranscript(data);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't reach the generator. Check your save + API key.");
      } finally {
        setLoadingType(null);
      }
    },
    [generate]
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
          <TranscriptViewer transcript={transcript} onBack={() => setTranscript(null)} />
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
