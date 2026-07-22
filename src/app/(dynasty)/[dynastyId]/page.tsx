"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/section-header";
import { FrontPageSkeleton } from "@/components/ui/front-page-skeleton";
import { ScoreCard } from "@/components/ui/score-card";
import { StatStrip } from "@/components/ui/stat-strip";
import { LeadStory } from "@/components/front-page/lead-story";
import type { RecapContent } from "@/components/front-page/types";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useIssueTab } from "@/components/dynasty/use-issue-tab";
import { issueKey, readTab, writeTab } from "@/lib/dynasty/issue-cache";
import { computeGameOdds, type GameOdds } from "@/lib/dynasty/odds";
import type { GameResult, TeamInfo } from "@/lib/dynasty/client";

// One extracted highlight from the user's in-game footage screenshots.
interface Highlight {
  text: string;
  player?: string | null;
}

// Around-the-league items from the weekly national wire (also feeds the breaking ticker).
interface WireItem {
  category: string;
  school: string;
  headline: string;
  blurb?: string;
  featured?: boolean;
  /** Featured items carry a full multi-paragraph wire story — click the card to read. */
  story?: string;
}

const WIRE_CATEGORY_STYLE: Record<string, string> = {
  recruiting: "text-dw-green border-dw-green/40",
  portal: "text-dw-accent2 border-dw-accent2/40",
  legal: "text-dw-red border-dw-red/40",
  "locker-room": "text-dw-yellow border-dw-yellow/40",
  carousel: "text-dw-accent border-dw-accent/40",
  upset: "text-dw-red border-dw-red/40",
  rankings: "text-ink2 border-dw-border",
  nil: "text-dw-accent2 border-dw-accent2/40",
};

