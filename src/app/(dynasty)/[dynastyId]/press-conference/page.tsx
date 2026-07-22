"use client";

// The Podium — a full interactive post-game press conference. Reporters come one at a
// time; the coach answers by picking a posture OR speaking in his own words. Every answer
// moves the saga meters (media heat / fan trust / locker room), so what you say up there
// actually matters. When the room empties, the media grades your performance. Answers and
// the grade persist per week (issue store), so the transcript survives navigation/restarts.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useIssueTab } from "@/components/dynasty/use-issue-tab";
import { useSaga } from "@/components/dynasty/use-saga";
import { SectionHeader } from "@/components/ui/section-header";
import { issueKey, readTab, writeTab } from "@/lib/dynasty/issue-cache";
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
  /** Present in the interactive schema; absent on old cached pressers. */
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
interface Grade {
  overall: string;
  composure: number;
  authenticity: number;
  deflectionSkill: number;
  headlineManagement: number;
  summary: string;
  bestMoment: string;
  worstMoment: string;
  error?: boolean;
}
interface PresserRecord {
  answers: Record<number, AnswerRec>;
  grade?: Grade | null;
}

const ANSWERS_TAB = "presser-answers"; // per-week persistence key in the issue store

const TONE_STYLE: Record<PCQuestion["tone"], string> = {
  friendly: "text-dw-green border-dw-green/40",
  neutral: "text-ink3 border-dw-border",
  hostile: "text-dw-red border-dw-red/40",
  gotcha: "text-dw-yellow border-dw-yellow/40",
};

function deltaChip(label: string, v: number, invert = false) {
  if (!v) return null;
  const good = invert ? v < 0 : v > 0;
  return (
    <span className={cn("rounded px-1.5 py-0.5 font-sans text-[10px] font-semibold", good ? "text-dw-green" : "text-dw-red")}>
      {label} {v > 0 ? `+${v}` : v}
    </span>
  );
}

function DeltaRow({ rec }: { rec: AnswerRec }) {
  return (
    <span className="flex flex-wrap gap-1">
      {deltaChip("Media", rec.mediaDelta, true)}
      {deltaChip("Fans", rec.fanDelta)}
      {deltaChip("Room", rec.lockerDelta)}
    </span>
  );
}

