"use client";

// "Add to Dynasty Lore" — the button that turns a line the app wrote into part of the world.
//
// This is the half of the lore feature that actually builds a universe. The other half is a
// text box, and a text box has a blank-page problem: nobody wants to author a world bible
// before they have played a game. This does not ask them to. They read the week, they see a
// reporter or a feud or a moment they like, and they keep it — and from then on every
// generator treats it as true and reuses it instead of inventing a replacement.
//
// Deliberately quiet in the layout. It sits beside generated content that people are reading
// for pleasure, and a loud button on every paragraph would wreck the page it is attached to.

import { useEffect, useMemo, useRef, useState } from "react";
import { BookmarkCheck, BookmarkPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDynasty } from "./dynasty-context";
import { useSaga } from "./use-saga";
import { hasEntry, tidy, type LoreKind } from "@/lib/dynasty/lore";

export interface AddToLoreProps {
  /** The fact to keep. Truncated to a fact-sized line by lore.ts. */
  text: string;
  /** What kind of thing it is. Drives grouping and prompt ordering. */
  kind?: LoreKind;
  /** The surface it came off, shown in the Lore tab so the user remembers where it is from. */
  from: string;
  /** Override the resting label where "Add to Dynasty Lore" is too long for the space. */
  label?: string;
  className?: string;
}

export function AddToLore({ text, kind = "fact", from, label, className }: AddToLoreProps) {
  const { year, week } = useDynasty();
  const { lore, addLore, ready } = useSaga();
  const [saving, setSaving] = useState(false);

  const clean = useMemo(() => tidy(text), [text]);
  // Reflects the STORE, not a local flag, so the button reads as already-added when the page
  // is revisited a week later — the whole point of a permanent world is that it persists.
  const added = useMemo(() => !!clean && hasEntry(lore, clean), [lore, clean]);

  if (!clean) return null;

  const onClick = async () => {
    if (added || saving || !ready) return;
    setSaving(true);
    try {
      await addLore({ source: "promoted", kind, text: clean, from, year, week });
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={added || saving || !ready}
      title={
        added
          ? "Part of your dynasty's permanent world. Manage it on the Lore tab."
          : "Keep this. Every future story will treat it as true and use these people again."
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-1 font-sans text-[10px] uppercase tracking-wider transition-colors",
        added
          ? "border-dw-green/40 text-dw-green cursor-default"
          : "border-dw-border text-ink3 hover:border-dw-accent/60 hover:text-dw-accent",
        className
      )}
    >
      {added ? <BookmarkCheck className="h-3 w-3" /> : <BookmarkPlus className="h-3 w-3" />}
      {added ? "In your lore" : (label ?? "Add to Dynasty Lore")}
    </button>
  );
}

/**
 * Keep a generated line automatically, once, when the user has switched that on.
 *
 * Written as a hook rather than folded into the button because the thing being kept is the
 * page's headline, which exists whether or not anybody looks at the button — and the request
 * was explicitly to stop having to press it every week.
 *
 * Guards, in order of how badly each would bite:
 *  - the setting must be on;
 *  - the store must have loaded, or a fresh launch would write into an empty world and
 *    "already kept?" would answer no for something kept weeks ago;
 *  - the text must not already be present (hasEntry is the same check the button uses);
 *  - and it fires at most once per mounted text, because a re-render is not a new week.
 */
export function useAutoKeep(text: string | null | undefined, from: string, kind: LoreKind = "event") {
  const { year, week } = useDynasty();
  const { lore, addLore, ready } = useSaga();
  const done = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !lore.autoKeepFrontPage) return;
    const clean = tidy(text ?? "");
    if (!clean) return;
    if (done.current === clean) return;
    if (hasEntry(lore, clean)) {
      done.current = clean;
      return;
    }
    done.current = clean;
    void addLore({ source: "promoted", kind, text: clean, from, year, week });
  }, [ready, lore, text, from, kind, addLore, year, week]);
}
