"use client";

// Standalone press conference: generate the reporters' questions from the real week
// (ingest/gen/press-conference.js), grounded in the actual game. The old interactive
// respond/grade loop was server-bound and is deferred; this renders the media's questions.

import { useCallback, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/utils";

interface PCQuestion {
  reporterName: string;
  outlet: string;
  question: string;
  tone: "friendly" | "neutral" | "hostile" | "gotcha";
}
interface PCResult {
  questions: PCQuestion[];
  error?: boolean;
}

const TONE_STYLE: Record<PCQuestion["tone"], string> = {
  friendly: "text-dw-green border-dw-green/40",
  neutral: "text-ink3 border-dw-border",
  hostile: "text-dw-red border-dw-red/40",
  gotcha: "text-dw-yellow border-dw-yellow/40",
};

export default function PressConferencePage() {
  const { needsOnboarding, generate } = useDynasty();
  const [questions, setQuestions] = useState<PCQuestion[]>([]);
  const [generating, setGenerating] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
      <SectionHeader title="PRESS CONFERENCE" subtitle="Step to the podium" variant="press-conference" />

      {needsOnboarding ? (
        <div className="mt-6 rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
          <p className="font-serif text-ink2">Point Dynasty Wire at your save and add your API key in settings — then the media will have questions.</p>
        </div>
      ) : (
        <>
          <div className="mt-4 mb-6">
            <button
              type="button"
              onClick={() => void run()}
              disabled={generating}
              className="rounded border border-dw-accent bg-dw-accent px-5 py-2.5 font-sans text-xs uppercase tracking-wider text-paper hover:bg-dw-accent2 disabled:opacity-50"
            >
              {generating ? "Reporters filing in…" : questions.length ? "New Questions" : "Face the Media"}
            </button>
          </div>

          {error && !generating && (
            <div className="rounded border border-dw-red/30 bg-dw-red/10 px-6 py-8 text-center font-serif text-dw-red">{error}</div>
          )}
          {!generating && !error && questions.length === 0 && tried && (
            <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center font-serif text-ink2">No questions yet — try again.</div>
          )}
          {!generating && !error && questions.length === 0 && !tried && (
            <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center font-serif text-ink2">The podium is set. Face the media to hear what reporters are asking after your latest game.</div>
          )}

          <div className="space-y-4">
            {questions.map((q, i) => (
              <div key={i} className="rounded border border-dw-border bg-paper2 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-sans text-xs text-ink3">
                    {q.reporterName}{q.outlet ? ` · ${q.outlet}` : ""}
                  </span>
                  <span className={cn("rounded border px-2 py-0.5 text-[10px] font-sans uppercase tracking-wider", TONE_STYLE[q.tone])}>
                    {q.tone}
                  </span>
                </div>
                <p className="mt-2 font-serif text-ink leading-relaxed">{q.question}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
