"use client";

// YOUR RECRUITMENT — every school's real interest in him, straight off `SchoolRelationship`.
//
// Zero generation, zero tokens, zero invention: 138 rows in a real save, each with an offer
// status, an interest score and whether he ever decommitted. Nothing else on the market shows
// a player his own board.

import { useMemo } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { SectionHeader } from "@/components/ui/section-header";
import { recruitmentBoard } from "@/lib/dynasty/rtg";
import { cn } from "@/lib/utils";
import type { SchoolInterest } from "@/lib/dynasty/client";

function Row({ s, committed }: { s: SchoolInterest; committed: boolean }) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 border-b border-dw-border px-3 py-2 last:border-b-0",
        committed && "bg-dw-crimson/10"
      )}
    >
      <span className="min-w-0 flex-1 truncate font-serif text-[15px] text-ink">
        {s.school}
        {committed && (
          <span className="ml-2 font-sans text-[9px] uppercase tracking-wider text-dw-crimson">
            committed
          </span>
        )}
        {s.decommitted && (
          <span className="ml-2 font-sans text-[9px] uppercase tracking-wider text-dw-red">
            decommitted
          </span>
        )}
      </span>
      {s.tier && (
        <span className="font-sans text-[10px] uppercase tracking-wider text-dw-accent2">{s.tier}</span>
      )}
      <span className="w-24 text-right font-sans text-[11px] text-ink3">
        {s.offerStatus && !/^(none|invalid)$/i.test(s.offerStatus) ? s.offerStatus : "no offer"}
      </span>
    </li>
  );
}

export default function RecruitmentPage() {
  const { snapshot, loading } = useDynasty();
  const player = snapshot?.player ?? null;
  const school = snapshot?.userTeam?.name ?? null;

  const board = useMemo(() => recruitmentBoard(snapshot?.schoolInterest, 200), [snapshot]);

  if (loading) return <p className="p-6 font-serif text-ink3">Reading the save…</p>;
  if (!player) {
    return (
      <div className="p-6">
        <SectionHeader title="Your Recruitment" subtitle="Road to Glory" />
        <p className="font-serif text-ink2">Open a Road to Glory save to use this screen.</p>
      </div>
    );
  }

  const isHere = (s: SchoolInterest) => !!school && s.school === school;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6">
      <SectionHeader
        title="Your Recruitment"
        subtitle={`${board.total} schools · ${board.offers.length} with an offer out`}
      />

      {player.prospectStars && (
        <p className="mb-4 font-serif text-ink2">
          A{" "}
          <span className="text-dw-accent2">
            {player.prospectStars.replace(/_/g, " ").toLowerCase()}
          </span>{" "}
          prospect{player.homeState ? ` out of ${player.homeState}` : ""}. This is what he was
          rated coming out of high school — not what he is now.
        </p>
      )}

      {board.offers.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 font-sans text-[10px] uppercase tracking-[0.3em] text-ink3">
            Offers on the table
          </h2>
          <ul className="rounded border border-paper4 bg-paper2">
            {board.offers.map((s, i) => (
              <Row key={i} s={s} committed={isHere(s)} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-sans text-[10px] uppercase tracking-[0.3em] text-ink3">
          Interest, no offer
        </h2>
        <ul className="max-h-[28rem] overflow-y-auto rounded border border-dw-border bg-paper2">
          {board.interested.map((s, i) => (
            <Row key={i} s={s} committed={isHere(s)} />
          ))}
        </ul>
      </section>

      <p className="mt-4 font-sans text-[10px] leading-relaxed text-ink3">
        Read directly from your save — no AI, no credits spent.
      </p>
    </div>
  );
}
