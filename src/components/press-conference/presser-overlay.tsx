"use client";

// THE PODIUM TAKEOVER — the moment the week turns.
//
// When a new week lands (a result came in, or kickoff is this week), the app stops being a
// newspaper and becomes a room: full-screen, lights down, one reporter at a time, the
// question in type you can read from across the desk. It's the same press conference the
// dedicated page runs — same generator, same persistence, same meters — but staged so it
// feels like walking to a microphone instead of reading a tab.
//
// Cost discipline: the takeover itself never spends a token. If the week's presser is
// already written (full-mode weekly issue), the questions are there and the room is live
// immediately. If it isn't (budget mode), the coach taps once to fill the room.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useSaga } from "@/components/dynasty/use-saga";
import { readTab, writeTab } from "@/lib/dynasty/issue-cache";
import { nextOpponent, weekStateOf } from "@/lib/dynasty/week-state";
import { cn } from "@/lib/utils";

interface PCAnswer {
  label: string;
  text: string;
  mediaDelta: number;
  fanDelta: number;
  lockerDelta: number;
}
interface PCQuestion {
  reporterName: string;
  outlet: string;
  question: string;
  tone: "friendly" | "neutral" | "hostile" | "gotcha";
  answers?: PCAnswer[];
}
interface PCResult {
  questions: PCQuestion[];
  error?: boolean;
}
interface AnswerRec {
  label: string;
  text: string;
  custom: boolean;
  reaction?: string;
  headline?: string;
  mediaDelta: number;
  fanDelta: number;
  lockerDelta: number;
}
interface PresserRecord {
  answers: Record<number, AnswerRec>;
  grade?: unknown;
}

// Shared with the press-conference page so answers given at the podium show up there and
// never get asked twice.
const ANSWERS_TAB = "presser-answers";
/** Per-week marker: this takeover has already had its moment. */
const SEEN_TAB = "presser-overlay-seen";

const TONE_STYLE: Record<PCQuestion["tone"], string> = {
  friendly: "border-dw-green/40 text-dw-green",
  neutral: "border-dw-border text-ink3",
  hostile: "border-dw-red/50 text-dw-red",
  gotcha: "border-dw-yellow/50 text-dw-yellow",
};

function Delta({ label, v, invert = false }: { label: string; v: number; invert?: boolean }) {
  if (!v) return null;
  const good = invert ? v < 0 : v > 0;
  return (
    <span className={cn("font-sans text-[11px] font-semibold", good ? "text-dw-green" : "text-dw-red")}>
      {label} {v > 0 ? `+${v}` : v}
    </span>
  );
}

