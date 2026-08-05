"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/section-header";
import { useSettings } from "@/components/settings/settings-context";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useSaga } from "@/components/dynasty/use-saga";
import { getRoster, type RosterPlayer } from "@/lib/dynasty/client";
import { attackLine, playerProfile, profileLine } from "@/lib/dynasty/traits";
import {
  EDGE_LABEL,
  SEVERITY_LABEL,
  TIER_LABEL,
  formLine,
  playerLine,
  scoutingMath,
  starterLine,
  type EdgeVerdict,
} from "@/lib/dynasty/scouting";
import { issueKey, readTab, writeTab } from "@/lib/dynasty/issue-cache";
import { seatTemperature, SEAT_COLOR, PROGRAM_SITUATIONS, type CoachBackstory, type ProgramSituation } from "@/lib/dynasty/saga";
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
  RotateCcw,
  Pencil
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
// Two halves, deliberately: the INSTANT READ is computed from the save in code (free, no API
// call, and it cannot hallucinate), and the CALL SHEET is the AI game plan written on top of
// that same data. Everything is shaped to be read with a controller in hand — hence the
// play-call bullets, the opening script, and the copyable second-screen sheet.
//
// NO RATINGS ANYWHERE. A real staff has film, a jersey number, a class, and production — not
// an OVR column. Ratings stay inside the scouting module as an ordering signal and surface
// only as grades and tiers. If you are about to render a 0-99 number here, don't.
interface ScoutKeyPlayer { name: string; note: string; assignment?: string }
interface ScoutBullet { target: string; why: string; how: string }
interface ScoutReport {
  opponent: string;
  summary: string;
  offense: { identity: string; scheme: string; keyPlayers: ScoutKeyPlayer[]; howToStop: string; tendency?: string; calls?: string[] };
  defense: { identity: string; keyPlayers: ScoutKeyPlayer[]; howToAttack: string; scheme?: string; calls?: string[] };
  xFactor: string;
  keys: string[];
  // Added with the in-depth call sheet — optional so reports cached by an older build still
  // render instead of blanking out.
  bottomLine?: string;
  attack?: ScoutBullet[];
  beware?: ScoutBullet[];
  openingScript?: string[];
  situational?: { firstDown: string; thirdDown: string; redZone: string; fourthDown: string };
  adjustments?: { ifTrailing: string; ifLeading: string };
  gameFlow?: string;
  injuryImpact?: string;
  seriesRead?: string;
  specialTeams?: string;
  prediction?: { call: string; confidence: string };
  error?: boolean;
}

const EDGE_TONE: Record<EdgeVerdict, string> = {
  "decisive-edge": "text-dw-green",
  "clear-edge": "text-dw-green/80",
  "slight-edge": "text-dw-green/60",
  even: "text-ink3",
  "slight-disadvantage": "text-dw-red/60",
  "clear-disadvantage": "text-dw-red/80",
  "decisive-disadvantage": "text-dw-red",
};

const RESULT_TONE: Record<string, string> = { W: "text-dw-green", L: "text-dw-red", T: "text-ink3" };

