// Diff two DynastySnapshots -> WeekDelta. The delta IS the week's story: it's what the
// AI generators consume to write articles, pressers, social, etc.

function teamName(snap, row) {
  if (row == null) return null;
  const t = snap.teams[row];
  return t ? t.name : `team#${row}`;
}

// Key games by the participating rows so we can match a game across snapshots even if
// SeasonGame record ordering shifts.
function gameKey(g) {
  return `${g.year}:${g.week}:${g.homeRow}:${g.awayRow}`;
}

function modeWeek(results) {
  const counts = {};
  for (const r of results) if (r.week != null) counts[r.week] = (counts[r.week] || 0) + 1;
  let best = null,
    bestN = -1;
  for (const [w, n] of Object.entries(counts)) if (n > bestN) (best = Number(w)), (bestN = n);
  return best;
}

function buildDelta(before, after) {
  const beforeByKey = new Map();
  for (const g of before.games) beforeByKey.set(gameKey(g), g);

  // Newly-played games: unplayed (or absent) before, played now.
  const results = [];
  for (const g of after.games) {
    if (!g.played) continue;
    const prev = beforeByKey.get(gameKey(g));
    if (prev && prev.played) continue; // already played before this diff
    const homeWon = (g.homeScore || 0) > (g.awayScore || 0);
    const winnerRow = homeWon ? g.homeRow : g.awayRow;
    const loserRow = homeWon ? g.awayRow : g.homeRow;
    results.push({
      week: g.week,
      home: teamName(after, g.homeRow),
      away: teamName(after, g.awayRow),
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      homeQuarters: g.homeQuarters,
      awayQuarters: g.awayQuarters,
      winner: teamName(after, winnerRow),
      loser: teamName(after, loserRow),
      margin: Math.abs((g.homeScore || 0) - (g.awayScore || 0)),
      rankHome: after.teams[g.homeRow] ? after.teams[g.homeRow].rankMedia : null,
      rankAway: after.teams[g.awayRow] ? after.teams[g.awayRow].rankMedia : null,
      userInvolved:
        after.userTeamRow != null &&
        (g.homeRow === after.userTeamRow || g.awayRow === after.userTeamRow),
      simmed: g.simmed,
    });
  }

  // Ranking moves for ranked teams.
  const rankingMoves = [];
  for (const row of Object.keys(after.teams)) {
    const a = after.teams[row];
    const b = before.teams[row];
    if (!b) continue;
    if (a.rankMedia !== b.rankMedia && (a.rankMedia || b.rankMedia)) {
      rankingMoves.push({
        team: a.name,
        from: b.rankMedia,
        to: a.rankMedia,
        delta: (b.rankMedia || 99) - (a.rankMedia || 99), // positive = moved up
      });
    }
  }
  // Surface only moves that touch the top 25 (hidden ranks 26+ are noise for a poll story).
  const topMoves = rankingMoves
    .filter((m) => (m.from && m.from <= 25) || (m.to && m.to <= 25))
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  // "This week's game" is the user's game AT the current week (SeasonInfo.CurrentWeek), and
  // its result is set ONLY when that game is actually played:
  //   • current-week game PLAYED   → POSTGAME (userResult = it)
  //   • current-week game UNPLAYED → PREGAME  (userResult stays null; the media context
  //                                            previews the matchup instead of recapping)
  //   • no current-week game       → BYE / season boundary (userResult null; handled downstream)
  //
  // THE BUG THIS FIXES: the old logic picked the latest PLAYED user game <= currentWeek, so the
  // moment you advanced to a new week without playing, it grabbed the PRIOR week's result and
  // the whole app (front page, press conference, podcasts) rendered a postgame recap of LAST
  // week — the "I can only do postgame / it only talks about the previous game" reports.
  const currentWeek = after.week;
  let userResult = null;
  if (after.userTeamRow != null && currentWeek != null) {
    const userGames = after.games.filter(
      (g) => g.homeRow === after.userTeamRow || g.awayRow === after.userTeamRow
    );
    // Same-season guard: prior seasons' rows live in the save with the SAME week numbers.
    // Without this, a played Week-1 game from LAST season matches "week === currentWeek"
    // and resurrects the fabricated-result bug on every season rollover.
    const maxYear = userGames.reduce((m, g) => (g.year != null && g.year > m ? g.year : m), -1);
    const sameSeason = (y) => y == null || maxYear < 0 || y === maxYear;
    const thisWeek = userGames.find((g) => sameSeason(g.year) && g.week === currentWeek);
    const g = thisWeek && thisWeek.played ? thisWeek : null; // unplayed/none → pregame/bye
    if (g) {
      const homeWon = (g.homeScore || 0) >= (g.awayScore || 0);
      const winnerRow = homeWon ? g.homeRow : g.awayRow;
      const loserRow = homeWon ? g.awayRow : g.homeRow;
      userResult = {
        week: g.week,
        home: teamName(after, g.homeRow),
        away: teamName(after, g.awayRow),
        homeScore: g.homeScore ?? 0,
        awayScore: g.awayScore ?? 0,
        homeQuarters: g.homeQuarters ?? [0, 0, 0, 0],
        awayQuarters: g.awayQuarters ?? [0, 0, 0, 0],
        winner: teamName(after, winnerRow),
        loser: teamName(after, loserRow),
        margin: Math.abs((g.homeScore || 0) - (g.awayScore || 0)),
        rankHome: after.teams[g.homeRow] ? after.teams[g.homeRow].rankMedia : null,
        rankAway: after.teams[g.awayRow] ? after.teams[g.awayRow].rankMedia : null,
        userInvolved: true,
        simmed: g.simmed,
      };
      if (!results.some((r) => r.week === g.week && r.home === userResult.home && r.away === userResult.away)) {
        results.push(userResult);
      }
    }
  }

  // weekPlayed drives pregame/postgame framing in gen.ts, so it must be the CURRENT week the
  // dynasty is on — not the mode of the diff (which lags to last week on a pregame ingest).
  let weekPlayed = currentWeek != null ? currentWeek : modeWeek(results);
  if (weekPlayed == null) weekPlayed = userResult ? userResult.week : after.week;

  return {
    weekPlayed,
    userTeam: after.userTeam ? after.userTeam.name : null,
    gamesPlayed: results.length,
    userResult,
    results,
    rankingMoves: topMoves,
  };
}

module.exports = { buildDelta };
