"use client";

import { cn } from "@/lib/utils";
import type { ShowTranscript, ShowType } from "@/lib/shows/types";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";

const SHOW_ACCENT: Record<ShowType, string> = {
  gameday: "text-dw-accent",
  rankings: "text-dw-yellow",
  portal: "text-dw-accent2",
  draft: "text-dw-green",
  hotseat: "text-dw-red",
};

const SHOW_BORDER_ACCENT: Record<ShowType, string> = {
  gameday: "border-dw-accent/30",
  rankings: "border-dw-yellow/30",
  portal: "border-dw-accent2/30",
  draft: "border-dw-green/30",
  hotseat: "border-dw-red/30",
};

const SPEAKER_COLORS = [
  "text-dw-accent",
  "text-dw-accent2",
  "text-ink",
  "text-ink2",
];

interface TranscriptViewerProps {
  transcript: ShowTranscript;
  onBack: () => void;
  submissionId?: string;
  dynastyId?: string;
}

export function TranscriptViewer({
  transcript,
  onBack,
  submissionId,
  dynastyId,
}: TranscriptViewerProps) {
  const speakerColorMap = new Map<string, string>();
  let colorIndex = 0;

  function getSpeakerColor(speaker: string): string {
    const existing = speakerColorMap.get(speaker);
    if (existing) return existing;
    const color = SPEAKER_COLORS[colorIndex % SPEAKER_COLORS.length];
    speakerColorMap.set(speaker, color);
    colorIndex++;
    return color;
  }

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-6 flex items-center gap-2 font-sans text-sm text-ink2 transition-colors hover:text-dw-accent"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Shows
      </button>

      <div
        className={cn(
          "mb-8 rounded border bg-paper2 p-6",
          SHOW_BORDER_ACCENT[transcript.showType]
        )}
      >
        <h2
          className={cn(
            "font-headline text-xl uppercase tracking-wider",
            SHOW_ACCENT[transcript.showType]
          )}
        >
          {transcript.title}
        </h2>
        <p className="mt-1 font-serif text-sm italic text-ink2">
          {transcript.subtitle} &mdash; Week {transcript.week}
        </p>

        <div className="mt-4 border-t border-dw-border pt-4">
          <p className="mb-2 font-sans text-xs font-medium uppercase tracking-wider text-ink3">
            On Air
          </p>
          <div className="flex flex-wrap gap-4">
            {transcript.personas.map((persona) => (
              <div key={persona.name} className="text-sm">
                <span className={cn("font-medium", getSpeakerColor(persona.name))}>
                  {persona.name}
                </span>
                <span className="text-ink3">
                  {" "}
                  &middot; {persona.role}, {persona.affiliation}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {transcript.dialogue.map((line, i) => {
          const speakerColor = getSpeakerColor(line.speaker);

          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.3 }}
            >
              {line.isStageDirection ? (
                <p className="py-1 font-serif text-sm italic text-ink3">
                  {line.speaker && (
                    <span className={cn("not-italic font-medium", speakerColor)}>
                      {line.speaker}{" "}
                    </span>
                  )}
                  <span className="italic">{line.text}</span>
                </p>
              ) : (
                <div className="rounded bg-paper3/50 px-4 py-3">
                  <p className="text-sm leading-relaxed text-ink">
                    <span className={cn("font-medium", speakerColor)}>
                      {line.speaker}
                    </span>
                    <span className="text-ink3">
                      {" "}
                      ({line.role})
                    </span>
                    <span className="text-ink3"> &mdash; </span>
                    <span className="font-serif">{line.text}</span>
                  </p>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
