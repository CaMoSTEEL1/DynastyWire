"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { BeatTakesContent, RankingsTakeContent, RecruitingNoteContent } from "./types";

interface SecondaryStoriesProps {
  beatTakes: BeatTakesContent | null;
  rankingsTake: RankingsTakeContent | null;
  recruitingNote: RecruitingNoteContent | null;
}

function StorySkeleton() {
  return (
    <div className="space-y-3">
      <div className="skeleton-pulse h-5 w-5/6 rounded-sm" />
      <div className="skeleton-pulse h-5 w-2/3 rounded-sm" />
      <div className="space-y-1.5">
        <div className="skeleton-pulse h-3 w-full rounded-sm" />
        <div className="skeleton-pulse h-3 w-11/12 rounded-sm" />
        <div className="skeleton-pulse h-3 w-3/4 rounded-sm" />
        <div className="skeleton-pulse h-3 w-full rounded-sm" />
        <div className="skeleton-pulse h-3 w-2/3 rounded-sm" />
      </div>
    </div>
  );
}

const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: 0.5, ease: "easeOut" as const },
};

export function SecondaryStories({
  beatTakes,
  rankingsTake,
  recruitingNote,
}: SecondaryStoriesProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-0">
      <div className={cn("px-5 py-2 sm:border-r sm:border-dw-border")}>
        {beatTakes?.headline ? (
          <motion.div {...fadeIn} className="space-y-4">
            <h3 className="font-headline text-lg font-bold text-ink leading-tight">
              {beatTakes.headline}
            </h3>
            {Array.isArray(beatTakes.takes) && beatTakes.takes.length > 0 && (
              <div className="space-y-3">
                {beatTakes.takes.map((take) => (
                  <div key={take.number} className="space-y-1">
                    <p className="font-headline text-sm font-bold text-dw-accent">
                      {take.number}. {take.title}
                    </p>
                    <p className="font-serif text-sm text-ink2 leading-relaxed">
                      {take.body}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        ) : (
          <StorySkeleton />
        )}
      </div>

      <div className={cn("px-5 py-2 sm:border-r sm:border-dw-border")}>
        {rankingsTake?.headline ? (
          <motion.div {...fadeIn} className="space-y-3">
            <h3 className="font-headline text-lg font-bold text-ink leading-tight">
              {rankingsTake.headline}
            </h3>
            {rankingsTake.movement && (
              <p className="font-headline text-sm font-semibold text-dw-accent">
                {rankingsTake.movement}
              </p>
            )}
            {rankingsTake.body && (
              <p className="font-serif text-sm text-ink2 leading-relaxed">
                {rankingsTake.body}
              </p>
            )}
          </motion.div>
        ) : (
          <StorySkeleton />
        )}
      </div>

      <div className="px-5 py-2">
        {recruitingNote?.headline ? (
          <motion.div {...fadeIn} className="space-y-3">
            <h3 className="font-headline text-lg font-bold text-ink leading-tight">
              {recruitingNote.headline}
            </h3>
            {recruitingNote.body && (
              <p className="font-serif text-sm text-ink2 leading-relaxed">
                {recruitingNote.body}
              </p>
            )}
            {Array.isArray(recruitingNote.targets) && recruitingNote.targets.length > 0 && (
              <div className="space-y-1">
                <p className="font-sans text-xs uppercase tracking-wide text-ink3">
                  Names to Watch
                </p>
                <ul className="space-y-0.5">
                  {recruitingNote.targets.map((target) => (
                    <li
                      key={target}
                      className="font-serif text-sm text-ink flex items-center gap-2"
                    >
                      <span className="h-1 w-1 rounded-full bg-dw-accent shrink-0" />
                      {target}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </motion.div>
        ) : (
          <StorySkeleton />
        )}
      </div>
    </div>
  );
}
