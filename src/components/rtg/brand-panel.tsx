"use client";

// The athlete's platform, as a panel.
//
// The number here is DynastyWire's, not the game's — the save has an RTG meters economy but
// no readable live follower total. That is stated in the UI on purpose: a count that looks
// like it mirrors the in-game meter, and doesn't, is worse than one that admits what it is.

import { fmtFollowers, brandTier, type BrandState, type FollowerResult } from "@/lib/dynasty/brand";
import { cn } from "@/lib/utils";

const TIER_WORD: Record<ReturnType<typeof brandTier>, string> = {
  unknown: "Nobody knows him yet",
  local: "Known locally",
  known: "Known to the fanbase",
  star: "A name",
  national: "National",
};

export function BrandPanel({
  state,
  week,
  className,
}: {
  state: BrandState;
  week?: FollowerResult | null;
  className?: string;
}) {
  const followers = week?.followers ?? state.followers;
  const tier = brandTier(followers);
  const delta = week?.delta ?? 0;

  return (
    <div className={cn("rounded border border-dw-border bg-paper2 p-4", className)}>
      <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-ink3">Platform</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-headline text-3xl leading-none text-ink">{fmtFollowers(followers)}</span>
        <span className="font-sans text-[11px] uppercase tracking-wider text-ink3">followers</span>
      </div>

      {delta !== 0 && (
        <p
          className={cn(
            "mt-1.5 font-sans text-xs font-semibold",
            delta > 0 ? "text-dw-green" : "text-dw-red"
          )}
        >
          {delta > 0 ? "+" : ""}
          {delta.toLocaleString("en-US")} this week
        </p>
      )}
      {week?.reason && <p className="mt-1 font-serif text-sm leading-snug text-ink2">{week.reason}</p>}

      <p className="mt-3 border-t border-dw-border pt-2 font-sans text-[10px] uppercase tracking-wider text-dw-accent2">
        {TIER_WORD[tier]}
      </p>

      {/* Honesty: this is our model, not the save's meter. */}
      <p className="mt-2 font-sans text-[10px] leading-relaxed text-ink3">
        DynastyWire&apos;s own count — the save doesn&apos;t expose your in-game follower meter,
        so this tracks what actually happened on the field instead.
      </p>
    </div>
  );
}