export default function PresserOverlay() {
  const { snapshot, delta, settings, generate, dynastyId, year, week, hasApiKey, currentIssueKey } =
    useDynasty();
  const saga = useSaga();

  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [questions, setQuestions] = useState<PCQuestion[]>([]);
  const [record, setRecord] = useState<PresserRecord>({ answers: {} });
  const [generating, setGenerating] = useState(false);
  // Seconds spent waiting on the provider. A silent spinner is why this screen read as
  // "hung" — the request now has a deadline, but the user still needs to see it moving.
  const [waited, setWaited] = useState(0);
  useEffect(() => {
    if (!generating) {
      setWaited(0);
      return;
    }
    const t = setInterval(() => setWaited((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [generating]);
  const [answering, setAnswering] = useState(false);
  const [draft, setDraft] = useState("");
  const [ownWords, setOwnWords] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The SAME key `generate()` writes the questions under — which carries "::pre" before
  // kickoff. Keyed by week alone (as this was), a pregame availability and the post-game
  // presser share one record: give three answers on Tuesday, play the game, reopen, and
  // Tuesday's answers are sitting under Saturday's questions with the room already "seen".
  const weekKey = currentIssueKey;
  const state = weekStateOf(snapshot, delta);
  const isPost = state === "game";
  const isPre = state === "pregame";
  const eligible = isPost || isPre;

  const upcoming = useMemo(() => nextOpponent(snapshot), [snapshot]);
  const result = delta?.userResult ?? null;

  // Decide once per week whether the room takes over. Everything that would make this
  // annoying is a reason not to: no key, the feature is off, it isn't a game week, or this
  // week's podium has already had its moment.
  useEffect(() => {
    let cancelled = false;
    if (checked || !eligible || !hasApiKey || !weekKey) return;
    if (settings.presserTakeover === false) return;
    (async () => {
      const [seen, answers, cachedQs] = await Promise.all([
        readTab<{ seen: boolean }>(weekKey, SEEN_TAB),
        readTab<PresserRecord>(weekKey, ANSWERS_TAB),
        readTab<PCResult>(weekKey, "press-conference"),
      ]);
      if (cancelled) return;
      setChecked(true);
      if (seen?.data?.seen) return;
      // Already worked this week's room on the dedicated page? Then it isn't news.
      if (answers?.data?.answers && Object.keys(answers.data.answers).length > 0) return;
      if (answers?.data) setRecord(answers.data);
      if (Array.isArray(cachedQs?.data?.questions)) setQuestions(cachedQs.data.questions);
      setOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [checked, eligible, hasApiKey, settings.presserTakeover, weekKey]);

  // Re-arm when the week turns.
  useEffect(() => {
    setChecked(false);
    setQuestions([]);
    setRecord({ answers: {} });
    setOwnWords(false);
    setDraft("");
  }, [weekKey]);

  const markSeen = useCallback(async () => {
    if (!weekKey) return;
    await writeTab(
      weekKey,
      SEEN_TAB,
      { status: "ready", data: { seen: true }, error: null, generatedAt: Date.now() },
      { dynastyId, year, week }
    );
  }, [weekKey, dynastyId, year, week]);

  const close = useCallback(() => {
    setOpen(false);
    void markSeen();
  }, [markSeen]);

  // Esc always gets you out of the room.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll while the room is up.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, close]);

  const persistRecord = useCallback(
    async (next: PresserRecord) => {
      setRecord(next);
      if (!weekKey) return;
      await writeTab(
        weekKey,
        ANSWERS_TAB,
        { status: "ready", data: next, error: null, generatedAt: Date.now() },
        { dynastyId, year, week }
      );
    },
    [weekKey, dynastyId, year, week]
  );

  const fillTheRoom = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const data = await generate<PCResult>("press-conference", {});
      if (data?.error || !Array.isArray(data?.questions) || data.questions.length === 0) {
        setError("Nobody showed up. Try again.");
      } else {
        setQuestions(data.questions);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the room.");
    } finally {
      setGenerating(false);
    }
  }, [generate]);

  const qi = useMemo(() => {
    for (let i = 0; i < questions.length; i++) if (!record.answers[i]) return i;
    return -1;
  }, [questions, record.answers]);
  const done = questions.length > 0 && qi === -1;
  const current = qi >= 0 ? questions[qi] : null;
  const lastAnswer = qi > 0 ? record.answers[qi - 1] : done ? record.answers[questions.length - 1] : undefined;

  const answerScripted = useCallback(
    async (a: PCAnswer) => {
      if (qi < 0 || answering) return;
      setAnswering(true);
      try {
        await saga.adjustMeters({ mediaHeat: a.mediaDelta, fanTrust: a.fanDelta, lockerRoom: a.lockerDelta });
        await persistRecord({
          ...record,
          answers: {
            ...record.answers,
            [qi]: { label: a.label, text: a.text, custom: false, mediaDelta: a.mediaDelta, fanDelta: a.fanDelta, lockerDelta: a.lockerDelta },
          },
        });
      } finally {
        setAnswering(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qi, answering, record, persistRecord]
  );

  const answerOwnWords = useCallback(async () => {
    const text = draft.trim();
    if (!text || qi < 0 || answering || !current) return;
    setAnswering(true);
    setDraft("");
    setOwnWords(false);
    try {
      const res = await generate<{ reaction: string; headline: string; mediaDelta: number; fanDelta: number; lockerDelta: number; error?: boolean }>(
        "podium-answer",
        {
          question: { reporterName: current.reporterName, outlet: current.outlet, question: current.question, tone: current.tone },
          answer: text,
        },
        { force: true }
      );
      const rec: AnswerRec = res?.error
        ? { label: "In his own words", text, custom: true, mediaDelta: 0, fanDelta: 0, lockerDelta: 0 }
        : {
            label: "In his own words",
            text,
            custom: true,
            reaction: res.reaction,
            headline: res.headline,
            mediaDelta: res.mediaDelta,
            fanDelta: res.fanDelta,
            lockerDelta: res.lockerDelta,
          };
      await saga.adjustMeters({ mediaHeat: rec.mediaDelta, fanTrust: rec.fanDelta, lockerRoom: rec.lockerDelta });
      await persistRecord({ ...record, answers: { ...record.answers, [qi]: rec } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The room didn't hear you.");
    } finally {
      setAnswering(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, qi, answering, current, record, generate, persistRecord]);

  if (!open || !eligible) return null;

  const scoreline = result
    ? `${result.winner === snapshot?.userTeam?.name ? "W" : "L"} ${Math.max(result.homeScore ?? 0, result.awayScore ?? 0)}–${Math.min(result.homeScore ?? 0, result.awayScore ?? 0)} vs ${result.winner === snapshot?.userTeam?.name ? result.loser : result.winner}`
    : upcoming
      ? `${upcoming.userIsHome ? "vs" : "at"} ${upcoming.opp.rankMedia ? `#${upcoming.opp.rankMedia} ` : ""}${upcoming.opp.name} (${upcoming.opp.wins}-${upcoming.opp.losses})`
      : "";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 backdrop-blur-sm px-4 py-6">
      <div className="relative flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded border border-dw-border bg-paper shadow-2xl">
        {/* Podium header — the takeover moment */}
        <div className="shrink-0 border-b border-dw-border bg-paper2 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-dw-crimson">
                {isPost ? "Post-Game" : "Pregame"} · Week {week}
              </p>
              <h2 className="mt-1 font-headline text-3xl uppercase leading-none tracking-wide text-ink sm:text-4xl">
                Press Conference
              </h2>
              {scoreline && <p className="mt-1.5 font-serif text-sm text-ink2">{scoreline}</p>}
            </div>
            {/* The only way out of a full-screen takeover, previously ink3-on-paper2 with a
                border a shade off its own background. It has to look like a way out. */}
            <button
              type="button"
              onClick={close}
              className={cn(
                "shrink-0 rounded border border-paper4 bg-paper3 px-3 py-1.5",
                "font-sans text-[10px] uppercase tracking-wider text-ink2 transition-colors",
                "hover:border-ink3 hover:bg-paper4 hover:text-ink",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-accent2"
              )}
            >
              Skip · Esc
            </button>
          </div>
          {questions.length > 0 && (
            <div className="mt-3 flex items-center gap-1.5">
              {questions.map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors",
                    record.answers[i] ? "bg-dw-crimson" : i === qi ? "bg-dw-accent2" : "bg-paper4"
                  )}
                />
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {/* Nobody in the room yet */}
          {questions.length === 0 && (
            <div className="py-8 text-center">
              <p className="font-serif text-lg leading-relaxed text-ink2">
                {isPost
                  ? "The reporters are outside the door. They watched the same game you did."
                  : "The room is filling for your weekly availability. They want to know the plan."}
              </p>
              {error && <p className="mt-3 font-serif text-sm text-dw-red">{error}</p>}
              <button
                type="button"
                onClick={() => void fillTheRoom()}
                disabled={generating}
                className="mt-6 rounded border border-dw-crimson bg-dw-crimson px-6 py-3 font-sans text-sm uppercase tracking-wider text-paper hover:opacity-90 disabled:opacity-50"
              >
                {generating ? `They're filing in… ${waited}s` : "Step to the podium"}
              </button>
              <p className="mt-3 font-sans text-[10px] uppercase tracking-wider text-ink3">
                {generating && waited >= 30
                  ? "Still waiting on the provider. It gives up on its own if nothing comes back."
                  : "Or skip — you can always take the podium from the Press Conference tab."}
              </p>
            </div>
          )}

          {/* The reaction to what you just said, then the next man up */}
          {lastAnswer && (current || done) && (
            <div className="mb-6 rounded border border-dw-border bg-paper2 px-4 py-3">
              <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">You said</p>
              <p className="mt-1 font-serif text-sm italic leading-snug text-ink2">&ldquo;{lastAnswer.text}&rdquo;</p>
              {lastAnswer.reaction && <p className="mt-1.5 font-serif text-sm text-ink2">{lastAnswer.reaction}</p>}
              {lastAnswer.headline && (
                <p className="mt-1.5 font-headline text-sm uppercase tracking-wide text-dw-accent2">
                  &ldquo;{lastAnswer.headline}&rdquo;
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-3">
                <Delta label="Media" v={lastAnswer.mediaDelta} invert />
                <Delta label="Fans" v={lastAnswer.fanDelta} />
                <Delta label="Room" v={lastAnswer.lockerDelta} />
              </div>
            </div>
          )}

          {/* One reporter, up close */}
          {current && (
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded border px-2 py-0.5 font-sans text-[10px] uppercase tracking-wider", TONE_STYLE[current.tone])}>
                  {current.tone}
                </span>
                <span className="font-sans text-[11px] uppercase tracking-wider text-ink">
                  {current.reporterName}
                </span>
                <span className="font-sans text-[11px] text-ink3">{current.outlet}</span>
                <span className="ml-auto font-sans text-[10px] uppercase tracking-wider text-ink3">
                  {qi + 1} of {questions.length}
                </span>
              </div>

              <p className="mt-4 font-serif text-2xl leading-snug text-ink sm:text-[27px]">
                &ldquo;{current.question}&rdquo;
              </p>

              <div className="mt-6 space-y-2">
                {/* THESE ARE THE ONLY CONTROLS ON A FULL-SCREEN TAKEOVER, and they used to
                    be invisible: border #3a3835 on fill #252320 is 1.34:1, and that fill on
                    the card behind it is 1.11:1 — so an option read as text lying on a flat
                    panel, with nothing to say it could be clicked. The left rule is the fix
                    and it's the house's own vocabulary (column rules, rule diamonds): a
                    burnt-orange edge at 5.4:1, going crimson under the cursor. */}
                {!ownWords &&
                  (current.answers ?? []).map((a, i) => (
                    <button
                      key={i}
                      type="button"
                      disabled={answering}
                      onClick={() => void answerScripted(a)}
                      className={cn(
                        "group w-full rounded border border-paper4 border-l-[3px] border-l-dw-accent2 bg-paper3",
                        "px-4 py-3 text-left transition-colors",
                        "hover:border-l-dw-crimson hover:bg-paper4 hover:border-dw-crimson/50",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-accent2",
                        "disabled:opacity-40"
                      )}
                    >
                      <span className="font-sans text-[11px] uppercase tracking-wider text-dw-accent2">{a.label}</span>
                      <p className="mt-1 font-serif text-[15px] leading-snug text-ink">&ldquo;{a.text}&rdquo;</p>
                    </button>
                  ))}

                {ownWords ? (
                  <div className="rounded border border-dw-accent2/50 bg-paper2 px-4 py-3">
                    <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Say it yourself</p>
                    <textarea
                      autoFocus
                      rows={3}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Step to the mic…"
                      className="mt-2 w-full resize-none rounded border border-dw-border bg-paper px-3 py-2 font-serif text-[15px] text-ink outline-none focus:border-dw-crimson"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={answering || !draft.trim()}
                        onClick={() => void answerOwnWords()}
                        className="rounded border border-dw-crimson bg-dw-crimson px-4 py-2 font-sans text-[11px] uppercase tracking-wider text-paper disabled:opacity-40"
                      >
                        {answering ? "The room reacts…" : "Answer"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOwnWords(false)}
                        className="rounded border border-paper4 bg-paper3 px-4 py-2 font-sans text-[11px] uppercase tracking-wider text-ink2 transition-colors hover:border-ink3 hover:text-ink"
                      >
                        Back
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={answering}
                    onClick={() => setOwnWords(true)}
                    className={cn(
                      "w-full rounded border border-dashed border-ink3/70 bg-paper2 px-4 py-2.5 text-left",
                      "font-sans text-[11px] uppercase tracking-wider text-ink2 transition-colors",
                      "hover:border-dw-accent2 hover:text-ink",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-accent2",
                      "disabled:opacity-40"
                    )}
                  >
                    In your own words…
                  </button>
                )}
              </div>
              {error && <p className="mt-3 font-serif text-sm text-dw-red">{error}</p>}
            </div>
          )}

          {/* Room's empty */}
          {done && (
            <div className="py-4 text-center">
              <p className="font-headline text-2xl uppercase tracking-wide text-ink">That&apos;s all the time we have</p>
              <p className="mt-2 font-serif text-ink2">
                The room files out. Your answers are on the record — the Press Conference tab has the full
                transcript and the media&apos;s grade.
              </p>
              <button
                type="button"
                onClick={close}
                className="mt-6 rounded border border-dw-crimson bg-dw-crimson px-6 py-3 font-sans text-sm uppercase tracking-wider text-paper hover:opacity-90"
              >
                Leave the podium
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
