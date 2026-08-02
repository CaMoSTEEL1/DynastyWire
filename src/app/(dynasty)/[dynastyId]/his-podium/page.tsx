"use client";

// HIS PODIUM. A nineteen-year-old at a microphone.
//
// The dynasty presser measures media heat, fan trust and the locker room. A player's answers
// pull in three directions that DON'T move together — poise, the room, and how it plays online
// — and the interesting choices are the ones where they conflict: honest and popular but bad
// for the locker room, or coach-speak that keeps him safe and dull. The UI shows all three so
// the trade-off is visible before he answers, not after.

import { useCallback, useEffect, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useIssueTab } from "@/components/dynasty/use-issue-tab";
import { SectionHeader } from "@/components/ui/section-header";
import { useBrand } from "@/components/rtg/use-brand";
import { cn } from "@/lib/utils";

interface Answer {
  label: string;
  text: string;
  poise?: number;
  roomDelta?: number;
  brandDelta?: number;
}
interface Question {
  reporterName: string;
  outlet: string;
  question: string;
  tone: "friendly" | "neutral" | "hostile" | "gotcha";
  answers?: Answer[];
}
interface Presser { questions: Question[]; error?: boolean }

const TONE: Record<Question["tone"], string> = {
  friendly: "border-dw-green/40 text-dw-green",
  neutral: "border-paper4 text-ink3",
  hostile: "border-dw-red/50 text-dw-red",
  gotcha: "border-dw-yellow/50 text-dw-yellow",
};

function Delta({ label, v }: { label: string; v?: number }) {
  if (!v) return null;
  return (
    <span className={cn("font-sans text-[10px] font-semibold", v > 0 ? "text-dw-green" : "text-dw-red")}>
      {label} {v > 0 ? `+${v}` : v}
    </span>
  );
}

export default function HisPodiumPage() {
  const { snapshot, roster, generate, loading } = useDynasty();
  const { baseline } = useBrand();

  const [presser, setPresser] = useState<Presser | null>(null);
  const [answered, setAnswered] = useState<Record<number, Answer>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cached = useIssueTab<Presser>("rtg-podium");
  useEffect(() => {
    if (!presser && cached) setPresser(cached);
  }, [cached, presser]);

  const player = snapshot?.player ?? null;

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await generate<Presser>("rtg-podium", { baselinePlayer: baseline, roster });
      if (data?.error || !data?.questions?.length) setError("Nobody came.");
      else setPresser(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't fill the room.");
    } finally {
      setBusy(false);
    }
  }, [generate, baseline, roster]);

  if (loading) return <p className="p-6 font-serif text-ink3">Reading the save…</p>;
  if (!player) {
    return (
      <div className="p-6">
        <SectionHeader title="His Podium" subtitle="Road to Glory" />
        <p className="font-serif text-ink2">Open a Road to Glory save to use this screen.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
      <SectionHeader title="His Podium" subtitle={`${player.name} · media availability`} />

      {!presser ? (
        <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center">
          <p className="font-serif text-lg text-ink2">
            They want a few minutes with him. He&apos;s done this twice.
          </p>
          {error && <p className="mt-3 font-serif text-sm text-dw-red">{error}</p>}
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="mt-5 rounded border border-dw-crimson bg-dw-crimson px-6 py-2.5 font-sans text-sm uppercase tracking-wider text-paper hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "They're coming in…" : "Take the questions"}
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {presser.questions.map((q, qi) => {
            const chosen = answered[qi];
            return (
              <div key={qi} className="rounded border border-paper4 bg-paper2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-sans text-[11px] uppercase tracking-wider text-ink">
                    {q.reporterName}
                  </span>
                  <span className="font-sans text-[11px] text-ink3">{q.outlet}</span>
                  <span
                    className={cn(
                      "ml-auto rounded border px-2 py-0.5 font-sans text-[9px] uppercase tracking-wider",
                      TONE[q.tone] ?? TONE.neutral
                    )}
                  >
                    {q.tone}
                  </span>
                </div>
                <p className="mt-3 font-serif text-xl leading-snug text-ink">
                  &ldquo;{q.question}&rdquo;
                </p>

                <div className="mt-4 space-y-2">
                  {chosen ? (
                    <div className="rounded border border-dw-accent2/50 bg-paper3 px-4 py-3">
                      <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">
                        {chosen.label}
                      </p>
                      <p className="mt-1 font-serif text-[15px] leading-snug text-ink">
                        &ldquo;{chosen.text}&rdquo;
                      </p>
                      <div className="mt-2 flex flex-wrap gap-3">
                        <Delta label="Poise" v={chosen.poise} />
                        <Delta label="Room" v={chosen.roomDelta} />
                        <Delta label="Online" v={chosen.brandDelta} />
                      </div>
                    </div>
                  ) : (
                    (q.answers ?? []).map((a, ai) => (
                      <button
                        key={ai}
                        type="button"
                        onClick={() => setAnswered((prev) => ({ ...prev, [qi]: a }))}
                        className={cn(
                          "w-full rounded border border-paper4 border-l-[3px] border-l-dw-accent2 bg-paper3",
                          "px-4 py-3 text-left transition-colors",
                          "hover:border-dw-crimson/50 hover:border-l-dw-crimson hover:bg-paper4",
                          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dw-accent2"
                        )}
                      >
                        <span className="font-sans text-[11px] uppercase tracking-wider text-dw-accent2">
                          {a.label}
                        </span>
                        <p className="mt-1 font-serif text-[15px] leading-snug text-ink">
                          &ldquo;{a.text}&rdquo;
                        </p>
                        {/* The trade-off is shown BEFORE he answers. Choosing blind isn't a
                            decision, it's a coin flip. */}
                        <span className="mt-2 flex flex-wrap gap-3">
                          <Delta label="Poise" v={a.poise} />
                          <Delta label="Room" v={a.roomDelta} />
                          <Delta label="Online" v={a.brandDelta} />
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
