"use client";

// DYNASTY LORE — the one screen where the user writes the locked column themselves.
//
// Every other tab in this app displays facts that were computed. This one collects facts
// that were declared, and it has to earn that trust in two directions at once: the user must
// believe what they type here will be honoured, and they must not be misled about how far
// that goes. So the page says the limit out loud rather than burying it — names can be held
// to, narrative can only be weighted. Promising enforcement we cannot deliver would be a
// worse feature than promising less.

import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/section-header";
import { useSaga } from "@/components/dynasty/use-saga";
import {
  FREEFORM_MAX,
  ENTRY_MAX,
  loreOverflow,
  rankEntries,
  type LoreKind,
} from "@/lib/dynasty/lore";

const KIND_LABEL: Record<LoreKind, string> = {
  person: "Person",
  relationship: "Relationship",
  event: "Event",
  fact: "Fact",
};

const KIND_STYLE: Record<LoreKind, string> = {
  person: "border-dw-accent/40 text-dw-accent",
  relationship: "border-dw-accent2/40 text-dw-accent2",
  event: "border-dw-green/40 text-dw-green",
  fact: "border-dw-border text-ink3",
};

const KIND_ORDER: LoreKind[] = ["person", "relationship", "event", "fact"];

const PLACEHOLDER = `Anything that is true about your dynasty that the save cannot know.

Examples:
• My DC is my old college roommate and we have not spoken since the 2031 title game.
• The program was hit with a bowl ban two years before I took over — the fanbase is still bitter about it.
• I promised the AD a conference title within three years. Year two is now.
• Our QB1 is the son of the coach I replaced.

Write it however you like. Nothing here is parsed — it goes to the newsroom in your own words.`;

