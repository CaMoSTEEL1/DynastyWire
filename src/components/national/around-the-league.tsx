"use client";

// Around-the-League wire cards (shared by the Front Page and the National Desk).
// Reads this week's national-wire from the persisted issue cache; featured items carry a
// full multi-paragraph story that expands in place.

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useIssueTab } from "@/components/dynasty/use-issue-tab";

export interface WireItem {
  category: string;
  school: string;
  headline: string;
  blurb?: string;
  featured?: boolean;
  /** Featured items carry a full multi-paragraph wire story — click the card to read. */
  story?: string;
}

const WIRE_CATEGORY_STYLE: Record<string, string> = {
  recruiting: "text-dw-green border-dw-green/40",
  portal: "text-dw-accent2 border-dw-accent2/40",
  legal: "text-dw-red border-dw-red/40",
  "locker-room": "text-dw-yellow border-dw-yellow/40",
  carousel: "text-dw-accent border-dw-accent/40",
  upset: "text-dw-red border-dw-red/40",
  rankings: "text-ink2 border-dw-border",
  nil: "text-dw-accent2 border-dw-accent2/40",
};

export function AroundTheLeague() {
  const { generate, hasApiKey } = useDynasty();
  const cached = useIssueTab<{ items: WireItem[] }>("national-wire");
  const [items, setItems] = useState<WireItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    if (!items && cached?.items?.length) setItems(cached.items);
  }, [cached, items]);

  async function load() {
    setLoading(true);
    try {
      const data = await generate<{ items: WireItem[]; error?: boolean }>("national-wire", {});
      if (!data?.error && Array.isArray(data?.items)) setItems(data.items);
    } catch {
      /* ticker keeps its fallback lines */
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded border border-dw-border bg-paper">
      <div className="flex items-center justify-between border-b border-dw-border bg-paper2 px-4 py-3">
        <h3 className="font-headline text-sm uppercase tracking-wider text-ink2">Around the League</h3>
        {items && (
          <span className="font-sans text-[10px] uppercase tracking-wider text-ink3">{items.length} stories on the wire</span>
        )}
      </div>
      <div className="px-4 py-4">
        {!items ? (
          <div className="py-4 text-center">
            <p className="font-serif text-sm text-ink2">
              The national desk covers the rest of the country — recruiting battles, portal moves, arrests, locker-room turmoil, and the carousel.
            </p>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || !hasApiKey}
              className="mt-4 rounded border border-dw-accent bg-dw-accent/10 px-5 py-2 font-headline text-sm uppercase tracking-wider text-dw-accent hover:bg-dw-accent/20 disabled:opacity-50"
            >
              {loading ? "Working the phones…" : "Open the National Wire"}
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((it, i) => {
              const hasStory = typeof it.story === "string" && it.story.trim().length > 0;
              const isOpen = expanded === i;
              return (
                <div
                  key={i}
                  onClick={() => { if (hasStory) setExpanded(isOpen ? null : i); }}
                  className={cn(
                    "rounded border border-dw-border bg-paper2 p-3 transition-colors",
                    hasStory && "cursor-pointer hover:border-dw-accent/50",
                    isOpen && "sm:col-span-2 border-dw-accent/50"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("rounded border px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-wider", WIRE_CATEGORY_STYLE[it.category] ?? "text-ink3 border-dw-border")}>
                      {it.category}
                    </span>
                    <span className="flex items-center gap-2">
                      {hasStory && (
                        <span className="font-sans text-[9px] uppercase tracking-wider text-dw-accent">
                          {isOpen ? "Close" : "Full story"}
                        </span>
                      )}
                      <span className="truncate font-sans text-[10px] uppercase tracking-wider text-ink3">{it.school}</span>
                    </span>
                  </div>
                  <p className="mt-1.5 font-headline text-sm leading-snug text-ink">{it.headline}</p>
                  {it.blurb && !isOpen && <p className="mt-1 font-serif text-xs leading-snug text-ink3">{it.blurb}</p>}
                  {isOpen && hasStory && (
                    <div className="mt-3 space-y-2 border-t border-dw-border pt-3">
                      {it.story!.split(/\n\n|\n/).filter((p) => p.trim()).map((p, pi) => (
                        <p key={pi} className="font-serif text-sm leading-relaxed text-ink2">{p}</p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
