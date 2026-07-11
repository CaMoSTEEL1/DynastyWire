"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import type { RecapContent } from "./types";

interface LeadStoryProps {
  recap: RecapContent | null;
}

function LeadStorySkeleton() {
  return (
    <div className="space-y-4">
      <div className="skeleton-pulse h-8 w-3/4 rounded-sm" />
      <div className="skeleton-pulse h-4 w-1/3 rounded-sm" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
        <div className="space-y-2">
          <div className="skeleton-pulse h-4 w-full rounded-sm" />
          <div className="skeleton-pulse h-4 w-11/12 rounded-sm" />
          <div className="skeleton-pulse h-4 w-4/5 rounded-sm" />
          <div className="skeleton-pulse h-4 w-full rounded-sm" />
          <div className="skeleton-pulse h-4 w-3/5 rounded-sm" />
        </div>
        <div className="space-y-2">
          <div className="skeleton-pulse h-4 w-full rounded-sm" />
          <div className="skeleton-pulse h-4 w-11/12 rounded-sm" />
          <div className="skeleton-pulse h-4 w-4/5 rounded-sm" />
          <div className="skeleton-pulse h-4 w-full rounded-sm" />
        </div>
      </div>
    </div>
  );
}

export function LeadStory({ recap }: LeadStoryProps) {
  if (!recap || !recap.body) {
    return <LeadStorySkeleton />;
  }

  const paragraphs = recap.body
    .split(/\n\n|\n/)
    .filter((p) => p.trim().length > 0);

  const firstParagraph = paragraphs[0] ?? "";
  const remainingParagraphs = paragraphs.slice(1);

  const midpoint = Math.ceil(remainingParagraphs.length / 2);
  const leftColumn = remainingParagraphs.slice(0, midpoint);
  const rightColumn = remainingParagraphs.slice(midpoint);

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="space-y-4"
    >
      <h1 className="font-headline text-3xl md:text-4xl font-bold text-ink leading-tight">
        {recap.headline}
      </h1>

      <p className="font-sans text-sm text-ink3">{recap.byline}</p>

      <div className="h-px w-full bg-dw-border" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
        <div className="space-y-4">
          <p
            className={cn(
              "font-serif text-base text-ink leading-relaxed drop-cap"
            )}
          >
            {firstParagraph}
          </p>
          {leftColumn.map((p, i) => (
            <p
              key={`left-${i}`}
              className="font-serif text-base text-ink leading-relaxed"
            >
              {p}
            </p>
          ))}
        </div>

        <div className="space-y-4">
          {rightColumn.map((p, i) => (
            <p
              key={`right-${i}`}
              className="font-serif text-base text-ink leading-relaxed"
            >
              {p}
            </p>
          ))}

          {recap.pullQuote && (
            <blockquote className="border-l-4 border-dw-accent pl-4 py-2 my-4">
              <p className="font-serif italic text-lg text-ink2 leading-relaxed">
                &ldquo;{recap.pullQuote}&rdquo;
              </p>
            </blockquote>
          )}
        </div>
      </div>
    </motion.article>
  );
}
