// CFB27 dynasty save -> DynastySnapshot (clean, serializable domain model).
// Field mapping is documented + verified in docs/FIELD-MAP.md.
//
// The parser is bep713/madden-franchise. CFB27 shares Madden 26's franchise core, so
// the bundled M26 schema labels the core tables correctly. Gotcha: several tables share
// a name (e.g. multiple `SeasonGame`); always pick the instance with the most records.

const { FranchiseFile } = require('madden-franchise');

function openSave(path) {
  return new Promise((resolve, reject) => {
    const f = new FranchiseFile(path, { autoParse: true, autoUnempty: false });
    f.on('ready', () => resolve(f));
    f.on('error', reject);
    setTimeout(() => reject(new Error('timeout opening ' + path)), 120000);
  });
}

// Pick the real table among same-named duplicates: the one with the most records.
function pickTable(f, name) {
  const cands = f.tables.filter((t) => t.name === name);
  if (!cands.length) return null;
  return cands.sort(
    (a, b) => (b.header.data1RecordCount || 0) - (a.header.data1RecordCount || 0)
  )[0];
}

function readRecords(t) {
  if (!t) return Promise.resolve(t);
  return new Promise((r) => t.readRecords().then(() => r(t)).catch(() => r(t)));
}

// Resolve a reference field (e.g. SeasonGame.HomeTeam) to the referenced row number.
function refRow(rec, field) {
  try {
    const fld = rec.fields[field];
    if (fld && fld.referenceData && fld.referenceData.rowNumber != null) {
      return fld.referenceData.rowNumber;
    }
  } catch (e) {
    /* not a reference / unreadable */
  }
  return null;
}

function num(rec, field) {
  try {
    const v = rec[field];
    return typeof v === 'number' ? v : null;
  } catch (e) {
    return null;
  }
}
function str(rec, field) {
  try {
    const v = rec[field];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  } catch (e) {
    return null;
  }
}

// Build the Team lookup: rowIndex -> { name, rank, record, prestige, ... }
function buildTeams(teamTable) {
  const teams = {};
  for (const r of teamTable.records) {
    if (r.isEmpty) continue;
    const w = (num(r, 'HomeWin') || 0) + (num(r, 'RoadWin') || 0);
    const l = (num(r, 'HomeLoss') || 0) + (num(r, 'RoadLoss') || 0);
    teams[r.index] = {
      row: r.index,
      teamIndex: num(r, 'TeamIndex'),
      name: str(r, 'DisplayName') || str(r, 'LongName') || `team#${r.index}`,
      nickname: str(r, 'NickName'),
      city: str(r, 'City'),
      wins: w,
      losses: l,
      confWins: num(r, 'ConfWin'),
      confLosses: num(r, 'ConfLoss'),
      rankMedia: rankOrNull(num(r, 'MediaPoll_CurrentRank')),
      rankMediaLastWeek: rankOrNull(num(r, 'MediaPoll_LastWeeksRank')),
      rankCoaches: rankOrNull(num(r, 'CoachesPoll_CurrentRank')),
      rankCFP: rankOrNull(num(r, 'CFPPoll_CurrentRank')),
      prestige: num(r, 'TeamPrestige'),
      ratingOVR: num(r, 'TEAM_RATINGOVR'),
      confStanding: num(r, 'CurSeasonConfStanding'),
      // User-only dynasty resources — CPU teams leave these at 0. Used to detect the
      // human's team (verified: unique to the controlled team, e.g. Kansas State).
      programPoints:
        (num(r, 'RemainingProgramPoints') || 0) + (num(r, 'ProgramPointBudget') || 0),
      contractGoalPoints: num(r, 'CoachContractGoalsProgramPoints') || 0,
    };
  }
  return teams;
}

// Only the top 25 are truly AP-ranked; unranked teams carry a large hidden rank (e.g. 111).
function rankOrNull(v) {
  return v != null && v > 0 && v <= 25 ? v : null;
}

function buildGames(sgTable) {
  const games = [];
  for (const r of sgTable.records) {
    if (r.isEmpty) continue;
    const hs = num(r, 'HomeScore');
    const as = num(r, 'AwayScore');
    if (hs == null && as == null) continue;
    games.push({
      week: num(r, 'SeasonWeek'),
      year: num(r, 'SeasonYear'),
      homeRow: refRow(r, 'HomeTeam'),
      awayRow: refRow(r, 'AwayTeam'),
      homeScore: hs,
      awayScore: as,
      homeOT: num(r, 'HomeScoreOT'),
      awayOT: num(r, 'AwayScoreOT'),
      homeQuarters: [1, 2, 3, 4].map((q) => num(r, `HomeScoreQuarter${q}`)),
      awayQuarters: [1, 2, 3, 4].map((q) => num(r, `AwayScoreQuarter${q}`)),
      played: (hs || 0) > 0 || (as || 0) > 0,
      simmed: safeBool(r, 'IsSimmed'),
      status: num(r, 'GameStatus'),
    });
  }
  return games;
}

