"use client";

import { cn } from "@/lib/utils";
import type { ShowType, ShowTranscript } from "@/lib/shows/types";

const TYPE_BADGE_COLORS: Record<ShowType, string> = {
  gameday: "bg-dw-accent/10 text-dw-accent border-dw-accent/20",
  rankings: "bg-dw-yellow/10 text-dw-yellow border-dw-yellow/20",
  portal: "bg-dw-accent2/10 text-dw-accent2 border-dw-accent2/20",
  draft: "bg-dw-green/10 text-dw-green border-dw-green/20",
  hotseat: "bg-dw-red/10 text-dw-red border-dw-red/20",
  podcast: "bg-dw-accent2/10 text-dw-accent2 border-dw-accent2/20",
};

interface ArchivedShow {
  week: number;
  showType: ShowType;
  transcript: ShowTranscript;
}

interface ShowArchiveProps {
  shows: ArchivedShow[];
  onSelect: (transcript: ShowTranscript) => void;
}

export function ShowArchive({ shows, onSelect }: ShowArchiveProps) {
  if (shows.length === 0) {
    return (
      <div className="rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
        <p className="font-serif text-ink2">
          No archived shows yet. Generate your first broadcast to start building
          the archive.
        </p>
      </div>
    );
  }

  const weekGroups = new Map<number, ArchivedShow[]>();
  for (const show of shows) {
    const existing = weekGroups.get(show.week);
    if (existing) {
      existing.push(show);
    } else {
      weekGroups.set(show.week, [show]);
    }
  }

  const sortedWeeks = Array.from(weekGroups.keys()).sort((a, b) => b - a);

  return (
    <div className="space-y-6">
      {sortedWeeks.map((week) => {
        const weekShows = weekGroups.get(week)!;
        return (
          <div key={week}>
            <h3 className="mb-3 font-headline text-sm uppercase tracking-wider text-ink3">
              Week {week}
            </h3>
            <div className="space-y-2">
              {weekShows.map((show, i) => (
                <button
                  key={`${show.showType}-${i}`}
                  type="button"
                  onClick={() => onSelect(show.transcript)}
                  className="flex w-full items-center justify-between rounded border border-dw-border bg-paper2 px-4 py-3 text-left transition-all hover:border-dw-accent hover:bg-paper3"
                >
                  <span className="font-serif text-sm text-ink">
                    {show.transcript.title}
                  </span>
                  <span
                    className={cn(
                      "rounded border px-2 py-0.5 font-sans text-xs",
                      TYPE_BADGE_COLORS[show.showType]
                    )}
                  >
                    {show.showType}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
