"use client";

// The Weekly Issue loading moment (design Q3): the first open of a new in-game week,
// while the background pass writes the issue. Full-bleed editorial overlay until the
// lead story lands, then it steps aside and the rest fills in behind it.

import { useDynasty } from "./dynasty-context";
import { eagerTabs } from "@/lib/dynasty/issue";

function TabRow({ label, status }: { label: string; status?: string }) {
  const ready = status === "ready";
  const failed = status === "error";
  const active = status === "generating";
  return (
    <div className="flex items-center justify-between gap-4 border-b border-dw-border/60 py-1.5 last:border-0">
      <span
        className={`font-serif text-xs ${
          ready ? "text-ink" : failed ? "text-dw-red/80" : "text-ink3"
        }`}
      >
        {label}
      </span>
      <span className="font-sans text-[9px] uppercase tracking-wider">
        {ready ? (
          <span className="text-dw-green font-semibold">Filed ✓</span>
        ) : failed ? (
          <span className="text-dw-red/80">Held</span>
        ) : active ? (
          <span className="inline-flex items-center gap-1 text-ink3">
            <span className="h-1 w-1 animate-pulse rounded-full bg-dw-crimson" />
            Writing
          </span>
        ) : (
          <span className="text-ink3/40">Queued</span>
        )}
      </span>
    </div>
  );
}

export default function IssueLoadingOverlay() {
  const { issue, issueStatus, snapshot, settings } = useDynasty();

  if (issueStatus !== "generating") return null;

  // Show only the sections this user auto-writes — listing unchecked sections as
  // forever-"Queued" would read like something is stuck.
  const tabs = eagerTabs(settings);

  const week = snapshot?.week ?? null;

  return (
    <div className="fixed bottom-6 right-6 z-40 w-80 bg-paper/90 border border-dw-border shadow-2xl rounded p-4 backdrop-blur-sm transition-all duration-300">
      <div className="space-y-3">
        <div className="text-left">
          <p className="font-sans text-[8px] uppercase tracking-[0.2em] text-dw-crimson">
            {week != null ? `Week ${week} Edition` : "This Week's Edition"}
          </p>
          <h2 className="mt-1 font-headline text-sm leading-tight text-ink">
            Filing stories...
          </h2>
          <p className="mt-1 font-serif text-[10px] text-ink3 leading-relaxed">
            Dynasty Wire is writing this week&apos;s issue in the background. You can browse the app while it files!
          </p>
        </div>

        <div className="rounded border border-dw-border bg-paper2/50 px-3 py-1.5 max-h-48 overflow-y-auto">
          {tabs.map((t) => (
            <TabRow key={t.kind} label={t.label} status={issue?.tabs[t.kind]?.status} />
          ))}
        </div>
      </div>
    </div>
  );
}
