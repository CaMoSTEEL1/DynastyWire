"use client";

// The Situation Room — DynastyWire's storytelling core. Outside forces (arrests, the portal,
// boosters, the media) land on the coach's desk as decisions with no clean answer. Every
// choice moves the four pressure meters, drags the coach to the podium to own it, and — when
// a player's involved — opens a private text thread you can actually reply in. It's the tape
// and glue: the human weight of running a program, not just the box score.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useIssueTab } from "@/components/dynasty/use-issue-tab";
import { useSaga } from "@/components/dynasty/use-saga";
import { SectionHeader } from "@/components/ui/section-header";
import { applyImpact, type ImpactPayload, type ImpactResult, type RosterPlayer } from "@/lib/dynasty/client";
import { issueKey, readTab, writeTab } from "@/lib/dynasty/issue-cache";
import { academicCase, ACADEMIC_SUSPENSION_WEEKS } from "@/lib/dynasty/academics";
import {
  addSuspension,
  enforceSuspensions,
  loadSuspensions,
  weeksLeft,
  isActive,
  SUSPENDED_OVR,
  type Suspension,
} from "@/lib/dynasty/suspensions";
import { cn } from "@/lib/utils";
import {
  CATEGORY_LABEL,
  METER_META,
  METER_ORDER,
  SEAT_COLOR,
  SEVERITY_STYLE,
  meterTone,
  seatTemperature,
  storylineId,
  type Fallout,
  type MediaAnswer,
  type MediaQuestion,
  type Resolution,
  type Situation,
  type StorylinesResult,
  type StoryOption,
  type ThreadMessage,
  type MeterKey,
  type SagaMeters,
  type CoachBackstory,
} from "@/lib/dynasty/saga";

const METER_FILL: Record<"good" | "warn" | "bad", string> = {
  good: "bg-dw-green",
  warn: "bg-dw-yellow",
  bad: "bg-dw-red",
};
const TONE_STYLE: Record<MediaQuestion["tone"], string> = {
  friendly: "text-dw-green border-dw-green/40",
  neutral: "text-ink3 border-dw-border",
  hostile: "text-dw-red border-dw-red/40",
  gotcha: "text-dw-yellow border-dw-yellow/40",
};

// ── Pressure gauges ───────────────────────────────────────────────────────────

