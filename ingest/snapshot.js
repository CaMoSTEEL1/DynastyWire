// CFB27 dynasty save -> DynastySnapshot (clean, serializable domain model).
// Field mapping is documented + verified in docs/FIELD-MAP.md.
//
// The parser is bep713/madden-franchise. CFB27 shares Madden 26's franchise core, so
// the bundled M26 schema labels the core tables correctly. Gotcha: several tables share
// a name (e.g. multiple `SeasonGame`); always pick the instance with the most records.

const { FranchiseFile } = require('madden-franchise');
const os = require('os');
const fsc = require('fs');
const pathc = require('path');
const crypto = require('crypto');

// Parsed-result cache keyed by (path, mtime, size, kind). A full-schema parse is slow
// (~1-2 min); every generate/delta call would otherwise re-parse the same save. With
// this, only the first parse of a given save state pays the cost.
function statKey(p) {
  try {
    const s = fsc.statSync(p);
    return `${Math.round(s.mtimeMs)}_${s.size}`;
  } catch (e) {
    return 'nostat';
  }
}
function cacheFile(p, kind) {
  const h = crypto.createHash('md5').update(`${p}|${statKey(p)}|${kind}`).digest('hex');
  const dir = pathc.join(os.tmpdir(), 'dynastywire-cache');
  try {
    fsc.mkdirSync(dir, { recursive: true });
  } catch (e) {
    /* ignore */
  }
  return pathc.join(dir, `${h}.json`);
}
function readCache(file) {
  try {
    return JSON.parse(fsc.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}
function writeCache(file, obj) {
  try {
    fsc.writeFileSync(file, JSON.stringify(obj));
  } catch (e) {
    /* ignore */
  }
}

function openSave(path) {
  return new Promise((resolve, reject) => {
    const f = new FranchiseFile(path, { autoParse: true, autoUnempty: false });
    const timer = setTimeout(() => reject(new Error('timeout opening ' + path)), 120000);
    f.on('ready', () => {
      clearTimeout(timer);
      resolve(f);
    });
    f.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
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
    // Total record = Conf + NonConf, NOT Home + Road. Verified against a real save: a
    // neutral-site game (conference championship, bowls, the entire playoff) increments
    // NEITHER HomeWin nor RoadWin, so summing those silently dropped every postseason win
    // (a 15-0 national finalist read as 11-0). Conf+NonConf partitions all games by
    // opponent type and therefore counts neutral-site games correctly.
    const w = (num(r, 'ConfWin') || 0) + (num(r, 'NonConfWin') || 0);
    const l = (num(r, 'ConfLoss') || 0) + (num(r, 'NonConfLoss') || 0);
    const ties = (num(r, 'ConfTie') || 0) + (num(r, 'NonConfTie') || 0);
    teams[r.index] = {
      row: r.index,
      teamIndex: num(r, 'TeamIndex'),
      name: str(r, 'DisplayName') || str(r, 'LongName') || `team#${r.index}`,
      nickname: str(r, 'NickName'),
      city: str(r, 'City'),
      wins: w,
      losses: l,
      ties,
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
      // The dynasty "points" economy the NIL tool reasons over. ProgramPointBudget is the
      // pool; the rest are how it's been allocated. NILProgramPointsSpent is points already
      // put toward player NIL. Verified against a real save.
      pointBudget: num(r, 'ProgramPointBudget'),
      pointsRemaining: num(r, 'RemainingProgramPoints'),
      nilPointsSpent: num(r, 'NILProgramPointsSpent'),
      brandExposurePoints: num(r, 'BrandExposureProgramPoints'),
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

// Detect all human coaches via the real CFB27 schema: Coach.IsUserControlled === true.
// Returns an array of { teamIndex, coachName, ... } objects.
function detectUserCoaches(coachTable) {
  const coaches = [];
  if (!coachTable) return coaches;
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
      coaches.push({
        teamIndex: num(r, 'TeamIndex'),
        coachName: [first, last].filter(Boolean).join(' ') || null,
        // Real coach fields (CFB27 schema) — powers the coach hub + hot-seat drama.
        // Position: 'HeadCoach' | 'OffensiveCoordinator' | 'DefensiveCoordinator' — verified
        // against a real save. Coordinator careers get coordinator-shaped press coverage.
        position: str(r, 'Position'),
        archetype: str(r, 'DominantArchetype'),
        jobSecurity: str(r, 'SeasonStartJobSecurityStatus'),
        fireReported: safeBool(r, 'COACH_FIREREPORTED'),
        performanceLevel: num(r, 'COACH_PERFORMANCELEVEL'),
        age: num(r, 'Age'),
        awardPoints: num(r, 'AwardPoints'),
        careerWinSeasons: num(r, 'CareerWinSeasons'),
        careerPlayoffs: num(r, 'CareerPlayoffsMade'),
        careerLongWinStreak: num(r, 'CareerLongWinStreak'),
      });
    }
  }
  return coaches;
}

// Every program's REAL head coach from the save: teamIndex -> "First Last". Feeds the
// generators so other teams' coaches are the save's actual names, never invented.
function buildHeadCoaches(coachTable) {
  const map = {};
  if (!coachTable) return map;
  for (const r of coachTable.records) {
    if (r.isEmpty) continue;
    try {
      if (str(r, 'Position') !== 'HeadCoach') continue;
      const ti = num(r, 'TeamIndex');
      if (ti == null || ti < 0) continue;
      const name = [str(r, 'FirstName'), str(r, 'LastName')].filter(Boolean).join(' ');
      if (name) map[ti] = name;
    } catch (e) {
      /* skip unreadable rows */
    }
  }
  return map;
}

async function buildSnapshot(pathOrFile, opts = {}) {
  const isPath = typeof pathOrFile === 'string';
  const optKey = JSON.stringify({
    t: opts.userTeamName || null,
    r: opts.userTeamRow ?? null,
    c: opts.coachName || null,
  });
  const cf = isPath ? cacheFile(pathOrFile, `snap|v6|${optKey}`) : null;
  if (cf) {
    const cached = readCache(cf);
    if (cached) return cached;
  }

  const f = isPath ? await openSave(pathOrFile) : pathOrFile;
  const seasonInfo = await readRecords(pickTable(f, 'SeasonInfo'));
  const teamTable = await readRecords(pickTable(f, 'Team'));
  const sgTable = await readRecords(pickTable(f, 'SeasonGame'));
  const coachTable = await readRecords(pickTable(f, 'Coach'));

  const teams = buildTeams(teamTable);
  const games = buildGames(sgTable);

  // Priority: explicit override -> reliable Coach.IsUserControlled -> last-resort heuristic.
  let userTeamRow = resolveUserTeam(teams, opts);
  
  const userCoaches = detectUserCoaches(coachTable);
  let userCoach = null;
  
  // If user explicitly pinned a team, try to find the user-controlled coach for that team
  if (userTeamRow != null) {
    const teamIdx = teams[userTeamRow].teamIndex;
    userCoach = userCoaches.find((c) => c.teamIndex === teamIdx) || null;
  }
  
  // Fallback: If no explicit team matched a user coach, just pick the first user coach
  if (!userCoach && userCoaches.length > 0) {
    userCoach = userCoaches[0];
  }

  // If we still don't have a team, but we have a user coach, use the coach's team
  if (userTeamRow == null && userCoach && userCoach.teamIndex != null) {
    const match = Object.keys(teams)
      .map(Number)
      .find((row) => teams[row].teamIndex === userCoach.teamIndex);
    if (match !== undefined) userTeamRow = match;
  }
  // Last resort heuristic: most program points
  if (userTeamRow == null) userTeamRow = detectUserTeam(teams);
  
  const coachName = opts.coachName || (userCoach ? userCoach.coachName : null);

  // Week + dynasty year from the real SeasonInfo fields.
  const si = seasonInfo && seasonInfo.records[0];
  let week = si ? num(si, 'CurrentWeek') : null;
  if (week == null) {
    week = games.reduce((m, g) => (g.played && g.week != null && g.week > m ? g.week : m), 0);
  }

  // Postseason shape, straight from SeasonInfo — this is what makes "we're IN the playoff"
  // real instead of guessed from a hardcoded week number. CurrentWeekType reads e.g.
  // "RegularSeason" / "BowlSeason1".."BowlSeason4" / "OffSeason"; PostSeasonNumWeeks is the
  // number of playoff rounds (4 for the 12-team format). See computePhase() in gen.ts.
  const calendar = si
    ? {
        weekType: str(si, 'CurrentWeekType'),
        stage: str(si, 'CurrentStage'),
        postSeasonWeeks: num(si, 'PostSeasonNumWeeks'),
        regularSeasonLastWeek: num(si, 'RegularSeasonLastWeekScheduled'),
        confChampWeek: num(si, 'RegularSeasonWeekConferenceChampionship'),
        // Offseason progression — CurrentStage becomes an off-season value and
        // CurrentOffseasonStage steps 0..OffseasonNumStages through the portal window,
        // signing day, coaching carousel, spring, etc.
        offseasonStage: num(si, 'CurrentOffseasonStage'),
        offseasonNumStages: num(si, 'OffseasonNumStages'),
      }
    : null;

  const result = {
    week,
    year: si ? num(si, 'CurrentSeasonYear') : null,
    dynastyYear: si ? num(si, 'CurrentYear') : null,
    calendar,
    coachName,
    coach: userCoach,
    tableCount: f.tables.length,
    userTeamRow,
    userTeam: userTeamRow != null ? teams[userTeamRow] : null,
    teams,
    games,
    headCoaches: buildHeadCoaches(coachTable),
  };
  if (cf) writeCache(cf, result);
  return result;
}

// Recruiting board: join Recruit -> Player (mapping from PocketScout). Capped to the top
// the full class so every recruit is searchable. Also joins the USER's recruiting board
// (UserRecruitTarget) so we can flag which prospects are on your board / committed to you,
// with their scholarship + NIL state. Verified field map against a real CFB27 save.
async function buildRecruits(pathOrFile, cap = 5000) {
  const isPath = typeof pathOrFile === 'string';
  const cf = isPath ? cacheFile(pathOrFile, `recruits|v3|${cap}`) : null;
  if (cf) {
    const cached = readCache(cf);
    if (cached) return cached;
  }
  const f = isPath ? await openSave(pathOrFile) : pathOrFile;
  const recruitT = await readRecords(pickTable(f, 'Recruit'));
  const playerT = await readRecords(pickTable(f, 'Player'));
  if (!recruitT || !playerT) return [];

  // The user's recruiting board: Recruit-row -> your recruiting state for that prospect.
  const board = new Map();
  const boardT = await readRecords(pickTable(f, 'UserRecruitTarget'));
  if (boardT) {
    for (const b of boardT.records) {
      if (b.isEmpty) continue;
      const rr = refRow(b, 'Recruit');
      if (rr == null) continue;
      board.set(rr, {
        scholarship: str(b, 'ScholarshipStatus'),
        committedWeek: num(b, 'CommittedWeekNumber'),
        nilOffer: num(b, 'CurrentNILOffer'),
        isFavorite: safeBool(b, 'IsFavorite'),
        influence: num(b, 'ProspectInfluenceTotal'),
      });
    }
  }

  const ranked = [];
  for (const r of recruitT.records) {
    if (r.isEmpty) continue;
    const natRank = num(r, 'NationalRank');
    ranked.push({ r, natRank: natRank == null || natRank <= 0 ? 999999 : natRank });
  }
  ranked.sort((a, b) => a.natRank - b.natRank);

  const out = [];
  for (const { r } of ranked.slice(0, cap)) {
    const playerRow = refRow(r, 'Player');
    let name = null;
    let position = null;
    let overall = null;
    let stars = num(r, 'ProspectStarRating'); // sometimes on Recruit
    if (playerRow != null && playerT.records[playerRow]) {
      const p = playerT.records[playerRow];
      name = [str(p, 'FirstName'), str(p, 'LastName')].filter(Boolean).join(' ') || null;
      position = str(p, 'Position');
      overall = num(p, 'OverallRating');
      if (overall == null) overall = num(p, 'PlayerOverallRating');
      if (stars == null) stars = num(p, 'ProspectStarRating'); // usually on the Player
    }
    if (!name) continue; // skip placeholder rows
    const bi = board.get(r.index) || null;
    const stage = str(r, 'RecruitStage');
    // A prospect is committed to the USER when he's on the user's board AND his recruit
    // stage has locked in (Signed / Committed / SoftCommitted). VERIFIED: CommittedWeekNumber
    // is 0 for players who signed on Signing Day (only early commits set it), so the old
    // check found 1 of a 24-man class. RecruitStage is the real signal.
    const committed = !!bi && !!stage && /signed|committed|softcommit/i.test(stage);
    out.push({
      name,
      position,
      overall,
      stars,
      commitScore: num(r, 'CommitScore'),
      nationalRank: num(r, 'NationalRank'),
      positionRank: num(r, 'PositionRank'),
      stateRank: num(r, 'StateRank'),
      class: str(r, 'Class'),
      stage,
      // User recruiting-board state (null when the prospect isn't on your board).
      onBoard: !!bi,
      committedToUser: committed,
      scholarship: bi ? bi.scholarship : null,
      nilOffer: bi ? bi.nilOffer : null,
      isFavorite: bi ? bi.isFavorite : null,
      boardInfluence: bi ? bi.influence : null,
    });
  }
  if (cf) writeCache(cf, out);
  return out;
}

// The user team's roster, for player-specific content (situations, awards, NIL). Verified
// field map against a real CFB27 save: Player.TeamIndex === Team.TeamIndex links a player to
// his team; name/pos/OVR/jersey/year come off the Player row. Returns players sorted by OVR.
const SCHOOL_YEAR = { Freshman: 'Fr', Sophomore: 'So', Junior: 'Jr', Senior: 'Sr' };

// ── League-wide transfer-portal board ──────────────────────────────────────────
// Real portal signal from the save (verified fields):
//   - AbsoluteTransferChance : per-player chance the game has computed. It's -1 during the
//     regular season/playoff (portal not open) and becomes >= 0 in the postseason/offseason.
//   - RecruitingDealbreaker  : the ONE thing that would make this player leave, e.g.
//     "PlayingTime" / "ProPotential" / "ChampionshipContender" / "BrandExposure".
// Since a live "who entered the portal" list only exists once the portal opens, the board
// ALSO computes a grounded FLIGHT-RISK read that's valid any week: a good player buried on
// the depth chart whose dealbreaker is Playing Time is a real risk to leave. Everything here
// is derived from actual roster data — no invented names.

// How many bodies realistically "start" at a position — used to decide who's buried.
const STARTERS_AT = {
  QB: 1, HB: 1, FB: 1, TE: 1, K: 1, P: 1, LT: 1, LG: 1, C: 1, RG: 1, RT: 1,
  WR: 3, MLB: 1, LOLB: 1, ROLB: 1, LE: 1, RE: 1, DT: 2, CB: 2, FS: 1, SS: 1,
};

async function buildPortal(pathOrFile, opts = {}) {
  const isPath = typeof pathOrFile === 'string';
  const cf = isPath ? cacheFile(pathOrFile, `portal|v3`) : null;
  if (cf) {
    const cached = readCache(cf);
    if (cached) return cached;
  }
  const f = isPath ? await openSave(pathOrFile) : pathOrFile;
  const teamTable = await readRecords(pickTable(f, 'Team'));
  const playerT = await readRecords(pickTable(f, 'Player'));
  if (!playerT) return { active: false, transferred: [], atRisk: [] };

  // teamIndex -> { name, rank } (for league-wide labeling). Skip FCS / non-FBS filler —
  // their rosters are generic clones and they'd swamp the board with meaningless names.
  const teamByIndex = {};
  if (teamTable) {
    for (const r of teamTable.records) {
      if (r.isEmpty) continue;
      const ti = num(r, 'TeamIndex');
      if (ti == null) continue;
      const nm = str(r, 'DisplayName') || str(r, 'LongName') || `team#${ti}`;
      if (/^FCS\b|\bFCS$/i.test(nm)) continue; // FCS East/West/etc. — not real programs
      teamByIndex[ti] = {
        name: nm,
        rank: rankOrNull(num(r, 'MediaPoll_CurrentRank')),
      };
    }
  }

  // Gather every rostered player once, grouped by (team, position) for depth-chart math.
  const byTeamPos = new Map(); // `${ti}|${pos}` -> [players]
  const all = [];
  for (const p of playerT.records) {
    if (p.isEmpty) continue;
    let ti, pos, ovr, name;
    try {
      ti = num(p, 'TeamIndex');
      if (ti == null || ti < 0 || !teamByIndex[ti]) continue; // skip free agents / FCS filler
      name = [str(p, 'FirstName'), str(p, 'LastName')].filter(Boolean).join(' ');
      if (!name) continue;
      pos = str(p, 'Position');
      ovr = num(p, 'OverallRating');
    } catch (e) {
      continue;
    }
    const rec = {
      name,
      team: teamByIndex[ti].name,
      teamRank: teamByIndex[ti].rank,
      teamIndex: ti,
      position: pos,
      overall: ovr,
      year: (() => { const sy = str(p, 'SchoolYear'); return sy ? SCHOOL_YEAR[sy] || sy : null; })(),
      schoolYear: str(p, 'SchoolYear'),
      dealbreaker: str(p, 'RecruitingDealbreaker'),
      transferChance: num(p, 'AbsoluteTransferChance'),
    };
    all.push(rec);
    const key = `${ti}|${pos}`;
    if (!byTeamPos.has(key)) byTeamPos.set(key, []);
    byTeamPos.get(key).push(rec);
  }

  // Depth index per (team, position): 0 = top OVR at the spot.
  for (const list of byTeamPos.values()) {
    list.sort((a, b) => (b.overall || 0) - (a.overall || 0));
    list.forEach((p, i) => {
      p.depth = i;
      p.aheadOvr = i > 0 ? list[0].overall : null; // the starter's OVR
    });
  }

  // If the portal is OPEN (any player has a real, >= 0 chance) surface those directly.
  const portalOpen = all.some((p) => p.transferChance != null && p.transferChance >= 0);
  const transferred = portalOpen
    ? all
        .filter((p) => p.transferChance != null && p.transferChance >= 40)
        .sort((a, b) => (b.transferChance || 0) - (a.transferChance || 0))
        .slice(0, 40)
        .map((p) => ({
          name: p.name, team: p.team, teamRank: p.teamRank, position: p.position,
          overall: p.overall, year: p.year, chance: p.transferChance, dealbreaker: p.dealbreaker,
        }))
    : [];

  // Flight-risk model — valid any week, grounded in real depth chart + dealbreaker. The
  // realistic portal risk is a GOOD player with eligibility left who's blocked: sophomores
  // and juniors. True freshmen redshirt/develop (not risks); seniors are out of eligibility
  // or draft-bound (they leave, but not via the portal). So we score only So/Jr.
  const CLASS_WEIGHT = { Junior: 1.0, Sophomore: 0.75 };
  const scored = [];
  for (const p of all) {
    if (p.overall == null) continue;
    const cw = CLASS_WEIGHT[p.schoolYear];
    if (cw == null) continue; // Fr / Sr / RS-Sr etc. excluded
    if (p.overall < 78) continue; // must be genuinely startable elsewhere
    const starters = STARTERS_AT[p.position] ?? 1;
    const buried = p.depth != null && p.depth >= starters; // outside the starter slots
    if (!buried) continue;
    const gap = p.aheadOvr != null ? Math.max(0, p.aheadOvr - p.overall) : 0;
    let score = (p.overall - 77) * 1.5 + p.depth * 2.5 + cw * 6;
    if (p.dealbreaker === 'PlayingTime') score += 14; // the smoking gun
    if (gap <= 3) score += 6; // as good as (or better than) the starter and STILL sitting
    if (p.teamRank) score += 3; // being buried on a contender is a bigger story
    scored.push({ ...p, gap, score });
  }
  scored.sort((a, b) => b.score - a.score);

  // Cap to 2 per team so a single deep roster can't swamp the league-wide board.
  const perTeam = {};
  const atRisk = [];
  for (const p of scored) {
    perTeam[p.teamIndex] = (perTeam[p.teamIndex] || 0) + 1;
    if (perTeam[p.teamIndex] > 2) continue;
    atRisk.push({
      name: p.name, team: p.team, teamRank: p.teamRank, position: p.position,
      overall: p.overall, year: p.year, depth: p.depth, starterOvr: p.aheadOvr,
      dealbreaker: p.dealbreaker,
      tier: p.score >= 26 ? 'high' : 'watch',
    });
    if (atRisk.length >= 40) break;
  }

  const result = { active: portalOpen, transferred, atRisk };
  if (cf) writeCache(cf, result);
  return result;
}

// Which tables a player's per-season stat row can live in. VERIFIED against a real save:
// "SeasonOffensiveKPReturnStats" is NOT a returns-only table — it carries the player's FULL
// offensive line (RUSHYARDS/RUSHTDS/RECEIVE*/PASS*) *plus* return fields, and the game files
// a player there whenever he also returns kicks. That is usually the RB1/WR1, so ignoring
// this table blanked the stats of exactly the best players ("my 2000-yard back shows no
// stats" — the stars looked statless while backups read fine).
const OFFENSE_TABLES = /^Season(Offensive|OffensiveKPReturn)Stats$/;
const DEFENSE_TABLES = /^Season(Defensive|DefensiveKPReturn)Stats$/;
const KICKING_TABLE = /^SeasonKickingStats$/;
const STAT_TABLES = /^Season(Offensive|OffensiveKPReturn|Defensive|DefensiveKPReturn|Kicking)Stats$/;

// Follow Player.SeasonStats -> SeasonStats[] (array of per-season stat-row refs) and
// summarize the CURRENT season's production. Each row carries SEAS_YEAR (the dynasty year
// index, matching SeasonInfo.CurrentYear) + GAMESPLAYED/GAMESSTARTED.
function makeStatsResolver(f, currentSeasonYear) {
  const byId = new Map();
  for (const t of f.tables) byId.set(t.header.tableId, t);
  const readCacheT = new Map(); // tableId -> Promise<table with records>
  function readById(id) {
    if (!readCacheT.has(id)) {
      const t = byId.get(id);
      readCacheT.set(id, t ? readRecords(t) : Promise.resolve(null));
    }
    return readCacheT.get(id);
  }

  return async function statsFor(playerRec) {
    const ref = (() => {
      try {
        const fld = playerRec.fields['SeasonStats'];
        return fld && fld.referenceData && fld.referenceData.tableId ? fld.referenceData : null;
      } catch (e) {
        return null;
      }
    })();
    if (!ref) return null;
    const arrT = await readById(ref.tableId);
    if (!arrT || !arrT.records || !arrT.records[ref.rowNumber]) return null;
    const arrRec = arrT.records[ref.rowNumber];

    // Collect every element ref, keeping only rows for the CURRENT season. Pinning to the
    // current year (rather than "highest year seen") stops a prior season's line being
    // presented as this year's — that's how a backup with 0 starts was reported as a
    // 9-game starter: his only row was last season's.
    let bestOff = null;
    let bestDef = null;
    let bestKick = null;
    for (const key of Object.keys(arrRec.fields || {})) {
      let rd = null;
      try {
        const fld = arrRec.fields[key];
        rd = fld && fld.referenceData && fld.referenceData.tableId ? fld.referenceData : null;
      } catch (e) {
        continue;
      }
      if (!rd) continue;
      const t = byId.get(rd.tableId);
      if (!t || !STAT_TABLES.test(t.name)) continue;
      const st = await readById(rd.tableId);
      const rec = st && st.records && st.records[rd.rowNumber];
      if (!rec || rec.isEmpty) continue;
      const year = num(rec, 'SEAS_YEAR');
      // Only this season. If the save doesn't expose a current year, fall back to the
      // highest year present so we degrade to the old behaviour rather than to nothing.
      if (currentSeasonYear != null) {
        if (year !== currentSeasonYear) continue;
      }
      const y = year ?? -1;
      if (OFFENSE_TABLES.test(t.name)) {
        if (!bestOff || y > bestOff.year) bestOff = { year: y, rec };
      } else if (DEFENSE_TABLES.test(t.name)) {
        if (!bestDef || y > bestDef.year) bestDef = { year: y, rec };
      } else if (KICKING_TABLE.test(t.name)) {
        if (!bestKick || y > bestKick.year) bestKick = { year: y, rec };
      }
    }
    if (!bestOff && !bestDef && !bestKick) return null;
    if (currentSeasonYear == null) {
      // Legacy path: pair sides only when they're from the SAME season.
      const latest = Math.max(bestOff ? bestOff.year : -1, bestDef ? bestDef.year : -1);
      if (bestOff && bestOff.year < latest) bestOff = null;
      if (bestDef && bestDef.year < latest) bestDef = null;
    }

    const offense = bestOff
      ? {
          gamesPlayed: num(bestOff.rec, 'GAMESPLAYED'),
          gamesStarted: num(bestOff.rec, 'GAMESSTARTED'),
          passYds: num(bestOff.rec, 'PASSYARDS'),
          passTDs: num(bestOff.rec, 'PASSTDS'),
          passInts: num(bestOff.rec, 'PASSINTS'),
          passComp: num(bestOff.rec, 'PASSCOMPLETED'),
          passAtt: num(bestOff.rec, 'PASSATTEMPTS'),
          rushYds: num(bestOff.rec, 'RUSHYARDS'),
          rushAtt: num(bestOff.rec, 'RUSHATTEMPTS'),
          rushTDs: num(bestOff.rec, 'RUSHTDS'),
          rushLong: num(bestOff.rec, 'RUSHLONGEST'),
          recYds: num(bestOff.rec, 'RECEIVEYARDS'),
          recTDs: num(bestOff.rec, 'RECEIVETDS'),
          recCatches: num(bestOff.rec, 'RECEIVECATCHES'),
          // Return production (present on the KP-return flavour of the table).
          kickRetYds: num(bestOff.rec, 'KRETYARDS'),
          kickRetTDs: num(bestOff.rec, 'KRETTDS'),
          puntRetYds: num(bestOff.rec, 'PRETYARDS'),
          puntRetTDs: num(bestOff.rec, 'PRETTDS'),
        }
      : null;
    const defense = bestDef
      ? {
          gamesPlayed: num(bestDef.rec, 'GAMESPLAYED'),
          gamesStarted: num(bestDef.rec, 'GAMESSTARTED'),
          tackles: (num(bestDef.rec, 'DEFTACKLES') || 0) + (num(bestDef.rec, 'ASSDEFTACKLES') || 0),
          tfl: num(bestDef.rec, 'DEFTACKLESFORLOSS'),
          sacks: (num(bestDef.rec, 'DLINESACKS') || 0) + (num(bestDef.rec, 'DLINEHALFSACK') || 0) * 0.5,
          ints: num(bestDef.rec, 'DSECINTS'),
          deflections: num(bestDef.rec, 'DEFPASSDEFLECTIONS'),
          forcedFumbles: num(bestDef.rec, 'DLINEFORCEDFUMBLES'),
        }
      : null;

    // Kickers/punters file their season in SeasonKickingStats — without this they read as
    // "no stats" even with 47 field goals on the year.
    const kicking = bestKick
      ? {
          gamesPlayed: num(bestKick.rec, 'GAMESPLAYED'),
          gamesStarted: num(bestKick.rec, 'GAMESSTARTED'),
          fgMade: num(bestKick.rec, 'KICKFGMADE'),
          fgAtt: num(bestKick.rec, 'KICKFGATTEMPTS'),
          fgLong: num(bestKick.rec, 'KICKFGLONGEST'),
          fgMade50Plus: num(bestKick.rec, 'KICKFGMADE50ORMORE'),
          fgAtt50Plus: num(bestKick.rec, 'KICKFGATTEMPTS50ORMORE'),
          xpMade: num(bestKick.rec, 'KICKEPMADE'),
          xpAtt: num(bestKick.rec, 'KICKEPATTEMPTS'),
          gameWinners: num(bestKick.rec, 'GAMEWINFGSMADE'),
          punts: num(bestKick.rec, 'PUNTATTEMPTS'),
          puntYds: num(bestKick.rec, 'PUNTYARDS'),
          puntLong: num(bestKick.rec, 'PUNTLONGEST'),
          puntIn20: num(bestKick.rec, 'PUNTIN20'),
          puntBlocked: num(bestKick.rec, 'PUNTBLOCKED'),
        }
      : null;

    // GAMESSTARTED is not always trustworthy (some rows report starts == games played for
    // players who never started). Never claim more starts than games played.
    for (const s of [offense, defense, kicking]) {
      if (!s) continue;
      if (s.gamesStarted != null && s.gamesPlayed != null && s.gamesStarted > s.gamesPlayed) {
        s.gamesStarted = null;
      }
    }

    // Two-way when both sides actually saw the field this season.
    const played = (s) => s && (s.gamesPlayed || 0) > 0;
    const twoWay = !!(played(offense) && played(defense));

    // Back-compat shape: `side` + flat fields mirror the dominant side; `offense`/`defense`/
    // `kicking` carry the full split (two-way players keep both scrimmage sides).
    let primary;
    if (offense || defense) {
      primary = offense && (!defense || (offense.gamesStarted || 0) >= (defense.gamesStarted || 0)) ? 'offense' : 'defense';
    } else {
      primary = 'kicking';
    }
    const flat = primary === 'offense' ? offense : primary === 'defense' ? defense : kicking;
    return { side: primary, twoWay, offense, defense, kicking, ...flat };
  };
}

async function buildRoster(pathOrFile, opts = {}) {
  const teamIndex = opts.teamIndex;
  if (teamIndex == null) return [];
  const isPath = typeof pathOrFile === 'string';
  const cf = isPath ? cacheFile(pathOrFile, `roster|v6|${teamIndex}`) : null;
  if (cf) {
    const cached = readCache(cf);
    if (cached) return cached;
  }
  const f = isPath ? await openSave(pathOrFile) : pathOrFile;
  const playerT = await readRecords(pickTable(f, 'Player'));
  if (!playerT) return [];

  // Stat rows are tagged with SEAS_YEAR, which matches SeasonInfo.CurrentYear. Pin stat
  // reads to this so last season's line is never shown as this season's.
  let currentSeasonYear = opts.seasonYear ?? null;
  if (currentSeasonYear == null) {
    const si = await readRecords(pickTable(f, 'SeasonInfo'));
    const rec = si && si.records && si.records[0];
    if (rec) currentSeasonYear = num(rec, 'CurrentYear');
  }

  const out = [];
  for (const p of playerT.records) {
    if (p.isEmpty) continue;
    if (num(p, 'TeamIndex') !== teamIndex) continue;
    const name = [str(p, 'FirstName'), str(p, 'LastName')].filter(Boolean).join(' ');
    if (!name) continue;
    const sy = str(p, 'SchoolYear');
    out.push({
      name,
      position: str(p, 'Position'),
      year: sy ? SCHOOL_YEAR[sy] || sy : null,
      overall: num(p, 'OverallRating'),
      jersey: num(p, 'JerseyNum'),
      // Game-assigned personality — Unpredictable | Intense | TeamPlayer | Entertainer |
      // Leader. Drives how a player behaves in conflicts, texts, and locker-room drama.
      personality: str(p, 'Personality'),
      confidence: num(p, 'ConfidenceRating'),
      redshirt: str(p, 'RedshirtStatus'),
      injury: str(p, 'InjuryStatus'),
      // NIL economy (real, per-player): BaseNILValue = intrinsic worth, CurrentNILCompensation
      // = what he's actually paid. Both are writable — the NIL allotment tool edits comp.
      nilBaseValue: num(p, 'BaseNILValue'),
      nilComp: num(p, 'CurrentNILCompensation'),
      dealbreaker: str(p, 'RecruitingDealbreaker'),
      _rec: p,
    });
  }
  out.sort((a, b) => (b.overall || 0) - (a.overall || 0));
  const capped = out.slice(0, 70);

  // Attach current-season stat lines (top 40 only — the slice fed to the model).
  const statsFor = makeStatsResolver(f, currentSeasonYear);
  for (const pl of capped.slice(0, 40)) {
    try {
      pl.stats = await statsFor(pl._rec);
    } catch (e) {
      pl.stats = null;
    }
  }
  for (const pl of capped) delete pl._rec;

  if (cf) writeCache(cf, capped);
  return capped;
}

module.exports = { openSave, pickTable, readRecords, buildSnapshot, buildRecruits, buildRoster, buildPortal };
