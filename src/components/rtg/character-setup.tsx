"use client";

// The one screen you must fill in before Road to Glory works.
//
// Mandatory setup is friction at exactly the wrong moment, so the whole design of this form is
// about making it cost thirty seconds: it opens pre-filled from the save, only four fields are
// actually required, and every input says what it is FOR rather than just what it is. Nobody
// fills in "Beat writer" well when the label is "Beat writer"; they fill it in well when it
// says this is the person who will have an opinion about him all season.

import { useEffect, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import {
  ARC_LABEL,
  ARC_NOTE,
  isComplete,
  loadCharacter,
  saveCharacter,
  seedFromSave,
  type RtgArc,
  type RtgCharacter,
} from "@/lib/dynasty/rtg-character";
import { cn } from "@/lib/utils";

const ARCS: RtgArc[] = ["underrated", "blue-chip", "hometown", "calculated", "transfer"];

function Field({
  label,
  hint,
  value,
  onChange,
  placeholder,
  required,
  multiline,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
}) {
  const Input = multiline ? "textarea" : "input";
  return (
    <label className="block">
      <span className="font-sans text-[10px] uppercase tracking-widest text-ink3">
        {label}
        {required && <span className="ml-1 text-dw-crimson">*</span>}
      </span>
      <p className="mt-0.5 font-serif text-[13px] leading-snug text-ink3">{hint}</p>
      <Input
        {...(multiline ? { rows: 3 } : {})}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "mt-1.5 w-full rounded border border-paper4 bg-paper px-3 py-2",
          "font-serif text-[15px] text-ink outline-none placeholder:text-ink3",
          "focus:border-dw-accent2",
          multiline && "resize-none"
        )}
      />
    </label>
  );
}

export function CharacterSetup({ onDone }: { onDone: () => void }) {
  const { snapshot, dynastyId } = useDynasty();
  const player = snapshot?.player ?? null;
  const school = snapshot?.userTeam?.name ?? null;

  const [c, setC] = useState<RtgCharacter | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await loadCharacter(dynastyId);
      if (cancelled) return;
      setC(existing ?? seedFromSave(player, snapshot?.schoolInterest, school));
    })();
    return () => {
      cancelled = true;
    };
  }, [dynastyId, player, school, snapshot?.schoolInterest]);

  if (!c) return <p className="p-6 font-serif text-ink3">Reading the save…</p>;

  const set = (k: keyof RtgCharacter) => (v: string) => setC({ ...c, [k]: v } as RtgCharacter);
  const ready = isComplete(c);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-6">
      <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-dw-crimson">
        Road to Glory
      </p>
      <h1 className="mt-1 font-headline text-3xl uppercase leading-none tracking-wide text-ink sm:text-4xl">
        Who is he?
      </h1>
      <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink2">
        Your save knows he&apos;s a {player?.classYear?.toLowerCase() ?? ""}{" "}
        {player?.position ?? "player"}
        {player?.homeState ? ` from ${player.homeState}` : ""}. It doesn&apos;t know anything
        that makes him a person — and without that, every story about him is a stat line.
        This takes a minute and you only do it once.
      </p>

      <div className="mt-7 space-y-5">
        <div>
          <span className="font-sans text-[10px] uppercase tracking-widest text-ink3">
            His story <span className="text-dw-crimson">*</span>
          </span>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {ARCS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setC({ ...c, arc: a })}
                className={cn(
                  "rounded border px-3 py-2 text-left transition-colors",
                  c.arc === a
                    ? "border-dw-accent2 bg-paper3"
                    : "border-paper4 bg-paper2 hover:border-ink3"
                )}
              >
                <span
                  className={cn(
                    "font-sans text-[11px] uppercase tracking-wider",
                    c.arc === a ? "text-dw-accent2" : "text-ink2"
                  )}
                >
                  {ARC_LABEL[a]}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-2 font-serif text-[13px] leading-snug text-ink3">{ARC_NOTE[c.arc]}</p>
        </div>

        <Field
          required
          label="Hometown"
          hint="The save only knows the state. Where is he actually from?"
          value={c.hometown}
          onChange={set("hometown")}
          placeholder="Valdosta, Georgia"
        />
        <Field
          required
          multiline
          label="His story so far"
          hint="Two or three sentences — his path here, his family, what he's actually chasing."
          value={c.bio}
          onChange={set("bio")}
        />
        <Field
          required
          label="Position coach"
          hint="The man who decides whether he plays. He'll be in almost every story."
          value={c.positionCoach}
          onChange={set("positionCoach")}
          placeholder="Coach Reyes"
        />
        <Field
          label="The man ahead of him"
          hint="Who he's behind on the depth chart. They share a room every day."
          value={c.aheadOfHim}
          onChange={set("aheadOfHim")}
        />
        <Field
          label="Closest teammate"
          hint="The one in his group chat at 1am."
          value={c.teammate}
          onChange={set("teammate")}
        />
        <Field
          label="Beat writer"
          hint="Whoever covers this team will have an opinion about him all season."
          value={c.reporter}
          onChange={set("reporter")}
        />
        <Field
          required
          label="Home"
          hint="The person he calls after a bad week. Mum, dad, his high school coach."
          value={c.home}
          onChange={set("home")}
          placeholder="His mother, Renee"
        />
        <Field
          label="What he says he wants"
          hint="In his words, not yours."
          value={c.goal}
          onChange={set("goal")}
          placeholder="Play."
        />
      </div>

      <div className="mt-8 flex items-center gap-3 border-t border-dw-border pt-5">
        <button
          type="button"
          disabled={!ready || saving}
          onClick={async () => {
            setSaving(true);
            await saveCharacter(dynastyId, c);
            setSaving(false);
            onDone();
          }}
          className="rounded border border-dw-crimson bg-dw-crimson px-6 py-2.5 font-sans text-sm uppercase tracking-wider text-paper hover:opacity-90 disabled:opacity-40"
        >
          {saving ? "Saving…" : "That's him"}
        </button>
        {!ready && (
          <span className="font-sans text-[11px] text-ink3">
            Hometown, his story, position coach and home are needed.
          </span>
        )}
      </div>
    </div>
  );
}