function AroundTheLeague() {
  const { generate, hasApiKey } = useDynasty();
  const cached = useIssueTab<{ items: WireItem[] }>("national-wire");
  const [items, setItems] = useState<WireItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [wireError, setWireError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  useEffect(() => {
    if (!items && cached?.items?.length) setItems(cached.items);
  }, [cached, items]);

  async function load() {
    setLoading(true);
    setWireError(null);
    try {
      const data = await generate<{ items: WireItem[]; error?: boolean; raw?: string }>("national-wire", {});
      if (!data?.error && Array.isArray(data?.items)) {
        setItems(data.items);
      } else {
        setWireError("The national desk couldn't file the report. Please try again.");
      }
    } catch (e) {
      setWireError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded border border-dw-border bg-paper">
      <div className="flex items-center justify-between border-b border-dw-border bg-paper2 px-4 py-3">
        <h3 className="font-headline text-sm uppercase tracking-wider text-ink2">Around the League</h3>
        {items && (
          <span className="font-sans text-[10px] uppercase tracking-wider text-ink3">{items.length} stories on the wire</span>
        )}
      </div>
      <div className="px-4 py-4">
        {wireError && (
          <div className="mb-4 rounded-sm border border-dw-red bg-paper2 px-4 py-3">
            <p className="font-sans text-sm text-dw-red">{wireError}</p>
          </div>
        )}
        {!items ? (
          <div className="py-4 text-center">
            <p className="font-serif text-sm text-ink2">
              The national desk covers the rest of the country — recruiting battles, portal moves, arrests, locker-room turmoil, and the carousel.
            </p>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || !hasApiKey}
              className="mt-4 rounded border border-dw-accent bg-dw-accent/10 px-5 py-2 font-headline text-sm uppercase tracking-wider text-dw-accent hover:bg-dw-accent/20 disabled:opacity-50"
            >
              {loading ? "Working the phones…" : "Open the National Wire"}
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((it, i) => {
              const hasStory = typeof it.story === "string" && it.story.trim().length > 0;
              const isOpen = expanded === i;
              return (
                <div
                  key={i}
                  onClick={() => { if (hasStory) setExpanded(isOpen ? null : i); }}
                  className={cn(
                    "rounded border border-dw-border bg-paper2 p-3 transition-colors",
                    hasStory && "cursor-pointer hover:border-dw-accent/50",
                    isOpen && "sm:col-span-2 border-dw-accent/50"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("rounded border px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-wider", WIRE_CATEGORY_STYLE[it.category] ?? "text-ink3 border-dw-border")}>
                      {it.category}
                    </span>
                    <span className="flex items-center gap-2">
                      {hasStory && (
                        <span className="font-sans text-[9px] uppercase tracking-wider text-dw-accent">
                          {isOpen ? "Close" : "Full story"}
                        </span>
                      )}
                      <span className="truncate font-sans text-[10px] uppercase tracking-wider text-ink3">{it.school}</span>
                    </span>
                  </div>
                  <p className="mt-1.5 font-headline text-sm leading-snug text-ink">{it.headline}</p>
                  {it.blurb && !isOpen && <p className="mt-1 font-serif text-xs leading-snug text-ink3">{it.blurb}</p>}
                  {isOpen && hasStory && (
                    <div className="mt-3 space-y-2 border-t border-dw-border pt-3">
                      {it.story!.split(/\n\n|\n/).filter((p) => p.trim()).map((p, pi) => (
                        <p key={pi} className="font-serif text-sm leading-relaxed text-ink2">{p}</p>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Resolve the score/opponent view of this week's game from the user team's perspective.
function readUserResult(game: GameResult, userTeam: string) {
  const userIsHome = game.home === userTeam;
  const userScore = userIsHome ? game.homeScore : game.awayScore;
  const oppScore = userIsHome ? game.awayScore : game.homeScore;
  const opponent = userIsHome ? game.away : game.home;
  const opponentRank = userIsHome ? game.rankAway : game.rankHome;
  const userRank = userIsHome ? game.rankHome : game.rankAway;
  const result: "W" | "L" =
    (userScore ?? 0) >= (oppScore ?? 0) ? "W" : "L";
  return {
    userIsHome,
    userScore: userScore ?? 0,
    oppScore: oppScore ?? 0,
    opponent,
    opponentRank,
    userRank,
    result,
    week: game.week,
  };
}

function buildStatStrip(
  view: ReturnType<typeof readUserResult>,
  userTeam: TeamInfo | null
): Array<{ label: string; value: string | number }> {
  const margin = Math.abs(view.userScore - view.oppScore);
  const stats: Array<{ label: string; value: string | number }> = [
    { label: "Result", value: view.result },
    { label: "Score", value: `${view.userScore}-${view.oppScore}` },
    { label: "Margin", value: margin },
    { label: "Week", value: view.week ?? "—" },
  ];
  if (userTeam) {
    stats.push({ label: "Record", value: `${userTeam.wins}-${userTeam.losses}` });
  }
  return stats;
}

export default function FrontPage() {
  const { snapshot, delta, generate, settings, loading, error, issue, issueStatus, dynastyId, year, week } =
    useDynasty();

  const [recap, setRecap] = useState<RecapContent | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Highlight screenshots: attach the game's highlight/stat screens; a vision pass extracts
  // the real plays and the recap is rewritten around them. Persisted per week.
  const weekKey = issueKey(dynastyId, year, week);
  const [highlights, setHighlights] = useState<Highlight[] | null>(null);
  const [hlBusy, setHlBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    setHighlights(null);
    (async () => {
      const rec = await readTab<{ highlights: Highlight[] }>(weekKey, "highlights");
      if (!cancelled && Array.isArray(rec?.data?.highlights)) setHighlights(rec.data.highlights);
    })();
    return () => {
      cancelled = true;
    };
  }, [weekKey]);

  async function attachScreenshots(files: FileList | null) {
    if (!files || files.length === 0 || hlBusy) return;
    setHlBusy(true);
    setGenError(null);
    try {
      // Read up to 4 screenshots as raw base64 (no data: prefix — the bridge sniffs type).
      const images: string[] = [];
      for (const f of Array.from(files).slice(0, 4)) {
        const b64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).replace(/^data:[^;]+;base64,/, ""));
          r.onerror = () => reject(new Error(`couldn't read ${f.name}`));
          r.readAsDataURL(f);
        });
        images.push(b64);
      }
      const res = await generate<{ highlights: Highlight[]; error?: boolean }>(
        "highlights-extract",
        { images },
        { force: true }
      );
      const extracted = Array.isArray(res?.highlights) ? res.highlights.filter((h) => h?.text) : [];
      if (!extracted.length) {
        setGenError("Couldn't read any highlights off those screenshots — try clearer shots of the highlight list.");
        return;
      }
      const merged = [...(highlights ?? []), ...extracted];
      setHighlights(merged);
      await writeTab(
        weekKey,
        "highlights",
        { status: "ready", data: { highlights: merged }, error: null, generatedAt: Date.now() },
        { dynastyId, year, week }
      );
      // Rewrite the lead around the verified plays.
      setGenerating(true);
      const result = await generate<RecapContent>("recap-lead", { highlights: merged }, { force: true });
      setRecap(result);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setHlBusy(false);
      setGenerating(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Auto-populate the lead from this week's issue: when the background pass (or a prior
  // visit) has already written recap-lead, show it with no click and no extra tokens.
  const leadTab = issue?.tabs["recap-lead"];
  useEffect(() => {
    if (!recap && leadTab?.status === "ready" && leadTab.data) {
      setRecap(leadTab.data as RecapContent);
    }
  }, [leadTab, recap]);

  // Reflect the background writer so the front page shows "filing" rather than an empty
  // call-to-action while the issue is being written for the first time this week.
  const leadWriting =
    generating || (issueStatus === "generating" && leadTab?.status !== "ready");

  const userTeam = snapshot?.userTeam ?? null;
  const userTeamName = userTeam?.name ?? settings.userTeam ?? "Your Program";
  let userResult = delta?.userResult ?? null;
  // This week's matchup when it's scheduled but NOT played — the front page previews it
  // instead of showing a result. (A prior-season Week-18 row with scores used to win the
  // fallback sort and put a phantom score on screen for a game that hadn't kicked off.)
  let upcoming: {
    week: number | null;
    opponent: string;
    opponentRank: number | null;
    opponentRecord: string | null;
    userIsHome: boolean;
    odds: GameOdds | null;
  } | null = null;
  if (!userResult && snapshot && snapshot.userTeamRow != null) {
    const userGames = (snapshot.games || []).filter(
      (g) => g.homeRow === snapshot.userTeamRow || g.awayRow === snapshot.userTeamRow
    );
    if (userGames.length > 0) {
      // Bound to the current week so a stray played record past it (e.g. a placeholder
      // Week 17 game while the season is at Week 10) doesn't get picked as "this week".
      const currentWeek = snapshot.week;
      const withinSeason = (w: number | null) =>
        currentWeek == null || w == null || w <= currentWeek;
      // Same-season guard: rows from prior seasons also live in the save. Many rows carry
      // a year; when they do, only the newest season's rows are candidates.
      const maxYear = userGames.reduce((m, g) => (g.year != null && g.year > m ? g.year : m), -1);
      const sameSeason = (y: number | null) => y == null || maxYear < 0 || y === maxYear;

      // Scheduled-but-unplayed matchup AT the current week → preview mode, not a result.
      const pending = userGames.find(
        (g) => !g.played && sameSeason(g.year) && currentWeek != null && g.week === currentWeek
      );
      const played = userGames.filter((g) => g.played && sameSeason(g.year) && withinSeason(g.week));

      if (pending) {
        const userIsHome = pending.homeRow === snapshot.userTeamRow;
        const oppRow = userIsHome ? pending.awayRow : pending.homeRow;
        const opp = oppRow != null ? snapshot.teams[String(oppRow)] : null;
        // Projected odds — neutral site once we're past the conference-championship week
        // (bowls/playoff). Home team passed first so homeWinPct maps to the home side.
        const confChamp = snapshot.calendar?.confChampWeek ?? 16;
        const neutral = pending.week != null && pending.week > confChamp;
        const me = userTeam;
        let odds: GameOdds | null = null;
        if (me && opp) {
          const homeTeam = userIsHome ? me : opp;
          const awayTeam = userIsHome ? opp : me;
          odds = computeGameOdds(
            { name: homeTeam.name, ratingOVR: homeTeam.ratingOVR, prestige: homeTeam.prestige, wins: homeTeam.wins, losses: homeTeam.losses, rankMedia: homeTeam.rankMedia },
            { name: awayTeam.name, ratingOVR: awayTeam.ratingOVR, prestige: awayTeam.prestige, wins: awayTeam.wins, losses: awayTeam.losses, rankMedia: awayTeam.rankMedia },
            neutral
          );
        }
        upcoming = {
          week: pending.week,
          opponent: opp?.name ?? `team#${oppRow}`,
          opponentRank: opp?.rankMedia ?? null,
          opponentRecord: opp ? `${opp.wins ?? 0}-${opp.losses ?? 0}` : null,
          userIsHome,
          odds,
        };
      } else if (played.length > 0) {
        const g = played.sort(
          (a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.week ?? 0) - (a.week ?? 0)
        )[0];
        const homeWon = (g.homeScore || 0) >= (g.awayScore || 0);
        const homeTeam = g.homeRow != null ? snapshot.teams[String(g.homeRow)] : null;
        const awayTeam = g.awayRow != null ? snapshot.teams[String(g.awayRow)] : null;

        userResult = {
          week: g.week,
          home: homeTeam ? homeTeam.name : `team#${g.homeRow}`,
          away: awayTeam ? awayTeam.name : `team#${g.awayRow}`,
          homeScore: g.homeScore,
          awayScore: g.awayScore,
          winner: homeWon
            ? (homeTeam ? homeTeam.name : `team#${g.homeRow}`)
            : (awayTeam ? awayTeam.name : `team#${g.awayRow}`),
          loser: homeWon
            ? (awayTeam ? awayTeam.name : `team#${g.awayRow}`)
            : (homeTeam ? homeTeam.name : `team#${g.homeRow}`),
          margin: Math.abs((g.homeScore || 0) - (g.awayScore || 0)),
          rankHome: homeTeam ? homeTeam.rankMedia : null,
          rankAway: awayTeam ? awayTeam.rankMedia : null,
          userInvolved: true,
          simmed: g.simmed,
        };
      }
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setGenError(null);
    try {
      const result = await generate<RecapContent>(
        "recap-lead",
        highlights?.length ? { highlights } : {},
        recap ? { force: true } : undefined
      );
      setRecap(result);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  // Loading: reading the save for the first time.
  if (loading && !snapshot) {
    return (
      <div>
        <SectionHeader
          title="FRONT PAGE"
          subtitle="The day's top stories from your dynasty"
        />
        <FrontPageSkeleton />
      </div>
    );
  }

  // Error reading the save — degrade gracefully, keep the masthead.
  if (error && !snapshot) {
    return (
      <div>
        <SectionHeader
          title="FRONT PAGE"
          subtitle="The day's top stories from your dynasty"
        />
        <div className="mt-8 rounded border border-dw-red bg-paper2 px-6 py-10 text-center">
          <p className="font-serif text-ink2">
            The Wire couldn&apos;t read your latest save.
          </p>
          <p className="mt-2 font-sans text-xs uppercase tracking-wide text-dw-red">
            {error}
          </p>
        </div>
      </div>
    );
  }

  const view = userResult ? readUserResult(userResult, userTeamName) : null;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <SectionHeader
          title="FRONT PAGE"
          subtitle="The day's top stories from your dynasty"
        />
        {(view || upcoming) && (
          <div className="flex items-center gap-2">
            {/* Attach the in-game highlight list — a vision pass extracts the real plays
                and the recap gets rewritten around them (accuracy suggestion from Discord). */}
            {view && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => void attachScreenshots(e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={hlBusy || generating}
                  title="Attach screenshots of the game's highlight/stat screens — the recap will cite the real plays"
                  className={cn(
                    "rounded border border-dw-accent2 bg-dw-accent2/15 px-4 py-2",
                    "font-sans text-xs font-semibold uppercase tracking-wider text-dw-accent2",
                    "transition-colors hover:bg-dw-accent2/25 disabled:opacity-50"
                  )}
                >
                  {hlBusy
                    ? "Reading film…"
                    : highlights?.length
                      ? `Highlights ✓ ${highlights.length}`
                      : "+ Add Highlights"}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating || hlBusy}
              className={cn(
                "rounded bg-dw-accent px-6 py-2",
                "font-sans text-xs font-semibold uppercase tracking-wider text-white",
                "transition-colors hover:bg-dw-accent2 disabled:opacity-50"
              )}
            >
              {generating
                ? "Filing…"
                : recap
                  ? upcoming && !view
                    ? "Rewrite the Preview"
                    : "Regenerate Recap"
                  : upcoming && !view
                    ? "Preview the Matchup"
                    : "Generate Recap"}
            </button>
          </div>
        )}
      </div>

      {genError && (
        <div className="rounded-sm border border-dw-red bg-paper2 px-4 py-3">
          <p className="font-sans text-sm text-dw-red">{genError}</p>
        </div>
      )}

      {!view && upcoming ? (
        <>
          {/* Scheduled but not played — preview the matchup instead of inventing a result. */}
          <div className="space-y-0">
            <div className="h-0.5 w-full rounded-t bg-dw-accent2" />
            <div className="rounded-b border border-t-0 border-dw-border bg-paper2 px-6 py-8 text-center">
              <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">
                Week {upcoming.week ?? "—"} · Up Next · Not Yet Played
              </p>
              <div className="mt-4 flex items-center justify-center gap-5">
                <span className="font-headline text-2xl uppercase tracking-wide text-ink">
                  {upcoming.userIsHome ? upcoming.opponent : userTeamName}
                </span>
                <span className="font-sans text-xs uppercase tracking-widest text-ink3">at</span>
                <span className="font-headline text-2xl uppercase tracking-wide text-ink">
                  {upcoming.userIsHome ? userTeamName : upcoming.opponent}
                </span>
              </div>
              <p className="mt-3 font-serif text-sm text-ink3">
                {upcoming.opponentRank ? `#${upcoming.opponentRank} ` : ""}
                {upcoming.opponent}
                {upcoming.opponentRecord ? ` (${upcoming.opponentRecord})` : ""}
                {" · "}
                {upcoming.userIsHome ? "at home" : "on the road"}
              </p>

              {/* Projected odds — a transparent power-rating line off the save, for flavor. */}
              {upcoming.odds && (
                <div className="mx-auto mt-6 max-w-md border-t border-dw-border pt-5">
                  <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">
                    DynastyWire Projected Line
                  </p>
                  <p className="mt-2 font-headline text-lg uppercase tracking-wide text-dw-accent2">
                    {upcoming.odds.favorite
                      ? upcoming.odds.line
                      : "Pick’em — too close to call"}
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    {(() => {
                      const meIsHome = upcoming.userIsHome;
                      const myPct = meIsHome ? upcoming.odds.homeWinPct : upcoming.odds.awayWinPct;
                      const oppPct = 100 - myPct;
                      const myMl = meIsHome ? upcoming.odds.homeMoneyline : upcoming.odds.awayMoneyline;
                      const oppMl = meIsHome ? upcoming.odds.awayMoneyline : upcoming.odds.homeMoneyline;
                      const fmtMl = (m: number) => (m > 0 ? `+${m}` : `${m}`);
                      const Cell = ({ team, pct, ml, mine }: { team: string; pct: number; ml: number; mine: boolean }) => (
                        <div className={cn("rounded border px-3 py-2", mine ? "border-dw-accent2/40 bg-dw-accent2/5" : "border-dw-border bg-paper")}>
                          <p className="truncate font-sans text-[11px] uppercase tracking-wider text-ink2">{team}</p>
                          <p className="mt-0.5 font-headline text-2xl font-bold text-ink">{pct}%</p>
                          <p className="font-sans text-[10px] tracking-wider text-ink3">{fmtMl(ml)} ML</p>
                        </div>
                      );
                      return (
                        <>
                          <Cell team={userTeamName} pct={myPct} ml={myMl} mine />
                          <Cell team={upcoming.opponent} pct={oppPct} ml={oppMl} mine={false} />
                        </>
                      );
                    })()}
                  </div>
                  <p className="mt-3 font-sans text-[9px] uppercase tracking-wider text-ink3">
                    Model line from team ratings, record &amp; poll rank · entertainment only
                  </p>
                </div>
              )}
            </div>
          </div>

          {leadWriting && !recap ? (
            <LeadStory recap={null} />
          ) : recap ? (
            <LeadStory recap={recap} />
          ) : (
            <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center">
              <p className="font-serif text-ink2">
                {userTeamName} hasn&apos;t kicked off against {upcoming.opponent} yet. Read the
                matchup before you play it — how the two rosters stack up, the keys, the stakes.
              </p>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className={cn(
                  "mt-4 rounded bg-dw-accent px-8 py-3",
                  "font-sans text-sm font-semibold uppercase tracking-wider text-white",
                  "transition-colors hover:bg-dw-accent2 disabled:opacity-50"
                )}
              >
                {generating ? "Filing…" : "Preview the Matchup"}
              </button>
            </div>
          )}

          <AroundTheLeague />
        </>
      ) : view ? (
        <>
          <div className="space-y-0">
            {/* Emotional result stripe — green for W, crimson for L */}
            <div
              className={cn(
                "h-0.5 w-full rounded-t",
                view.result === "W" ? "bg-dw-green" : "bg-dw-accent"
              )}
            />
            <ScoreCard
              homeTeam={view.userIsHome ? userTeamName : view.opponent}
              awayTeam={view.userIsHome ? view.opponent : userTeamName}
              homeScore={view.userIsHome ? view.userScore : view.oppScore}
              awayScore={view.userIsHome ? view.oppScore : view.userScore}
              homeRank={
                view.userIsHome ? view.userRank ?? undefined : view.opponentRank ?? undefined
              }
              awayRank={
                view.userIsHome ? view.opponentRank ?? undefined : view.userRank ?? undefined
              }
              week={`Week ${view.week ?? "—"}`}
              result={view.result}
            />
          </div>

          <StatStrip stats={buildStatStrip(view, userTeam)} />

          {leadWriting && !recap ? (
            <LeadStory recap={null} />
          ) : recap ? (
            <LeadStory recap={recap} />
          ) : (
            <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center">
              <p className="font-serif text-ink2">
                {userTeamName} {view.result === "W" ? "took down" : "fell to"}{" "}
                {view.opponent}, {view.userScore}-{view.oppScore}. The lead story
                is waiting to be written.
              </p>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className={cn(
                  "mt-4 rounded bg-dw-accent px-8 py-3",
                  "font-sans text-sm font-semibold uppercase tracking-wider text-white",
                  "transition-colors hover:bg-dw-accent2 disabled:opacity-50"
                )}
              >
                {generating ? "Filing…" : "Generate the Recap"}
              </button>
            </div>
          )}

          <AroundTheLeague />
        </>
      ) : (
        // No new game to cover yet — degrade gracefully with what the save shows.
        <div className="mt-4 rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
          {userTeam ? (
            <>
              <p className="font-headline text-2xl text-ink">
                {userTeam.name}
              </p>
              <p className="mt-1 font-serif text-ink2">
                {userTeam.wins}-{userTeam.losses}
                {userTeam.rankMedia && userTeam.rankMedia <= 25
                  ? ` · AP #${userTeam.rankMedia}`
                  : ""}
              </p>
              <p className="mt-4 font-serif text-sm text-ink3">
                No new game to cover yet. Play your next week, then re-open the
                Wire to file the front page.
              </p>
            </>
          ) : (
            <p className="font-serif text-ink3">
              Reading from your save… once a game is played, the front page fills
              in here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
