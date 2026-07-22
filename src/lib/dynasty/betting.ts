// Play-money sportsbook — a purely-for-fun secondary mechanic. No NIL, no save writes, no
// real money: just a fake bankroll ("DynastyWire Bucks") you wager on moneylines around your
// save, settled when the games actually play. Persisted per dynasty in its own Tauri store.

import { LazyStore } from "@tauri-apps/plugin-store";

const store = new LazyStore("dynastywire.betting.json");
const STARTING_BANKROLL = 1000;
/** Standard juice on spread bets — both sides of the number pay -110. */
export const SPREAD_PRICE = -110;

export interface Bet {
  /** Stable game id: year::week::homeRow::awayRow. */
  gameId: string;
  week: number | null;
  side: "home" | "away";
  pickName: string; // team the user backed
  oppName: string;
  /** Wager type. Absent on bets placed before spreads existed → moneyline. */
  betType?: "moneyline" | "spread";
  moneyline: number; // American odds at placement (spread bets: the -110 juice)
  /** Spread bets only: the handicap RELATIVE TO THE PICKED TEAM at placement
   * (e.g. -6.5 laying points, +6.5 taking them). */
  spread?: number;
  stake: number;
  placedAt: number;
  /** Settlement — undefined while pending. */
  result?: "win" | "loss" | "push";
  payout?: number; // returned to bankroll on settle (0 on loss)
  settledAt?: number;
}

/** Final score of a played game, home perspective: margin = homeScore - awayScore. */
export interface GameResult {
  winner: "home" | "away" | "push";
  margin: number;
}

export interface BettingState {
  bankroll: number;
  bets: Bet[]; // open + settled, newest first
}

function key(dynastyId: string): string {
  return `betting::${dynastyId}`;
}

export async function loadBetting(dynastyId: string): Promise<BettingState> {
  const saved = await store.get<BettingState>(key(dynastyId));
  return saved ?? { bankroll: STARTING_BANKROLL, bets: [] };
}

async function save(dynastyId: string, state: BettingState): Promise<void> {
  await store.set(key(dynastyId), state);
  await store.save();
}

/** Profit on a winning American-moneyline wager (excludes the returned stake). */
export function moneylineProfit(stake: number, ml: number): number {
  return ml > 0 ? stake * (ml / 100) : stake * (100 / Math.abs(ml));
}

export async function placeBet(dynastyId: string, bet: Omit<Bet, "placedAt">): Promise<BettingState> {
  const state = await loadBetting(dynastyId);
  if (bet.stake <= 0 || bet.stake > state.bankroll) return state; // ignore invalid
  state.bankroll = Math.round((state.bankroll - bet.stake) * 100) / 100;
  state.bets.unshift({ ...bet, placedAt: Date.now() });
  await save(dynastyId, state);
  return state;
}

/** A bet's outcome against a final score. Moneyline: straight winner. Spread: the picked
 * team's margin plus the handicap taken at placement decides cover / push / miss. */
function betOutcome(b: Bet, r: GameResult): "win" | "loss" | "push" {
  if ((b.betType ?? "moneyline") === "spread" && b.spread != null) {
    const pickedMargin = b.side === "home" ? r.margin : -r.margin;
    const adj = pickedMargin + b.spread;
    if (adj > 0) return "win";
    if (adj < 0) return "loss";
    return "push";
  }
  if (r.winner === "push") return "push";
  return r.winner === b.side ? "win" : "loss";
}

/** Settle every pending bet whose game now has a final score. `results` maps gameId to the
 * final winner + home-perspective margin. Returns the updated state. */
export async function settleBets(
  dynastyId: string,
  results: Record<string, GameResult>,
  now: number
): Promise<BettingState> {
  const state = await loadBetting(dynastyId);
  let changed = false;
  for (const b of state.bets) {
    if (b.result) continue;
    const r = results[b.gameId];
    if (!r) continue;
    changed = true;
    const outcome = betOutcome(b, r);
    if (outcome === "push") {
      b.result = "push"; b.payout = b.stake; state.bankroll += b.stake;
    } else if (outcome === "win") {
      const profit = moneylineProfit(b.stake, b.moneyline);
      b.payout = Math.round((b.stake + profit) * 100) / 100;
      b.result = "win"; state.bankroll = Math.round((state.bankroll + b.payout) * 100) / 100;
    } else {
      b.result = "loss"; b.payout = 0;
    }
    b.settledAt = now;
  }
  if (changed) { state.bankroll = Math.round(state.bankroll * 100) / 100; await save(dynastyId, state); }
  return state;
}

export async function resetBankroll(dynastyId: string): Promise<BettingState> {
  const state: BettingState = { bankroll: STARTING_BANKROLL, bets: [] };
  await save(dynastyId, state);
  return state;
}