export default function LorePage() {
  const { ready, lore, saveLoreFreeform, addLore, removeLore } = useSaga();

  // Local draft so typing is not a write per keystroke. Seeded once the store has loaded.
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    if (!ready || seeded.current) return;
    seeded.current = true;
    setDraft(lore.freeform);
  }, [ready, lore.freeform]);

  const [newText, setNewText] = useState("");
  const [newKind, setNewKind] = useState<LoreKind>("fact");
  const [busy, setBusy] = useState(false);

  const ranked = useMemo(() => rankEntries(lore.entries), [lore.entries]);
  const canon = useMemo(() => ranked.filter((e) => e.source === "canon"), [ranked]);
  const promoted = useMemo(() => ranked.filter((e) => e.source === "promoted"), [ranked]);
  const overflow = useMemo(() => loreOverflow(lore), [lore]);

  const saveDraft = async () => {
    setBusy(true);
    try {
      await saveLoreFreeform(draft);
      setDirty(false);
      setSavedAt(Date.now());
    } finally {
      setBusy(false);
    }
  };

  const addCanon = async () => {
    const text = newText.trim();
    if (!text) return;
    setBusy(true);
    try {
      await addLore({ source: "canon", kind: newKind, text, from: null });
      setNewText("");
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <div className="p-6">
        <SectionHeader title="DYNASTY LORE" subtitle="The world you bring" />
        <div className="mt-8 flex items-center gap-2 font-sans text-xs uppercase tracking-wider text-ink3">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Opening the book
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 pb-16">
      <SectionHeader
        title="DYNASTY LORE"
        subtitle="Facts you establish. The newsroom writes around them, never against them."
      />

      {/* What this does, and — just as important — what it does not do. */}
      <div className="mt-5 rounded border border-dw-border bg-paper2 p-4">
        <p className="font-serif text-sm leading-relaxed text-ink2">
          Everything on this page is treated as <span className="text-ink">true</span> by every
          story DynastyWire writes — recaps, social, the podium, the shows, the forum. It is not a
          script: the newsroom still invents its own reporters, arguments, quotes and
          controversies. It just builds them on top of your world instead of a blank one.
        </p>
        <p className="mt-3 font-sans text-[11px] leading-relaxed text-ink3">
          Straight about the limit: this is context, not a rule the app can enforce. Your stats get
          checked against your save because there is a table to check them against — there is no
          such table for a story. Lore makes contradiction unlikely, not impossible. If you catch
          one, that is worth reporting.
        </p>
      </div>

      {/* ── Your own account ──────────────────────────────────────────── */}
      <div className="mt-8 space-y-3">
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="font-headline text-sm uppercase tracking-widest text-dw-accent">
            Your Dynasty, In Your Words
          </h3>
          <span
            className={cn(
              "font-sans text-[10px] tabular-nums",
              draft.length > FREEFORM_MAX * 0.9 ? "text-dw-yellow" : "text-ink3"
            )}
          >
            {draft.length.toLocaleString()} / {FREEFORM_MAX.toLocaleString()}
          </span>
        </div>
        <textarea
          value={draft}
          maxLength={FREEFORM_MAX}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
          rows={12}
          placeholder={PLACEHOLDER}
          className="w-full rounded border border-dw-border bg-paper px-3 py-2.5 font-serif text-sm leading-relaxed text-ink placeholder:text-ink3 focus:border-dw-accent/60 focus:outline-none"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={saveDraft}
            disabled={!dirty || busy}
            className="rounded bg-dw-crimson px-5 py-2.5 font-sans text-xs uppercase tracking-widest text-white transition-colors hover:bg-dw-crimson/95 disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {dirty && (
            <span className="font-sans text-[10px] uppercase tracking-wider text-dw-yellow">
              Unsaved — the newsroom has not seen this yet
            </span>
          )}
          {!dirty && savedAt && (
            <span className="font-sans text-[10px] uppercase tracking-wider text-dw-green">
              Saved. It applies from your next generated week.
            </span>
          )}
        </div>
      </div>

      {/* ── Canon entries ─────────────────────────────────────────────── */}
      <div className="mt-10 space-y-3">
        <h3 className="font-headline text-sm uppercase tracking-widest text-dw-accent">
          Established Canon
        </h3>
        <p className="font-sans text-[11px] text-ink3">
          Single facts, stated plainly. These outrank anything the app has written before.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={newText}
            maxLength={ENTRY_MAX}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addCanon();
            }}
            placeholder="e.g. Marcus Hale is my offensive coordinator and my brother-in-law"
            className="flex-1 rounded border border-dw-border bg-paper px-3 py-2.5 font-serif text-sm text-ink placeholder:text-ink3 focus:border-dw-accent/60 focus:outline-none"
          />
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as LoreKind)}
            className="rounded border border-dw-border bg-paper px-3 py-2.5 font-sans text-xs uppercase tracking-wider text-ink2 focus:border-dw-accent/60 focus:outline-none"
          >
            {KIND_ORDER.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addCanon}
            disabled={!newText.trim() || busy}
            className="rounded border border-dw-accent/50 px-5 py-2.5 font-sans text-xs uppercase tracking-widest text-dw-accent transition-colors hover:bg-dw-accent/10 disabled:opacity-40"
          >
            Add
          </button>
        </div>

        {canon.length === 0 ? (
          <p className="py-3 font-serif text-sm italic text-ink3">
            Nothing yet. The paragraph above does the same job — this is for facts you want stated
            cleanly and kept separate.
          </p>
        ) : (
          <ul className="divide-y divide-dw-border rounded border border-dw-border">
            {canon.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-3 py-2.5">
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-wider",
                    KIND_STYLE[e.kind]
                  )}
                >
                  {KIND_LABEL[e.kind]}
                </span>
                <span className="flex-1 font-serif text-sm leading-snug text-ink">{e.text}</span>
                <button
                  type="button"
                  onClick={() => void removeLore(e.id)}
                  title="Remove from your world"
                  className="shrink-0 text-ink3 transition-colors hover:text-dw-red"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Promoted from coverage ────────────────────────────────────── */}
      <div className="mt-10 space-y-3">
        <h3 className="font-headline text-sm uppercase tracking-widest text-dw-accent">
          Kept From Coverage
        </h3>
        <p className="font-sans text-[11px] text-ink3">
          Anything you pressed <span className="text-ink2">Add to Dynasty Lore</span> on. These
          people and events are real now, and the newsroom reuses them instead of inventing
          replacements.
        </p>

        {promoted.length === 0 ? (
          <p className="flex items-center gap-2 py-3 font-serif text-sm italic text-ink3">
            <BookOpen className="h-4 w-4 shrink-0" />
            Nothing kept yet. When a story invents a reporter, a feud or a moment you like, keep it
            and it stops being disposable.
          </p>
        ) : (
          <ul className="divide-y divide-dw-border rounded border border-dw-border">
            {promoted.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-3 py-2.5">
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-wider",
                    KIND_STYLE[e.kind]
                  )}
                >
                  {KIND_LABEL[e.kind]}
                </span>
                <span className="flex-1">
                  <span className="block font-serif text-sm leading-snug text-ink">{e.text}</span>
                  {(e.from || e.year != null) && (
                    <span className="mt-0.5 block font-sans text-[10px] uppercase tracking-wider text-ink3">
                      {[e.from, e.year != null ? `${e.year}${e.week != null ? ` · wk ${e.week}` : ""}` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => void removeLore(e.id)}
                  title="Remove from your world"
                  className="shrink-0 text-ink3 transition-colors hover:text-dw-red"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/*
        Overflow is reported rather than silently swallowed. A world bible that quietly stops
        being read is the worst possible failure for this feature — the user would keep adding
        facts and keep wondering why the newsroom ignored them.
      */}
      {overflow > 0 && (
        <p className="mt-6 rounded border border-dw-yellow/30 bg-dw-yellow/10 px-4 py-3 font-serif text-sm text-dw-yellow">
          Your world is bigger than one prompt can hold. The {overflow} oldest{" "}
          {overflow === 1 ? "entry is" : "entries are"} no longer being sent with each story —
          canon and your most recent facts are kept first. Trim anything you no longer need.
        </p>
      )}
    </div>
  );
}
