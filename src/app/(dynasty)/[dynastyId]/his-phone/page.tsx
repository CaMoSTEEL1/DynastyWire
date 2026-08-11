"use client";

// HIS PHONE — the one surface where the user is a person rather than a reader.
//
// It used to be a list of finished conversations: the model wrote what people sent AND what he
// sent back, so a week arrived already answered. Three people, three versions of the same
// agreeable nothing, and nothing to decide. A phone you cannot type into is a screenshot of
// somebody else's phone.
//
// Now it is a phone. A thread list on the left with who is waiting on him, a conversation on
// the right, and his reply is a CHOICE — with the option to say nothing at all, which is the
// most realistic thing a nineteen-year-old does with a message he does not want to answer.
// Every answer moves where he stands with that person, and it persists (see phone.ts).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useIssueTab } from "@/components/dynasty/use-issue-tab";
import { SectionHeader } from "@/components/ui/section-header";
import { RtgGate } from "@/components/rtg/rtg-gate";
import { useBrand } from "@/components/rtg/use-brand";
import { useCharacter } from "@/components/rtg/use-character";
import { useSaga } from "@/components/dynasty/use-saga";
import { cn } from "@/lib/utils";
import {
  STANDING_LABEL,
  TONE_LABEL,
  advanceContacts,
  metersAfter,
  newContact,
  standingAfter,
  type Contact,
  type ContactKind,
  type ReplyTone,
} from "@/lib/dynasty/phone";
import { loadContacts, saveContacts } from "@/lib/dynasty/phone-store";
import { Loader2, MessageSquare } from "lucide-react";

interface Incoming { text: string }
interface ReplyOption { tone: ReplyTone; text: string }
interface Thread { with: string; kind: ContactKind; messages: Incoming[]; replies: ReplyOption[] }
interface Texts { threads: Thread[]; error?: boolean }

const KIND_TINT: Record<string, string> = {
  coach: "text-dw-crimson",
  teammate: "text-dw-accent2",
  "rival-for-the-job": "text-dw-yellow",
  home: "text-dw-green",
  reporter: "text-dw-accent",
  "old-life": "text-ink3",
};

const STANDING_TINT: Record<string, string> = {
  close: "text-dw-green",
  good: "text-dw-green",
  fine: "text-ink3",
  strained: "text-dw-yellow",
  cold: "text-dw-red",
};

/** What he sent, kept per week so a thread stays answered when the tab is reopened. */
type Answered = Record<string, { tone: ReplyTone; text: string }>;

