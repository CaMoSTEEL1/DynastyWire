"use client";

// HIS SITUATION ROOM — the decisions a player actually gets.
//
// A coach's situation room is about power he holds. A player's is about how little of it he
// has: what he does with a week, who he talks to, whether he says the thing he's thinking.
// The choices are small on purpose. Small choices are all he has, and pretending otherwise
// would be the same lie as writing him as the centre of the program.

import { useCallback, useEffect, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useIssueTab } from "@/components/dynasty/use-issue-tab";
import { SectionHeader } from "@/components/ui/section-header";
import { RtgGate } from "@/components/rtg/rtg-gate";
import { useBrand } from "@/components/rtg/use-brand";
import { useCharacter } from "@/components/rtg/use-character";
import { cn } from "@/lib/utils";

interface Option { label: string; text: string; cost: string }
interface Situation {
  headline: string;
  category: "locker-room" | "academics" | "family" | "brand" | "football" | "money" | "body" | "future";
  setup: string;
  options: Option[];
  error?: boolean;
}

function DecisionInner() {
  const { generate, snapshot, loading } = useDynasty();
  const { baseline } = useBrand();
  const character = useCharacter();

  const [sit, setSit] = useState<Situation | null>(null);
  const [chosen, setChosen] = useState<Option | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cached = useIssueTab<Situation>("rtg-situation");
  useEffect(() => {
    if (!sit && cached) setSit(cached);
  }, [cached, sit]);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await generate<Situation>("rtg-situation", { baselinePlayer: baseline, character });
      if (data?.error || !data?.options?.length) setError("Nothing came up this week.");
      else setSit(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this week.");
    } finally {
      setBusy(false);
    }
  }, [generate, baseline, character]);

  if (loading) return <p className="p-6 font-serif text-ink3">Reading the save…</p>;
  if (!snapshot?.player) {
    return (
      <div className="p-6">
        <SectionHeader title="His Week" subtitle="Road to Glory" />
        <p className="font-serif text-ink2">Open a Road to Glory save to use this screen.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-6">
      <SectionHeader title="His Week" subtitle="What he does with it" />

      {sit ? (
        <div className="rounded border border-paper4 bg-paper2 p-5">
          <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-dw-accent2">
            {sit.category?.replace("-", " ")}
          </p>
          <h2 className="mt-1 font-headline text-2xl leading-tight text-ink">{sit.headline}</h2>
          <p className="mt-3 font-serif text-[16px] leading-relaxed text-ink2">{sit.setup}</p>

          <div className="mt-5 space-y-2">
            {chosen ? (
              <div className="rounded border border-dw-accent2/50 bg-paper3 px-4 py-3">
                <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">
                  {chosen.label}
                </p>
                <p className="mt-1 font-serif text-[15px] leading-snug text-ink">{chosen.text}</p>
                <p className="mt-2 border-t border-dw-border pt-2 font-serif text-sm text-ink3">
                  {chosen.cost}
                </p>
              </div>
            ) : (
              sit.options.map((o, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setChosen(o)}
                  className={cn(
                    "w-full rounded border border-paper4 border-l-[3px] border-l-dw-accent2 bg-paper3",
                    "px-4 py-3 text-left transition-colors",
                    "hover:border-dw-crimson/50 hover:border-l-dw-crimson hover:bg-paper4",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-accent2"
                  )}
                >
                  <span className="font-sans text-[11px] uppercase tracking-wider text-dw-accent2">
                    {o.label}
                  </span>
                  <p className="mt-1 font-serif text-[15px] leading-snug text-ink">{o.text}</p>
                  {/* What it costs, shown before he picks — every option costs something. */}
                  <p className="mt-1.5 font-serif text-[13px] leading-snug text-ink3">{o.cost}</p>
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center">
          <p className="font-serif text-ink2">He&apos;s got a week. Something in it needs deciding.</p>
          {error && <p className="mt-3 font-serif text-sm text-dw-red">{error}</p>}
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="mt-5 rounded border border-dw-crimson bg-dw-crimson px-6 py-2.5 font-sans text-sm uppercase tracking-wider text-paper hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Loading…" : "See his week"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function DecisionPage() {
  return (
    <RtgGate>
      <DecisionInner />
    </RtgGate>
  );
}
