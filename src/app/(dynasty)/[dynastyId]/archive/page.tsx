"use client";

// THE ARCHIVE — every week you've generated, kept and re-readable. Nothing here costs
// credits: the weekly issues were already being cached per (dynasty, year, week); this is
// the browser for them, plus a JSON export so your dynasty's coverage is yours to keep.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { SectionHeader } from "@/components/ui/section-header";
import { listIssues, type Issue } from "@/lib/dynasty/issue-cache";
import { ISSUE_TABS } from "@/lib/dynasty/issue";
import { downloadTextFile } from "@/lib/dynasty/archive";
import { FileJson, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = Object.fromEntries(
  ISSUE_TABS.map((t) => [t.kind, t.label])
);
// Tabs written outside the standard issue set still deserve a readable name.
const EXTRA_LABELS: Record<string, string> = {
  "recap-lead": "Front Page",
  trophy: "Retrospective",
  nil: "NIL Market",
  storylines: "Situation Room",
  shows: "Broadcast",
  carousel: "Coaching Carousel",
};

function labelFor(tabKey: string): string {
  const base = tabKey.split("::")[0];
  return LABELS[base] ?? EXTRA_LABELS[base] ?? base.replace(/[-_]/g, " ");
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** Render whatever a generator produced, without pretending to know every schema. */
function TabContent({ data }: { data: unknown }) {
  if (data == null) return <p className="font-serif text-sm text-ink3">Nothing saved for this section.</p>;
  const d = (typeof data === "object" ? data : {}) as Record<string, unknown>;

  const headline = str(d.headline) ?? str(d.title);
  const byline = str(d.byline);
  const body = str(d.body) ?? str(d.narrative) ?? str(d.summary);
  const pull = str(d.pullQuote);

  // Common list shapes across generators (social posts, press questions, wire items…).
  const posts = Array.isArray(d.posts) ? (d.posts as Record<string, unknown>[]) : null;
  const questions = Array.isArray(d.questions) ? (d.questions as Record<string, unknown>[]) : null;
  const items = Array.isArray(d.items) ? (d.items as Record<string, unknown>[]) : null;
  const dialogue = Array.isArray(d.dialogue) ? (d.dialogue as Record<string, unknown>[]) : null;

  const nothingKnown = !headline && !body && !posts && !questions && !items && !dialogue;

  return (
    <div className="space-y-4">
      {headline && <h3 className="font-headline text-xl leading-tight text-ink">{headline}</h3>}
      {byline && <p className="font-sans text-xs text-ink3">{byline}</p>}
      {body && <p className="whitespace-pre-line font-serif leading-relaxed text-ink2">{body}</p>}
      {pull && (
        <p className="border-l-2 border-dw-accent pl-3 font-serif italic text-ink2">&ldquo;{pull}&rdquo;</p>
      )}

      {posts && posts.length > 0 && (
        <div className="space-y-2">
          {posts.map((p, i) => (
            <div key={i} className="rounded border border-dw-border bg-paper2 px-3 py-2">
              <p className="font-sans text-[11px] text-ink3">
                {str(p.displayName) ?? ""} {str(p.handle) ?? ""}
              </p>
              <p className="font-serif text-sm text-ink2">{str(p.body) ?? str(p.text)}</p>
            </div>
          ))}
        </div>
      )}

      {dialogue && dialogue.length > 0 && (
        <div className="space-y-2">
          {dialogue.map((l, i) => (
            <p key={i} className="font-serif text-sm text-ink2">
              <span className="font-sans text-xs uppercase tracking-wider text-dw-accent2">
                {str(l.speaker) ?? "Host"}
              </span>{" "}
              — {str(l.text)}
            </p>
          ))}
        </div>
      )}

      {questions && questions.length > 0 && (
        <div className="space-y-3">
          {questions.map((q, i) => (
            <div key={i} className="rounded border border-dw-border bg-paper2 px-3 py-2">
              <p className="font-sans text-[11px] uppercase tracking-wider text-ink3">
                {str(q.reporter) ?? "Reporter"}{str(q.outlet) ? ` · ${str(q.outlet)}` : ""}
              </p>
              <p className="font-serif text-sm text-ink">{str(q.question)}</p>
            </div>
          ))}
        </div>
      )}

      {items && items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="font-serif text-sm text-ink2">
              <span className="font-sans text-xs uppercase tracking-wider text-ink">
                {str(it.headline) ?? str(it.school) ?? ""}
              </span>
              {str(it.blurb) ? ` — ${str(it.blurb)}` : ""}
            </li>
          ))}
        </ul>
      )}

      {nothingKnown && (
        <pre className="max-h-80 overflow-auto rounded border border-dw-border bg-paper2 p-3 font-sans text-[11px] leading-relaxed text-ink3">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function ArchivePage() {
  const { dynastyId, needsOnboarding } = useDynasty();
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listIssues(dynastyId)
      .then((l) => { if (!cancelled) setIssues(l); })
      .catch(() => { if (!cancelled) setIssues([]); });
    return () => { cancelled = true; };
  }, [dynastyId]);

  const open = useMemo(() => issues?.find((i) => i.key === openKey) ?? null, [issues, openKey]);

  // Only sections that actually have content — a half-written week shouldn't show dead rows.
  const readyTabs = useMemo(() => {
    if (!open) return [];
    return Object.entries(open.tabs)
      .filter(([, t]) => t?.status === "ready" && t.data != null)
      .map(([k]) => k)
      .sort((a, b) => labelFor(a).localeCompare(labelFor(b)));
  }, [open]);

  const exportWeek = useCallback((issue: Issue) => {
    downloadTextFile(
      `dynastywire-${issue.year}-week${issue.week}.json`,
      "application/json",
      JSON.stringify(issue, null, 2)
    );
  }, []);

  const exportAll = useCallback(() => {
    if (!issues?.length) return;
    downloadTextFile(
      `dynastywire-archive-${dynastyId}.json`,
      "application/json",
      JSON.stringify(issues, null, 2)
    );
  }, [issues, dynastyId]);

  if (needsOnboarding) {
    return (
      <div>
        <SectionHeader title="THE ARCHIVE" subtitle="Every week you've covered" />
        <div className="mt-6 rounded border border-dw-border bg-paper2 px-6 py-12 text-center font-serif text-ink2">
          Set up your save to start building an archive.
        </div>
      </div>
    );
  }

  // ── Reading one week ──────────────────────────────────────────────────
  if (open) {
    const activeTab = tab && readyTabs.includes(tab) ? tab : readyTabs[0] ?? null;
    return (
      <div className="space-y-5">
        <SectionHeader title="THE ARCHIVE" subtitle={`Year ${open.year} · Week ${open.week}`} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => { setOpenKey(null); setTab(null); }}
            className="inline-flex items-center gap-1.5 font-sans text-xs text-ink2 hover:text-dw-accent"
          >
            <ChevronLeft className="h-4 w-4" /> All weeks
          </button>
          <button
            type="button"
            onClick={() => exportWeek(open)}
            className="inline-flex items-center gap-1.5 rounded border border-dw-border px-3 py-1.5 font-sans text-[10px] uppercase tracking-wider text-ink3 hover:border-dw-accent hover:text-dw-accent"
          >
            <FileJson className="h-3.5 w-3.5" /> Export this week
          </button>
        </div>

        {readyTabs.length === 0 ? (
          <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center font-serif text-ink2">
            Nothing was written for this week.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              {readyTabs.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={cn(
                    "rounded border px-3 py-1.5 font-sans text-[10px] uppercase tracking-wider transition-colors",
                    k === activeTab
                      ? "border-dw-accent bg-dw-accent/10 text-dw-accent"
                      : "border-dw-border text-ink3 hover:text-ink"
                  )}
                >
                  {labelFor(k)}
                </button>
              ))}
            </div>
            <div className="rounded border border-dw-border bg-paper px-5 py-5">
              {activeTab && <TabContent data={open.tabs[activeTab]?.data} />}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── The week list ─────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <SectionHeader title="THE ARCHIVE" subtitle="Every week you've covered" />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-serif text-xs text-ink3">
          Every issue the Wire has written for this dynasty, kept locally. Reopening costs nothing.
        </p>
        <button
          type="button"
          onClick={exportAll}
          disabled={!issues?.length}
          className="inline-flex items-center gap-1.5 rounded border border-dw-border px-3 py-1.5 font-sans text-[10px] uppercase tracking-wider text-ink3 hover:border-dw-accent hover:text-dw-accent disabled:opacity-40"
        >
          <FileJson className="h-3.5 w-3.5" /> Export all as JSON
        </button>
      </div>

      {issues == null && <p className="py-10 text-center font-serif italic text-ink3">Opening the archive…</p>}

      {issues != null && issues.length === 0 && (
        <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center">
          <p className="font-serif text-ink2">
            Nothing archived yet. Every week the Wire writes gets saved here automatically —
            play a week and come back.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {(issues ?? []).map((i) => {
          const ready = Object.values(i.tabs).filter((t) => t?.status === "ready" && t.data != null).length;
          return (
            <button
              key={i.key}
              type="button"
              onClick={() => { setOpenKey(i.key); setTab(null); }}
              className="rounded border border-dw-border bg-paper2 p-4 text-left transition-colors hover:border-dw-accent"
            >
              <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">
                Year {i.year}
              </p>
              <p className="font-headline text-lg uppercase tracking-wide text-ink">Week {i.week}</p>
              <p className="mt-0.5 font-sans text-[11px] text-ink3">
                {ready} section{ready === 1 ? "" : "s"} ·{" "}
                {new Date(i.updatedAt).toLocaleDateString()}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
