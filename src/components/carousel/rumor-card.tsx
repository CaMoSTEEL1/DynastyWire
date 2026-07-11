"use client";

// Display-only coaching-rumor card. The old interactive "resolve" flow hit a server
// route that no longer exists; in the standalone app rumors are generated narrative.

import { cn } from "@/lib/utils";
import type { CoachingRumor } from "@/lib/carousel/types";

interface RumorCardProps {
  rumor: CoachingRumor;
  className?: string;
}

const TYPE_LABELS: Record<CoachingRumor["type"], string> = {
  interview_request: "Interview Request",
  poaching_attempt: "Poaching Attempt",
  forced_departure: "Forced Departure",
  loyalty_test: "Loyalty Test",
};

const TYPE_STYLES: Record<CoachingRumor["type"], string> = {
  interview_request: "bg-dw-accent/20 text-dw-accent border-dw-accent/40",
  poaching_attempt: "bg-dw-yellow/20 text-dw-yellow border-dw-yellow/40",
  forced_departure: "bg-dw-red/20 text-dw-red border-dw-red/40",
  loyalty_test: "bg-dw-green/20 text-dw-green border-dw-green/40",
};

const URGENCY_STYLES: Record<CoachingRumor["urgency"], { label: string; dot: string }> = {
  low: { label: "Low Urgency", dot: "bg-dw-green" },
  medium: { label: "Medium Urgency", dot: "bg-dw-yellow" },
  high: { label: "High Urgency", dot: "bg-dw-red" },
};

export function RumorCard({ rumor, className }: RumorCardProps) {
  const typeStyle = TYPE_STYLES[rumor.type];
  const urgency = URGENCY_STYLES[rumor.urgency];

  return (
    <div className={cn("rounded border border-dw-border bg-paper2 p-4", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded border px-2 py-0.5 text-xs font-sans font-medium uppercase tracking-wider", typeStyle)}>
          {TYPE_LABELS[rumor.type]}
        </span>
        <div className="flex items-center gap-1.5">
          <span className={cn("inline-block h-2 w-2 rounded-full", urgency.dot)} />
          <span className="font-sans text-xs text-ink3">{urgency.label}</span>
        </div>
      </div>

      <div className="mt-3">
        <p className="font-headline text-sm uppercase tracking-wide text-ink">
          {rumor.staffMember.name}{" "}
          <span className="font-sans text-xs normal-case tracking-normal text-ink3">
            ({rumor.staffMember.role})
          </span>
        </p>
        <p className="mt-1 font-sans text-xs text-ink3">
          Suitor: <span className="font-medium text-ink2">{rumor.suitor}</span>
        </p>
      </div>

      <p className="mt-3 font-serif text-sm leading-relaxed text-ink2">{rumor.narrative}</p>
    </div>
  );
}