// Small labelled block used across the call sheet.
function Block({ label, children, tone }: { label: string; children: React.ReactNode; tone?: string }) {
  return (
    <div>
      <p className={cn("font-sans text-[10px] uppercase tracking-widest", tone ?? "text-ink3")}>{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ScoutingReport() {
  const { snapshot, currentSavePath, generate, dynastyId, year, week, roster } = useDynasty();
  const [report, setReport] = useState<ScoutReport | null>(null);
  const [oppRoster, setOppRoster] = useState<RosterPlayer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
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

  // Restore a saved report for this exact opponent, and read the opponent's roster so the
  // instant read is on screen before the coach spends a single token on the AI half. The
  // roster parse is local and cached per save+team, so revisits are quick.
  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setOppRoster(null);
    if (!next) return;
    (async () => {
      const rec = await readTab<ScoutReport>(cacheKey, tab);
      if (!cancelled && rec?.data && !rec.data.error) setReport(rec.data);
      // getRoster with no teamIndex reads the USER's roster — so without one there is no
      // opponent roster to be had, and asking anyway would compare us against ourselves.
      if (!currentSavePath || next.opp.teamIndex == null) return;
      try {
        const list = await getRoster(currentSavePath, undefined, next.opp.teamIndex);
        if (!cancelled) setOppRoster(list);
      } catch {
        // No roster = no instant read; the AI half still works off what the save gave us.
      }
    })();
    return () => { cancelled = true; };
  }, [cacheKey, tab, next?.opp.teamIndex, currentSavePath]);

  // The deterministic half: graded unit edges, phase matchups, mismatches, soft spots,
  // injuries, tendencies, special teams — plus the schedule-derived half a real report opens
  // with (recent form, common opponents, the series, quarter-by-quarter scoring).
  const math = useMemo(
    () =>
      oppRoster && oppRoster.length
        ? scoutingMath(roster ?? [], oppRoster, {
            games: snapshot?.games ?? [],
            teams: snapshot?.teams ?? {},
            myRow: snapshot?.userTeamRow,
            theirRow: next?.opp.row,
          })
        : null,
    [roster, oppRoster, snapshot, next?.opp.row]
  );

  const run = useCallback(async () => {
    if (!next || !currentSavePath) return;
    setLoading(true);
    setErr(null);
    try {
      // Same guard as the mount fetch: no teamIndex means we cannot read THEIR roster, and
      // handing the model our own would poison every named player in the report.
      const opp =
        oppRoster ??
        (next.opp.teamIndex != null
          ? await getRoster(currentSavePath, undefined, next.opp.teamIndex)
          : []);
      if (!oppRoster && opp.length) setOppRoster(opp);
      const data = await generate<ScoutReport>(
        "scouting",
        {
          oppName: next.opp.name,
          oppRecord: `${next.opp.wins}-${next.opp.losses}`,
          oppRank: next.opp.rankMedia ?? undefined,
          // The row keys the schedule lookups (form, common opponents, the series).
          oppRow: next.opp.row,
          oppRoster: opp,
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
  }, [next, currentSavePath, oppRoster, generate, cacheKey, tab, dynastyId, year, week]);

  // Plain-text call sheet for a second screen / phone while the game is running. Built from
  // the same two halves that are on screen, so what you paste is what you read.
  const copySheet = useCallback(async () => {
    if (!next) return;
    const L: string[] = [`SCOUTING — ${next.opp.name} (${next.opp.wins}-${next.opp.losses})${next.week != null ? ` · Week ${next.week}` : ""} · ${next.userIsHome ? "home" : "away"}`];
    if (report?.bottomLine) L.push("", report.bottomLine);
    if (math) {
      const sc = math.schedule;
      if (sc?.form.games.length) {
        L.push("", `THEIR FORM (${sc.form.streak ?? ""})`);
        for (const g of sc.form.games) L.push(`  ${formLine(g)}`);
      }
      if (sc?.common.length) {
        L.push("", "COMMON OPPONENTS");
        for (const c of sc.common) L.push(`  ${c.opponent}: us ${formLine(c.yours)} | them ${formLine(c.theirs)}`);
      }
      if (sc?.quarters.read) L.push("", "GAME FLOW", `  ${sc.quarters.read}`);
      L.push("", "MATCHUPS");
      for (const m of math.matchups) {
        if (!m.verdict) continue;
        L.push(`  ${m.label}: ${EDGE_LABEL[m.verdict]} — ${m.call}`);
      }
      if (math.mismatches.length) {
        L.push("", "GO AT");
        for (const x of math.mismatches) {
          L.push(`  ${starterLine(x.mine)} vs ${starterLine(x.theirs, true)} — ${SEVERITY_LABEL[x.severity]}`);
        }
      }
      if (math.threats.length) {
        L.push("", "THEIR THREATS");
        for (const s of math.threats) {
          const prof = profileLine(s.player);
          L.push(`  ${starterLine(s)}${prof ? ` — ${prof}` : ""}`);
        }
      }
      if (math.weakLinks.length) {
        L.push("", "GO AT THESE SPOTS");
        for (const s of math.weakLinks) {
          const how = attackLine(s.player);
          if (how) L.push(`  ${starterLine(s)} — ${how}`);
        }
      }
      if (math.injuries.length) {
        L.push("", "THEIR INJURIES");
        for (const i of math.injuries.slice(0, 6)) L.push(`  ${playerLine(i.player)} ${i.player.position ?? "?"} — ${i.status}`);
      }
    }
    if (report?.openingScript?.length) {
      L.push("", "OPENING SCRIPT");
      report.openingScript.forEach((p, i) => L.push(`  ${i + 1}. ${p}`));
    }
    if (report?.defense.calls?.length) {
      L.push("", "OFFENSIVE CALLS");
      for (const c of report.defense.calls) L.push(`  • ${c}`);
    }
    if (report?.offense.calls?.length) {
      L.push("", "DEFENSIVE CALLS");
      for (const c of report.offense.calls) L.push(`  • ${c}`);
    }
    if (report?.keys.length) {
      L.push("", "KEYS");
      for (const k of report.keys) L.push(`  • ${k}`);
    }
    try {
      await navigator.clipboard.writeText(L.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setErr("Couldn't reach the clipboard.");
    }
  }, [next, report, math]);

  if (!next) return null;

  const KP = ({ list }: { list: ScoutKeyPlayer[] }) => (
    <ul className="mt-1 space-y-1.5">
      {list.map((p, i) => (
        <li key={i} className="font-serif text-sm text-ink2">
          <span className="font-sans text-xs uppercase tracking-wider text-ink">{p.name}</span> — {p.note}
          {p.assignment && (
            <span className="mt-0.5 block text-[13px] text-ink3">
              <span className="font-sans text-[10px] uppercase tracking-wider text-dw-accent2">Assignment:</span>{" "}
              {p.assignment}
            </span>
          )}
        </li>
      ))}
    </ul>
  );

  const t = math?.tendencies;
  const st = math?.specialTeams;
  const sched = math?.schedule ?? null;
  const tendencyBits = t
    ? [
        t.passRate != null ? `${t.passRate}% pass` : null,
        t.yardsPerAtt != null ? `${t.yardsPerAtt} yds/att` : null,
        t.completionPct != null ? `${t.completionPct}% comp` : null,
        t.yardsPerCarry != null ? `${t.yardsPerCarry} yds/carry` : null,
        `${t.passTDs} TD / ${t.passInts} INT`,
        t.sacksPerGame != null ? `${t.sacksPerGame} sacks/g` : null,
        t.takeawaysPerGame != null ? `${t.takeawaysPerGame} takeaways/g` : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="overflow-hidden rounded border border-dw-border bg-paper2">
      <div className="h-1 w-full bg-gradient-to-r from-dw-accent2 to-dw-accent" />
      <div className="px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Next Up · Scouting Desk</p>
            <h3 className="font-headline text-xl uppercase tracking-wide text-ink">
              {next.opp.rankMedia ? `#${next.opp.rankMedia} ` : ""}{next.opp.name}
              <span className="ml-2 font-sans text-xs text-ink3">
                ({next.opp.wins}-{next.opp.losses}){next.week != null ? ` · Week ${next.week}` : ""} · {next.userIsHome ? "home" : "away"}
              </span>
            </h3>
            {math?.overallVerdict && (
              <p className="mt-1 font-sans text-[10px] uppercase tracking-wider text-ink3">
                Talent on the field{" "}
                <span className={cn("font-semibold", EDGE_TONE[math.overallVerdict])}>
                  {EDGE_LABEL[math.overallVerdict]}
                </span>
                {t?.games != null ? ` · ${t.games} games of film` : ""}
                {sched?.form.streak ? ` · ${sched.form.streak}` : ""}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(report || math) && (
              <button
                type="button"
                onClick={() => void copySheet()}
                className="rounded border border-dw-border px-3 py-1.5 font-sans text-[10px] uppercase tracking-wider text-ink3 hover:text-ink"
                title="Copy a plain-text call sheet for a second screen while you play"
              >
                {copied ? "Copied" : "Copy call sheet"}
              </button>
            )}
            {(!report || loading) ? (
              <button
                type="button"
                onClick={() => void run()}
                disabled={loading}
                className="rounded border border-dw-accent bg-dw-accent px-4 py-2 font-sans text-xs uppercase tracking-wider text-paper hover:bg-dw-accent2 disabled:opacity-50"
              >
                {loading ? "Breaking down film…" : "Pull the Call Sheet"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void run()}
                className="rounded border border-dw-border px-3 py-1.5 font-sans text-[10px] uppercase tracking-wider text-ink3 hover:text-ink"
              >
                Refresh
              </button>
            )}
          </div>
        </div>

        {err && <p className="mt-3 font-serif text-sm text-dw-red">{err}</p>}

        {/* ── The instant read: computed, free, on screen before any AI call ── */}
        {math && (
          <div className="mt-5 space-y-5 rounded border border-dw-border bg-paper px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent">The Instant Read</p>
              <p className="font-sans text-[10px] text-ink3">off the save · film grades, no AI</p>
            </div>

            {/* What both teams line up in — straight from the save, no inference. */}
            {math.schemes && math.schemes.notes.length > 0 && (
              <Block label="What they line up in">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {math.schemes.theirOffense && (
                    <span className="font-sans text-[11px] uppercase tracking-wider text-ink">
                      Offense <span className="text-dw-accent2">{math.schemes.theirOffense}</span>
                    </span>
                  )}
                  {math.schemes.theirDefense && (
                    <span className="font-sans text-[11px] uppercase tracking-wider text-ink">
                      Defense <span className="text-dw-accent2">{math.schemes.theirDefense}</span>
                      {math.schemes.theirBox != null && (
                        <span className="text-ink3"> · {math.schemes.theirBox} in the box</span>
                      )}
                    </span>
                  )}
                </div>
                <ul className="mt-1.5 space-y-1">
                  {math.schemes.notes.map((n, i) => (
                    <li key={i} className="font-serif text-[13px] leading-snug text-ink2">{n}</li>
                  ))}
                </ul>
                {(math.schemes.yourOffense || math.schemes.yourDefense) && (
                  <p className="mt-1.5 font-sans text-[10px] text-ink3">
                    You run {math.schemes.yourOffense ?? "—"} / {math.schemes.yourDefense ?? "—"}
                  </p>
                )}
              </Block>
            )}

            {/* Form and common opponents — how a real report opens. */}
            {sched && (sched.form.games.length > 0 || sched.common.length > 0) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {sched.form.games.length > 0 && (
                  <Block label="Their last four">
                    <ul className="space-y-0.5">
                      {sched.form.games.map((g, i) => (
                        <li key={i} className="font-serif text-[13px] text-ink2">
                          <span className={cn("font-sans text-[11px] font-semibold", RESULT_TONE[g.result])}>{g.result}</span>{" "}
                          {g.pointsFor}-{g.pointsAgainst} {g.home ? "vs" : "at"}{" "}
                          {g.oppRank ? <span className="text-dw-accent2">#{g.oppRank} </span> : null}
                          {g.opponent ?? "—"}
                        </li>
                      ))}
                    </ul>
                    {sched.form.pointsForPerGame != null && (
                      <p className="mt-1 font-sans text-[10px] text-ink3">
                        {sched.form.pointsForPerGame} scored / {sched.form.pointsAgainstPerGame} allowed per game
                      </p>
                    )}
                  </Block>
                )}
                {sched.common.length > 0 && (
                  <Block label="Common opponents">
                    <ul className="space-y-1">
                      {sched.common.map((c, i) => (
                        <li key={i} className="font-serif text-[13px] leading-snug text-ink2">
                          <span className="font-sans text-[11px] uppercase tracking-wider text-ink">{c.opponent}</span>
                          <br />
                          us {formLine(c.yours).replace(` ${c.opponent}`, "")} · them{" "}
                          {formLine(c.theirs).replace(` ${c.opponent}`, "")}
                        </li>
                      ))}
                    </ul>
                  </Block>
                )}
              </div>
            )}

            {sched?.quarters.read && (
              <Block label="When they do their damage">
                <p className="font-serif text-[13px] leading-snug text-ink2">{sched.quarters.read}</p>
                <p className="mt-1 font-sans text-[10px] text-ink3">
                  Scoring by quarter {sched.quarters.scoredPerQuarter.join(" / ")} · allowing{" "}
                  {sched.quarters.allowedPerQuarter.join(" / ")}
                </p>
              </Block>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              {math.matchups.filter((m) => m.verdict != null).map((m) => (
                <div key={m.label} className="rounded border border-dw-border/60 bg-paper2 px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-sans text-[10px] uppercase tracking-wider text-ink2">{m.label}</p>
                    <p className={cn("font-sans text-[10px] font-semibold uppercase tracking-wider", EDGE_TONE[m.verdict!])}>
                      {EDGE_LABEL[m.verdict!]}
                    </p>
                  </div>
                  <p className="mt-1 font-serif text-[13px] leading-snug text-ink2">{m.call}</p>
                  <p className="mt-1 font-sans text-[10px] text-ink3">
                    us {m.myGrade ?? "—"} · them {m.theirGrade ?? "—"}
                  </p>
                </div>
              ))}
            </div>

            <div>
              <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">Unit report card</p>
              <div className="mt-1 grid gap-x-6 sm:grid-cols-2">
                {math.edges.filter((e) => e.verdict != null).map((e) => (
                  <div key={e.unit} className="flex items-baseline justify-between border-b border-dw-border/40 py-1">
                    <span className="font-sans text-[11px] uppercase tracking-wider text-ink2">{e.label}</span>
                    <span className="font-sans text-[11px] text-ink3">
                      <span className="text-ink">{e.myGrade}</span> <span className="opacity-50">vs</span> {e.theirGrade}
                      <span className={cn("ml-2 font-semibold", EDGE_TONE[e.verdict!])}>{EDGE_LABEL[e.verdict!]}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {math.mismatches.length > 0 && (
                <Block label="Go at" tone="text-dw-green">
                  <ul className="space-y-1">
                    {math.mismatches.map((x, i) => (
                      <li key={i} className="font-serif text-[13px] leading-snug text-ink2">
                        <span className="font-sans text-[11px] uppercase tracking-wider text-ink">{starterLine(x.mine)}</span>
                        <br />
                        vs their {starterLine(x.theirs)}{" "}
                        <span className="text-dw-green">({SEVERITY_LABEL[x.severity]})</span>
                        {(() => {
                          const how = attackLine(x.theirs.player);
                          return how ? <span className="block text-dw-green">{how}</span> : null;
                        })()}
                      </li>
                    ))}
                  </ul>
                </Block>
              )}
              {math.threats.length > 0 && (
                <Block label="Their threats" tone="text-dw-red">
                  <ul className="space-y-1.5">
                    {math.threats.map((s, i) => {
                      const prof = playerProfile(s.player);
                      return (
                        <li key={i} className="font-serif text-[13px] leading-snug text-ink2">
                          {starterLine(s)}
                          {prof.archetype && (
                            <span className="ml-1 font-sans text-[10px] uppercase tracking-wider text-dw-accent2">
                              {prof.archetype}
                            </span>
                          )}
                          {prof.threats.length > 0 && (
                            <span className="block text-ink3">{prof.threats.join(" · ")}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Block>
              )}
              {math.weakLinks.length > 0 && (
                <Block label="Their soft spots">
                  <ul className="space-y-1.5">
                    {math.weakLinks.map((s, i) => {
                      const prof = playerProfile(s.player);
                      return (
                        <li key={i} className="font-serif text-[13px] leading-snug text-ink2">
                          {starterLine(s)}
                          {prof.archetype && (
                            <span className="ml-1 font-sans text-[10px] uppercase tracking-wider text-ink3">
                              {prof.archetype}
                            </span>
                          )}
                          {prof.weaknesses.length > 0 ? (
                            <span className="block text-dw-green">{prof.weaknesses.join(" · ")}</span>
                          ) : (
                            <span className="block text-ink3">{TIER_LABEL[s.tier]}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Block>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Block label="Experience">
                <p className="font-serif text-[13px] leading-snug text-ink2">{math.experience.read}</p>
              </Block>
              {math.dropOffs.length > 0 && (
                <Block label="They can't afford to lose">
                  <ul className="space-y-0.5">
                    {math.dropOffs.map((d, i) => (
                      <li key={i} className="font-serif text-[13px] leading-snug text-ink2">
                        {d.slot} {playerLine(d.starter)}{" "}
                        <span className="text-ink3">
                          — {d.backup ? `steep drop to ${playerLine(d.backup)}` : "nothing behind him"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Block>
              )}
            </div>

            {tendencyBits.length > 0 && (
              <Block label={`How they call it — ${t?.identity ?? ""}`}>
                <p className="font-sans text-[11px] text-ink2">{tendencyBits.join(" · ")}</p>
              </Block>
            )}

            {math.injuries.length > 0 && (
              <Block label="Their injuries" tone="text-dw-accent2">
                <ul className="space-y-0.5">
                  {math.injuries.slice(0, 6).map((i, k) => (
                    <li key={k} className="font-serif text-[13px] text-ink2">
                      {playerLine(i.player)} <span className="text-ink3">{i.player.position ?? "?"}</span> — {i.status}
                    </li>
                  ))}
                </ul>
              </Block>
            )}

            {st && (st.kicker || st.punter || st.returnThreats.length > 0) && (
              <Block label="Special teams">
                <ul className="space-y-0.5 font-serif text-[13px] text-ink2">
                  {st.kicker && (
                    <li>
                      K {st.kicker.name}
                      {st.kicker.fgAtt > 0 ? ` — ${st.kicker.fgMade}/${st.kicker.fgAtt} FG` : ""}
                      {st.kicker.fgLong ? `, long ${st.kicker.fgLong}` : ""}
                      {st.kicker.att50 ? `, ${st.kicker.made50 ?? 0}/${st.kicker.att50} from 50+` : ""}
                    </li>
                  )}
                  {st.punter && (
                    <li>
                      P {st.punter.name}
                      {st.punter.avg ? ` — ${st.punter.avg} yd avg` : ""}
                      {st.punter.in20 ? `, ${st.punter.in20} inside the 20` : ""}
                    </li>
                  )}
                  {st.returnThreats.map((r, i) => (
                    <li key={i}>
                      Return threat: {r.name}
                      {r.position ? ` (${r.position})` : ""} — {r.retYds} ret yds
                      {r.kickRetTDs + r.puntRetTDs > 0 ? `, ${r.kickRetTDs + r.puntRetTDs} TD` : ""}
                    </li>
                  ))}
                </ul>
              </Block>
            )}
          </div>
        )}

        {/* ── The AI call sheet ── */}
        {report && (
          <div className="mt-5 space-y-5">
            {report.bottomLine && (
              <p className="border-l-2 border-dw-accent2 pl-3 font-headline text-lg leading-snug text-ink">{report.bottomLine}</p>
            )}
            <p className="font-serif leading-relaxed text-ink">{report.summary}</p>

            {(report.attack?.length || report.beware?.length) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {report.attack && report.attack.length > 0 && (
                  <div className="rounded border border-dw-green/30 bg-dw-green/5 px-4 py-3">
                    <p className="font-sans text-[10px] uppercase tracking-widest text-dw-green">Attack here</p>
                    <ul className="mt-2 space-y-2">
                      {report.attack.map((a, i) => (
                        <li key={i} className="font-serif text-sm text-ink2">
                          <span className="font-sans text-xs uppercase tracking-wider text-ink">{a.target}</span>
                          {a.why && <span className="text-ink3"> — {a.why}</span>}
                          {a.how && <span className="block">{a.how}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {report.beware && report.beware.length > 0 && (
                  <div className="rounded border border-dw-red/30 bg-dw-red/5 px-4 py-3">
                    <p className="font-sans text-[10px] uppercase tracking-widest text-dw-red">Beware</p>
                    <ul className="mt-2 space-y-2">
                      {report.beware.map((b, i) => (
                        <li key={i} className="font-serif text-sm text-ink2">
                          <span className="font-sans text-xs uppercase tracking-wider text-ink">{b.target}</span>
                          {b.why && <span className="text-ink3"> — {b.why}</span>}
                          {b.how && <span className="block">{b.how}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {report.openingScript && report.openingScript.length > 0 && (
              <div className="rounded border border-dw-accent2/30 bg-dw-accent2/5 px-4 py-3">
                <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Opening script</p>
                <ol className="mt-2 space-y-1">
                  {report.openingScript.map((p, i) => (
                    <li key={i} className="font-serif text-sm text-ink2">
                      <span className="font-sans text-[11px] text-dw-accent2">{i + 1}.</span> {p}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {report.gameFlow && <p className="font-serif text-sm leading-relaxed text-ink2">{report.gameFlow}</p>}

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="rounded border border-dw-border bg-paper px-4 py-3">
                <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent">Their Offense</p>
                <p className="mt-1 font-sans text-xs text-ink3">
                  {report.offense.identity}{report.offense.scheme ? ` · ${report.offense.scheme}` : ""}
                </p>
                {report.offense.tendency && (
                  <p className="mt-2 font-serif text-sm text-ink2">{report.offense.tendency}</p>
                )}
                <KP list={report.offense.keyPlayers} />
                {report.offense.howToStop && (
                  <p className="mt-2 border-t border-dw-border pt-2 font-serif text-sm text-ink2"><span className="font-sans text-[10px] uppercase tracking-wider text-dw-green">How to stop them:</span> {report.offense.howToStop}</p>
                )}
                {report.offense.calls && report.offense.calls.length > 0 && (
                  <div className="mt-3 border-t border-dw-border pt-2">
                    <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Call this on defense</p>
                    <ul className="mt-1 space-y-1">
                      {report.offense.calls.map((c, i) => (
                        <li key={i} className="font-serif text-sm text-ink2">• {c}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="rounded border border-dw-border bg-paper px-4 py-3">
                <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent">Their Defense</p>
                <p className="mt-1 font-sans text-xs text-ink3">
                  {report.defense.identity}{report.defense.scheme ? ` · ${report.defense.scheme}` : ""}
                </p>
                <KP list={report.defense.keyPlayers} />
                {report.defense.howToAttack && (
                  <p className="mt-2 border-t border-dw-border pt-2 font-serif text-sm text-ink2"><span className="font-sans text-[10px] uppercase tracking-wider text-dw-green">How to attack them:</span> {report.defense.howToAttack}</p>
                )}
                {report.defense.calls && report.defense.calls.length > 0 && (
                  <div className="mt-3 border-t border-dw-border pt-2">
                    <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Call this on offense</p>
                    <ul className="mt-1 space-y-1">
                      {report.defense.calls.map((c, i) => (
                        <li key={i} className="font-serif text-sm text-ink2">• {c}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {report.situational && Object.values(report.situational).some(Boolean) && (
              <div>
                <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">Situational</p>
                <div className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  {([
                    ["First down", report.situational.firstDown],
                    ["Third down", report.situational.thirdDown],
                    ["Red zone", report.situational.redZone],
                    ["Fourth down", report.situational.fourthDown],
                  ] as const)
                    .filter(([, v]) => !!v)
                    .map(([label, v]) => (
                      <p key={label} className="border-b border-dw-border/40 py-1 font-serif text-sm text-ink2">
                        <span className="font-sans text-[10px] uppercase tracking-wider text-ink">{label}:</span> {v}
                      </p>
                    ))}
                </div>
              </div>
            )}

            {report.adjustments && (report.adjustments.ifTrailing || report.adjustments.ifLeading) && (
              <div>
                <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">In-game adjustments</p>
                <div className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  {report.adjustments.ifTrailing && (
                    <p className="border-b border-dw-border/40 py-1 font-serif text-sm text-ink2">
                      <span className="font-sans text-[10px] uppercase tracking-wider text-dw-red">If trailing:</span>{" "}
                      {report.adjustments.ifTrailing}
                    </p>
                  )}
                  {report.adjustments.ifLeading && (
                    <p className="border-b border-dw-border/40 py-1 font-serif text-sm text-ink2">
                      <span className="font-sans text-[10px] uppercase tracking-wider text-dw-green">If leading:</span>{" "}
                      {report.adjustments.ifLeading}
                    </p>
                  )}
                </div>
              </div>
            )}

            {report.seriesRead && (
              <p className="font-serif text-sm text-ink2"><span className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">The series:</span> {report.seriesRead}</p>
            )}
            {report.injuryImpact && (
              <p className="font-serif text-sm text-ink2"><span className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Injury impact:</span> {report.injuryImpact}</p>
            )}
            {report.specialTeams && (
              <p className="font-serif text-sm text-ink2"><span className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Special teams:</span> {report.specialTeams}</p>
            )}
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
            {report.prediction?.call && (
              <p className="border-t border-dw-border pt-3 font-serif text-sm text-ink2">
                <span className="font-sans text-[10px] uppercase tracking-widest text-dw-accent">Staff prediction:</span> {report.prediction.call}
                {report.prediction.confidence ? <span className="ml-2 font-sans text-[10px] uppercase tracking-wider text-ink3">({report.prediction.confidence})</span> : null}
              </p>
            )}
          </div>
        )}

        {!report && !loading && !err && (
          <p className="mt-4 font-serif text-sm text-ink3">
            {math
              ? `The numbers above are already yours. Pull the call sheet for the game plan on top of them — the plays to call at ${next.opp.name}, who to go at, and what to stay away from.`
              : `Break down ${next.opp.name} before you play them — their scheme, stat leaders, and how to attack them, straight from their real roster.`}
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
  // The PROGRAM's own story — an FCS team that just moved up or a TeamBuilder school should
  // never be covered like a generic established FBS program.
  const [programSituation, setProgramSituation] = useState<ProgramSituation>("established");
  const [programNote, setProgramNote] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);
  // Rename the recurring cast (AD / booster / beat writer / rival). Editing these updates
  // every generator instantly, since the names ride into the shared media context.
  const [editingCast, setEditingCast] = useState(false);
  const [castDraft, setCastDraft] = useState({ adName: "", boosterName: "", reporterName: "", rivalCoachName: "" });

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
        programSituation,
        programNote: programNote.trim(),
      }, { force: true });
      if (!res || !res.bio) {
        throw new Error("The situation room returned an empty biography.");
      }
      // Keep the user's own program inputs on the record — the media context reads them
      // every week, not just at generation time.
      await saga.saveBackstory({
        ...res,
        programSituation,
        programNote: programNote.trim(),
      });
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

          {/* Program situation — the school's own origin story */}
          <div className="space-y-2">
            <label className="block text-[10px] uppercase tracking-wider text-ink3 font-semibold">
              Where Is This Program Coming From?
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PROGRAM_SITUATIONS.map((s) => {
                const active = programSituation === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setProgramSituation(s.id)}
                    className={cn(
                      "rounded border p-3 text-left transition-all",
                      active
                        ? "border-dw-accent bg-dw-accent/5 ring-1 ring-dw-accent"
                        : "border-dw-border bg-paper hover:border-ink3 hover:bg-paper3"
                    )}
                  >
                    <span className="block font-headline text-xs uppercase tracking-wide text-ink">{s.label}</span>
                    <span className="mt-0.5 block font-serif text-[11px] leading-snug text-ink3">{s.desc}</span>
                  </button>
                );
              })}
            </div>
            <input
              value={programNote}
              onChange={(e) => setProgramNote(e.target.value)}
              placeholder="Anything the media should know about the program — e.g. 'moved up from FCS in 2029, year two in the Sun Belt, still playing in a 20k stadium'"
              className="w-full rounded border border-dw-border bg-paper px-3 py-2.5 font-serif text-sm text-ink placeholder:text-ink3 focus:border-dw-accent/60 focus:outline-none"
            />
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
              {!resetArmed && (
                <button
                  type="button"
                  onClick={() => {
                    setCastDraft({
                      adName: backstory.adName ?? "",
                      boosterName: backstory.boosterName ?? "",
                      reporterName: backstory.reporterName ?? "",
                      rivalCoachName: backstory.rivalCoachName ?? "",
                    });
                    setEditingCast((v) => !v);
                  }}
                  className={cn(
                    "flex items-center gap-1 font-sans text-[10px] uppercase tracking-wider transition-colors",
                    editingCast ? "text-dw-accent" : "text-ink3 hover:text-dw-accent"
                  )}
                >
                  <Pencil className="h-3 w-3" /> Rename Cast
                </button>
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

          {editingCast && (
            <div className="rounded border border-dw-accent/40 bg-dw-accent/5 p-4">
              <p className="mb-3 font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Rename your recurring cast</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {([
                  ["adName", "Athletic Director"],
                  ["boosterName", "Lead Booster"],
                  ["reporterName", "Beat Writer"],
                  ["rivalCoachName", "Rival Head Coach"],
                ] as const).map(([key, label]) => (
                  <label key={key} className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-wider text-ink3">{label}</span>
                    <input
                      value={castDraft[key]}
                      onChange={(e) => setCastDraft((s) => ({ ...s, [key]: e.target.value }))}
                      className="w-full rounded border border-dw-border bg-paper px-3 py-2 font-serif text-sm text-ink focus:border-dw-accent/60 focus:outline-none"
                    />
                  </label>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    await saga.saveBackstory({
                      ...backstory,
                      adName: castDraft.adName.trim() || backstory.adName,
                      boosterName: castDraft.boosterName.trim() || backstory.boosterName,
                      reporterName: castDraft.reporterName.trim() || backstory.reporterName,
                      rivalCoachName: castDraft.rivalCoachName.trim() || backstory.rivalCoachName,
                    });
                    setEditingCast(false);
                  }}
                  className="rounded border border-dw-accent bg-dw-accent px-4 py-1.5 font-sans text-[10px] uppercase tracking-wider text-paper hover:bg-dw-accent2"
                >
                  Save names
                </button>
                <button
                  type="button"
                  onClick={() => setEditingCast(false)}
                  className="font-sans text-[10px] uppercase tracking-wider text-ink3 hover:text-ink"
                >
                  Cancel
                </button>
                <span className="font-sans text-[10px] text-ink3">Updates every story going forward.</span>
              </div>
            </div>
          )}

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

          {/* The program's own story, when it isn't a plain established FBS school */}
          {(backstory.programBio || backstory.programNote) && (
            <div className="rounded border border-dw-accent2/30 bg-dw-accent2/5 p-4">
              <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">
                The Program
                {backstory.programSituation
                  ? ` · ${PROGRAM_SITUATIONS.find((s) => s.id === backstory.programSituation)?.label ?? ""}`
                  : ""}
              </p>
              {backstory.programBio && (
                <p className="mt-1.5 whitespace-pre-line font-serif text-sm leading-relaxed text-ink2">
                  {backstory.programBio}
                </p>
              )}
              {backstory.programNote && (
                <p className="mt-2 font-serif text-[11px] italic text-ink3">
                  Your note: {backstory.programNote}
                </p>
              )}
            </div>
          )}

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