function HisPhoneInner() {
  const { generate, snapshot, loading, dynastyId, week } = useDynasty();
  const { baseline } = useBrand();
  const character = useCharacter();
  const saga = useSaga();

  const [texts, setTexts] = useState<Texts | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [answered, setAnswered] = useState<Answered>({});
  const [openWith, setOpenWith] = useState<string | null>(null);

  const cached = useIssueTab<Texts>("rtg-texts");
  useEffect(() => {
    if (!texts && cached) setTexts(cached);
  }, [cached, texts]);

  useEffect(() => {
    let cancelled = false;
    void loadContacts(dynastyId).then((c) => { if (!cancelled) setContacts(c); });
    return () => { cancelled = true; };
  }, [dynastyId]);

  // A new week is a clean inbox. The RELATIONSHIPS carry; the answers do not.
  useEffect(() => { setAnswered({}); setOpenWith(null); }, [week]);

  const threads = useMemo(() => texts?.threads ?? [], [texts]);

  useEffect(() => {
    if (!openWith && threads.length) setOpenWith(threads[0].with);
  }, [threads, openWith]);

  /** Where he stands with someone, creating the contact the first time they appear. */
  const contactFor = useCallback(
    (t: Thread): Contact =>
      contacts.find((c) => c.name.toLowerCase() === t.with.toLowerCase()) ?? newContact(t.with, t.kind),
    [contacts]
  );

  const load = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await generate<Texts>("rtg-texts", {
        baselinePlayer: baseline,
        character,
        contacts,
      });
      if (res?.error) setError("The messages didn't come through. Try again.");
      else setTexts(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load his messages.");
    } finally {
      setBusy(false);
    }
  }, [generate, baseline, character, contacts, busy]);

  /**
   * Answer someone — or deliberately not.
   *
   * The reply is applied locally and immediately: this is a phone, and a phone does not spin
   * for two seconds before showing what you just sent. The cost lands at the same moment.
   */
  const reply = useCallback(
    async (t: Thread, tone: ReplyTone, text: string) => {
      const contact = contactFor(t);
      setAnswered((a) => ({ ...a, [t.with]: { tone, text } }));
      const next = advanceContacts(
        contacts.some((c) => c.name.toLowerCase() === t.with.toLowerCase()) ? contacts : [...contacts, contact],
        [{ name: t.with, tone }]
      );
      setContacts(next);
      void saveContacts(dynastyId, next).catch(() => {});
      const meters = metersAfter(contact, tone);
      if (Object.keys(meters).length) await saga.adjustMeters(meters).catch(() => {});
    },
    [contacts, contactFor, dynastyId, saga]
  );

  const open = threads.find((t) => t.with === openWith) ?? null;
  const unread = threads.filter((t) => !answered[t.with]).length;

  if (loading || !snapshot) return null;

  return (
    <div>
      <SectionHeader
        title="HIS PHONE"
        subtitle={unread > 0 ? `${unread} waiting on him` : "all caught up"}
      />

      {!texts && (
        <div className="mt-6 rounded border border-dw-border bg-paper2 px-6 py-8 text-center">
          <p className="font-serif text-ink3">
            Nothing yet this week. His phone fills up like anyone else&apos;s — the position coach,
            the group chat, home, and whoever else has a reason to reach him.
          </p>
          <button
            type="button"
            onClick={() => void load()}
            disabled={busy}
            className="mt-4 inline-flex items-center gap-2 rounded border border-dw-crimson bg-dw-crimson px-4 py-2 font-sans text-xs uppercase tracking-wider text-paper disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />}
            Check his messages
          </button>
        </div>
      )}

      {error && <p className="mt-4 font-serif text-sm text-dw-red">{error}</p>}

      {threads.length > 0 && (
        <div className="mt-6 grid gap-4 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
          {/* The inbox. Who is waiting, and where he stands with them. */}
          <ul className="space-y-1.5">
            {threads.map((t) => {
              const c = contactFor(t);
              const done = answered[t.with];
              return (
                <li key={t.with}>
                  <button
                    type="button"
                    onClick={() => setOpenWith(t.with)}
                    className={cn(
                      "w-full rounded border px-3 py-2.5 text-left",
                      t.with === openWith ? "border-dw-accent2/50 bg-paper2" : "border-dw-border bg-paper hover:border-dw-border/80"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn("font-sans text-[11px] uppercase tracking-wider", KIND_TINT[t.kind] ?? "text-ink2")}>
                        {t.with}
                      </span>
                      {!done && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-dw-crimson" />}
                    </div>
                    <p className="mt-1 truncate font-serif text-[13px] text-ink3">
                      {done ? done.text : t.messages[t.messages.length - 1]?.text}
                    </p>
                    <p className={cn("mt-0.5 font-sans text-[9px] uppercase tracking-wider", STANDING_TINT[c.standing])}>
                      {STANDING_LABEL[c.standing]}
                      {c.ignored >= 2 ? ` · on read ${c.ignored} weeks` : ""}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* The conversation. */}
          {open && (
            <div className="rounded border border-dw-border bg-paper2 p-4">
              <p className={cn("font-sans text-[10px] uppercase tracking-widest", KIND_TINT[open.kind] ?? "text-ink3")}>
                {open.with}
              </p>

              <div className="mt-3 space-y-2">
                {open.messages.map((m, i) => (
                  <p
                    key={i}
                    className="max-w-[80%] rounded-lg rounded-tl-none bg-paper px-3 py-2 font-serif text-[15px] leading-snug text-ink2"
                  >
                    {m.text}
                  </p>
                ))}
                {answered[open.with] && answered[open.with].tone !== "ignore" && (
                  <p className="ml-auto max-w-[80%] rounded-lg rounded-tr-none bg-dw-crimson/80 px-3 py-2 text-right font-serif text-[15px] leading-snug text-paper">
                    {answered[open.with].text}
                  </p>
                )}
                {answered[open.with]?.tone === "ignore" && (
                  <p className="pt-1 text-right font-sans text-[10px] uppercase tracking-wider text-ink3">
                    Left on read
                  </p>
                )}
              </div>

              {!answered[open.with] && (
                <div className="mt-4 space-y-1.5 border-t border-dw-border pt-3">
                  <p className="font-sans text-[9px] uppercase tracking-widest text-ink3">
                    What he sends — and it counts
                  </p>
                  {open.replies.map((r) => (
                    <button
                      key={r.tone}
                      type="button"
                      onClick={() => void reply(open, r.tone, r.text)}
                      className="w-full rounded border border-dw-border bg-paper px-3 py-2 text-left hover:border-dw-accent2/50"
                    >
                      <span className="font-sans text-[9px] uppercase tracking-wider text-dw-accent2">
                        {TONE_LABEL[r.tone]}
                      </span>
                      <p className="font-serif text-[14px] leading-snug text-ink">{r.text}</p>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => void reply(open, "ignore", "")}
                    className="w-full rounded border border-dashed border-dw-border px-3 py-2 text-left font-sans text-[10px] uppercase tracking-wider text-ink3 hover:text-ink"
                  >
                    {TONE_LABEL.ignore}
                    <span className="ml-2 normal-case tracking-normal opacity-70">
                      — costs more from some people than others
                    </span>
                  </button>
                </div>
              )}

              {answered[open.with] && (
                <p className="mt-3 border-t border-dw-border pt-3 font-sans text-[10px] uppercase tracking-wider text-ink3">
                  Now {STANDING_LABEL[standingAfter(contactFor(open), answered[open.with].tone)]} with {open.with}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HisPhonePage() {
  return (
    <RtgGate>
      <HisPhoneInner />
    </RtgGate>
  );
}
