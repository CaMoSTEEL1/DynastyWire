"use client";

import { useState, useEffect, useCallback, useRef, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import type { PressConfQuestion, ResponseOption } from "@/lib/ai/press-conference-types";

type ResponseMode = "choice" | "text";

interface QuestionDisplayProps {
  question: PressConfQuestion;
  questionIndex: number;
  totalQuestions: number;
  responseOptions: ResponseOption[] | null;
  isFollowUp: boolean;
  onAnswer: (answer: string, tone: string, mode: ResponseMode) => void;
  onNextQuestion: () => void;
  showNextButton: boolean;
  isSubmitting: boolean;
}

// Variable-speed typewriter — punctuation creates natural speech rhythm
// Pauses after sentence-ending punctuation, accelerates on spaces
function useTypingAnimation(text: string): { displayText: string; isComplete: boolean } {
  const [charIndex, setCharIndex] = useState(0);

  useEffect(() => {
    setCharIndex(0);
  }, [text]);

  useEffect(() => {
    if (charIndex >= text.length) return;

    const prevChar = charIndex > 0 ? text[charIndex - 1] : "";
    const curChar = text[charIndex];
    let delay = 26;

    if (prevChar === "." || prevChar === "?" || prevChar === "!") delay = 340;
    else if (prevChar === ",") delay = 150;
    else if (prevChar === ";" || prevChar === ":") delay = 190;
    else if (prevChar === "—" || prevChar === "–") delay = 220;
    else if (curChar === " ") delay = 12;

    const timer = setTimeout(() => {
      setCharIndex((prev) => prev + 1);
    }, delay);

    return () => clearTimeout(timer);
  }, [charIndex, text]);

  return {
    displayText: text.slice(0, charIndex),
    isComplete: charIndex >= text.length,
  };
}

const TONE_COLORS: Record<string, { border: string; bg: string; label: string; text: string }> = {
  honest: {
    border: "border-dw-green",
    bg: "bg-dw-green/10",
    label: "text-dw-green",
    text: "text-ink2",
  },
  deflect: {
    border: "border-dw-yellow",
    bg: "bg-dw-yellow/10",
    label: "text-dw-yellow",
    text: "text-ink2",
  },
  coachspeak: {
    border: "border-ink3",
    bg: "bg-ink3/10",
    label: "text-ink3",
    text: "text-ink2",
  },
  fiery: {
    border: "border-dw-red",
    bg: "bg-dw-red/10",
    label: "text-dw-red",
    text: "text-ink2",
  },
};

const TONE_LABELS: Record<string, string> = {
  honest: "Honest",
  deflect: "Deflect",
  coachspeak: "Coach-speak",
  fiery: "Fiery",
};

// All CSS keyframes in one injection point
const PRESS_CONF_STYLES = `
/* Spring overshoot entry for response cards */
@keyframes pc-card-spring-in {
  0%   { opacity: 0; transform: translateY(16px) scale(0.94); }
  55%  { opacity: 1; transform: translateY(-6px) scale(1.018); }
  75%  { transform: translateY(2px) scale(0.992); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}

/* Hostile/gotcha reporter glow — crimson pulse */
@keyframes pc-hostile-glow {
  0%, 100% { box-shadow: 0 0 0 1px rgba(181, 32, 42, 0.5); }
  50%       { box-shadow: 0 0 0 1px rgba(181, 32, 42, 1), 0 0 22px rgba(181, 32, 42, 0.3); }
}

/* Friendly reporter glow — green halo */
@keyframes pc-friendly-glow {
  0%, 100% { box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.35); }
  50%       { box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.85), 0 0 16px rgba(34, 197, 94, 0.18); }
}

/* Respect reduced motion — disable all custom animations */
@media (prefers-reduced-motion: reduce) {
  .pc-spring-card {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
  .pc-hostile-box,
  .pc-friendly-box {
    animation: none !important;
    box-shadow: none !important;
  }
}
`;

const MODES = ["choice", "text"] as const;

export default function QuestionDisplay({
  question,
  questionIndex,
  totalQuestions,
  responseOptions,
  isFollowUp,
  onAnswer,
  onNextQuestion,
  showNextButton,
  isSubmitting,
}: QuestionDisplayProps) {
  const [mode, setMode] = useState<ResponseMode>("choice");
  const [textAnswer, setTextAnswer] = useState("");
  const [hasAnswered, setHasAnswered] = useState(false);

  // Sliding tab indicator
  const tabContainerRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null);

  const { displayText, isComplete } = useTypingAnimation(question.question);

  useEffect(() => {
    setHasAnswered(false);
    setTextAnswer("");
    setMode("choice");
  }, [question.question]);

  // Track sliding tab indicator position
  useEffect(() => {
    const container = tabContainerRef.current;
    if (!container) return;
    const modeIndex = MODES.indexOf(mode);
    const tabs = container.querySelectorAll<HTMLElement>("[data-tab]");
    const activeTab = tabs[modeIndex];
    if (activeTab) {
      setIndicatorStyle({ left: activeTab.offsetLeft, width: activeTab.offsetWidth });
    }
  }, [mode]);

  const handleChoiceSelect = useCallback(
    (option: ResponseOption, e: MouseEvent<HTMLButtonElement>) => {
      if (hasAnswered || isSubmitting) return;

      // Physical "delivery" — compress then release before locking in
      e.currentTarget.animate(
        [
          { transform: "scale(1)", offset: 0 },
          { transform: "scale(0.96)", offset: 0.3 },
          { transform: "scale(1.03)", offset: 0.65 },
          { transform: "scale(1)", offset: 1 },
        ],
        { duration: 260, easing: "ease-out" }
      );

      setHasAnswered(true);
      onAnswer(option.text, option.tone, "choice");
    },
    [hasAnswered, isSubmitting, onAnswer]
  );

  const handleTextSubmit = useCallback(() => {
    if (!textAnswer.trim() || hasAnswered || isSubmitting) return;
    setHasAnswered(true);
    onAnswer(textAnswer.trim(), "honest", "text");
  }, [textAnswer, hasAnswered, isSubmitting, onAnswer]);

  // Tone-reactive question box
  const isHostile = question.tone === "hostile" || question.tone === "gotcha";
  const isFriendly = question.tone === "friendly";

  const questionBoxAnimation: React.CSSProperties = isHostile
    ? { animation: "pc-hostile-glow 1.8s ease-in-out infinite" }
    : isFriendly
      ? { animation: "pc-friendly-glow 2.5s ease-in-out infinite" }
      : {};

  const questionToneColor = isHostile
    ? "text-dw-red"
    : isFriendly
      ? "text-dw-green"
      : "text-ink3";

  return (
    <div className="mx-auto max-w-2xl">
      {/* Single style injection for all press conference animations */}
      <style>{PRESS_CONF_STYLES}</style>

      <div className="mb-4 flex items-center justify-between">
        <p className="font-sans text-xs uppercase tracking-widest text-ink3">
          {isFollowUp ? "Follow-up" : `Question ${questionIndex + 1} of ${totalQuestions}`}
        </p>
        <span className={cn("font-sans text-xs uppercase tracking-wider", questionToneColor)}>
          {question.tone}
        </span>
      </div>

      {/* Question box — border and glow react to reporter tone */}
      <div
        className={cn(
          "mb-6 rounded border bg-paper2 p-6",
          isHostile ? "border-dw-accent/60 pc-hostile-box" : isFriendly ? "border-dw-green/40 pc-friendly-box" : "border-dw-border"
        )}
        style={questionBoxAnimation}
      >
        <div className="mb-3 flex items-baseline gap-2">
          <span className="font-headline text-sm uppercase tracking-wide text-ink">
            {question.reporterName}
          </span>
          <span className="font-serif text-xs italic text-ink3">
            {question.outlet}
          </span>
        </div>
        <div className="min-h-[3rem]">
          <p className="font-serif text-base leading-relaxed text-ink2">
            &ldquo;{displayText}
            {!isComplete && <span className="animate-pulse text-dw-accent">|</span>}
            {isComplete && "”"}
          </p>
        </div>
      </div>

      {isComplete && !hasAnswered && (
        <div className="space-y-4">
          {/* Mode tabs — animated sliding indicator */}
          <div
            ref={tabContainerRef}
            className="relative flex gap-1 rounded border border-dw-border bg-paper3 p-1"
          >
            {indicatorStyle && (
              <div
                className="absolute top-1 bottom-1 rounded bg-paper shadow-sm pointer-events-none"
                style={{
                  left: indicatorStyle.left,
                  width: indicatorStyle.width,
                  transition: "left 270ms cubic-bezier(0.34, 1.56, 0.64, 1), width 200ms ease",
                }}
              />
            )}
            {MODES.map((m) => (
              <button
                key={m}
                data-tab={m}
                onClick={() => setMode(m)}
                className={cn(
                  "relative z-10 flex-1 rounded px-3 py-2 font-sans text-xs uppercase tracking-wider transition-colors duration-150",
                  mode === m ? "text-ink" : "text-ink3 hover:text-ink2"
                )}
              >
                {m === "choice" ? "Pick a Response" : "Type Your Answer"}
              </button>
            ))}
          </div>

          {mode === "choice" && responseOptions && (
            <div className="space-y-3">
              {responseOptions.map((option, index) => {
                const colors = TONE_COLORS[option.tone] ?? TONE_COLORS.coachspeak;
                return (
                  <button
                    key={option.id}
                    onClick={(e) => handleChoiceSelect(option, e)}
                    disabled={isSubmitting}
                    className={cn(
                      "pc-spring-card w-full rounded border p-4 text-left",
                      "transition-[box-shadow,transform] duration-150",
                      "hover:shadow-md hover:-translate-y-0.5",
                      colors.border,
                      colors.bg,
                      "disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                    style={{
                      animation: `pc-card-spring-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) ${index * 80}ms both`,
                    }}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className={cn("font-sans text-xs font-semibold uppercase tracking-wider", colors.label)}>
                        {TONE_LABELS[option.tone] ?? option.tone}
                      </span>
                      <span className="font-sans text-xs text-ink3">&mdash; {option.label}</span>
                    </div>
                    <p className={cn("font-serif text-sm leading-relaxed", colors.text)}>
                      &ldquo;{option.text}&rdquo;
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {mode === "choice" && !responseOptions && (
            <div className="rounded border border-dw-border bg-paper3 p-6 text-center">
              <p className="font-serif text-sm text-ink3">
                No response options available. Switch to Type Your Answer mode.
              </p>
            </div>
          )}

          {mode === "text" && (
            <div className="space-y-3">
              <textarea
                value={textAnswer}
                onChange={(e) => setTextAnswer(e.target.value)}
                placeholder="Type your response as the coach..."
                rows={4}
                className={cn(
                  "w-full rounded border border-dw-border bg-paper p-4",
                  "font-serif text-sm text-ink placeholder:text-ink3",
                  "resize-none focus:border-dw-accent focus:outline-none focus:ring-1 focus:ring-dw-accent"
                )}
              />
              <button
                onClick={handleTextSubmit}
                disabled={!textAnswer.trim() || isSubmitting}
                className={cn(
                  "rounded border border-dw-accent bg-dw-accent px-6 py-2",
                  "font-sans text-xs uppercase tracking-wider text-paper",
                  "transition-colors hover:bg-dw-accent2 hover:border-dw-accent2",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                {isSubmitting ? "Submitting..." : "Submit Answer"}
              </button>
            </div>
          )}
        </div>
      )}

      {hasAnswered && showNextButton && (
        <div className="mt-6 flex justify-end">
          <button
            onClick={onNextQuestion}
            className={cn(
              "w-full sm:w-auto rounded border border-dw-accent bg-dw-accent px-6 py-3 sm:py-2",
              "font-sans text-xs uppercase tracking-wider text-paper",
              "transition-colors hover:bg-dw-accent2 hover:border-dw-accent2"
            )}
          >
            Next Question
          </button>
        </div>
      )}

      {isSubmitting && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <div className="h-2 w-2 animate-pulse rounded-full bg-dw-accent" />
          <p className="font-sans text-xs uppercase tracking-wider text-ink3">
            Reporters are reacting...
          </p>
        </div>
      )}
    </div>
  );
}
