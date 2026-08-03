"use client";

// HIS GAMEPLAN — the scouting report as a player receives it.
//
// The dynasty version is the whole board. This is one page of it: his matchup, the men he
// lines up across from, and nothing else. The withholding is the feature — a report that
// handed him the team's install would quietly turn him back into the head coach, which is the
// one thing this mode exists not to be.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useIssueTab } from "@/components/dynasty/use-issue-tab";
import { SectionHeader } from "@/components/ui/section-header";
import { RtgGate } from "@/components/rtg/rtg-gate";
import { useBrand } from "@/components/rtg/use-brand";
import { useCharacter } from "@/components/rtg/use-character";
import { gameplan } from "@/lib/dynasty/rtg";
import { TIER_LABEL, tierFor } from "@/lib/dynasty/scouting";

interface Key { title: string; detail: string }
interface Plan {
  headline: string;
  assignment: string;
  keys: Key[];
  theyDoThis: string;
  goAtThis: string;
  coachSays: string;
  error?: boolean;
}

function GameplanInner() {
  const { snapshot, oppRoster, generate, loading } = useDynasty();
  const { baseline } = useBrand();
  const character = useCharacter();

  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cached = useIssueTab<Plan>("rtg-gameplan");
  useEffect(() => {
    if (!plan && cached) setPlan(cached);
  }, [cached, plan]);

  const player = snapshot?.player ?? null;
  const opponent = useMemo(
    () => gameplan(player, oppRoster, null, (o) => TIER_LABEL[tierFor(o ?? null)]),
    [player, oppRoster]
  );

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await generate<Plan>("rtg-gameplan", { baselinePlayer: baseline, character });
      if (data?.error || !data?.assignment) setError("No plan came down this week.");
      else setPlan(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the gameplan.");
    } finally {
      setBusy(false);
    }
  }, [generate, baseline, character]);

  if (loading) return <p className="p-6 font-serif text-ink3">Reading the save…</p>;
  if (!player) {
    return (
      <div className="p-6">
        <SectionHeader title="His Gameplan" subtitle="Road to Glory" />
        <p className="font-serif text-ink2">Open a Road to Glory save to use this screen.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
      <SectionHeader
        title="His Gameplan"
        subtitle={opponent ? `${player.position} · ${opponent.focus}` : (player.position ?? "")}
      />

      {plan ? (
        <div className="space-y-5">
          <div className="rounded border border-paper4 border-l-[3px] border-l-dw-accent2 bg-paper2 p-5">
            <h2 className="font-headline text-2xl leading-tight text-ink">{plan.headline}</h2>
            <p className="mt-2 font-serif text-[17px] leading-relaxed text-ink2">{plan.assignment}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded border border-dw-border bg-paper2 p-4">
              <p className="font-sans text-[10px] uppercase tracking-widest text-dw-red">What they do</p>
              <p className="mt-1.5 font-serif text-[15px] leading-snug text-ink2">{plan.theyDoThis}</p>
            </div>
            <div className="rounded border border-dw-border bg-paper2 p-4">
              <p className="font-sans text-[10px] uppercase tracking-widest text-dw-green">Go at this</p>
              <p className="mt-1.5 font-serif text-[15px] leading-snug text-ink2">{plan.goAtThis}</p>
            </div>
          </div>

          <div className="space-y-2">
            {plan.keys?.map((k, i) => (
              <div key={i} className="rounded border border-paper4 bg-paper2 px-4 py-3">
                <p className="font-sans text-[11px] uppercase tracking-wider text-dw-accent2">
                  {i + 1}. {k.title}
                </p>
                <p className="mt-1 font-serif text-[15px] leading-snug text-ink2">{k.detail}</p>
              </div>
            ))}
          </div>

          {plan.coachSays && (
            <p className="border-l-2 border-dw-crimson pl-4 font-headline text-lg italic leading-snug text-dw-accent2">
              &ldquo;{plan.coachSays}&rdquo;
            </p>
          )}
        </div>
      ) : (
        <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center">
          <p className="font-serif text-ink2">
            {opponent?.faces.length
              ? `His week is about ${opponent.focus}.`
              : "His position coach hasn't handed anything down yet."}
          </p>
          {error && <p className="mt-3 font-serif text-sm text-dw-red">{error}</p>}
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="mt-5 rounded border border-dw-crimson bg-dw-crimson px-6 py-2.5 font-sans text-sm uppercase tracking-wider text-paper hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Loading…" : "Get the plan"}
          </button>
        </div>
      )}

      {/* The men he actually faces — free, read from the save. */}
      {opponent && opponent.faces.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 font-sans text-[10px] uppercase tracking-[0.3em] text-ink3">
            Who he lines up across from
          </h3>
          <ul className="rounded border border-paper4 bg-paper2">
            {opponent.faces.map((f, i) => (
              <li key={i} className="flex items-baseline gap-3 border-b border-dw-border px-4 py-2.5 last:border-b-0">
                <span className="min-w-0 flex-1 truncate font-serif text-[15px] text-ink">
                  {f.name}
                  <span className="ml-2 font-sans text-[10px] uppercase tracking-wider text-ink3">
                    {f.position}
                    {f.classYear ? ` · ${f.classYear}` : ""}
                  </span>
                </span>
                <span className="shrink-0 font-sans text-[11px] text-dw-accent2">{f.grade}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 font-sans text-[10px] leading-relaxed text-ink3">
            His matchup only. A player doesn&apos;t get the staff&apos;s full board.
          </p>
        </div>
      )}
    </div>
  );
}

export default function HisGameplanPage() {
  return (
    <RtgGate>
      <GameplanInner />
    </RtgGate>
  );
}
