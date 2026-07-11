"use client";

import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import type { DynastyRetrospective as DynastyRetrospectiveType } from "@/lib/trophy/types";

interface DynastyRetrospectiveProps {
  retrospective: DynastyRetrospectiveType;
  className?: string;
}

export function DynastyRetrospective({
  retrospective,
  className,
}: DynastyRetrospectiveProps) {
  return (
    <article
      className={cn(
        "rounded border border-dw-border bg-paper2 p-6 sm:p-8",
        className
      )}
    >
      {/* Headline */}
      <header className="mb-6 border-b border-dw-border pb-6 text-center">
        <p className="mb-2 font-sans text-[10px] uppercase tracking-[0.2em] text-ink3">
          A DynastyWire Longform Feature
        </p>
        <h2 className="font-headline text-2xl leading-tight text-ink sm:text-3xl lg:text-4xl">
          {retrospective.headline}
        </h2>
        <div className="mx-auto mt-4 h-px w-16 bg-dw-accent" />
      </header>

      {/* Introduction */}
      <div className="mb-8">
        <div className="font-serif text-base leading-relaxed text-ink2 sm:columns-2 sm:gap-8">
          <p>
            <span className="float-left mr-1.5 mt-1 font-headline text-5xl leading-none text-ink">
              {retrospective.body[0]}
            </span>
            {retrospective.body.slice(1)}
          </p>
        </div>
      </div>

      {/* Chapters */}
      <div className="space-y-8">
        {retrospective.chapters.map((chapter, idx) => (
          <motion.section
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: 0.2 + idx * 0.15,
              ease: "easeOut",
            }}
            className="border-t border-dw-border pt-6"
          >
            <div className="mb-3 flex items-baseline gap-3">
              {chapter.year > 0 && (
                <span className="font-headline text-3xl text-ink3">
                  {chapter.year}
                </span>
              )}
              <h3 className="font-headline text-lg text-ink">
                {chapter.title}
              </h3>
            </div>
            <div className="font-serif text-sm leading-relaxed text-ink2 sm:columns-2 sm:gap-8">
              <p>{chapter.body}</p>
            </div>
          </motion.section>
        ))}
      </div>

      {/* Footer flourish */}
      <div className="mt-8 border-t border-dw-border pt-6 text-center">
        <div className="mx-auto mb-2 flex items-center justify-center gap-2">
          <div className="h-px w-8 bg-dw-border" />
          <span className="font-sans text-[10px] uppercase tracking-[0.3em] text-ink3">
            End
          </span>
          <div className="h-px w-8 bg-dw-border" />
        </div>
      </div>
    </article>
  );
}