function MeterBar({ mkey, value }: { mkey: MeterKey; value: number }) {
  const meta = METER_META[mkey];
  const tone = meterTone(mkey, value);
  return (
    <div className="rounded border border-dw-border bg-paper2 px-3 py-2.5">
      <div className="flex items-baseline justify-between">
        <span className="font-sans text-[10px] uppercase tracking-widest text-ink3">{meta.label}</span>
        <span className={cn("font-headline text-sm font-bold", tone === "bad" ? "text-dw-red" : tone === "warn" ? "text-dw-yellow" : "text-dw-green")}>
          {value}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-paper4">
        <div
          className={cn("h-full rounded-full transition-all duration-700 ease-out", METER_FILL[tone])}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function GaugeStrip({ meters, recordEdge }: { meters: SagaMeters; recordEdge: number }) {
  const seat = seatTemperature(meters, recordEdge);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded border border-dw-border bg-paper2 px-4 py-3">
        <div>
          <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">Seat Temperature</p>
          <p className={cn("font-headline text-xl font-bold uppercase tracking-wide", SEAT_COLOR[seat.level])}>
            {seat.label}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {seat.level !== "secure" && (
            <span className={cn("h-2 w-2 animate-pulse rounded-full", seat.level === "volcanic" || seat.level === "hot" ? "bg-dw-red" : "bg-dw-yellow")} />
          )}
          <p className="max-w-[16rem] text-right font-serif text-xs italic text-ink3">{seat.blurb}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {METER_ORDER.map((k) => (
          <MeterBar key={k} mkey={k} value={meters[k]} />
        ))}
      </div>
    </div>
  );
}

// ── Media gauntlet ────────────────────────────────────────────────────────────

function deltaChip(label: string, v: number, invert = false) {
  if (!v) return null;
  const good = invert ? v < 0 : v > 0;
  return (
    <span className={cn("rounded px-1.5 py-0.5 font-sans text-[10px] font-semibold", good ? "text-dw-green" : "text-dw-red")}>
      {label} {v > 0 ? `+${v}` : v}
    </span>
  );
}

function MediaGauntlet({
  questions,
  answered,
  onAnswer,
  onCustomAnswer,
  customBusy,
}: {
  questions: MediaQuestion[];
  answered: Record<number, MediaAnswer>;
  onAnswer: (qIndex: number, answer: MediaAnswer) => void;
  /** Speak in your own words — the room judges the exact quote. */
  onCustomAnswer: (qIndex: number, text: string) => void;
  /** Question index currently being judged, or null. */
  customBusy: number | null;
}) {
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  if (!questions?.length) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="font-sans text-[10px] uppercase tracking-widest text-dw-accent">At the Podium</span>
        <div className="h-px flex-1 bg-dw-accent/30" />
      </div>
      {questions.map((q, qi) => {
        const chosen = answered[qi];
        const draft = drafts[qi] ?? "";
        const busy = customBusy === qi;
        const canSend = draft.trim().length > 0 && !busy && !chosen;
        const send = () => {
          if (!canSend) return;
          onCustomAnswer(qi, draft.trim());
          setDrafts((d) => ({ ...d, [qi]: "" }));
        };
        return (
          <div key={qi} className="rounded border border-dw-border bg-paper2 p-4">
            <div className="flex items-center justify-between">
              <span className="font-sans text-xs text-ink3">
                {q.reporter}{q.outlet ? ` · ${q.outlet}` : ""}
              </span>
              <span className={cn("rounded border px-2 py-0.5 text-[10px] font-sans uppercase tracking-wider", TONE_STYLE[q.tone])}>
                {q.tone}
              </span>
            </div>
            <p className="mt-2 font-serif text-ink leading-relaxed">&ldquo;{q.question}&rdquo;</p>

            <div className="mt-3 space-y-2">
              {q.answers?.map((a, ai) => {
                const isChosen = !chosen?.custom && chosen?.text === a.text;
                const locked = !!chosen;
                return (
                  <button
                    key={ai}
                    type="button"
                    disabled={locked}
                    onClick={() => onAnswer(qi, a)}
                    className={cn(
                      "w-full rounded border px-3 py-2.5 text-left transition-colors",
                      isChosen
                        ? "border-dw-accent bg-dw-accent/10"
                        : locked
                          ? "border-dw-border opacity-40"
                          : "border-dw-border hover:border-dw-accent/60 hover:bg-paper3"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-sans text-[10px] uppercase tracking-wider text-ink3">{a.label}</span>
                      {isChosen && (
                        <span className="flex flex-wrap gap-1">
                          {deltaChip("Media", a.mediaDelta, true)}
                          {deltaChip("Fans", a.fanDelta)}
                          {deltaChip("Room", a.lockerDelta)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-serif text-sm text-ink leading-snug">&ldquo;{a.text}&rdquo;</p>
                  </button>
                );
              })}
            </div>

            {/* The coach's own-words answer, once judged */}
            {chosen?.custom && (
              <div className="mt-3 rounded border border-dw-accent bg-dw-accent/10 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-[10px] uppercase tracking-wider text-dw-accent">In his own words</span>
                  <span className="flex flex-wrap gap-1">
                    {deltaChip("Media", chosen.mediaDelta, true)}
                    {deltaChip("Fans", chosen.fanDelta)}
                    {deltaChip("Room", chosen.lockerDelta)}
                  </span>
                </div>
                <p className="mt-1 font-serif text-sm text-ink leading-snug">&ldquo;{chosen.text}&rdquo;</p>
                {chosen.reaction && <p className="mt-1.5 font-serif text-xs italic text-ink3">{chosen.reaction}</p>}
                {chosen.headline && (
                  <p className="mt-1 font-sans text-[10px] uppercase tracking-wider text-ink3">
                    Tomorrow&apos;s headline: <span className="text-ink2">{chosen.headline}</span>
                  </p>
                )}
              </div>
            )}

            {/* Or say it in your own words */}
            {!chosen && (
              <div className="mt-3 border-t border-dw-border pt-3">
                <p className="mb-2 font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Or say it in your own words</p>
                <div className="flex gap-2">
                  <input
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [qi]: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                    disabled={busy}
                    placeholder="Lean into the mic…"
                    className="flex-1 rounded border border-dw-border bg-paper px-3 py-2 font-serif text-sm text-ink placeholder:text-ink3 focus:border-dw-accent2/60 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={!canSend}
                    onClick={send}
                    className="rounded border border-dw-accent2 bg-dw-accent2/20 px-4 py-2 font-sans text-xs uppercase tracking-wider text-dw-accent2 hover:bg-dw-accent2/30 disabled:opacity-40"
                  >
                    Answer
                  </button>
                </div>
                {busy ? (
                  <p className="mt-2 font-sans text-[10px] uppercase tracking-wider text-dw-accent">The room reacts…</p>
                ) : (
                  <p className="mt-2 font-sans text-[10px] uppercase tracking-wider text-ink3">Pick an answer or speak — you only get one.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Player text thread ────────────────────────────────────────────────────────

function PlayerThread({
  playerName,
  thread,
  onSend,
  sending,
}: {
  playerName: string | null;
  thread: ThreadMessage[];
  onSend: (text: string) => void;
  sending: boolean;
}) {
  const [draft, setDraft] = useState("");
  const canSend = draft.trim().length > 0 && !sending;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">
          Texts with {playerName ?? "the player"}
        </span>
        <div className="h-px flex-1 bg-dw-accent2/30" />
      </div>
      <div className="space-y-2 rounded border border-dw-border bg-paper p-3">
        {thread.map((m, i) => {
          const mine = m.from === "coach";
          return (
            <div key={i} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[80%] rounded-2xl px-3.5 py-2 font-serif text-sm leading-snug",
                  mine ? "rounded-br-sm bg-dw-accent text-paper" : "rounded-bl-sm bg-paper3 text-ink"
                )}
              >
                {!mine && <span className="mb-0.5 block font-sans text-[9px] uppercase tracking-wider text-ink3">{playerName ?? "Player"}</span>}
                {m.text}
              </div>
            </div>
          );
        })}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-paper3 px-3.5 py-2.5">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink3" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink3 [animation-delay:200ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink3 [animation-delay:400ms]" />
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSend) {
              onSend(draft.trim());
              setDraft("");
            }
          }}
          placeholder={`Text ${playerName ?? "your player"}…`}
          className="flex-1 rounded border border-dw-border bg-paper2 px-3 py-2 font-serif text-sm text-ink placeholder:text-ink3 focus:border-dw-accent2/60 focus:outline-none"
        />
        <button
          type="button"
          disabled={!canSend}
          onClick={() => {
            onSend(draft.trim());
            setDraft("");
          }}
          className="rounded border border-dw-accent2 bg-dw-accent2/20 px-4 py-2 font-sans text-xs uppercase tracking-wider text-dw-accent2 hover:bg-dw-accent2/30 disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ── Resolved situation ────────────────────────────────────────────────────────

function ResolvedCard({
  res,
  onAnswer,
  onCustomAnswer,
  customBusy,
  onSend,
  sending,
}: {
  res: Resolution;
  onAnswer: (qIndex: number, answer: MediaAnswer) => void;
  onCustomAnswer: (qIndex: number, text: string) => void;
  customBusy: number | null;
  onSend: (text: string) => void;
  sending: boolean;
}) {
  const { fallout } = res;
  const deltas = fallout.meterDeltas || {};
  return (
    <div className="overflow-hidden rounded border border-dw-border bg-paper2">
      <div className="h-1 w-full bg-gradient-to-r from-dw-red via-dw-accent2 to-dw-accent" />
      <div className="space-y-5 px-5 py-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded border border-dw-border px-2 py-0.5 font-sans text-[10px] uppercase tracking-wider text-ink3">
              {CATEGORY_LABEL[res.category]}
            </span>
            <span className="rounded border border-dw-green/40 px-2 py-0.5 font-sans text-[10px] uppercase tracking-wider text-dw-green">
              Decided
            </span>
          </div>
          <h3 className="mt-2 font-headline text-xl uppercase tracking-wide text-ink">{res.headline}</h3>
          <p className="mt-1 font-sans text-xs text-ink3">
            You chose: <span className="text-ink2">{res.option.label}</span> — {res.option.approach}
          </p>
        </div>

        <div className="rounded border border-dw-border bg-paper px-4 py-3">
          <p className="font-serif text-ink leading-relaxed">{fallout.outcome}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {deltaChip("Boosters", Number(deltas.boosterConfidence) || 0)}
            {deltaChip("Fans", Number(deltas.fanTrust) || 0)}
            {deltaChip("Media", Number(deltas.mediaHeat) || 0, true)}
            {deltaChip("Room", Number(deltas.lockerRoom) || 0)}
          </div>
        </div>

        {fallout.lockerRoom?.reaction && (
          <div className="border-l-2 border-dw-accent2/50 pl-3">
            <p className="font-serif italic text-ink2">&ldquo;{fallout.lockerRoom.reaction}&rdquo;</p>
            <p className="mt-0.5 font-sans text-[10px] uppercase tracking-wider text-ink3">— {fallout.lockerRoom.byPlayer}, locker room</p>
          </div>
        )}

        <MediaGauntlet
          questions={fallout.mediaQuestions}
          answered={res.answered}
          onAnswer={onAnswer}
          onCustomAnswer={onCustomAnswer}
          customBusy={customBusy}
        />

        {res.playerName && (fallout.playerThread?.length > 0 || res.thread.length > 0) && (
          <PlayerThread playerName={res.playerName} thread={res.thread} onSend={onSend} sending={sending} />
        )}
      </div>
    </div>
  );
}

// ── Open situation ────────────────────────────────────────────────────────────

const TONE_ACCENT: Record<StoryOption["tone"], string> = {
  hardline: "hover:border-dw-red/60",
  measured: "hover:border-ink3",
  protective: "hover:border-dw-green/60",
  pragmatic: "hover:border-dw-accent2/60",
};

function OpenCard({
  situation,
  busy,
  onDecide,
}: {
  situation: Situation;
  busy: boolean;
  onDecide: (option: StoryOption) => void;
}) {
  return (
    <div className="rounded border border-dw-border bg-paper2 px-5 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded border border-dw-border px-2 py-0.5 font-sans text-[10px] uppercase tracking-wider text-ink3">
          {CATEGORY_LABEL[situation.category]}
        </span>
        <span className={cn("rounded border px-2 py-0.5 font-sans text-[10px] uppercase tracking-wider", SEVERITY_STYLE[situation.severity])}>
          {situation.severity}
        </span>
        {situation.player && (
          <span className="font-sans text-[10px] uppercase tracking-wider text-ink3">
            {situation.player.name}{situation.player.position ? ` · ${situation.player.position}` : ""}
          </span>
        )}
      </div>

      <h3 className="mt-2 font-headline text-xl uppercase tracking-wide text-ink">{situation.headline}</h3>
      <p className="mt-2 font-serif text-ink leading-relaxed">{situation.dek}</p>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
        {situation.source && (
          <p className="font-sans text-[11px] text-ink3"><span className="uppercase tracking-wider">How you found out:</span> {situation.source}</p>
        )}
        {situation.stakes && (
          <p className="font-sans text-[11px] text-dw-yellow"><span className="uppercase tracking-wider text-ink3">At stake:</span> {situation.stakes}</p>
        )}
      </div>

      <div className="mt-4 space-y-2">
        <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">Your call — and you&apos;ll own it</p>
        {situation.options?.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={busy}
            onClick={() => onDecide(o)}
            className={cn(
              "w-full rounded border border-dw-border bg-paper px-4 py-3 text-left transition-colors disabled:opacity-40",
              TONE_ACCENT[o.tone] ?? "hover:border-ink3"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="font-sans text-sm font-semibold uppercase tracking-wider text-ink">{o.label}</span>
              <span className="font-sans text-[10px] uppercase tracking-wider text-ink3">{o.tone}</span>
            </div>
            <p className="mt-0.5 font-serif text-sm text-ink2 leading-snug">{o.approach}</p>
          </button>
        ))}
      </div>

      {busy && (
        <p className="mt-3 font-sans text-xs uppercase tracking-wider text-dw-accent">The fallout is landing…</p>
      )}
    </div>
  );
}

// ── Outside Forces Sidebar & Alerts ──────────────────────────────────────────

function OutsideForcesSidebar({ backstory, meters, recordEdge }: { backstory: CoachBackstory; meters: SagaMeters; recordEdge: number }) {
  const adStance = (() => {
    const val = meters.boosterConfidence;
    if (val >= 68) return { label: "Fully Aligned", color: "text-dw-green", border: "border-dw-green/30 bg-dw-green/5" };
    if (val >= 42) return { label: "Monitoring", color: "text-dw-yellow", border: "border-dw-yellow/30 bg-dw-yellow/5" };
    return { label: "Replacement List", color: "text-dw-red", border: "border-dw-red/30 bg-dw-red/5" };
  })();

  const boosterStance = (() => {
    const val = meters.boosterConfidence * 0.6 + meters.fanTrust * 0.4;
    if (val >= 65) return { label: "Funding Facility", color: "text-dw-green", border: "border-dw-green/30 bg-dw-green/5" };
    if (val >= 45) return { label: "NIL Active", color: "text-dw-yellow", border: "border-dw-yellow/30 bg-dw-yellow/5" };
    return { label: "Funding Frozen", color: "text-dw-red", border: "border-dw-red/30 bg-dw-red/5" };
  })();

  const writerStance = (() => {
    const val = meters.mediaHeat;
    if (val >= 62) return { label: "Hostile / Hot-Seat Pieces", color: "text-dw-red", border: "border-dw-red/30 bg-dw-red/5" };
    if (val >= 38) return { label: "Skeptical / Fair", color: "text-dw-yellow", border: "border-dw-yellow/30 bg-dw-yellow/5" };
    return { label: "Puff Pieces", color: "text-dw-green", border: "border-dw-green/30 bg-dw-green/5" };
  })();

  const rivalStance = (() => {
    const val = recordEdge;
    if (val > 2) return { label: "Panic-recruiting", color: "text-dw-green", border: "border-dw-green/30 bg-dw-green/5" };
    if (val < -2) return { label: "Trolling online", color: "text-dw-red", border: "border-dw-red/30 bg-dw-red/5" };
    return { label: "Focused on schedule", color: "text-ink3", border: "border-dw-border bg-paper" };
  })();

  return (
    <div className="rounded border border-dw-border bg-paper2 p-4 space-y-4">
      <div>
        <h3 className="font-headline text-xs uppercase tracking-widest text-ink3">Outside Forces</h3>
        <p className="font-serif text-[11px] text-ink3 mt-0.5 font-light">The key figures watching your program</p>
      </div>

      <div className="space-y-2">
        {/* AD */}
        <div className={cn("rounded border p-3 flex items-center justify-between", adStance.border)}>
          <div>
            <span className="block font-sans text-[8px] uppercase tracking-wider text-ink3">AD</span>
            <span className="font-headline text-xs uppercase text-ink">{backstory.adName}</span>
          </div>
          <span className={cn("font-sans text-[9px] uppercase font-bold tracking-wider", adStance.color)}>
            {adStance.label}
          </span>
        </div>

        {/* Booster */}
        <div className={cn("rounded border p-3 flex items-center justify-between", boosterStance.border)}>
          <div>
            <span className="block font-sans text-[8px] uppercase tracking-wider text-ink3">Chief Booster</span>
            <span className="font-headline text-xs uppercase text-ink">{backstory.boosterName}</span>
          </div>
          <span className={cn("font-sans text-[9px] uppercase font-bold tracking-wider", boosterStance.color)}>
            {boosterStance.label}
          </span>
        </div>

        {/* Writer */}
        <div className={cn("rounded border p-3 flex items-center justify-between", writerStance.border)}>
          <div>
            <span className="block font-sans text-[8px] uppercase tracking-wider text-ink3">Beat Writer</span>
            <span className="font-headline text-xs uppercase text-ink">{backstory.reporterName}</span>
          </div>
          <span className={cn("font-sans text-[9px] uppercase font-bold tracking-wider", writerStance.color)}>
            {writerStance.label}
          </span>
        </div>

        {/* Rival */}
        <div className={cn("rounded border p-3 flex items-center justify-between", rivalStance.border)}>
          <div>
            <span className="block font-sans text-[8px] uppercase tracking-wider text-ink3">Rival Coach</span>
            <span className="font-headline text-xs uppercase text-ink">{backstory.rivalCoachName}</span>
          </div>
          <span className={cn("font-sans text-[9px] uppercase font-bold tracking-wider", rivalStance.color)}>
            {rivalStance.label}
          </span>
        </div>
      </div>
      
      <div className="pt-2 border-t border-dw-border text-center flex items-center justify-center gap-1.5">
        <span className="font-sans text-[9px] uppercase tracking-wider text-ink3">Archetype:</span>
        <span className="font-sans text-[9px] uppercase tracking-wider text-dw-accent font-semibold">
          {backstory.archetype.replace("-", " ")}
        </span>
      </div>
    </div>
  );
}

// ── Consequence Sync ─────────────────────────────────────────────────────────
// The meters stop being decoration: locker-room trust moves player confidence ratings,
// booster confidence grants/withholds program points, and AD standing sets job security —
// written into the actual save (backed up, verified, refused while the game runs).

interface ImpactPlan {
  payload: ImpactPayload;
  confPreview: { name: string; from: number; to: number }[];
}

function buildImpactPlan(
  meters: SagaMeters,
  roster: RosterPlayer[],
  teamIndex: number,
  resolvedThisWeek: Resolution[]
): ImpactPlan {
  // Per-situation extra shove for the players actually in this week's drama.
  const involved = new Map<string, number>();
  for (const r of resolvedThisWeek) {
    if (!r.playerName) continue;
    const d = Number(r.fallout?.meterDeltas?.lockerRoom) || 0;
    involved.set(r.playerName.toLowerCase(), Math.max(-10, Math.min(10, Math.round(d))));
  }

  const base = Math.round((meters.lockerRoom - 50) / 5); // -10..+10 roster-wide
  const confidence: { name: string; value: number }[] = [];
  const confPreview: { name: string; from: number; to: number }[] = [];
  for (const p of roster) {
    if (p.confidence == null) continue;
    const extra = involved.get(p.name.toLowerCase()) ?? 0;
    const delta = base + extra;
    if (delta === 0) continue;
    const to = Math.max(5, Math.min(99, p.confidence + delta));
    if (to === p.confidence) continue;
    confidence.push({ name: p.name, value: to });
    confPreview.push({ name: p.name, from: p.confidence, to });
  }

  const programPointsDelta = Math.round((meters.boosterConfidence - 50) / 5) * 5; // -50..+50
  const jobSecurityPct = Math.max(
    1,
    Math.min(100, Math.round(meters.boosterConfidence * 0.6 + meters.fanTrust * 0.4 - (meters.mediaHeat - 50) * 0.4))
  );

  return {
    payload: { teamIndex, confidence, programPointsDelta, jobSecurityPct },
    confPreview: confPreview.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from)),
  };
}

const IMPACT_TAB = "impact-sync"; // once-per-week guard, persisted in the issue store

function ConsequenceSyncPanel({
  meters,
  resolvedThisWeek,
}: {
  meters: SagaMeters;
  resolvedThisWeek: Resolution[];
}) {
  const { snapshot, roster, currentSavePath, dynastyId, year, week } = useDynasty();
  const weekKey = issueKey(dynastyId, year, week);
  const [synced, setSynced] = useState<ImpactResult | null>(null);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSynced(null);
    setChecked(false);
    (async () => {
      const rec = await readTab<ImpactResult>(weekKey, IMPACT_TAB);
      if (!cancelled) {
        if (rec?.data?.ok) setSynced(rec.data);
        setChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weekKey]);

  const teamIndex = snapshot?.userTeam?.teamIndex ?? null;
  const plan = useMemo(
    () => (teamIndex != null ? buildImpactPlan(meters, roster, teamIndex, resolvedThisWeek) : null),
    [meters, roster, teamIndex, resolvedThisWeek]
  );

  const push = useCallback(async () => {
    if (!plan || !currentSavePath || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await applyImpact(currentSavePath, plan.payload);
      if (!res.ok) {
        setErr(res.detail || "The save refused the write. Close the game and try again.");
      } else {
        setSynced(res);
        await writeTab(weekKey, IMPACT_TAB, { status: "ready", data: res, error: null, generatedAt: Date.now() }, { dynastyId, year, week });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't reach the save.");
    } finally {
      setBusy(false);
    }
  }, [plan, currentSavePath, busy, weekKey, dynastyId, year, week]);

  if (!checked || !plan || !currentSavePath) return null;
  const { payload, confPreview } = plan;
  const ppDelta = payload.programPointsDelta ?? 0;
  const nothingToWrite =
    (payload.confidence?.length ?? 0) === 0 && ppDelta === 0 && payload.jobSecurityPct == null;

  return (
    <div className="rounded border border-dw-border bg-paper2 p-4 space-y-3">
      <div>
        <h3 className="font-headline text-xs uppercase tracking-widest text-ink3">Consequence Sync</h3>
        <p className="font-serif text-[11px] text-ink3 mt-0.5 font-light">
          Push this week&apos;s standing into the game itself
        </p>
      </div>

      <div className="space-y-1.5 font-sans text-[11px]">
        <p className="flex justify-between">
          <span className="text-ink3">Job security</span>
          <span className="text-ink">{payload.jobSecurityPct}%</span>
        </p>
        <p className="flex justify-between">
          <span className="text-ink3">Program points</span>
          <span className={cn(ppDelta >= 0 ? "text-dw-green" : "text-dw-red")}>
            {ppDelta >= 0 ? `+${ppDelta}` : ppDelta}
          </span>
        </p>
        <p className="flex justify-between">
          <span className="text-ink3">Player confidence</span>
          <span className="text-ink">{confPreview.length ? `${confPreview.length} players shift` : "no change"}</span>
        </p>
        {confPreview.slice(0, 4).map((c) => (
          <p key={c.name} className="flex justify-between pl-2">
            <span className="text-ink3">{c.name}</span>
            <span className={cn(c.to >= c.from ? "text-dw-green" : "text-dw-red")}>
              {c.from} → {c.to}
            </span>
          </p>
        ))}
      </div>

      {synced?.ok ? (
        <p className="rounded border border-dw-green/30 bg-dw-green/5 px-3 py-2 font-sans text-[10px] uppercase tracking-wider text-dw-green">
          Synced into the save this week ✓{synced.verified === false ? " (partial — see console)" : ""}
        </p>
      ) : (
        <>
          <button
            type="button"
            disabled={busy || nothingToWrite}
            onClick={() => void push()}
            className="w-full rounded border border-dw-accent bg-dw-accent/15 px-3 py-2 font-sans text-[10px] uppercase tracking-wider text-dw-accent hover:bg-dw-accent/25 disabled:opacity-40"
          >
            {busy ? "Writing to save…" : "Push into the game"}
          </button>
          <p className="font-serif text-[10px] text-ink3 leading-relaxed">
            Backs the save up first, refuses while the game is running, and verifies every
            write. Once per week.
          </p>
          {err && <p className="font-serif text-[11px] text-dw-red">{err}</p>}
        </>
      )}
    </div>
  );
}

function MissingBackstoryBanner() {
  return (
    <div className="rounded border border-dw-yellow/30 bg-dw-yellow/5 p-4 text-center space-y-3">
      <p className="font-serif text-xs text-dw-yellow leading-relaxed">
        Establish your coach backstory and relationships on the profile page to feel the pressure of the AD, boosters, and beat reporters on your desk.
      </p>
      {/* Hard link to the static route (client routing breaks under Tauri's asset
          protocol, so <Link> is deliberately NOT used here). NOTE: the context's dynastyId
          is the dynasty's internal identity (a UUID), NOT the URL segment — the exported
          route is always /current/. Using the UUID here 404'd users back to the front page. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/current/coach/"
        className="inline-block rounded border border-dw-yellow/60 bg-dw-yellow/25 px-4 py-1.5 font-sans text-[10px] uppercase tracking-wider text-dw-yellow hover:bg-dw-yellow/35 transition-colors"
      >
        Define Backstory
      </a>
    </div>
  );
}

// ── Suspensions sidebar card ──────────────────────────────────────────────────

function SuspensionsCard({ list, year, week }: { list: Suspension[]; year: number; week: number }) {
  const active = list.filter((s) => !s.lifted);
  if (active.length === 0) return null;
  return (
    <div className="rounded border border-dw-red/40 bg-dw-red/5 p-4 space-y-3">
      <div>
        <h3 className="font-headline text-xs uppercase tracking-widest text-dw-red">Suspended</h3>
        <p className="mt-0.5 font-serif text-[11px] font-light text-ink3">
          Enforced in your save — a suspended player&apos;s rating is temporarily dropped to {SUSPENDED_OVR} OVR
          so the depth chart buries him, then restored automatically once served.
        </p>
      </div>
      <div className="space-y-2">
        {active.map((s, i) => {
          const left = weeksLeft(s, year, week);
          return (
            <div key={s.playerName + i} className="rounded border border-dw-border bg-paper p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-headline text-xs uppercase text-ink">
                  {s.playerName}{s.position ? ` · ${s.position}` : ""}
                </span>
                <span className="shrink-0 font-sans text-[9px] font-bold uppercase tracking-wider text-dw-red">
                  {left > 0 ? `${left} wk${left === 1 ? "" : "s"} left` : "served"}
                </span>
              </div>
              <p className="mt-0.5 font-serif text-[11px] leading-snug text-ink3">{s.reason}</p>
              <p className="mt-1 font-sans text-[9px] uppercase tracking-wider text-ink3">
                {s.source === "academics" ? "Academic ruling" : "Team discipline"} ·{" "}
                {left > 0
                  ? s.applied
                    ? `benched in save (${s.originalOverall ?? "—"} → ${SUSPENDED_OVR} OVR)`
                    : "save write pending — close CFB27, then reopen the Wire"
                  : "rating restore pending — close CFB27, then reopen the Wire"}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SituationRoomPage() {
  const { needsOnboarding, generate, snapshot, roster, currentSavePath, dynastyId, year, week, settings } = useDynasty();
  const saga = useSaga();

  const [situations, setSituations] = useState<Situation[] | null>(null);
  const [suspensions, setSuspensions] = useState<Suspension[]>([]);
  const [loading, setLoading] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [textingId, setTextingId] = useState<string | null>(null);
  // "<storylineId>:<questionIndex>" while an own-words answer is being judged.
  const [customBusyKey, setCustomBusyKey] = useState<string | null>(null);

  const recordEdge = (snapshot?.userTeam?.wins ?? 0) - (snapshot?.userTeam?.losses ?? 0);

  // Active + recent suspensions for this dynasty (kept fresh after every enforcement pass).
  useEffect(() => {
    let cancelled = false;
    loadSuspensions(dynastyId).then((l) => { if (!cancelled) setSuspensions(l); }).catch(() => {});
    return () => { cancelled = true; };
  }, [dynastyId, week, year]);

  // The registrar's desk: rarely, an At-Risk-GPA player is ruled academically ineligible.
  // Deterministic per (dynasty, year, week) and skipped while he's already suspended.
  const academic = useMemo(() => {
    const c = academicCase(roster ?? [], dynastyId, year, week);
    if (!c) return null;
    if (suspensions.some((s) => s.playerName.toLowerCase() === c.player.name.toLowerCase() && isActive(s, year, week))) return null;
    return c;
  }, [roster, dynastyId, year, week, suspensions]);

  const ACADEMIC_INDEX = 99; // stable slot so the ruling's resolution persists like any other
  const academicId = storylineId(dynastyId, year, week, ACADEMIC_INDEX);
  const academicSituation = useMemo<Situation | null>(() => {
    if (!academic) return null;
    const p = academic.player;
    return {
      category: "academics",
      severity: "crisis",
      headline: `${p.name} ruled academically ineligible`,
      dek: `The registrar's office flagged ${p.name}'s ${academic.gpa.toFixed(2)} GPA after midterm grades posted. The ruling stands — he will miss the next ${ACADEMIC_SUSPENSION_WEEKS} games no matter how you play it. What's left is how you handle him, the room, and the press.`,
      player: { name: p.name, position: p.position ?? null, year: p.year ?? null },
      source: "A certified letter from the university registrar, copied to compliance.",
      stakes: `${ACADEMIC_SUSPENSION_WEEKS} games without him, and a locker room watching how you treat a teammate who slipped.`,
      options: [
        { id: "a", label: "Rules are rules", approach: "Announce the suspension yourself, own the standard, no sugarcoating.", tone: "hardline" },
        { id: "b", label: "Build him back", approach: "Pair the suspension with tutors, structure, and a public path to reinstatement.", tone: "measured" },
        { id: "c", label: "Shield him", approach: "Call it an internal matter, keep the details in-house, absorb the media hit yourself.", tone: "protective" },
      ],
    };
  }, [academic]);

  const ids = useMemo(
    () => (situations ?? []).map((_, i) => storylineId(dynastyId, year, week, i)),
    [situations, dynastyId, year, week]
  );

  // Restore this week's desk from the persisted issue cache (survives navigation + app
  // restarts) — resolved situations already persist via the saga.
  const cachedDesk = useIssueTab<StorylinesResult>("storylines");
  useEffect(() => {
    if (situations === null && Array.isArray(cachedDesk?.situations) && cachedDesk.situations.length > 0) {
      setSituations(cachedDesk.situations);
      setTried(true);
    }
  }, [cachedDesk, situations]);

  const openDesk = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await generate<StorylinesResult>("storylines", {
        backstory: saga.state?.backstory || null
      });
      if (data?.error || !Array.isArray(data?.situations) || data.situations.length === 0) {
        setError("Quiet week off the field. Check back after your next game.");
        setSituations([]);
      } else {
        setSituations(data.situations);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the desk. Check your save + API key.");
    } finally {
      setLoading(false);
      setTried(true);
    }
  }, [generate, saga.state?.backstory]);

  const decide = useCallback(
    async (situation: Situation, id: string, option: StoryOption) => {
      setBusyId(id);
      try {
        const fallout = await generate<Fallout>(
          "storyline-fallout",
          { situation, option, meters: saga.state?.meters, backstory: saga.state?.backstory || null },
          { force: true }
        );
        if (fallout?.error) throw new Error("The war room came back empty.");
        // Suspension: an academic ruling ALWAYS sits the player; other situations only
        // when the consequence engine (rarely) hands one down. Enforced in the save via
        // a temporary OVR drop, restored automatically once served.
        const isAcademic = id === academicId;
        const modelWeeks = fallout?.suspension?.weeks;
        const suspWeeks = isAcademic
          ? ACADEMIC_SUSPENSION_WEEKS
          : typeof modelWeeks === "number" && modelWeeks > 0
            ? Math.min(4, Math.round(modelWeeks))
            : 0;
        await saga.resolve(
          id,
          {
            week,
            year,
            category: situation.category,
            headline: situation.headline,
            playerName: situation.player?.name ?? null,
          },
          option,
          fallout
        );
        if (suspWeeks > 0 && situation.player?.name) {
          await addSuspension(dynastyId, {
            playerName: situation.player.name,
            position: situation.player.position ?? null,
            reason: situation.headline,
            source: isAcademic ? "academics" : "situation",
            weeks: suspWeeks,
            startYear: year,
            startWeek: week,
          });
          const ti = snapshot?.userTeam?.teamIndex;
          if (currentSavePath && ti != null) {
            // Write the bench-him drop now (retries on the next ingest if the game is open).
            const fresh = await enforceSuspensions(dynastyId, currentSavePath, ti, year, week).catch(() => null);
            if (fresh) setSuspensions(fresh);
            else setSuspensions(await loadSuspensions(dynastyId));
          } else {
            setSuspensions(await loadSuspensions(dynastyId));
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't resolve that decision.");
      } finally {
        setBusyId(null);
      }
    },
    [generate, saga, week, year, academicId, dynastyId, currentSavePath, snapshot?.userTeam?.teamIndex]
  );

  // Own-words podium answer inside a situation's media gauntlet: the room judges the exact
  // quote (podium-answer engine), then the verdict + deltas are recorded like a scripted pick.
  const customPodium = useCallback(
    async (id: string, res: Resolution, qi: number, text: string) => {
      const q = res.fallout.mediaQuestions?.[qi];
      if (!q || res.answered[qi]) return;
      setCustomBusyKey(`${id}:${qi}`);
      try {
        const verdict = await generate<{
          reaction: string;
          headline: string;
          mediaDelta: number;
          fanDelta: number;
          lockerDelta: number;
          error?: boolean;
        }>(
          "podium-answer",
          {
            question: { reporterName: q.reporter, outlet: q.outlet, question: q.question, tone: q.tone },
            answer: text,
          },
          { force: true }
        );
        const ans: MediaAnswer = verdict?.error
          ? { label: "In his own words", text, custom: true, mediaDelta: 0, fanDelta: 0, lockerDelta: 0 }
          : {
              label: "In his own words",
              text,
              custom: true,
              reaction: verdict.reaction,
              headline: verdict.headline,
              mediaDelta: verdict.mediaDelta,
              fanDelta: verdict.fanDelta,
              lockerDelta: verdict.lockerDelta,
            };
        await saga.answerMedia(id, qi, ans);
      } catch (e) {
        setError(e instanceof Error ? e.message : "The room didn't hear you — try again.");
      } finally {
        setCustomBusyKey(null);
      }
    },
    [generate, saga]
  );

  const sendText = useCallback(
    async (id: string, situation: Situation, res: Resolution, text: string) => {
      setTextingId(id);
      const coachMsg: ThreadMessage = { from: "coach", text };
      await saga.appendThread(id, [coachMsg]);
      try {
        const reply = await generate<{ reply: string; mood?: string }>(
          "player-text",
          { situation, thread: [...res.thread, coachMsg], coachMessage: text, backstory: saga.state?.backstory || null },
          { force: true }
        );
        if (reply?.reply) {
          await saga.appendThread(id, [{ from: "player", text: reply.reply, mood: reply.mood }]);
        }
      } catch {
        await saga.appendThread(id, [{ from: "player", text: "…", mood: "shut-down" }]);
      } finally {
        setTextingId(null);
      }
    },
    [generate, saga]
  );

  if (needsOnboarding) {
    return (
      <div>
        <SectionHeader title="SITUATION ROOM" subtitle="The weight of the chair" variant="press-conference" />
        <div className="mt-6 rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
          <p className="font-serif text-ink2">Point Dynasty Wire at your save and add your API key in settings — then the desk fills up.</p>
        </div>
      </div>
    );
  }

  const resolved = saga.state?.resolved ?? {};
  const openCount =
    (situations ?? []).filter((_, i) => !resolved[ids[i]]).length +
    (academicSituation && !resolved[academicId] ? 1 : 0);

  return (
    <div className="space-y-8">
      <SectionHeader title="SITUATION ROOM" subtitle="The weight of the chair" variant="press-conference" />

      {saga.state && <GaugeStrip meters={saga.state.meters} recordEdge={recordEdge} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main column: The Desk */}
        <div className="lg:col-span-2 space-y-6">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-headline text-xs uppercase tracking-widest text-ink3">
                The Desk {typeof week === "number" && week > 0 ? `· Week ${week}` : ""}
              </h3>
              {situations && situations.length > 0 && (
                <span className="font-sans text-[10px] uppercase tracking-wider text-ink3">{openCount} open</span>
              )}
            </div>

            {situations === null && (
              <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center">
                <p className="font-serif text-ink2">
                  Every dynasty is more than the scoreboard. See what landed on your desk this week.
                </p>
                <button
                  type="button"
                  onClick={() => void openDesk()}
                  disabled={loading}
                  className="mt-4 rounded border border-dw-accent bg-dw-accent px-5 py-2.5 font-sans text-xs uppercase tracking-wider text-paper hover:bg-dw-accent2 disabled:opacity-50"
                >
                  {loading ? "Reading the room…" : "Open the Desk"}
                </button>
              </div>
            )}

            {error && !loading && (
              <div className="rounded border border-dw-red/30 bg-dw-red/10 px-6 py-8 text-center font-serif text-dw-red">{error}</div>
            )}

            {situations && situations.length === 0 && tried && !error && (
              <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center font-serif text-ink2">
                Quiet week. No fires to put out — enjoy it while it lasts.
              </div>
            )}

            <div className="space-y-5">
              {/* The registrar's ruling outranks the rest of the desk — it lands whether
                  or not the coach has opened this week's situations. */}
              {academicSituation && (() => {
                const res = resolved[academicId];
                if (res) {
                  return (
                    <ResolvedCard
                      key={academicId}
                      res={res}
                      onAnswer={(qi, a) => void saga.answerMedia(academicId, qi, a)}
                      onCustomAnswer={(qi, text) => void customPodium(academicId, res, qi, text)}
                      customBusy={
                        customBusyKey?.startsWith(`${academicId}:`)
                          ? Number(customBusyKey.slice(academicId.length + 1))
                          : null
                      }
                      onSend={(text) => void sendText(academicId, academicSituation, res, text)}
                      sending={textingId === academicId}
                    />
                  );
                }
                return (
                  <OpenCard
                    key={academicId}
                    situation={academicSituation}
                    busy={busyId === academicId}
                    onDecide={(o) => void decide(academicSituation, academicId, o)}
                  />
                );
              })()}
              {(situations ?? []).map((s, i) => {
                const id = ids[i];
                const res = resolved[id];
                if (res) {
                  return (
                    <ResolvedCard
                      key={id}
                      res={res}
                      onAnswer={(qi, a) => void saga.answerMedia(id, qi, a)}
                      onCustomAnswer={(qi, text) => void customPodium(id, res, qi, text)}
                      customBusy={
                        customBusyKey?.startsWith(`${id}:`)
                          ? Number(customBusyKey.slice(id.length + 1))
                          : null
                      }
                      onSend={(text) => void sendText(id, s, res, text)}
                      sending={textingId === id}
                    />
                  );
                }
                return <OpenCard key={id} situation={s} busy={busyId === id} onDecide={(o) => void decide(s, id, o)} />;
              })}
            </div>
          </div>
        </div>

        {/* Sidebar: Relationships & Outside Forces */}
        <div className="space-y-6">
          <SuspensionsCard list={suspensions} year={year} week={week} />
          {saga.state?.backstory ? (
            <OutsideForcesSidebar
              backstory={saga.state.backstory}
              meters={saga.state.meters}
              recordEdge={recordEdge}
            />
          ) : (
            <MissingBackstoryBanner />
          )}
          {settings.consequenceSync === true && saga.state && (
            <ConsequenceSyncPanel
              meters={saga.state.meters}
              resolvedThisWeek={Object.values(saga.state.resolved).filter(
                (r) => r.week === week && r.year === year
              )}
            />
          )}
        </div>
      </div>

      {/* The Ledger */}
      {saga.state && saga.state.ledger.length > 0 && (
        <div>
          <h3 className="mb-3 font-headline text-xs uppercase tracking-widest text-ink3">The Ledger — Everything You&apos;ve Owned</h3>
          <div className="rounded border border-dw-border bg-paper2">
            {saga.state.ledger.map((e, i) => (
              <div key={e.storylineId + i} className="border-b border-dw-border px-4 py-3 last:border-b-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-serif text-sm text-ink">{e.headline}</span>
                  <span className="shrink-0 font-sans text-[10px] uppercase tracking-wider text-ink3">
                    {e.year ? `Y${e.year} · ` : ""}Wk {e.week}
                  </span>
                </div>
                <p className="mt-0.5 font-sans text-xs text-dw-accent2">{e.decision}</p>
                <p className="mt-0.5 font-serif text-xs italic text-ink3">{e.outcome}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
