"use client";

// The National Desk — the whole country's week, from the national media's chair. Lead
// game-of-the-week story, national takes on the real ranked slate, the poll pulse, the
// full around-the-league wire, and a national radio segment. Written once per week by the
// issue engine (cache-through), hydrated on revisit like every other tab.

import { useCallback, useEffect, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useIssueTab } from "@/components/dynasty/use-issue-tab";
import { AroundTheLeague } from "@/components/national/around-the-league";
import { PodcastPlayer } from "@/components/shows/podcast-player";
import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/utils";

interface DeskLead {
  headline: string;
  byline?: string;
  body: string;
}
interface DeskGame {
  matchup: string;
  take?: string;
  status?: "final" | "preview";
}
interface DeskPodLine {
  speaker?: string;
  text: string;
}
interface NationalDesk {
  lead: DeskLead;
  gamesOfTheWeek: DeskGame[];
  pollPulse: { headline?: string; body: string } | null;
  podcast: { title: string; hosts: string[]; lines: DeskPodLine[] };
  error?: boolean;
}

function Paragraphs({ text, className }: { text: string; className?: string }) {
  return (
    <>
      {text
        .split(/\n\n|\n/)
        .filter((p) => p.trim())
        .map((p, i) => (
          <p key={i} className={cn("font-serif leading-relaxed text-ink2", className)}>
            {p}
          </p>
        ))}
    </>
  );
}

export default function NationalDeskPage() {
  const { needsOnboarding, generate, hasApiKey, week } = useDynasty();
  const cached = useIssueTab<NationalDesk>("national-desk");

  const [desk, setDesk] = useState<NationalDesk | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore this week's edition from the persisted issue cache on mount.
  useEffect(() => {
    if (!desk && cached && !cached.error && cached.lead?.headline) setDesk(cached);
  }, [cached, desk]);

  const run = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await generate<NationalDesk>("national-desk", {}, { force });
      if (data?.error || !data?.lead?.headline) {
        // Keep the reader-facing error short; the parse details are in the devtools console.
        setError("The national desk missed its deadline — the edition came back malformed. Hit the button to retry.");
      } else {
        setDesk(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the desk. Check your save + API key.");
    } finally {
      setLoading(false);
    }
  }, [generate]);

  if (needsOnboarding) {
    return (
      <div>
        <SectionHeader title="NATIONAL DESK" subtitle="The whole country's week" />
        <div className="mt-6 rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
          <p className="font-serif text-ink2">Point Dynasty Wire at your save and add your API key in settings — then the national desk opens.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <SectionHeader title="NATIONAL DESK" subtitle="The whole country's week — no homers allowed" />

      {!desk && (
        <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center">
          <p className="font-serif text-ink2">
            The national edition: game of the week, the slate in takes, the poll pulse, and the radio segment arguing about all of it.
          </p>
          {error && <p className="mt-3 font-serif text-sm text-dw-red">{error}</p>}
          <button
            type="button"
            onClick={() => void run()}
            disabled={loading || !hasApiKey}
            className="mt-4 rounded border border-dw-accent bg-dw-accent px-5 py-2.5 font-sans text-xs uppercase tracking-wider text-paper hover:bg-dw-accent2 disabled:opacity-50"
          >
            {loading ? "Presses running…" : "Print the National Edition"}
          </button>
        </div>
      )}

      {desk && (
        <>
          {/* Lead — national game of the week */}
          <article className="rounded border border-dw-border bg-paper2 px-6 py-6">
            <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent">Game of the Week</p>
            <h2 className="mt-2 font-headline text-3xl leading-tight text-ink">{desk.lead.headline}</h2>
            {desk.lead.byline && <p className="mt-1 font-sans text-xs text-ink3">{desk.lead.byline}, National Columnist</p>}
            <div className="mt-4 space-y-3">
              <Paragraphs text={desk.lead.body} />
            </div>
          </article>

          {/* The slate */}
          {desk.gamesOfTheWeek.length > 0 && (
            <div>
              <h3 className="mb-3 font-headline text-xs uppercase tracking-widest text-ink3">The Slate — National Takes</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {desk.gamesOfTheWeek.map((g, i) => (
                  <div key={i} className="rounded border border-dw-border bg-paper2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-headline text-sm text-ink">{g.matchup}</p>
                      {g.status === "preview" && (
                        <span className="shrink-0 rounded border border-dw-accent2/40 px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-wider text-dw-accent2">
                          Preview
                        </span>
                      )}
                    </div>
                    {g.take && <p className="mt-1.5 font-serif text-xs leading-snug text-ink3">{g.take}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Poll pulse */}
          {desk.pollPulse && (
            <div className="rounded border border-dw-border bg-paper2 px-5 py-5">
              <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Poll Pulse</p>
              {desk.pollPulse.headline && (
                <h3 className="mt-1 font-headline text-xl text-ink">{desk.pollPulse.headline}</h3>
              )}
              <div className="mt-2 space-y-2">
                <Paragraphs text={desk.pollPulse.body} className="text-sm" />
              </div>
            </div>
          )}

          {/* The radio segment */}
          {desk.podcast.lines.length > 0 && (
            <div className="rounded border border-dw-border bg-paper2 px-5 py-5">
              <div className="flex items-center gap-3">
                <span className="font-sans text-[10px] uppercase tracking-widest text-dw-accent">On Air</span>
                <div className="h-px flex-1 bg-dw-accent/30" />
              </div>
              <h3 className="mt-2 font-headline text-xl text-ink">{desk.podcast.title}</h3>
              {desk.podcast.hosts.length > 0 && (
                <p className="font-sans text-xs text-ink3">with {desk.podcast.hosts.join(" & ")}</p>
              )}
              {/* Same podcast engine as the shows — manual play here (no surprise credits). */}
              <PodcastPlayer
                lines={desk.podcast.lines.map((l) => ({ speaker: l.speaker || "Host", text: l.text }))}
                weekSeed={week || 0}
                resetKey={`national::${desk.podcast.title}::${week}`}
                label="Listen · National Radio"
              />
              <div className="mt-4 space-y-3">
                {desk.podcast.lines.map((l, i) => (
                  <div key={i}>
                    {l.speaker && (
                      <span className={cn("font-sans text-[10px] uppercase tracking-wider", i % 2 === 0 ? "text-dw-accent" : "text-dw-accent2")}>
                        {l.speaker}
                      </span>
                    )}
                    <p className="font-serif text-sm leading-relaxed text-ink">{l.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => void run(true)}
              disabled={loading}
              className="rounded border border-dw-border bg-paper2 px-4 py-2 font-sans text-xs text-ink3 transition-colors hover:border-dw-accent hover:text-dw-accent disabled:opacity-50"
            >
              {loading ? "Presses running…" : "Reprint edition (rewrite)"}
            </button>
          </div>
        </>
      )}

      {/* The full wire, shared with the Front Page */}
      <AroundTheLeague />
    </div>
  );
}
