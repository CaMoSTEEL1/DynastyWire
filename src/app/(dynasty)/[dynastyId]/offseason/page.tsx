"use client";

// Offseason: pick a phase, generate its narrative from the real season
// (ingest/gen/offseason.js). Phase content shapes vary, so we render defensively.

import { useCallback, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { SectionHeader } from "@/components/ui/section-header";
import { OFFSEASON_PHASES, type OffseasonPhase } from "@/lib/offseason/types";
import { cn } from "@/lib/utils";

type PhaseContent = Record<string, unknown>;

function Str({ v }: { v: unknown }) {
  return typeof v === "string" && v.trim() ? <p className="mt-2 font-serif leading-relaxed text-ink2">{v}</p> : null;
}

function renderContent(c: PhaseContent) {
  const headline = (c.headline ?? c.title) as string | undefined;
  const items: React.ReactNode[] = [];
  if (Array.isArray(c.awards)) {
    items.push(
      <ul key="awards" className="mt-3 space-y-1">
        {(c.awards as { name: string; winner: string; description?: string }[]).map((a, i) => (
          <li key={i} className="font-serif text-ink2">
            <span className="font-headline text-ink">{a.name}:</span> {a.winner}
            {a.description ? ` — ${a.description}` : ""}
          </li>
        ))}
      </ul>
    );
  }
  if (Array.isArray(c.socialReactions)) {
    items.push(
      <div key="social" className="mt-4 space-y-2">
        {(c.socialReactions as { handle: string; body: string }[]).map((p, i) => (
          <div key={i} className="rounded border border-dw-border bg-paper2 p-3">
            <span className="font-sans text-xs text-ink3">{p.handle}</span>
            <p className="font-serif text-sm text-ink2">{p.body}</p>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="mt-4 rounded border border-dw-border bg-paper2 p-5">
      {headline && <h3 className="font-headline text-xl text-ink">{headline}</h3>}
      <Str v={c.body} />
      <Str v={c.narrative} />
      {items}
    </div>
  );
}

export default function OffseasonPage() {
  const { needsOnboarding, generate } = useDynasty();
  const [content, setContent] = useState<PhaseContent | null>(null);
  const [loadingPhase, setLoadingPhase] = useState<OffseasonPhase | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (phase: OffseasonPhase) => {
      setLoadingPhase(phase);
      setError(null);
      setContent(null);
      try {
        const data = await generate<PhaseContent>("offseason", { phase });
        if (!data || (data as { error?: boolean }).error) setError("That chapter didn't generate. Try again.");
        else setContent(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't reach the generator. Check your save + API key.");
      } finally {
        setLoadingPhase(null);
      }
    },
    [generate]
  );

  return (
    <div>
      <SectionHeader title="THE OFFSEASON" subtitle="Between the seasons" variant="offseason" />

      {needsOnboarding ? (
        <div className="mt-6 rounded border border-dw-border bg-paper2 px-6 py-12 text-center font-serif text-ink2">
          Set up your save + API key in settings to write your offseason.
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {OFFSEASON_PHASES.map((p) => (
              <button
                key={p.phase}
                type="button"
                onClick={() => void run(p.phase)}
                disabled={loadingPhase !== null}
                className={cn(
                  "rounded border border-dw-border bg-paper2 p-4 text-left transition-colors hover:border-dw-accent disabled:opacity-50",
                  loadingPhase === p.phase && "border-dw-accent"
                )}
              >
                <p className="font-headline text-sm uppercase tracking-wide text-ink">{p.title}</p>
                <p className="mt-0.5 font-sans text-xs text-ink3">{p.subtitle}</p>
                {loadingPhase === p.phase && <p className="mt-1 font-sans text-xs text-dw-accent">Writing…</p>}
              </button>
            ))}
          </div>
          {error && <div className="mt-4 rounded border border-dw-red/30 bg-dw-red/10 px-6 py-6 text-center font-serif text-dw-red">{error}</div>}
          {content && renderContent(content)}
        </>
      )}
    </div>
  );
}
