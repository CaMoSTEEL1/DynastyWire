"use client";

// THE ROOM — who is ahead of him, and by how much.
//
// This is the surface that makes the mode tense, and it costs nothing: it's his position group
// off the roster, ordered by who the staff ACTUALLY PLAYS and then by production. Not by
// rating — partly because of the no-ratings rule, and partly because starts are the honest
// ordering anyway. A depth chart is a record of decisions, not of talent.

import { useMemo } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { SectionHeader } from "@/components/ui/section-header";
import { depthOf, positionRoom } from "@/lib/dynasty/rtg";
import { cn } from "@/lib/utils";

export default function TheRoomPage() {
  const { snapshot, roster, loading } = useDynasty();
  const player = snapshot?.player ?? null;

  const room = useMemo(() => positionRoom(roster, player), [roster, player]);
  const depth = depthOf(room);

  if (loading) return <p className="p-6 font-serif text-ink3">Reading the save…</p>;
  if (!player) {
    return (
      <div className="p-6">
        <SectionHeader title="The Room" subtitle="Road to Glory" />
        <p className="font-serif text-ink2">Open a Road to Glory save to use this screen.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
      <SectionHeader
        title="The Room"
        subtitle={
          depth
            ? `${player.position ?? "His position"} · he is ${depth} of ${room.length}`
            : `${player.position ?? "His position"} group`
        }
      />

      {depth && depth > 1 && (
        <p className="mb-4 font-serif text-[17px] leading-relaxed text-ink2">
          There {depth - 1 === 1 ? "is one man" : `are ${depth - 1} men`} between him and the
          field.
        </p>
      )}
      {depth === 1 && (
        <p className="mb-4 font-serif text-[17px] leading-relaxed text-ink2">
          Nobody is ahead of him. The job is his to lose.
        </p>
      )}

      <ol className="rounded border border-paper4 bg-paper2">
        {room.map((r, i) => (
          <li
            key={i}
            className={cn(
              "flex items-baseline gap-3 border-b border-dw-border px-4 py-3 last:border-b-0",
              r.isUser && "border-l-[3px] border-l-dw-accent2 bg-paper3"
            )}
          >
            <span className="w-5 shrink-0 font-headline text-lg text-ink3">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className={cn("font-serif text-[16px]", r.isUser ? "text-dw-accent2" : "text-ink")}>
                {r.name}
                {r.classYear && <span className="ml-2 font-sans text-[10px] uppercase tracking-wider text-ink3">{r.classYear}</span>}
                {r.isUser && <span className="ml-2 font-sans text-[9px] uppercase tracking-wider text-dw-accent2">him</span>}
              </p>
              {r.line && <p className="mt-0.5 font-sans text-[11px] text-ink3">{r.line}</p>}
            </div>
            <span className="shrink-0 font-sans text-[11px] text-ink3">
              {r.gamesStarted ? `${r.gamesStarted} starts` : "—"}
            </span>
          </li>
        ))}
      </ol>

      {!room.length && (
        <p className="font-serif text-ink2">
          The save doesn&apos;t carry a roster for his team yet.
        </p>
      )}

      <p className="mt-4 font-sans text-[10px] leading-relaxed text-ink3">
        Ordered by starts, then by production — read from your save, no credits spent.
      </p>
    </div>
  );
}