function safeBool(rec, field) {
  try {
    const v = rec[field];
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    return null;
  } catch (e) {
    return null;
  }
}

// The user's team is the one managing program points (a user-only dynasty resource).
// This is reliable where the IsSimmed game heuristic was not.
function detectUserTeam(teams) {
  let best = null,
    bestPts = 0;
  for (const row of Object.keys(teams)) {
    const t = teams[row];
    const pts = (t.programPoints || 0) + (t.contractGoalPoints || 0);
    if (pts > bestPts) {
      bestPts = pts;
      best = Number(row);
    }
  }
  return best;
}

// Resolve the user's team. Auto-detection has proven unreliable (IsSimmed and
// program-points heuristics both mispicked), so the app treats the user's team as a
// confirmed setting: `opts.userTeamName` / `opts.userTeamRow` pin it exactly, and
// detectUserTeam() is only a best-effort seed for the setup dropdown.
function resolveUserTeam(teams, opts) {
  if (opts.userTeamRow != null && teams[opts.userTeamRow]) return opts.userTeamRow;
  if (opts.userTeamName) {
    const needle = opts.userTeamName.toLowerCase();
    // Exact match first (so "Kansas State" doesn't get shadowed by "ArKANSAS STATE").
    for (const row of Object.keys(teams)) {
      const t = teams[row];
      if (t.name && t.name.toLowerCase() === needle) return Number(row);
    }
    // Then fall back to a contains match.
    for (const row of Object.keys(teams)) {
      const t = teams[row];
      if (t.name && t.name.toLowerCase().includes(needle)) return Number(row);
    }
  }
  return null; // no explicit match; caller falls back to coach detection then heuristic
}

// Detect the human's coach via the real CFB27 schema: Coach.IsUserControlled === true.
// Returns { teamIndex, coachName } or null. Reliable (replaces the old heuristics).
function detectUserCoach(coachTable) {
  if (!coachTable) return null;
  for (const r of coachTable.records) {
    if (r.isEmpty) continue;
    let flag;
    try {
      flag = r['IsUserControlled'];
    } catch (e) {
      continue;
    }
    if (flag === true || flag === 1) {
      const first = str(r, 'FirstName');
      const last = str(r, 'LastName');
      return {
        teamIndex: num(r, 'TeamIndex'),
        coachName: [first, last].filter(Boolean).join(' ') || null,
        // Real coach fields (CFB27 schema) — powers the coach hub + hot-seat drama.
        jobSecurity: str(r, 'SeasonStartJobSecurityStatus'),
        fireReported: safeBool(r, 'COACH_FIREREPORTED'),
        performanceLevel: num(r, 'COACH_PERFORMANCELEVEL'),
        age: num(r, 'Age'),
        awardPoints: num(r, 'AwardPoints'),
        careerWinSeasons: num(r, 'CareerWinSeasons'),
        careerPlayoffs: num(r, 'CareerPlayoffsMade'),
        careerLongWinStreak: num(r, 'CareerLongWinStreak'),
      };
    }
  }
  return null;
}

async function buildSnapshot(pathOrFile, opts = {}) {
  const f = typeof pathOrFile === 'string' ? await openSave(pathOrFile) : pathOrFile;
  const seasonInfo = await readRecords(pickTable(f, 'SeasonInfo'));
  const teamTable = await readRecords(pickTable(f, 'Team'));
  const sgTable = await readRecords(pickTable(f, 'SeasonGame'));
  const coachTable = await readRecords(pickTable(f, 'Coach'));

  const teams = buildTeams(teamTable);
  const games = buildGames(sgTable);

  // Reliable user identity from the real schema, with explicit opts override kept as a
  // manual escape hatch.
  const userCoach = detectUserCoach(coachTable);
  // Priority: explicit override -> reliable Coach.IsUserControlled -> last-resort heuristic.
  let userTeamRow = resolveUserTeam(teams, opts);
  if (userTeamRow == null && userCoach && userCoach.teamIndex != null) {
    const match = Object.keys(teams)
      .map(Number)
      .find((row) => teams[row].teamIndex === userCoach.teamIndex);
    if (match !== undefined) userTeamRow = match;
  }
  if (userTeamRow == null) userTeamRow = detectUserTeam(teams);
  const coachName = opts.coachName || (userCoach ? userCoach.coachName : null);

  // Week + dynasty year from the real SeasonInfo fields.
  const si = seasonInfo && seasonInfo.records[0];
  let week = si ? num(si, 'CurrentWeek') : null;
  if (week == null) {
    week = games.reduce((m, g) => (g.played && g.week != null && g.week > m ? g.week : m), 0);
  }

  return {
    week,
    year: si ? num(si, 'CurrentSeasonYear') : null,
    dynastyYear: si ? num(si, 'CurrentYear') : null,
    coachName,
    coach: userCoach,
    tableCount: f.tables.length,
    userTeamRow,
    userTeam: userTeamRow != null ? teams[userTeamRow] : null,
    teams,
    games,
  };
}

module.exports = { openSave, pickTable, readRecords, buildSnapshot };
