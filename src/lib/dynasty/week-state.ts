// What kind of week is this? Shared by the generators (which frame every prompt around it)
// and the UI (which frames the podium takeover around it), so the screen can never say
// "post-game" while the model was told the game hasn't kicked off.

import type { DynastySnapshot, WeekDelta } from "./client";

export type WeekState = "game" | "pregame" | "preseason" | "bye" | "season-over";

/** The next unplayed game on the user's schedule, earliest first. */
export function nextScheduledGame(snapshot: DynastySnapshot | null | undefined) {
  const row = snapshot?.userTeamRow;
  if (row == null) return null;
  return (
    (snapshot?.games ?? [])
      .filter((g) => (g.homeRow === row || g.awayRow === row) && !g.played)
      .sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || (a.week ?? 0) - (b.week ?? 0))[0] ?? null
  );
}

/** The opponent of the next unplayed game, when the save knows who it is. */
export function nextOpponent(snapshot: DynastySnapshot | null | undefined) {
  const row = snapshot?.userTeamRow;
  const g = nextScheduledGame(snapshot);
  if (!g || row == null) return null;
  const oppRow = g.homeRow === row ? g.awayRow : g.homeRow;
  const opp = oppRow != null ? snapshot?.teams?.[String(oppRow)] ?? null : null;
  return opp ? { opp, game: g, userIsHome: g.homeRow === row } : null;
}

/**
 * A result this week means the game is in the books. Otherwise it is one of four real
 * states — and crucially NOT a vacuum to fill with an invented game: no games played at all
 * is preseason; this week's matchup already on the schedule is PREGAME (kickoff pending);
 * week 17+ with nothing scheduled is the season winding down; anything else is a bye.
 */
export function weekStateOf(
  snapshot: DynastySnapshot | null | undefined,
  delta: WeekDelta | null | undefined
): WeekState {
  if (delta?.userResult) return "game";

  const u = snapshot?.userTeam;
  const gamesPlayed = (u?.wins ?? 0) + (u?.losses ?? 0);
  if (gamesPlayed === 0) return "preseason";

  const next = nextScheduledGame(snapshot);
  const upcomingThisWeek =
    next != null && next.week != null && delta?.weekPlayed != null && next.week === delta.weekPlayed;
  if (upcomingThisWeek) return "pregame";

  if (delta?.weekPlayed != null && delta.weekPlayed >= 17) return "season-over";
  return "bye";
}
