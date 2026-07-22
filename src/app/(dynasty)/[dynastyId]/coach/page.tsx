"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/section-header";
import { useSettings } from "@/components/settings/settings-context";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useSaga } from "@/components/dynasty/use-saga";
import { getRoster } from "@/lib/dynasty/client";
import { issueKey, readTab, writeTab } from "@/lib/dynasty/issue-cache";
import { seatTemperature, SEAT_COLOR, type CoachBackstory } from "@/lib/dynasty/saga";
import { 
  Shield, 
  Heart, 
  DollarSign, 
  Sparkles, 
  Building, 
  Landmark, 
  Newspaper, 
  Flame, 
  RefreshCw, 
  UserCircle,
  RotateCcw
} from "lucide-react";

// ── Text threads with the AD / booster / beat reporter ────────────────────────
type FigureKey = "ad" | "booster" | "reporter";
interface FigureMsg { from: "coach" | "recruit"; text: string; mood?: string }

function FiguresDesk() {
  const { generate } = useDynasty();
  const saga = useSaga();
  const bs = saga.state?.backstory ?? null;
  const [active, setActive] = useState<FigureKey>("ad");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const figures: { key: FigureKey; label: string; name: string | null }[] = [
    { key: "ad", label: "Athletic Director", name: bs?.adName ?? null },
    { key: "booster", label: "Lead Booster", name: bs?.boosterName ?? null },
    { key: "reporter", label: "Beat Writer", name: bs?.reporterName ?? null },
  ];
  const cur = figures.find((f) => f.key === active)!;
  const thread = (saga.state?.figureThreads?.[active] ?? []) as FigureMsg[];

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    const next = [...thread, { from: "coach" as const, text }];
    await saga.appendFigureThread(active, [{ from: "coach", text }]);
    setSending(true);
    try {
      const reply = await generate<{ reply: string; mood?: string }>(
        "figure-text",
        { figure: active, thread: next, coachMessage: text },
        { force: true }
      );
      if (reply?.reply) await saga.appendFigureThread(active, [{ from: "recruit", text: reply.reply, mood: reply.mood }]);
    } catch {
      await saga.appendFigureThread(active, [{ from: "recruit", text: "…", mood: "neutral" }]);
    } finally {
      setSending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, sending, thread, active, generate, saga]);

  if (!bs) {
    return (
      <div className="rounded border border-dw-yellow/30 bg-dw-yellow/5 px-6 py-4 text-center font-serif text-sm text-dw-yellow">
        Define your coach backstory below to unlock direct lines to your AD, booster, and beat writer.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded border border-dw-border bg-paper2">
      <div className="h-1 w-full bg-gradient-to-r from-dw-accent to-dw-accent2" />
      <div className="px-6 py-5">
        <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Your Phone · Direct Lines</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {figures.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setActive(f.key)}
              className={cn(
                "rounded border px-3 py-1.5 text-left font-sans text-xs transition-colors",
                active === f.key ? "border-dw-accent bg-dw-accent/10 text-ink" : "border-dw-border text-ink3 hover:text-ink"
              )}
            >
              <span className="block uppercase tracking-wider">{f.name ?? f.label}</span>
              <span className="block text-[9px] text-ink3">{f.label}</span>
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-[6rem] space-y-2 rounded border border-dw-border bg-paper p-3">
          {thread.length === 0 && (
            <p className="py-4 text-center font-serif text-sm text-ink3">
              Text {cur.name ?? cur.label} directly. They&apos;ll answer in character.
            </p>
          )}
          {thread.map((m, i) => {
            const mine = m.from === "coach";
            return (
              <div key={i} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2 font-serif text-sm leading-snug", mine ? "rounded-br-sm bg-dw-accent text-paper" : "rounded-bl-sm bg-paper3 text-ink")}>
                  {!mine && <span className="mb-0.5 block font-sans text-[9px] uppercase tracking-wider text-ink3">{cur.name ?? cur.label}</span>}
                  {m.text}
                </div>
              </div>
            );
          })}
          {sending && <p className="font-sans text-[10px] uppercase tracking-wider text-ink3">typing…</p>}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
            placeholder={`Text ${cur.name ?? cur.label}…`}
            className="flex-1 rounded border border-dw-border bg-paper px-3 py-2 font-serif text-sm text-ink placeholder:text-ink3 focus:border-dw-accent/60 focus:outline-none"
          />
          <button
            type="button"
            disabled={!draft.trim() || sending}
            onClick={() => void send()}
            className="rounded border border-dw-accent bg-dw-accent px-4 py-2 font-sans text-xs uppercase tracking-wider text-paper hover:bg-dw-accent2 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Next-opponent scouting report ─────────────────────────────────────────────
interface ScoutKeyPlayer { name: string; note: string }
interface ScoutReport {
  opponent: string;
  summary: string;
  offense: { identity: string; scheme: string; keyPlayers: ScoutKeyPlayer[]; howToStop: string };
  defense: { identity: string; keyPlayers: ScoutKeyPlayer[]; howToAttack: string };
  xFactor: string;
  keys: string[];
  error?: boolean;
}

function ScoutingReport() {
  const { snapshot, currentSavePath, generate, dynastyId, year, week } = useDynasty();
  const [report, setReport] = useState<ScoutReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Figure out the NEXT scheduled (unplayed) opponent from the schedule.
  const next = (() => {
    const row = snapshot?.userTeamRow;
    if (!snapshot || row == null) return null;
    const games = (snapshot.games || []).filter((g) => g.homeRow === row || g.awayRow === row);
    const maxYear = games.reduce((m, g) => (g.year != null && g.year > m ? g.year : m), -1);
    const nx = games
      .filter((g) => !g.played && (g.year == null || maxYear < 0 || g.year === maxYear))
      .sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || (a.week ?? 0) - (b.week ?? 0))[0];
    if (!nx) return null;
    const oppRow = nx.homeRow === row ? nx.awayRow : nx.homeRow;
    const opp = oppRow != null ? snapshot.teams[String(oppRow)] : null;
    if (!opp) return null;
    return { week: nx.week, opp, userIsHome: nx.homeRow === row };
  })();

  const cacheKey = issueKey(dynastyId, year, week);
  const tab = next ? `scouting::${next.opp.teamIndex ?? next.opp.name}` : "scouting";

  // Restore a saved report for this exact opponent.
  useEffect(() => {
    let cancelled = false;
    setReport(null);
    if (!next) return;
    (async () => {
      const rec = await readTab<ScoutReport>(cacheKey, tab);
      if (!cancelled && rec?.data && !rec.data.error) setReport(rec.data);
    })();
    return () => { cancelled = true; };
  }, [cacheKey, tab, next?.opp.teamIndex]);

  const run = useCallback(async () => {
    if (!next || !currentSavePath) return;
    setLoading(true);
    setErr(null);
    try {
      const oppRoster = await getRoster(currentSavePath, undefined, next.opp.teamIndex ?? undefined);
      const data = await generate<ScoutReport>(
        "scouting",
        {
          oppName: next.opp.name,
          oppRecord: `${next.opp.wins}-${next.opp.losses}`,
          oppRank: next.opp.rankMedia ?? undefined,
          oppRatingOVR: next.opp.ratingOVR ?? undefined,
          oppRoster,
        },
        { force: true }
      );
      if (!data || data.error) {
        setErr("Couldn't put the report together — try again.");
      } else {
        setReport(data);
        await writeTab(cacheKey, tab, { status: "ready", data, error: null, generatedAt: Date.now() }, { dynastyId, year, week });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Scouting failed.");
    } finally {
      setLoading(false);
    }
  }, [next, currentSavePath, generate, cacheKey, tab, dynastyId, year, week]);

  if (!next) return null;

  const KP = ({ list }: { list: ScoutKeyPlayer[] }) => (
    <ul className="mt-1 space-y-1">
      {list.map((p, i) => (
        <li key={i} className="font-serif text-sm text-ink2">
          <span className="font-sans text-xs uppercase tracking-wider text-ink">{p.name}</span> — {p.note}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="overflow-hidden rounded border border-dw-border bg-paper2">
      <div className="h-1 w-full bg-gradient-to-r from-dw-accent2 to-dw-accent" />
      <div className="px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Next Up · Scouting Desk</p>
            <h3 className="font-headline text-xl uppercase tracking-wide text-ink">
              {next.opp.rankMedia ? `#${next.opp.rankMedia} ` : ""}{next.opp.name}
              <span className="ml-2 font-sans text-xs text-ink3">
                ({next.opp.wins}-{next.opp.losses}){next.week != null ? ` · Week ${next.week}` : ""} · {next.userIsHome ? "home" : "away"}
              </span>
            </h3>
          </div>
          {(!report || loading) && (
            <button
              type="button"
              onClick={() => void run()}
              disabled={loading}
              className="rounded border border-dw-accent bg-dw-accent px-4 py-2 font-sans text-xs uppercase tracking-wider text-paper hover:bg-dw-accent2 disabled:opacity-50"
            >
              {loading ? "Breaking down film…" : "Pull the Scouting Report"}
            </button>
          )}
          {report && !loading && (
            <button
              type="button"
              onClick={() => void run()}
              className="rounded border border-dw-border px-3 py-1.5 font-sans text-[10px] uppercase tracking-wider text-ink3 hover:text-ink"
            >
              Refresh
            </button>
          )}
        </div>

        {err && <p className="mt-3 font-serif text-sm text-dw-red">{err}</p>}

        {report && (
          <div className="mt-4 space-y-5">
            <p className="font-serif text-ink leading-relaxed">{report.summary}</p>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="rounded border border-dw-border bg-paper px-4 py-3">
                <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent">Their Offense</p>
                <p className="mt-1 font-sans text-xs text-ink3">
                  {report.offense.identity}{report.offense.scheme ? ` · ${report.offense.scheme}` : ""}
                </p>
                <KP list={report.offense.keyPlayers} />
                {report.offense.howToStop && (
                  <p className="mt-2 border-t border-dw-border pt-2 font-serif text-sm text-ink2"><span className="font-sans text-[10px] uppercase tracking-wider text-dw-green">How to stop them:</span> {report.offense.howToStop}</p>
                )}
              </div>
              <div className="rounded border border-dw-border bg-paper px-4 py-3">
                <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent">Their Defense</p>
                <p className="mt-1 font-sans text-xs text-ink3">{report.defense.identity}</p>
                <KP list={report.defense.keyPlayers} />
                {report.defense.howToAttack && (
                  <p className="mt-2 border-t border-dw-border pt-2 font-serif text-sm text-ink2"><span className="font-sans text-[10px] uppercase tracking-wider text-dw-green">How to attack them:</span> {report.defense.howToAttack}</p>
                )}
              </div>
            </div>

            {report.xFactor && (
              <p className="font-serif text-sm text-ink2"><span className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">X-Factor:</span> {report.xFactor}</p>
            )}
            {report.keys.length > 0 && (
              <div>
                <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">Keys to the Game</p>
                <ul className="mt-1 space-y-1">
                  {report.keys.map((k, i) => (
                    <li key={i} className="font-serif text-sm text-ink2">• {k}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {!report && !loading && !err && (
          <p className="mt-3 font-serif text-sm text-ink3">
            Break down {next.opp.name} before you play them — their scheme, stat leaders, and how to attack them, straight from their real roster.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Display configurations ───────────────────────────────────────────────────

const PRESTIGE_CONFIG: Record<string, { label: string; badge: string; desc: string }> = {
  blue_blood:   { label: "Blue Blood",   badge: "border-dw-red text-dw-red bg-dw-red/10",             desc: "Historic program with generational expectations." },
  rising_power: { label: "Rising Power", badge: "border-dw-accent2 text-dw-accent2 bg-dw-accent2/10", desc: "Building toward elite status with momentum." },
  rebuild:      { label: "Rebuild",      badge: "border-ink3 text-ink3 bg-ink3/10",                   desc: "Starting from scratch. Every win matters." },
};

function prestigeFromNumber(n: number): { label: string; badge: string; desc: string } {
  if (n >= 8) return PRESTIGE_CONFIG.blue_blood;
  if (n >= 5) return PRESTIGE_CONFIG.rising_power;
  return PRESTIGE_CONFIG.rebuild;
}

interface ArchetypeOption {
  id: CoachBackstory["archetype"];
  label: string;
  desc: string;
  icon: React.ElementType;
  style: string;
  pros: string;
  cons: string;
}

const ARCHETYPES: ArchetypeOption[] = [
  {
    id: "disciplinarian",
    label: "Disciplinarian",
    desc: "Built on rule-following, strict standards, and academic eligibility. Zero-tolerance policy on slips.",
    icon: Shield,
    style: "border-dw-red text-dw-red bg-dw-red/5",
    pros: "Higher AD & booster respect; easier to clamp down on media heat during crises.",
    cons: "Fragile locker-room buy-in; players text with high defensiveness and resentment.",
  },
  {
    id: "players-coach",
    label: "Player's Coach",
    desc: "Built on empathy, trust, and family values. You protect your guys and shield them from outside noise.",
    icon: Heart,
    style: "border-dw-green text-dw-green bg-dw-green/5",
    pros: "Exceptional locker-room morale; players are loyal in private texts and media fallout.",
    cons: "The AD and media watch you like a hawk, waiting for discipline cracks; higher booster pressure.",
  },
  {
    id: "nil-merchant",
    label: "NIL & Portal Merchant",
    desc: "Modern and resource-focused. You leverage booster funds and the transfer portal to rent top-tier talent.",
    icon: DollarSign,
    style: "border-dw-accent2 text-dw-accent2 bg-dw-accent2/5",
    pros: "Exceptional booster resource flow; easy portal recruitment and collective backing.",
    cons: "Extremely volatile locker room; fans see you as mercenary and have very little patience.",
  },
  {
    id: "hometown-savior",
    label: "Hometown Savior",
    desc: "A returning school legend or local hero. You represent the tradition and soul of the community.",
    icon: Sparkles,
    style: "border-dw-yellow text-dw-yellow bg-dw-yellow/5",
    pros: "Massive fan goodwill and trust baseline; reporters default to friendly questions.",
    cons: "Every single loss is treated as an existential tragedy; booster expectations are sky-high.",
  },
];

// ── UI Components ────────────────────────────────────────────────────────────

function StatBox({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded border border-dw-border bg-paper2 px-4 py-3 text-center">
      <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">{label}</p>
      <p className="mt-1 font-headline text-2xl font-bold text-ink">{value}</p>
      {sub && <p className="mt-0.5 font-sans text-xs text-ink3">{sub}</p>}
    </div>
  );
}

function PulseRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-dw-border py-3 last:border-b-0">
      <span className="font-sans text-xs uppercase tracking-wider text-ink3">{label}</span>
      {children}
    </div>
  );
}

function LoadingDots({ label = "Reading the room…" }: { label?: string }) {
  return (
    <div className="mt-8 flex flex-col items-center justify-center py-16 text-center space-y-4">
      <div className="flex gap-1.5">
        <span className="h-2 w-2 animate-pulse rounded-full bg-dw-accent" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-dw-accent [animation-delay:200ms]" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-dw-accent [animation-delay:400ms]" />
      </div>
      <p className="font-serif text-sm italic text-ink3">{label}</p>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function CoachPage() {
  const { dynasty } = useSettings();
  const { snapshot, loading: snapLoading, error: snapError, generate } = useDynasty();
  const saga = useSaga();

  const [selectedArch, setSelectedArch] = useState<CoachBackstory["archetype"]>("players-coach");
  const [customPath, setCustomPath] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);

  const team = snapshot?.userTeam ?? null;
  const loading = snapLoading || !saga.ready;
  const error = snapError;

  // Resolve prestige
  const numericPrestige = team?.prestige;
  const prestige =
    typeof numericPrestige === "number"
      ? prestigeFromNumber(numericPrestige)
      : PRESTIGE_CONFIG[dynasty.prestige] ?? PRESTIGE_CONFIG.rebuild;

  const wins = team?.wins ?? 0;
  const losses = team?.losses ?? 0;
  const recordEdge = wins - losses;
  const gamesPlayed = wins + losses;
  const winPct =
    gamesPlayed > 0 ? `${Math.round((wins / gamesPlayed) * 1000) / 10}%` : "—";

  const standing =
    gamesPlayed === 0
      ? { label: "Season Opener", color: "text-ink2", desc: "The season hasn't kicked off." }
      : wins > losses
        ? { label: "Winning Season", color: "text-dw-green", desc: "The program is trending up." }
        : wins === losses
          ? { label: "Even Keel", color: "text-dw-yellow", desc: "Every game from here defines the year." }
          : { label: "Under Pressure", color: "text-dw-red", desc: "The margin for error is gone." };

  async function handleWriteBackstory() {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await generate<CoachBackstory>("coach-backstory", {
        archetype: selectedArch,
        customPath: customPath.trim(),
      }, { force: true });
      if (!res || !res.bio) {
        throw new Error("The situation room returned an empty biography.");
      }
      await saga.saveBackstory(res);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Backstory generation failed. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  // Inline two-step confirm — browser dialogs (confirm/alert) are unreliable in the
  // Tauri webview, so destructive actions arm first and confirm in place.
  async function handleResetBackstory() {
    if (!resetArmed) {
      setResetArmed(true);
      return;
    }
    setResetArmed(false);
    await saga.saveBackstory(null);
  }

  if (loading) {
    return (
      <div>
        <SectionHeader title="COACH PROFILE" subtitle="Your program at a glance" />
        <LoadingDots label="Accessing coach personnel folders…" />
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div>
        <SectionHeader title="COACH PROFILE" subtitle="Your program at a glance" />
        <div className="mt-8 rounded border border-dw-red/40 bg-dw-red/5 px-6 py-8 text-center">
          <p className="font-serif text-sm text-ink2">Couldn&apos;t read your save. {error}</p>
        </div>
      </div>
    );
  }

  const backstory = saga.state?.backstory ?? null;
  const meters = saga.state?.meters ?? { boosterConfidence: 50, fanTrust: 50, mediaHeat: 35, lockerRoom: 50 };

  // The app's own hot-seat model (meters + record). The save's SeasonStartJobSecurityStatus
  // is often the sentinel "Invalid" (and its fireReported flag is unreliable), so we show the
  // derived Seat Temperature instead — consistent with the Situation Room — and only mention
  // fire when it's genuinely volcanic.
  const seat = seatTemperature(meters, recordEdge);
  const rawJob = snapshot?.coach?.jobSecurity?.trim();
  const realJob = rawJob && !/^(invalid|none|unknown)$/i.test(rawJob) ? rawJob : null;

  // Determine environmental stances based on meters
  const adStance = (() => {
    const val = meters.boosterConfidence;
    if (val >= 68) return { label: "Fully Aligned", color: "text-dw-green", desc: "AD is preparing a contract extension." };
    if (val >= 42) return { label: "Monitoring", color: "text-dw-yellow", desc: "AD expects weekly competitive results." };
    return { label: "Drafting Replacement List", color: "text-dw-red", desc: "The office is quietly taking agent inquiries." };
  })();

  const boosterStance = (() => {
    const val = meters.boosterConfidence * 0.6 + meters.fanTrust * 0.4;
    if (val >= 65) return { label: "Funding Facility upgrades", color: "text-dw-green", desc: "Collective cash is flowing freely." };
    if (val >= 45) return { label: "NIL Active", color: "text-dw-yellow", desc: "Funding remains stable but transactional." };
    return { label: "Funding Frozen", color: "text-dw-red", desc: "Checkbooks closed until culture/wins return." };
  })();

  const writerStance = (() => {
    const val = meters.mediaHeat;
    if (val >= 62) return { label: "Hostile / Hot-Seat pieces", color: "text-dw-red", desc: "Filing critical columns and leaks daily." };
    if (val >= 38) return { label: "Skeptical but objective", color: "text-dw-yellow", desc: "Asking difficult questions at the podium." };
    return { label: "Puff Piece Profiling", color: "text-dw-green", desc: "Writing generous narratives about your rebuild." };
  })();

  const rivalStance = (() => {
    const val = recordEdge;
    if (val > 2) return { label: "Panic-calling recruits", color: "text-dw-green", desc: "Intimidated by your program's upward momentum." };
    if (val < -2) return { label: "Trolling online", color: "text-dw-red", desc: "Enjoying your slide and targeting your commits." };
    return { label: "Focused on schedule", color: "text-ink3", desc: "Maintaining standard recruiting bounds." };
  })();

  return (
    <div className="space-y-8">
      <SectionHeader
        title="COACH PROFILE"
        subtitle={dynasty.conference ? `${dynasty.school} — ${dynasty.conference}` : dynasty.school}
      />

      {/* ── Direct lines: AD / booster / beat writer ──────────────────── */}
      <FiguresDesk />

      {/* ── Next-opponent scouting report ─────────────────────────────── */}
      <ScoutingReport />

      {/* ── Identity Card ──────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded border border-dw-border bg-paper2">
        <div className="h-1 w-full bg-gradient-to-r from-dw-red via-dw-accent2 to-dw-accent" />
        <div className="px-6 py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-dw-red text-xl font-bold text-paper shadow-inner">
                {dynasty.coachName.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">
                  {/* Real job from the save — OC/DC careers are not head-coach careers. */}
                  {snapshot?.coach?.position === "OffensiveCoordinator"
                    ? "Offensive Coordinator"
                    : snapshot?.coach?.position === "DefensiveCoordinator"
                      ? "Defensive Coordinator"
                      : "Head Coach"}
                </p>
                <h1 className="font-headline text-2xl uppercase tracking-wide text-ink">
                  {dynasty.coachName}
                </h1>
                <p className="font-serif text-sm italic text-ink3">{team?.name ?? dynasty.school}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end">
              <span className={cn("inline-block rounded border px-3 py-1 font-sans text-xs font-semibold uppercase tracking-wider", prestige.badge)}>
                {prestige.label}
              </span>
              {backstory && (
                <span className={cn(
                  "inline-block rounded border px-3 py-1 font-sans text-xs font-semibold uppercase tracking-wider",
                  ARCHETYPES.find(a => a.id === backstory.archetype)?.style
                )}>
                  {backstory.archetype.replace("-", " ")}
                </span>
              )}
            </div>
          </div>
          <p className="mt-4 font-serif text-sm italic text-ink3">{prestige.desc}</p>
        </div>
      </div>

      {generating && (
        <div className="rounded border border-dw-border bg-paper2 p-10">
          <LoadingDots label="Filing coach biography in university archives... generating casting staff..." />
        </div>
      )}

      {/* ── BACKSTORY ONBOARDING (If no backstory generated yet) ──────── */}
      {!backstory && !generating && (
        <div className="rounded border border-dw-border bg-paper2 p-6 space-y-6">
          <div>
            <h2 className="font-headline text-lg uppercase tracking-wider text-ink">Establish Your Origin Story</h2>
            <p className="mt-1 font-serif text-sm text-ink3">
              Your backstory and philosophy will steer the narrative of your dynasty. Key environmental characters will adapt to how you manage player decisions and face the press.
            </p>
          </div>

          {genError && (
            <div className="rounded border border-dw-red/30 bg-dw-red/10 px-4 py-2.5 text-center font-serif text-xs text-dw-red">
              {genError}
            </div>
          )}

          {/* Archetype Selector */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ARCHETYPES.map((arch) => {
              const Icon = arch.icon;
              const active = selectedArch === arch.id;
              return (
                <button
                  key={arch.id}
                  type="button"
                  onClick={() => setSelectedArch(arch.id)}
                  className={cn(
                    "rounded border p-4 text-left transition-all space-y-3",
                    active 
                      ? "border-dw-accent bg-dw-accent/5 ring-1 ring-dw-accent" 
                      : "border-dw-border bg-paper hover:bg-paper3 hover:border-ink3"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-5 w-5 text-dw-accent2" />
                    <span className="font-headline text-sm uppercase tracking-wide text-ink">{arch.label}</span>
                  </div>
                  <p className="font-serif text-xs text-ink2 leading-snug">{arch.desc}</p>
                  <div className="pt-2 border-t border-dw-border/60 text-[10px] space-y-1">
                    <p className="text-dw-green"><strong className="uppercase">Philosophy:</strong> {arch.pros}</p>
                    <p className="text-dw-red"><strong className="uppercase">Vulnerability:</strong> {arch.cons}</p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Custom Path Input */}
          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-wider text-ink3 font-semibold">
              Prior Coaching History & Career Path (Optional)
            </label>
            <input
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder="e.g. Spent 12 years as an SEC defensive coordinator, or Former star QB who failed in the NFL and returned to his alma mater..."
              className="w-full rounded border border-dw-border bg-paper px-3 py-2.5 font-serif text-sm text-ink placeholder:text-ink3 focus:border-dw-accent/60 focus:outline-none"
            />
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={handleWriteBackstory}
              className="w-full md:w-auto rounded bg-dw-crimson hover:bg-dw-crimson/95 px-6 py-3 font-sans text-xs uppercase tracking-widest text-white transition-colors"
            >
              Write My Backstory
            </button>
          </div>
        </div>
      )}

      {/* ── BACKSTORY CARD (If active) ────────────────────────────────── */}
      {backstory && !generating && (
        <div className="rounded border border-dw-border bg-paper2 p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-dw-border pb-3">
            <h3 className="font-headline text-sm uppercase tracking-widest text-dw-accent">The Coaching Journal</h3>
            <div className="flex items-center gap-2">
              {resetArmed && (
                <>
                  <span className="font-sans text-[10px] uppercase tracking-wider text-dw-red">Erase backstory + cast?</span>
                  <button
                    type="button"
                    onClick={() => setResetArmed(false)}
                    className="font-sans text-[10px] uppercase tracking-wider text-ink3 hover:text-ink"
                  >
                    Cancel
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={handleResetBackstory}
                className={cn(
                  "flex items-center gap-1 font-sans text-[10px] uppercase tracking-wider transition-colors",
                  resetArmed ? "rounded border border-dw-red bg-dw-red/15 px-2 py-1 text-dw-red" : "text-ink3 hover:text-dw-red"
                )}
              >
                <RotateCcw className="h-3 w-3" /> {resetArmed ? "Yes, reset" : "Reset Backstory"}
              </button>
            </div>
          </div>

          {/* Bio displaying drops cap */}
          <div className="prose prose-invert max-w-none font-serif text-sm text-ink leading-relaxed space-y-4">
            {backstory.bio.split("\n\n").map((para, i) =>
              i === 0 ? (
                // Editorial drop cap — the CSS styles the paragraph's real first letter.
                <p key={i} className="first-letter:float-left first-letter:text-5xl first-letter:font-headline first-letter:font-bold first-letter:mr-2 first-letter:text-dw-accent">
                  {para}
                </p>
              ) : (
                <p key={i}>{para}</p>
              )
            )}
          </div>

          <div className="h-px bg-dw-border my-4" />

          {/* Key environmental characters board */}
          <div>
            <h4 className="font-headline text-xs uppercase tracking-widest text-ink3 mb-3">Environmental Stances</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* AD Card */}
              <div className="rounded border border-dw-border bg-paper p-3 space-y-2">
                <div className="flex items-center gap-2 text-ink3">
                  <Building className="h-4 w-4" />
                  <span className="font-sans text-[10px] uppercase tracking-wider font-semibold">Athletic Director</span>
                </div>
                <p className="font-headline text-sm uppercase text-ink">{backstory.adName}</p>
                <div className="pt-1.5 border-t border-dw-border/40">
                  <span className={cn("text-[10px] font-bold uppercase tracking-wider", adStance.color)}>
                    {adStance.label}
                  </span>
                  <p className="mt-0.5 font-serif text-[11px] text-ink3 leading-snug">{adStance.desc}</p>
                </div>
              </div>

              {/* Booster Card */}
              <div className="rounded border border-dw-border bg-paper p-3 space-y-2">
                <div className="flex items-center gap-2 text-ink3">
                  <Landmark className="h-4 w-4" />
                  <span className="font-sans text-[10px] uppercase tracking-wider font-semibold">Lead Booster</span>
                </div>
                <p className="font-headline text-sm uppercase text-ink">{backstory.boosterName}</p>
                <div className="pt-1.5 border-t border-dw-border/40">
                  <span className={cn("text-[10px] font-bold uppercase tracking-wider", boosterStance.color)}>
                    {boosterStance.label}
                  </span>
                  <p className="mt-0.5 font-serif text-[11px] text-ink3 leading-snug">{boosterStance.desc}</p>
                </div>
              </div>

              {/* Reporter Card */}
              <div className="rounded border border-dw-border bg-paper p-3 space-y-2">
                <div className="flex items-center gap-2 text-ink3">
                  <Newspaper className="h-4 w-4" />
                  <span className="font-sans text-[10px] uppercase tracking-wider font-semibold">Principal Writer</span>
                </div>
                <p className="font-headline text-sm uppercase text-ink">{backstory.reporterName}</p>
                <div className="pt-1.5 border-t border-dw-border/40">
                  <span className={cn("text-[10px] font-bold uppercase tracking-wider", writerStance.color)}>
                    {writerStance.label}
                  </span>
                  <p className="mt-0.5 font-serif text-[11px] text-ink3 leading-snug">{writerStance.desc}</p>
                </div>
              </div>

              {/* Rival Coach Card */}
              <div className="rounded border border-dw-border bg-paper p-3 space-y-2">
                <div className="flex items-center gap-2 text-ink3">
                  <Flame className="h-4 w-4" />
                  <span className="font-sans text-[10px] uppercase tracking-wider font-semibold">Rival Head Coach</span>
                </div>
                <p className="font-headline text-sm uppercase text-ink">{backstory.rivalCoachName}</p>
                <div className="pt-1.5 border-t border-dw-border/40">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-ink2">
                    {rivalStance.label}
                  </span>
                  <p className="mt-0.5 font-serif text-[11px] text-ink3 leading-snug">{rivalStance.desc}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Season Snapshot & Pulse & Hot Seat ──────────────────────────── */}
      {team ? (
        <>
          <div>
            <h3 className="mb-3 font-headline text-xs uppercase tracking-widest text-ink3">
              Season Snapshot
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatBox label="Record" value={`${wins}-${losses}`} />
              <StatBox
                label="Media Rank"
                value={team.rankMedia ? `#${team.rankMedia}` : "NR"}
                sub={team.rankCFP ? `CFP #${team.rankCFP}` : undefined}
              />
              <StatBox
                label="Conf Record"
                value={
                  team.confWins != null && team.confLosses != null
                    ? `${team.confWins}-${team.confLosses}`
                    : "—"
                }
                sub={dynasty.conference || undefined}
              />
              <StatBox label="Win Rate" value={winPct} sub={`${gamesPlayed} played`} />
            </div>
          </div>

          {/* ── Program Pulse (degraded — save has record + prestige only) ─── */}
          <div>
            <h3 className="mb-3 font-headline text-xs uppercase tracking-widest text-ink3">
              Program Pulse
            </h3>
            <div className="rounded border border-dw-border bg-paper2 px-5 py-1">
              <PulseRow label="Standing">
                <span className={cn("font-sans text-sm font-semibold uppercase tracking-wider", standing.color)}>
                  {standing.label}
                </span>
              </PulseRow>
              <PulseRow label="Program Prestige">
                <span className="font-sans text-sm font-semibold uppercase tracking-wider text-ink2">
                  {typeof numericPrestige === "number" ? `${numericPrestige}/10` : prestige.label}
                </span>
              </PulseRow>
              <PulseRow label="Overall Rating">
                <span className="font-sans text-sm font-semibold uppercase tracking-wider text-ink2">
                  {team.ratingOVR != null ? team.ratingOVR : "—"}
                </span>
              </PulseRow>
            </div>
            <p className="mt-2 font-serif text-xs italic text-ink3">{standing.desc}</p>
          </div>

          {/* ── Hot Seat & Career (real coach data from the save) ──────────── */}
          {snapshot?.coach && (
            <div>
              <h3 className="mb-3 font-headline text-xs uppercase tracking-widest text-ink3">
                Hot Seat &amp; Career
              </h3>
              <div className="rounded border border-dw-border bg-paper2 px-5 py-1">
                <PulseRow label="Job Security">
                  <span
                    className={cn(
                      "font-sans text-sm font-semibold uppercase tracking-wider",
                      SEAT_COLOR[seat.level]
                    )}
                  >
                    {realJob ?? seat.label}
                    {seat.level === "volcanic" ? " · FIRE WATCH" : ""}
                  </span>
                </PulseRow>
                {snapshot.coach.careerWinSeasons != null && (
                  <PulseRow label="Winning Seasons">
                    <span className="font-sans text-sm font-semibold uppercase tracking-wider text-ink2">
                      {snapshot.coach.careerWinSeasons}
                    </span>
                  </PulseRow>
                )}
                {snapshot.coach.careerPlayoffs != null && (
                  <PulseRow label="Playoffs Made">
                    <span className="font-sans text-sm font-semibold uppercase tracking-wider text-ink2">
                      {snapshot.coach.careerPlayoffs}
                    </span>
                  </PulseRow>
                )}
                {snapshot.coach.careerLongWinStreak != null && (
                  <PulseRow label="Longest Win Streak">
                    <span className="font-sans text-sm font-semibold uppercase tracking-wider text-ink2">
                      {snapshot.coach.careerLongWinStreak}
                    </span>
                  </PulseRow>
                )}
                {snapshot.coach.age != null && (
                  <PulseRow label="Age">
                    <span className="font-sans text-sm font-semibold uppercase tracking-wider text-ink2">
                      {snapshot.coach.age}
                    </span>
                  </PulseRow>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
          <p className="font-serif text-ink2">
            No team data in this save yet. Play a week to start tracking your program.
          </p>
        </div>
      )}
    </div>
  );
}
