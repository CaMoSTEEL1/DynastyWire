"use client";

// THE BOARD — the depth chart as it hangs in a coach's office.
//
// Asked for as "overalls and positioning... last names on slates with ovr next to it", read
// only, no dragging. Built that way deliberately: the moment this can reorder anything it has
// to write to the save, and DynastyWire's whole safety story is that it does not touch the
// save while the game is running. A board you read is honest and costs nothing.
//
// The design note: the app is always dark, so a literal white dry-erase board would fight
// every other screen. What carries the idea is the SLATE — a raised tile with a surname and a
// number — laid on a ruled board, in the app's own paper tones. Starters sit proud; the room
// behind them recedes.

import { useMemo } from "react";
import { ClipboardList, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/section-header";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import {
  buildDepthChart,
  depthTotals,
  isOut,
  lastName,
  type DepthSpot,
  type DepthUnit,
} from "@/lib/dynasty/depth";
import type { RosterPlayer } from "@/lib/dynasty/client";

const SIDE_LABEL: Record<DepthUnit["side"], string> = {
  offense: "Offense",
  defense: "Defense",
  special: "Special Teams",
  other: "Unlisted",
};

const SIDE_ORDER: DepthUnit["side"][] = ["offense", "defense", "special", "other"];

/** Rating colour. Deliberately coarse — a board is read at a glance, not studied. */
function ovrTone(o: number | null): string {
  if (o == null) return "text-ink3";
  if (o >= 90) return "text-dw-green";
  if (o >= 82) return "text-dw-accent";
  if (o >= 74) return "text-ink2";
  return "text-ink3";
}

function Slate({ player, starter }: { player: RosterPlayer; starter: boolean }) {
  const out = isOut(player);
  return (
    <div
      title={`${player.name}${player.year ? ` · ${player.year}` : ""}${player.injury ? ` · ${player.injury}` : ""}`}
      className={cn(
        "flex items-center gap-2 rounded-sm border px-2 py-1.5 transition-colors",
        starter
          ? "border-dw-border bg-paper shadow-[0_1px_0_0_rgba(0,0,0,0.35)]"
          : "border-dw-border/50 bg-paper2/60",
        out && "opacity-55"
      )}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-headline uppercase tracking-wide",
          starter ? "text-[13px] text-ink" : "text-[12px] text-ink2"
        )}
      >
        {lastName(player.name)}
      </span>
      {player.year && (
        <span className="shrink-0 font-sans text-[9px] uppercase tracking-wider text-ink3">
          {player.year}
        </span>
      )}
      {out && <TriangleAlert className="h-3 w-3 shrink-0 text-dw-red" />}
      <span
        className={cn(
          "shrink-0 font-sans tabular-nums",
          starter ? "text-[13px] font-semibold" : "text-[12px]",
          ovrTone(player.overall)
        )}
      >
        {player.overall ?? "—"}
      </span>
    </div>
  );
}

function Spot({ spot }: { spot: DepthSpot }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b border-dw-border pb-1">
        <span className="font-headline text-xs uppercase tracking-widest text-dw-accent2">
          {spot.position}
        </span>
        <span className="font-sans text-[9px] uppercase tracking-wider text-ink3">
          {spot.players.length}
        </span>
      </div>
      <div className="space-y-1">
        {spot.players.map((p, i) => (
          <Slate key={`${p.name}-${p.jersey ?? i}`} player={p} starter={i < spot.starters} />
        ))}
      </div>
    </div>
  );
}

export default function DepthChartPage() {
  const { roster, snapshot } = useDynasty();

  const units = useMemo(() => buildDepthChart(roster ?? []), [roster]);
  const totals = useMemo(() => depthTotals(units), [units]);

  const bySide = useMemo(
    () =>
      SIDE_ORDER.map((side) => ({ side, units: units.filter((u) => u.side === side) })).filter(
        (g) => g.units.length
      ),
    [units]
  );

  if (!roster || roster.length === 0) {
    return (
      <div className="p-6">
        <SectionHeader title="THE BOARD" subtitle="Your depth chart" />
        <p className="mt-8 font-serif text-sm italic text-ink3">
          No roster loaded yet. Open a week so DynastyWire reads your team, then come back.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 pb-16">
      <SectionHeader
        title="THE BOARD"
        subtitle={`${snapshot?.userTeam?.name ?? "Your program"} — ${totals.players} players across ${totals.spots} spots`}
      />

      {/*
        Said once, at the top, because the alternative is someone trusting it against a depth
        chart they hand-set in the game. The save's own depth-chart table is read only in Road
        to Glory and its semantics are unverified (two QB entries, nothing saying which one
        governs), so claiming this IS your depth chart would be a confident wrong answer.
      */}
      <div className="mt-5 flex items-start gap-3 rounded border border-dw-border bg-paper2 px-4 py-3">
        <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-dw-accent2" />
        <p className="font-serif text-[13px] leading-relaxed text-ink3">
          Ordered <span className="text-ink2">by rating</span> &mdash; the same way the game sorts
          a position by default. If you have hand-set your depth chart in-game, this won&apos;t
          match it: DynastyWire can&apos;t read your ordering back out of the save yet, and it
          would rather show you something true than something that looks official and is wrong.
        </p>
      </div>

      {totals.thin.length > 0 && (
        <p className="mt-3 font-sans text-[11px] uppercase tracking-wider text-dw-yellow">
          Thin: {totals.thin.join(" · ")} &mdash; nobody behind the starter
        </p>
      )}

      {bySide.map(({ side, units: sideUnits }) => (
        <section key={side} className="mt-8">
          <h2 className="mb-3 font-headline text-sm uppercase tracking-[0.2em] text-ink2">
            {SIDE_LABEL[side]}
          </h2>
          <div className="space-y-6 rounded border border-dw-border bg-paper2/40 p-4">
            {sideUnits.map((u) => (
              <div key={u.key}>
                <p className="mb-2 font-sans text-[10px] uppercase tracking-widest text-ink3">
                  {u.label}
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
                  {u.spots.map((s) => (
                    <Spot key={`${u.key}-${s.position}`} spot={s} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
