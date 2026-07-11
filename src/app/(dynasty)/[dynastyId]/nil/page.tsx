"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/section-header";
import { useDynasty } from "@/components/dynasty/dynasty-context";

interface MarketNote {
  label: string;
  text: string;
}

interface NILMarketColumn {
  headline: string;
  body: string;
  marketTemp: string;
  tempReason: string;
  notes: MarketNote[];
}

const TEMP_CONFIG: Record<string, { label: string; color: string }> = {
  cold: { label: "Cold", color: "text-ink3" },
  warm: { label: "Warm", color: "text-dw-yellow" },
  hot: { label: "Hot", color: "text-dw-accent" },
  "red-hot": { label: "Red Hot", color: "text-dw-red" },
};

function TempBadge({ temp }: { temp: string }) {
  const cfg = TEMP_CONFIG[temp] ?? TEMP_CONFIG.warm;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border border-current px-2.5 py-1 font-sans text-xs uppercase tracking-wider",
        cfg.color
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {cfg.label} Market
    </span>
  );
}

export default function NILPage() {
  const { snapshot, loading, error, generate, settings, currentSavePath } =
    useDynasty();

  const [column, setColumn] = useState<NILMarketColumn | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const canGenerate = Boolean(currentSavePath && settings.anthropicKey);

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      const result = await generate<NILMarketColumn>("nil", {});
      setColumn(result);
    } catch (err) {
      setGenError(
        err instanceof Error ? err.message : "Failed to generate NIL report."
      );
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div>
        <SectionHeader title="NIL & PORTAL" subtitle="Money moves and roster drama" />
        <div className="mt-8 rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
          <p className="font-serif italic text-ink3">Reading your save&hellip;</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <SectionHeader title="NIL & PORTAL" subtitle="Money moves and roster drama" />
        <div className="mt-8 rounded border border-dw-red/30 bg-dw-red/10 px-6 py-12 text-center">
          <p className="font-serif text-dw-red">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="NIL & PORTAL" subtitle="Money moves and roster drama" />

      <div className="mt-6 space-y-6">
        {/* Player-level NIL/portal detail needs roster data the save does not
            yet expose. Degrade to a program NIL-market column — clearly labeled. */}
        <div className="rounded border border-dashed border-dw-border bg-paper2 px-6 py-8 text-center">
          <p className="font-headline text-sm uppercase tracking-widest text-dw-accent">
            Player-Level NIL Coming Soon
          </p>
          <p className="mx-auto mt-3 max-w-md font-serif text-sm leading-relaxed text-ink2">
            Individual NIL offers and transfer-portal moves will appear here once
            the roster is read from your dynasty save. For now, here&apos;s the
            program&apos;s market read.
            {snapshot?.userTeam
              ? ` Tracking ${snapshot.userTeam.name} at Week ${snapshot.week ?? "—"}.`
              : ""}
          </p>
        </div>

        <div className="rounded border border-dw-border bg-paper">
          <div className="flex items-center justify-between gap-4 border-b border-dw-border bg-paper2 px-4 py-3">
            <h3 className="font-headline text-sm uppercase tracking-wider text-ink2">
              Market Watch
            </h3>
            {column && <TempBadge temp={column.marketTemp} />}
          </div>

          <div className="px-5 py-5">
            {!column ? (
              <div className="py-6 text-center">
                <p className="font-serif text-sm text-ink2">
                  Generate a read on your program&apos;s NIL collective and
                  transfer-portal climate — grounded in this season&apos;s results.
                </p>

                {genError && (
                  <p className="mt-3 font-sans text-sm text-dw-red">{genError}</p>
                )}

                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating || !canGenerate}
                  className={cn(
                    "mt-6 inline-flex items-center gap-2 rounded border border-dw-accent bg-dw-accent/10 px-5 py-2.5",
                    "font-headline text-sm uppercase tracking-wider text-dw-accent",
                    "transition-colors hover:bg-dw-accent/20",
                    "disabled:cursor-not-allowed disabled:opacity-50"
                  )}
                >
                  {generating ? "Reading the market…" : "Generate NIL Report"}
                </button>

                {!canGenerate && (
                  <p className="mt-3 font-sans text-xs text-ink3">
                    Add your save and API key in settings to generate.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <h4 className="font-headline text-xl leading-tight text-ink">
                  {column.headline}
                </h4>
                <p className="mt-2 font-serif text-sm leading-relaxed text-ink2">
                  {column.body}
                </p>
                {column.tempReason && (
                  <p className="mt-2 font-serif italic text-sm text-ink3">
                    {column.tempReason}
                  </p>
                )}

                <div className="my-5 flex items-center gap-3 text-dw-accent/60">
                  <span className="h-px flex-1 bg-dw-border" />
                  <span className="text-xs">&#9670;</span>
                  <span className="h-px flex-1 bg-dw-border" />
                </div>

                <div className="space-y-4">
                  {column.notes.map((note, i) => (
                    <div key={i} className="border-l-2 border-dw-border pl-4">
                      <h5 className="font-headline text-xs uppercase tracking-wider text-dw-accent2">
                        {note.label}
                      </h5>
                      <p className="mt-1 font-serif text-sm leading-relaxed text-ink2">
                        {note.text}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 border-t border-dw-border pt-4">
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={generating}
                    className={cn(
                      "inline-flex items-center gap-2 rounded border border-dw-border bg-paper2 px-4 py-2",
                      "font-sans text-xs text-ink3",
                      "transition-colors hover:border-dw-accent hover:text-dw-accent",
                      "disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                  >
                    {generating ? "Regenerating…" : "Regenerate Report"}
                  </button>
                  {genError && (
                    <p className="mt-2 font-sans text-xs text-dw-red">{genError}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
