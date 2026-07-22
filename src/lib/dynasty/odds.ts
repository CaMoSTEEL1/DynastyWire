// Deterministic game-odds model for the pre-game front page. This is FLAVOR, not a
// sportsbook — a transparent power-rating projection derived entirely from the save
// (team OVR + record + poll rank), so the same matchup always yields the same line.
//
// Why blend three inputs: a team's raw TEAM_RATINGOVR (talent) under-credits a hot team —
// e.g. an undefeated #2 can carry only a mid OVR. Record (results) and poll rank (résumé)
// carry the rest, exactly like a real power rating.

export interface OddsTeam {
  name: string;
  ratingOVR: number | null;
  prestige: number | null;
  wins: number;
  losses: number;
  rankMedia: number | null;
}

export interface GameOdds {
  /** Team favored to win (name), or null for a true pick'em. */
  favorite: string | null;
  /** Spread as a positive number of points the favorite is laid (e.g. 6.5). */
  spread: number;
  /** Human line for the favorite, e.g. "Kansas State -6.5". */
  line: string;
  /** Win probability for the FIRST team passed (0-100, rounded). */
  homeWinPct: number;
  awayWinPct: number;
  /** American moneyline for each team (e.g. -240 / +190). */
  homeMoneyline: number;
  awayMoneyline: number;
  /** Projected total is deliberately omitted — the save gives us no pace signal. */
}

function power(t: OddsTeam): number {
  // Talent: TEAM_RATINGOVR (≈49 FCS … 96 elite). Fall back to prestige, then neutral.
  const talent =
    t.ratingOVR != null ? t.ratingOVR : t.prestige != null ? 55 + t.prestige * 4 : 72;
  // Results: reward win pct around a .500 baseline (undefeated ≈ +10, winless ≈ -10).
  const gp = t.wins + t.losses;
  const winPctBonus = gp > 0 ? ((t.wins / gp) - 0.5) * 20 : 0;
  // Résumé: a poll rank is worth up to +10 (No. 1) down to ~+0.4 (No. 25).
  const rankBonus = t.rankMedia && t.rankMedia <= 25 ? (26 - t.rankMedia) * 0.4 : 0;
  return talent + winPctBonus + rankBonus;
}

function moneyline(p: number): number {
  // p is a probability in (0,1). Standard fair-odds conversion, no vig.
  const clamped = Math.min(0.98, Math.max(0.02, p));
  if (clamped >= 0.5) return -Math.round((100 * clamped) / (1 - clamped) / 5) * 5;
  return Math.round((100 * (1 - clamped)) / clamped / 5) * 5;
}

/**
 * @param home the first team (the user's team in a home game, else the opponent)
 * @param away the second team
 * @param neutralSite postseason/bowl games have no home-field edge
 */
export function computeGameOdds(home: OddsTeam, away: OddsTeam, neutralSite: boolean): GameOdds {
  const hfa = neutralSite ? 0 : 2.3;
  // Home-perspective margin: power gap (scaled to scoreboard points) + home edge.
  let margin = (power(home) - power(away)) * 0.55 + hfa;
  margin = Math.max(-32, Math.min(32, margin));
  const spreadRounded = Math.round(margin * 2) / 2; // nearest half-point, home perspective

  // Win prob from the margin (logistic; ~3-pt fav ≈ 60%, 7 ≈ 73%, 14 ≈ 88%, 21 ≈ 95%).
  const homeP = 1 / (1 + Math.pow(10, -spreadRounded / 16));
  const homePct = Math.round(homeP * 100);

  const absSpread = Math.abs(spreadRounded);
  const favorite = absSpread < 1 ? null : spreadRounded > 0 ? home.name : away.name;
  const line = favorite ? `${favorite} -${absSpread.toFixed(1)}` : "Pick'em";

  return {
    favorite,
    spread: absSpread,
    line,
    homeWinPct: homePct,
    awayWinPct: 100 - homePct,
    homeMoneyline: moneyline(homeP),
    awayMoneyline: moneyline(1 - homeP),
  };
}