export default function PressConferencePage() {
  const { needsOnboarding, generate, dynastyId, year, week } = useDynasty();
  const saga = useSaga();

  const [questions, setQuestions] = useState<PCQuestion[]>([]);
  const [record, setRecord] = useState<PresserRecord>({ answers: {} });
  const [generating, setGenerating] = useState(false);
  const [tried, setTried] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [grading, setGrading] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const weekKey = issueKey(dynastyId, year, week);

  // Restore this week's presser from the persisted issue cache on mount.
  const cached = useIssueTab<PCResult>("press-conference");
  useEffect(() => {
    if (questions.length === 0 && !tried && Array.isArray(cached?.questions) && cached.questions.length > 0) {
      setQuestions(cached.questions);
      setTried(true);
    }
  }, [cached, questions.length, tried]);

  // Restore answers + grade (per week).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rec = await readTab<PresserRecord>(weekKey, ANSWERS_TAB);
      if (!cancelled && rec?.data) setRecord(rec.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [weekKey]);

  const persistRecord = useCallback(
    async (next: PresserRecord) => {
      setRecord(next);
      await writeTab(
        weekKey,
        ANSWERS_TAB,
        { status: "ready", data: next, error: null, generatedAt: Date.now() },
        { dynastyId, year, week }
      );
    },
    [weekKey, dynastyId, year, week]
  );

  const run = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const data = await generate<PCResult>("press-conference", {});
      if (data?.error || !Array.isArray(data?.questions) || data.questions.length === 0) {
        setError("The media room didn't fill up. Try again.");
        setQuestions([]);
      } else {
        setQuestions(data.questions);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the generator. Check your save + API key.");
    } finally {
      setGenerating(false);
      setTried(true);
    }
  }, [generate]);

  const currentIndex = useMemo(() => {
    for (let i = 0; i < questions.length; i++) if (!record.answers[i]) return i;
    return -1; // all answered
  }, [questions, record.answers]);
  const done = questions.length > 0 && currentIndex === -1;

  // When the room empties, have the media grade the performance (once).
  useEffect(() => {
    if (!done || record.grade || grading) return;
    setGrading(true);
    (async () => {
      try {
        const exchanges = questions.map((q, i) => {
          const a = record.answers[i];
          return {
            question: { reporterName: q.reporterName, outlet: q.outlet, question: q.question, tone: q.tone },
            selectedTone: a?.label ?? "unanswered",
            responseMode: a?.custom ? "own words" : "choice",
            userAnswer: a?.text ?? "",
          };
        });
        const grade = await generate<Grade>("press-conference-grade", { exchanges }, { force: true });
        if (grade && !grade.error) await persistRecord({ ...record, grade });
      } catch {
        /* grade is a bonus — never block the podium on it */
      } finally {
        setGrading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, record.grade]);

  const answerScripted = useCallback(
    async (qi: number, a: PCAnswer) => {
      if (record.answers[qi] || answering) return;
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
    [record, answering, saga, persistRecord]
  );

  const answerCustom = useCallback(
    async (qi: number) => {
      const text = draft.trim();
      if (!text || record.answers[qi] || answering) return;
      setAnswering(true);
      setDraft("");
      try {
        const q = questions[qi];
        const res = await generate<{ reaction: string; headline: string; mediaDelta: number; fanDelta: number; lockerDelta: number; error?: boolean }>(
          "podium-answer",
          { question: { reporterName: q.reporterName, outlet: q.outlet, question: q.question, tone: q.tone }, answer: text },
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
        setError(e instanceof Error ? e.message : "The room didn't hear you — try again.");
      } finally {
        setAnswering(false);
      }
    },
    [draft, record, answering, questions, generate, saga, persistRecord]
  );

  const answeredCount = Object.keys(record.answers).length;

  return (
    <div>
      <SectionHeader title="PRESS CONFERENCE" subtitle="Step to the podium — your answers matter" variant="press-conference" />

      {needsOnboarding ? (
        <div className="mt-6 rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
          <p className="font-serif text-ink2">Point Dynasty Wire at your save and add your API key in settings — then the media will have questions.</p>
        </div>
      ) : (
        <>
          {questions.length === 0 && (
            <div className="mt-4 mb-6">
              <button
                type="button"
                onClick={() => void run()}
                disabled={generating}
                className="rounded border border-dw-accent bg-dw-accent px-5 py-2.5 font-sans text-xs uppercase tracking-wider text-paper hover:bg-dw-accent2 disabled:opacity-50"
              >
                {generating ? "Reporters filing in…" : "Step to the Podium"}
              </button>
            </div>
          )}

          {error && !generating && (
            <div className="mb-4 rounded border border-dw-red/30 bg-dw-red/10 px-6 py-4 text-center font-serif text-sm text-dw-red">{error}</div>
          )}
          {!generating && !error && questions.length === 0 && !tried && (
            <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center font-serif text-ink2">
              The podium is set. The room is full. Every answer you give moves the media, the fans, and your locker room.
            </div>
          )}

          {questions.length > 0 && (
            <div className="space-y-4">
              {/* Progress line */}
              <div className="flex items-center justify-between">
                <span className="font-sans text-[10px] uppercase tracking-widest text-ink3">
                  {done ? "Room cleared" : `Question ${answeredCount + 1} of ${questions.length}`}
                </span>
                {!done && (
                  <span className="font-sans text-[10px] uppercase tracking-wider text-ink3">
                    {questions.length - answeredCount - 1} more hands up
                  </span>
                )}
              </div>

              {/* Transcript of answered exchanges */}
              {questions.map((q, i) => {
                const rec = record.answers[i];
                if (!rec) return null;
                return (
                  <div key={i} className="rounded border border-dw-border bg-paper2 p-4 opacity-90">
                    <div className="flex items-center justify-between">
                      <span className="font-sans text-xs text-ink3">{q.reporterName}{q.outlet ? ` · ${q.outlet}` : ""}</span>
                      <span className={cn("rounded border px-2 py-0.5 text-[10px] font-sans uppercase tracking-wider", TONE_STYLE[q.tone])}>{q.tone}</span>
                    </div>
                    <p className="mt-2 font-serif text-sm text-ink2 leading-snug">&ldquo;{q.question}&rdquo;</p>
                    <div className="mt-3 border-l-2 border-dw-accent/50 pl-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-sans text-[10px] uppercase tracking-wider text-dw-accent">{rec.label}</span>
                        <DeltaRow rec={rec} />
                      </div>
                      <p className="mt-1 font-serif text-ink leading-snug">&ldquo;{rec.text}&rdquo;</p>
                      {rec.reaction && <p className="mt-1.5 font-serif text-xs italic text-ink3">{rec.reaction}</p>}
                      {rec.headline && (
                        <p className="mt-1 font-sans text-[10px] uppercase tracking-wider text-ink3">
                          Tomorrow&apos;s headline: <span className="text-ink2">{rec.headline}</span>
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* The live question */}
              {!done && currentIndex >= 0 && (() => {
                const q = questions[currentIndex];
                return (
                  <div className="rounded border border-dw-accent/50 bg-paper2 p-5 shadow-lg">
                    <div className="flex items-center justify-between">
                      <span className="font-sans text-xs text-ink3">{q.reporterName}{q.outlet ? ` · ${q.outlet}` : ""}</span>
                      <span className={cn("rounded border px-2 py-0.5 text-[10px] font-sans uppercase tracking-wider", TONE_STYLE[q.tone])}>{q.tone}</span>
                    </div>
                    <p className="mt-3 font-serif text-lg text-ink leading-relaxed">&ldquo;{q.question}&rdquo;</p>

                    <div className="mt-4 space-y-2">
                      {(q.answers ?? []).map((a, ai) => (
                        <button
                          key={ai}
                          type="button"
                          disabled={answering}
                          onClick={() => void answerScripted(currentIndex, a)}
                          className="w-full rounded border border-dw-border bg-paper px-4 py-3 text-left transition-colors hover:border-dw-accent/60 hover:bg-paper3 disabled:opacity-40"
                        >
                          <span className="font-sans text-[10px] uppercase tracking-wider text-ink3">{a.label}</span>
                          <p className="mt-0.5 font-serif text-sm text-ink leading-snug">&ldquo;{a.text}&rdquo;</p>
                        </button>
                      ))}
                      {(q.answers?.length ?? 0) === 0 && (
                        <p className="font-sans text-[11px] text-ink3">
                          This week&apos;s presser was written before the interactive podium — speak in your own words below, or regenerate for scripted options.
                        </p>
                      )}
                    </div>

                    {/* Speak freely */}
                    <div className="mt-4 border-t border-dw-border pt-3">
                      <p className="mb-2 font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Or say it in your own words</p>
                      <div className="flex gap-2">
                        <input
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") void answerCustom(currentIndex); }}
                          placeholder="Lean into the mic…"
                          className="flex-1 rounded border border-dw-border bg-paper px-3 py-2 font-serif text-sm text-ink placeholder:text-ink3 focus:border-dw-accent2/60 focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={!draft.trim() || answering}
                          onClick={() => void answerCustom(currentIndex)}
                          className="rounded border border-dw-accent2 bg-dw-accent2/20 px-4 py-2 font-sans text-xs uppercase tracking-wider text-dw-accent2 hover:bg-dw-accent2/30 disabled:opacity-40"
                        >
                          Answer
                        </button>
                      </div>
                    </div>
                    {answering && <p className="mt-3 font-sans text-xs uppercase tracking-wider text-dw-accent">The room reacts…</p>}
                  </div>
                );
              })()}

              {/* The grade */}
              {done && (
                <div className="rounded border border-dw-border bg-paper2 p-5">
                  <div className="flex items-center gap-3">
                    <span className="font-sans text-[10px] uppercase tracking-widest text-dw-accent">Media Room Verdict</span>
                    <div className="h-px flex-1 bg-dw-accent/30" />
                  </div>
                  {grading && <p className="mt-4 font-sans text-xs uppercase tracking-wider text-ink3">The press box is filing its grades…</p>}
                  {record.grade && (
                    <div className="mt-4">
                      <div className="flex items-center gap-4">
                        <span className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dw-accent font-headline text-2xl font-bold text-dw-accent">
                          {record.grade.overall}
                        </span>
                        <p className="flex-1 font-serif text-sm text-ink2 leading-relaxed">{record.grade.summary}</p>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {([
                          ["Composure", record.grade.composure],
                          ["Authenticity", record.grade.authenticity],
                          ["Deflection", record.grade.deflectionSkill],
                          ["Headlines", record.grade.headlineManagement],
                        ] as const).map(([label, v]) => (
                          <div key={label} className="rounded border border-dw-border bg-paper px-3 py-2 text-center">
                            <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">{label}</p>
                            <p className={cn("font-headline text-lg font-bold", v >= 75 ? "text-dw-green" : v >= 50 ? "text-dw-yellow" : "text-dw-red")}>{v}</p>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 space-y-1">
                        <p className="font-serif text-xs text-ink3"><span className="font-sans uppercase tracking-wider text-dw-green">Best moment:</span> {record.grade.bestMoment}</p>
                        <p className="font-serif text-xs text-ink3"><span className="font-sans uppercase tracking-wider text-dw-red">Worst moment:</span> {record.grade.worstMoment}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
