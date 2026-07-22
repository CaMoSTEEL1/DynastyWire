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

  // The week actually played = the most common week among this diff's results
  // (robust against stray placeholder game records that carry bowl/playoff week numbers).
  let weekPlayed = modeWeek(results);

  // The "this week's game" must sit within the current week progression. CFB27 saves carry
  // stray played records past the current week (e.g. a placeholder Week 17 game while the
  // season is only at Week 10); picking by highest week number grabs those. Bound selection
  // to <= the current week so we surface the real most-recent result.
  const currentWeek = after.week;
  const withinSeason = (w) => currentWeek == null || w == null || w <= currentWeek;

  // Fallback for userResult if none found in this diff (or if before === after)
  let userResult =
    results
      .filter((r) => r.userInvolved && withinSeason(r.week))
      .sort((a, b) => (b.week ?? 0) - (a.week ?? 0))[0] || null;

  if (!userResult && after.userTeamRow != null) {
    // Find all games involving the user's team
    const userGames = after.games.filter(g =>
      g.homeRow === after.userTeamRow || g.awayRow === after.userTeamRow
    );
    if (userGames.length > 0) {
      // Latest PLAYED game within the current week; else the next scheduled game to preview.
      const played = userGames.filter(g => g.played && withinSeason(g.week));
      const upcoming = userGames.filter(g => withinSeason(g.week));
      const targetGame = played.length > 0
        ? played.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (b.week ?? 0) - (a.week ?? 0))[0]
        : (upcoming.length > 0 ? upcoming : userGames).sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || (a.week ?? 0) - (b.week ?? 0))[0];

      const g = targetGame;
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

      if (!results.some(r => r.week === g.week && r.home === userResult.home && r.away === userResult.away)) {
        results.push(userResult);
      }
    }
  }

  if (weekPlayed == null) {
    weekPlayed = userResult ? userResult.week : after.week;
  }

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
