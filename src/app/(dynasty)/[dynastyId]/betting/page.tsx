"use client";

// Play-money sportsbook — a for-fun secondary mechanic. Bet a fake bankroll on moneylines
// around your save; bets settle automatically when the games actually play. No NIL, no save
// writes, no real money.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { SectionHeader } from "@/components/ui/section-header";
import { computeGameOdds, type GameOdds } from "@/lib/dynasty/odds";
import { loadBetting, placeBet, settleBets, resetBankroll, moneylineProfit, SPREAD_PRICE, type BettingState, type Bet, type GameResult } from "@/lib/dynasty/betting";
import type { TeamInfo } from "@/lib/dynasty/client";
import { cn } from "@/lib/utils";

interface OpenGame {
  gameId: string;
  week: number | null;
  home: TeamInfo;
  away: TeamInfo;
  neutral: boolean;
  userInvolved: boolean;
}

const fmtMl = (m: number) => (m > 0 ? `+${m}` : `${m}`);

export default function BettingPage() {
  const { snapshot, dynastyId } = useDynasty();
  const [state, setState] = useState<BettingState | null>(null);
  const [stakes, setStakes] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const teams = snapshot?.teams ?? {};
  const userRow = snapshot?.userTeamRow ?? null;
  const confChamp = snapshot?.calendar?.confChampWeek ?? 16;

  const games = (snapshot?.games ?? []) as {
    week: number | null; year: number | null; homeRow: number | null; awayRow: number | null;
    homeScore: number | null; awayScore: number | null; played: boolean;
  }[];
  const maxYear = games.reduce((m, g) => (g.year != null && g.year > m ? g.year : m), -1);
  const gid = (g: { year: number | null; week: number | null; homeRow: number | null; awayRow: number | null }) =>
    `${g.year ?? 0}::${g.week ?? 0}::${g.homeRow ?? -1}::${g.awayRow ?? -1}`;

  // Settlement map from played games (current season) — winner + margin so both moneyline
  // and spread bets can grade.
  const results = useMemo(() => {
    const out: Record<string, GameResult> = {};
    for (const g of games) {
      if (!g.played) continue;
      if (maxYear >= 0 && g.year != null && g.year !== maxYear) continue;
      const hs = g.homeScore ?? 0, as = g.awayScore ?? 0;
      out[gid(g)] = { winner: hs === as ? "push" : hs > as ? "home" : "away", margin: hs - as };
    }
    return out;
  }, [games, maxYear]);

  // Upcoming board: unplayed current-season games involving the user or a ranked team.
  const board: OpenGame[] = useMemo(() => {
    const currentWeek = snapshot?.week ?? null;
    const out: OpenGame[] = [];
    for (const g of games) {
      if (g.played) continue;
      if (maxYear >= 0 && g.year != null && g.year !== maxYear) continue;
      if (currentWeek != null && g.week != null && g.week < currentWeek) continue;
      const home = g.homeRow != null ? teams[String(g.homeRow)] : null;
      const away = g.awayRow != null ? teams[String(g.awayRow)] : null;
      if (!home || !away) continue;
      const userInvolved = g.homeRow === userRow || g.awayRow === userRow;
      const ranked = (home.rankMedia && home.rankMedia <= 25) || (away.rankMedia && away.rankMedia <= 25);
      if (!userInvolved && !ranked) continue;
      out.push({ gameId: gid(g), week: g.week, home, away, neutral: g.week != null && g.week > confChamp, userInvolved });
    }
    out.sort((a, b) => (a.userInvolved === b.userInvolved ? (a.week ?? 0) - (b.week ?? 0) : a.userInvolved ? -1 : 1));
    return out.slice(0, 24);
  }, [games, teams, userRow, maxYear, confChamp, snapshot?.week]);

  // Load + settle on mount / when results change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadBetting(dynastyId);
      const settled = await settleBets(dynastyId, results, Date.now());
      if (!cancelled) setState(settled);
    })();
    return () => { cancelled = true; };
  }, [dynastyId, results]);

  const oddsFor = useCallback((g: OpenGame): GameOdds => computeGameOdds(
    { name: g.home.name, ratingOVR: g.home.ratingOVR, prestige: g.home.prestige, wins: g.home.wins, losses: g.home.losses, rankMedia: g.home.rankMedia },
    { name: g.away.name, ratingOVR: g.away.ratingOVR, prestige: g.away.prestige, wins: g.away.wins, losses: g.away.losses, rankMedia: g.away.rankMedia },
    g.neutral
  ), []);

  const bet = useCallback(async (g: OpenGame, side: "home" | "away", betType: "moneyline" | "spread") => {
    const stake = Math.round(stakes[g.gameId] || 0);
    if (!stake || stake <= 0) { setMsg("Enter a stake first."); return; }
    if (!state || stake > state.bankroll) { setMsg("Not enough in the bankroll."); return; }
    const odds = oddsFor(g);
    const pickName = side === "home" ? g.home.name : g.away.name;
    // Spread relative to the picked team: the favorite lays the number, the dog takes it.
    const pickSpread = odds.favorite == null ? 0 : odds.favorite === pickName ? -odds.spread : odds.spread;
    const next = await placeBet(dynastyId, {
      gameId: g.gameId, week: g.week, side, betType,
      pickName,
      oppName: side === "home" ? g.away.name : g.home.name,
      moneyline: betType === "spread" ? SPREAD_PRICE : side === "home" ? odds.homeMoneyline : odds.awayMoneyline,
      spread: betType === "spread" ? pickSpread : undefined,
      stake,
    });
    setState(next);
    setStakes((s) => ({ ...s, [g.gameId]: 0 }));
    setMsg(null);
  }, [stakes, state, dynastyId, oddsFor]);

  const pending = state?.bets.filter((b) => !b.result) ?? [];
  const settled = state?.bets.filter((b) => b.result) ?? [];
  const hasBet = (gameId: string, side: "home" | "away", betType: "moneyline" | "spread") =>
    pending.some((b) => b.gameId === gameId && b.side === side && (b.betType ?? "moneyline") === betType);

  // Season betting record + net, from settled slips.
  const record = useMemo(() => {
    let w = 0, l = 0, p = 0, net = 0;
    for (const b of settled) {
      if (b.result === "win") w++;
      else if (b.result === "loss") l++;
      else p++;
      net += (b.payout ?? 0) - b.stake;
    }
    return { w, l, p, net: Math.round(net) };
  }, [settled]);

  return (
    <div className="space-y-6">
      <SectionHeader title="THE BOOK" subtitle="Play-money spreads & moneylines · just for fun" variant="rankings" />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-dw-border bg-paper2 px-6 py-4">
        <div className="flex flex-wrap items-center gap-8">
          <div>
            <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">Bankroll</p>
            <p className="font-headline text-3xl font-bold text-dw-green">${state ? state.bankroll.toLocaleString() : "—"}</p>
          </div>
          {settled.length > 0 && (
            <div>
              <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">Season Record</p>
              <p className="font-headline text-xl font-bold text-ink">
                {record.w}-{record.l}{record.p > 0 ? `-${record.p}` : ""}
                <span className={cn("ml-2 font-sans text-sm", record.net > 0 ? "text-dw-green" : record.net < 0 ? "text-dw-red" : "text-ink3")}>
                  {record.net >= 0 ? "+" : "-"}${Math.abs(record.net).toLocaleString()}
                </span>
              </p>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={async () => setState(await resetBankroll(dynastyId))}
          className="rounded border border-dw-border px-3 py-1.5 font-sans text-[10px] uppercase tracking-wider text-ink3 hover:text-ink"
        >
          Reset to $1,000
        </button>
      </div>
      {msg && <p className="font-serif text-sm text-dw-red">{msg}</p>}
      <p className="font-serif text-xs text-ink3">
        Fake money. No NIL, no save changes — purely a side game. Take the spread at -110 or the
        moneyline at the listed price; bets settle automatically when the games play.
      </p>

      {/* Board */}
      <div>
        <h3 className="mb-3 font-headline text-xs uppercase tracking-widest text-ink3">Open Lines</h3>
        {board.length === 0 && <p className="font-serif text-sm text-ink3">No upcoming games to bet on right now.</p>}
        <div className="space-y-3">
          {board.map((g) => {
            const odds = oddsFor(g);
            const stake = Math.round(stakes[g.gameId] || 0);
            const favPct = odds.favorite === g.away.name ? odds.awayWinPct : odds.homeWinPct;
            const Side = ({ side }: { side: "home" | "away" }) => {
              const t = side === "home" ? g.home : g.away;
              const ml = side === "home" ? odds.homeMoneyline : odds.awayMoneyline;
              // Spread from this team's perspective: the favorite lays it, the dog takes it.
              const sp = odds.favorite == null ? 0 : odds.favorite === t.name ? -odds.spread : odds.spread;
              const spLabel = odds.favorite == null ? "PK" : `${sp > 0 ? "+" : ""}${sp.toFixed(1)}`;
              const mlPlaced = hasBet(g.gameId, side, "moneyline");
              const spPlaced = hasBet(g.gameId, side, "spread");
              const wagerCls = (placed: boolean) => cn(
                "flex-1 rounded border px-2 py-1.5 text-center transition-colors",
                placed ? "border-dw-accent bg-dw-accent/10" : "border-dw-border hover:border-dw-accent/60 hover:bg-paper3"
              );
              return (
                <div className="flex-1">
                  <p className="mb-1 truncate font-sans text-xs uppercase tracking-wider text-ink">
                    {t.rankMedia ? `#${t.rankMedia} ` : ""}{t.name}
                    <span className="ml-1 text-[10px] normal-case tracking-normal text-ink3">({t.wins}-{t.losses})</span>
                  </p>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void bet(g, side, "spread")}
                      disabled={spPlaced}
                      title={stake > 0 ? `${spLabel} at -110 · win $${Math.round(moneylineProfit(stake, SPREAD_PRICE))}` : "Spread bet (-110)"}
                      className={wagerCls(spPlaced)}
                    >
                      <span className="block font-headline text-sm font-bold text-dw-accent2">{spLabel}</span>
                      <span className="font-sans text-[9px] text-ink3">{spPlaced ? "bet placed" : "-110"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void bet(g, side, "moneyline")}
                      disabled={mlPlaced}
                      title={stake > 0 ? `${fmtMl(ml)} · win $${Math.round(moneylineProfit(stake, ml))}` : "Moneyline bet"}
                      className={wagerCls(mlPlaced)}
                    >
                      <span className="block font-headline text-sm font-bold text-dw-accent2">{fmtMl(ml)}</span>
                      <span className="font-sans text-[9px] text-ink3">{mlPlaced ? "bet placed" : "ML"}</span>
                    </button>
                  </div>
                </div>
              );
            };
            return (
              <div key={g.gameId} className={cn("rounded border bg-paper2 p-3", g.userInvolved ? "border-dw-accent2/40" : "border-dw-border")}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-sans text-[10px] uppercase tracking-wider text-ink3">
                    Week {g.week ?? "—"}{g.neutral ? " · neutral" : ""}{g.userInvolved ? " · your game" : ""}
                    <span className="ml-2 text-dw-accent2">{odds.line}</span>
                    {odds.favorite && <span className="ml-1.5 normal-case tracking-normal">({favPct}% to win)</span>}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="font-sans text-[10px] text-ink3">$</span>
                    <input
                      type="number" min={0}
                      value={stakes[g.gameId] || ""}
                      onChange={(e) => setStakes((s) => ({ ...s, [g.gameId]: Math.max(0, Number(e.target.value) || 0) }))}
                      placeholder="stake"
                      className="w-20 rounded border border-dw-border bg-paper px-2 py-1 text-right font-sans text-xs text-ink focus:border-dw-accent2/60 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <Side side="away" />
                  <span className="pb-2 font-sans text-[10px] uppercase text-ink3">at</span>
                  <Side side="home" />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Slips */}
      {pending.length > 0 && (
        <div>
          <h3 className="mb-2 font-headline text-xs uppercase tracking-widest text-ink3">Open Bets</h3>
          <div className="rounded border border-dw-border bg-paper2">
            {pending.map((b, i) => (
              <BetRow key={i} b={b} />
            ))}
          </div>
        </div>
      )}
      {settled.length > 0 && (
        <div>
          <h3 className="mb-2 font-headline text-xs uppercase tracking-widest text-ink3">Settled</h3>
          <div className="rounded border border-dw-border bg-paper2">
            {settled.slice(0, 20).map((b, i) => (
              <BetRow key={i} b={b} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BetRow({ b }: { b: Bet }) {
  const color = b.result === "win" ? "text-dw-green" : b.result === "loss" ? "text-dw-red" : b.result === "push" ? "text-ink3" : "text-dw-accent2";
  const isSpread = (b.betType ?? "moneyline") === "spread" && b.spread != null;
  const wager = isSpread
    ? `${b.spread! > 0 ? "+" : ""}${b.spread!.toFixed(1)} (${b.moneyline})`
    : `ML ${b.moneyline > 0 ? `+${b.moneyline}` : b.moneyline}`;
  return (
    <div className="flex items-center justify-between border-b border-dw-border px-4 py-2.5 last:border-0">
      <div>
        <p className="font-serif text-sm text-ink">{b.pickName} <span className="font-sans text-[10px] text-ink3">vs {b.oppName} · Wk {b.week ?? "—"}</span></p>
        <p className="font-sans text-[10px] text-ink3">${b.stake} · {wager}</p>
      </div>
      <span className={cn("font-sans text-xs uppercase tracking-wider", color)}>
        {b.result ? (b.result === "win" ? `+$${((b.payout ?? 0) - b.stake).toFixed(0)}` : b.result === "push" ? "push" : `-$${b.stake}`) : "pending"}
      </span>
    </div>
  );
}
