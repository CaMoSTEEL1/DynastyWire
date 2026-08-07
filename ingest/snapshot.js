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
/**
 * "OFF_SPREAD_OPTION" -> "Spread Option", "DEF_3_3_5_TITE" -> "3-3-5 Tite".
 * Front sizes come back as digits joined by hyphens, which is how anyone who watches
 * football writes them; words are title-cased. Unknown shapes fall through to the raw
 * string rather than a guess.
 */
function schemeLabel(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const body = raw.replace(/^(OFF|DEF)_/i, '');
  if (!body) return null;
  // Tokenize letters and digits separately so DEF_BASE3_4 reads "Base 3-4", not "Base3 4".
  const tokens = body.split('_').flatMap((p) => p.match(/\d+|[A-Za-z]+/g) ?? []);
  const out = [];
  let digits = [];
  const flushDigits = () => {
    if (digits.length) out.push(digits.join('-'));
    digits = [];
  };
  for (const t of tokens) {
    if (/^\d+$/.test(t)) digits.push(t);
    else {
      flushDigits();
      out.push(t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
    }
  }
  flushDigits();
  return out.join(' ').trim() || null;
}

/** Three 0-255 channel fields -> "#rrggbb". Null when the save has no colour there. */
/**
 * The save writes states as CamelCase enum names — "NewJersey", "NorthCarolina". Split them
 * back into how anyone would write them, without touching a single-word state.
 */
function stateName(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || /^none$/i.test(s)) return null;
  return s.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function rgbHex(rec, rField, gField, bField) {
  const ch = (f) => {
    const v = num(rec, f);
    return v == null ? null : Math.max(0, Math.min(255, Math.round(v)));
  };
  const r = ch(rField);
  const g = ch(gField);
  const b = ch(bField);
  if (r == null || g == null || b == null) return null;
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

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
      // What they actually run, from the save: OFF_AIR_RAID, OFF_OPTION, DEF_3_3_5_TITE …
      // The scouting report reads these so a matchup preview can talk about the offense the
      // opponent runs instead of inferring one from their yardage.
      offScheme: schemeLabel(str(r, 'CurrentOffensiveScheme')),
      defScheme: schemeLabel(str(r, 'CurrentDefensiveScheme')),
      // The program's real colours. Stored as separate 0-255 channels; verified against a
      // save (Alabama #b30839, Michigan navy + maize, Oregon green + yellow). The UI derives
      // its accents from these — see team-theme.ts, which does the readability work.
      colorPrimary: rgbHex(r, 'TEAM_BACKGROUNDCOLORR', 'TEAM_BACKGROUNDCOLORG', 'TEAM_BACKGROUNDCOLORB'),
      colorSecondary: safeBool(r, 'TEAM_HAS_SECONDARY_COLOR')
        ? rgbHex(r, 'TEAM_BACKGROUNDCOLORR2', 'TEAM_BACKGROUNDCOLORG2', 'TEAM_BACKGROUNDCOLORB2')
        : null,
      confStanding: num(r, 'CurSeasonConfStanding'),
      // NOT user-only, despite what this comment used to claim: 138 of 143 teams carry these,
      // scaling with prestige. They are kept for the NIL economy; they must never be used to
      // work out whose team this is. See detectUserTeamByCharacter.
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

/**
 * The save pre-populates postseason game rows with a score BEFORE the game is played.
 * Verified on a real week-18 save: Kansas State sat at 13-0 with fourteen scored rows on the
 * schedule, and all twelve quarterfinal rows in the league carried a final. Trusting the
 * score meant the app opened the playoff already recapping a game that had not kicked off —
 * no matchup breakdown, and a press conference asking how it felt to win it.
 *
 * A team's record is the honest count: it goes up only when a game actually finishes. So for
 * every team whose record we know, the first (wins+losses) scored rows in week order are the
 * real ones and anything past that is the save running ahead of itself. A row survives only
 * if BOTH participants can account for it — one team's word is not enough to erase a game
 * from the other's schedule.
 *
 * FCS opponents carry no record (0-0 always), so they abstain rather than voting every game
 * they appear in out of existence.
 */
function unplayFutureGames(games, teams) {
  const season = games.reduce((m, g) => (g.year != null && g.year > m ? g.year : m), -1);
  if (season < 0) return games;

  const trusted = new Set();
  const voters = new Map(); // game -> how many participants had a record to check it against

  for (const key of Object.keys(teams)) {
    const row = Number(key);
    const t = teams[key];
    const recordGames = (t.wins || 0) + (t.losses || 0);
    if (recordGames <= 0) continue; // no record to check against — abstain

    const played = games
      .filter((g) => g.year === season && g.played && (g.homeRow === row || g.awayRow === row))
      .sort((a, b) => (a.week || 0) - (b.week || 0));
    for (const g of played) voters.set(g, (voters.get(g) || 0) + 1);
    for (const g of played.slice(0, recordGames)) trusted.add(g);
  }

  for (const g of games) {
    if (g.played && voters.has(g) && !trusted.has(g)) g.played = false;
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
/**
 * WHOSE TEAM IS THIS. `Team.UserCharacter` is a reference that exactly one team carries — the
 * one the human is playing — and it is set whether that human is a coach or a Road to Glory
 * player. Verified on a real save: 1 of 143 teams had it, and it was the right one.
 *
 * This is the signal that should always have been first. Everything else is inference.
 */
function detectUserTeamByCharacter(teamTable) {
  const found = [];
  for (const r of teamTable.records) {
    if (r.isEmpty) continue;
    let link = null;
    try {
      link = r.fields['UserCharacter'].referenceData;
    } catch (e) {
      continue;
    }
    if (link && (link.tableId || link.rowNumber)) found.push(r.index);
  }
  // More than one means the save has co-op users and we cannot tell which is THIS user, so
  // say nothing rather than pick. Exactly one is the answer.
  return found.length === 1 ? found[0] : null;
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

/**
 * The coach's real job security. `CurrentJobSecurityStatus` first; the season-start field is
 * only a fallback, because it is stale by definition and often the sentinel "Invalid".
 * Returns null rather than a sentinel — "we don't know" must not read as a status.
 */
function pickJobSecurity(r) {
  const bad = /^(invalid|none|unknown|)$/i;
  const current = str(r, 'CurrentJobSecurityStatus');
  if (current && !bad.test(current.trim())) return current;
  const atStart = str(r, 'SeasonStartJobSecurityStatus');
  if (atStart && !bad.test(atStart.trim())) return atStart;
  return null;
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
        // JOB SECURITY — read the LIVE field, not the season-start one.
        //
        // `SeasonStartJobSecurityStatus` is a snapshot taken before the season and reads the
        // sentinel "Invalid" for a chunk of the league (7 of 145 head coaches in a real save,
        // including the user's). `CurrentJobSecurityStatus` is the live value and was "Safe"
        // for the same coach — a 14-0 season with 100% security being reported as unknown is
        // what sent hot-seat talk into a perfect year.
        jobSecurity: pickJobSecurity(r),
        jobSecurityPct: num(r, 'CurrentJobSecurityPercentage'),
        // COACH_FIREREPORTED is NOT a fire signal: it reads `true` for all 145 head coaches
        // in a live save, user included. It carries no information, so it is not parsed.
        // (The field is kept optional on the type so older cached snapshots still deserialize.)
        performanceLevel: num(r, 'COACH_PERFORMANCELEVEL'),
        age: num(r, 'Age'),
        awardPoints: num(r, 'AwardPoints'),
        careerWinSeasons: num(r, 'CareerWinSeasons'),
        careerPlayoffs: num(r, 'CareerPlayoffsMade'),
        careerLongWinStreak: num(r, 'CareerLongWinStreak'),
        // Tenure + standing. SeasonsWithTeam is 0 in a first season, which is meaningful and
        // must not be confused with "unknown" — the résumé block distinguishes them.
        yearsCoaching: num(r, 'YearsCoaching'),
        seasonsWithTeam: num(r, 'SeasonsWithTeam'),
        prestige: str(r, 'CoachPrestige'),
        prestigeScore: num(r, 'CoachPrestigeScore'),
        almaMater: str(r, 'AlmaMater'),
        // HomeTown is a table reference, not a string — it reads back as a raw 32-bit
        // binary blob. HomeState is a real enum and is the usable half.
        homeState: str(r, 'HomeState'),
        contractYearsRemaining: num(r, 'ContractYearsRemaining'),
        contractExpectation: str(r, 'CurrentContractExpectation'),
        // The record the media actually cares about — resolved below from CareerStats.
        _careerStatsRec: r,
        career: null,
      });
    }
  }
  return coaches;
}

/**
 * The coach's RÉSUMÉ, from `Coach.CareerStats` -> the `CareerCoachStats` row.
 *
 * This is the answer to "does the beat know whether he's won one title or five" — and it is
 * real data, verified against a live save: the row carries NCWins/NCLosses (national
 * titles), ConfChampWins, BowlWins, PlayoffWins, the career W-L, and — separately —
 * WinsAtCurrentSchool/LossesAtCurrentSchool, which is his record with THIS program rather
 * than everywhere he has been. Those two must never be collapsed: a coach hired away from
 * another school has a career record that says nothing about his tenure here.
 *
 * Same reference pattern as Player.SeasonStats: `fields[name].referenceData` gives
 * {tableId, rowNumber}, which beats parsing the 32-bit binary string by hand.
 */
async function resolveCoachCareer(f, coachRec) {
  if (!f || !coachRec) return null;
  let ref = null;
  try {
    const fld = coachRec.fields['CareerStats'];
    ref = fld && fld.referenceData && fld.referenceData.tableId ? fld.referenceData : null;
  } catch (e) {
    return null;
  }
  if (!ref) return null;
  const t = f.tables.find((x) => x.header && x.header.tableId === ref.tableId);
  if (!t) return null;
  await readRecords(t);
  const rec = t.records && t.records[ref.rowNumber];
  if (!rec) return null;
  const g = (name) => num(rec, name);
  return {
    wins: g('Wins'),
    losses: g('Losses'),
    winsAtSchool: g('WinsAtCurrentSchool'),
    lossesAtSchool: g('LossesAtCurrentSchool'),
    // National titles. RecentYearNCWon is -2 when he has never won one.
    natTitles: g('NCWins'),
    natTitleLosses: g('NCLosses'),
    recentTitleYear: g('RecentYearNCWon'),
    confTitles: g('ConfChampWins'),
    confTitleLosses: g('ConfChampLosses'),
    bowlWins: g('BowlWins'),
    bowlLosses: g('BowlLosses'),
    playoffWins: g('PlayoffWins'),
    playoffLosses: g('PlayoffLosses'),
    top25Wins: g('Top25Wins'),
    top25Losses: g('Top25Losses'),
    rivalWins: g('RivalWins'),
    rivalLosses: g('RivalLosses'),
    timesFired: g('TimesFired'),
    top5Classes: g('Top5RecruitClasses'),
    draftPicks: g('DraftPicks'),
    firstRoundPicks: g('FirstRoundDraftPicks'),
  };
}

/**
 * ROAD TO GLORY. The user is a PLAYER, not a coach.
 *
 * RTG saves are the same file format as dynasty saves — same schema, same tables — and the only
 * reliable way to tell them apart is who is flagged as user-controlled. In a dynasty save it is
 * a Coach row; in RTG it is a Player row and `Coach.IsUserControlled` matches nobody. That
 * matters beyond a label: the existing user-team resolution falls through to a heuristic and
 * picks the WRONG SCHOOL on an RTG save (it chose Georgia for a player on team 73).
 *
 * Returns null on a dynasty save, which is what makes `mode` computable.
 */
function detectUserPlayer(playerTable) {
  if (!playerTable) return null;
  for (const r of playerTable.records) {
    if (r.isEmpty) continue;
    let flag;
    try {
      flag = r['IsUserControlled'];
    } catch (e) {
      continue;
    }
    if (flag !== true && flag !== 1) continue;
    const name = [str(r, 'FirstName'), str(r, 'LastName')].filter(Boolean).join(' ') || null;
    return {
      name,
      teamIndex: num(r, 'TeamIndex'),
      position: str(r, 'Position'),
      classYear: str(r, 'SchoolYear'),
      // What he was rated coming OUT OF HIGH SCHOOL — the whole point of the arc, and not the
      // same thing as his current ability.
      prospectStars: str(r, 'ProspectStarRating'),
      redshirt: str(r, 'RedshirtStatus'),
      homeTown: str(r, 'PLYR_HOME_TOWN') || null,
      homeState: stateName(str(r, 'PLYR_HOME_STATE')),
      // Ability is carried for the app's own math only. It is NEVER shown to a generator —
      // see gradeWord() in gen.ts and SYSTEM_PROMPT rule 6.
      overall: num(r, 'OverallRating'),
      confidence: num(r, 'ConfidenceRating'),
      legacyScore: num(r, 'LegacyScore'),
      experiencePoints: num(r, 'ExperiencePoints'),
      performLevel: num(r, 'PLYR_PERFORMLEVEL'),
      awardCount: num(r, 'YearlyAwardCount'),
      hotCold: str(r, 'StartingHotCold'),
      injuryStatus: str(r, 'InjuryStatus'),
      draftRound: num(r, 'PLYR_DRAFTROUND'),
      draftPick: num(r, 'PLYR_DRAFTPICK'),
      transferChance: num(r, 'AbsoluteTransferChance'),
      nilValue: num(r, 'BaseNILValue'),
      nilComp: num(r, 'CurrentNILCompensation'),
      idealPitch: str(r, 'IdealRecruitingPitch'),
      dealbreaker: str(r, 'RecruitingDealbreaker'),
      _rec: r,
    };
  }
  return null;
}

/**
 * Where he sits on the depth chart. `ForcedDepthChartEntry` is RTG's own record of it.
 *
 * UNVERIFIED, and returned as a LIST on purpose: a real save carried TWO QB entries —
 * (depth 0, locked 0) and (depth 5, locked 1) — and there is no field that obviously says
 * which one is the user's. Guessing here would put a confident wrong number in front of the
 * writer, which is the exact failure this codebase keeps paying for. Callers must treat depth
 * as best-effort until someone confirms the semantics against a save where the answer is known.
 */
async function readDepthPosition(f) {
  const t = await readRecords(pickTable(f, 'ForcedDepthChartEntry'));
  if (!t || !t.records) return [];
  const out = [];
  for (const r of t.records) {
    if (r.isEmpty) continue;
    try {
      const pos = str(r, 'Position');
      if (!pos) continue;
      out.push({
        position: pos,
        depth: num(r, 'CurrentDepth'),
        locked: num(r, 'LockedDepth'),
        userEditable: safeBool(r, 'UserEditable'),
      });
    } catch (e) {
      /* unreadable row */
    }
  }
  return out;
}

/**
 * Every school's real interest in him — `SchoolRelationship`, one row per program. This is the
 * entire recruitment of the user as hard data: who offered, how hard they are pushing, and
 * whether he ever decommitted. Zero invention, zero tokens.
 */
async function buildSchoolInterest(f, teams) {
  const t = await readRecords(pickTable(f, 'SchoolRelationship'));
  if (!t || !t.records) return [];
  const byIndex = new Map();
  for (const row of Object.keys(teams)) {
    const team = teams[row];
    if (team && team.teamIndex != null) byIndex.set(team.teamIndex, team.name);
  }
  const out = [];
  for (const r of t.records) {
    if (r.isEmpty) continue;
    let teamIdx = null;
    try {
      const fld = r.fields['Team'];
      const rd = fld && fld.referenceData ? fld.referenceData : null;
      if (rd && rd.tableId) teamIdx = rd.rowNumber;
    } catch (e) {
      /* leave null */
    }
    const offer = str(r, 'ScholarshipOfferStatus');
    const score = num(r, 'ScholarshipScore');
    // A school with no offer and no interest is noise — 138 rows of it would swamp the UI.
    if (!offer && !score) continue;
    out.push({
      teamRow: teamIdx,
      school: teamIdx != null && teams[teamIdx] ? teams[teamIdx].name : null,
      offerStatus: offer,
      score,
      tier: str(r, 'ScholarshipBonusTier'),
      coachTrust: num(r, 'CoachTrustBonus'),
      teamNeed: num(r, 'TeamNeedScore'),
      brandBonus: num(r, 'BrandMeterBonus'),
      decommitted: safeBool(r, 'WasDecommitted'),
    });
  }
  out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return out;
}

/**
 * THE LEAGUE'S OWN LIFE — four tables the app has never read, all of them real and all of them
 * free (no generation, no invention).
 *
 * - `Story`: the game writes its OWN news feed. Real headlines with a one-line summary, tagged
 *   by category and week. It already decided what was newsworthy league-wide — reading it means
 *   the wire can never be wrong about what mattered. Verified: 61 rows in a real dynasty save,
 *   including school records and milestone watches ("Tennessee HB Nate Gumbs is now the
 *   all-time team leader in Rushing Yards").
 * - `LeagueHistoryAward`: every award winner, by name, position and school.
 * - `LeagueHistoryConferenceChampion`: every conference title game, with both coaches, both
 *   records and the score.
 * - `CoachTransactionHistoryEntry`: the coaching carousel — who moved where, in which year and
 *   week. This is what lets the media know a rival just hired someone, and who held YOUR job
 *   before you.
 *
 * NOTE: the two history tables carry no year column. Rows appear to accumulate in order, so
 * they are returned oldest-first WITHOUT a year attached — a story must never date one.
 */
async function buildWorld(f, teams, coachTable) {
  const nameOfTeamRow = (row) => (row != null && teams[row] ? teams[row].name : null);

  // The game's own headlines.
  const headlines = [];
  const storyT = await readRecords(pickTable(f, 'Story'));
  if (storyT && storyT.records) {
    for (const r of storyT.records) {
      if (r.isEmpty) continue;
      const header = str(r, 'Header');
      const tag = str(r, 'Tag');
      if (!header && !tag) continue;
      headlines.push({
        headline: header,
        summary: tag,
        category: str(r, 'Category'),
        week: num(r, 'CurrentWeek'),
        seasonWeek: num(r, 'SeasonWeek'),
        year: num(r, 'SeasonYear'),
        priority: num(r, 'Priority'),
        topStory: safeBool(r, 'IsTopStory'),
        breaking: safeBool(r, 'IsBreaking'),
        teamRow: refRow(r, 'Team'),
        team: nameOfTeamRow(refRow(r, 'Team')),
      });
    }
    headlines.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  // Award winners.
  const awards = [];
  const awardT = await readRecords(pickTable(f, 'LeagueHistoryAward'));
  if (awardT && awardT.records) {
    for (const r of awardT.records) {
      if (r.isEmpty) continue;
      const last = str(r, 'lastName');
      const first = str(r, 'firstName');
      const type = str(r, 'AwardType');
      if (!type || (!last && !first)) continue;
      awards.push({
        award: type,
        name: [first, last].filter(Boolean).join(' '),
        position: str(r, 'Position'),
        school: str(r, 'TeamDisplayName'),
      });
    }
  }

  // Conference title games.
  const confChampions = [];
  const ccT = await readRecords(pickTable(f, 'LeagueHistoryConferenceChampion'));
  if (ccT && ccT.records) {
    for (const r of ccT.records) {
      if (r.isEmpty) continue;
      const winner = str(r, 'WinningTeamName');
      if (!winner) continue;
      confChampions.push({
        conference: str(r, 'ConferenceName'),
        winner,
        winnerCoach: [str(r, 'WinningCoachFirstName'), str(r, 'WinningCoachLastName')].filter(Boolean).join(' ') || null,
        winnerScore: num(r, 'WinningTeamScore'),
        winnerRecord: `${num(r, 'WinningTeamWins') || 0}-${num(r, 'WinningTeamLosses') || 0}`,
        loser: str(r, 'LosingTeamName'),
        loserScore: num(r, 'LosingTeamScore'),
        loserRecord: `${num(r, 'LosingTeamWins') || 0}-${num(r, 'LosingTeamLosses') || 0}`,
      });
    }
  }

  // The carousel. Coach refs resolve into the Coach table for a real name.
  const carousel = [];
  const txT = await readRecords(pickTable(f, 'CoachTransactionHistoryEntry'));
  if (txT && txT.records && coachTable && coachTable.records) {
    for (const r of txT.records) {
      if (r.isEmpty) continue;
      const coachRow = refRow(r, 'Coach');
      const cRec = coachRow != null ? coachTable.records[coachRow] : null;
      let coachName = null;
      if (cRec && !cRec.isEmpty) {
        coachName = [str(cRec, 'FirstName'), str(cRec, 'LastName')].filter(Boolean).join(' ') || null;
      }
      const from = nameOfTeamRow(refRow(r, 'OldTeam'));
      const to = nameOfTeamRow(refRow(r, 'NewTeam'));
      if (!coachName && !from && !to) continue;
      carousel.push({
        coach: coachName,
        from,
        to,
        fromRole: str(r, 'OldCoachPosition'),
        toRole: str(r, 'NewCoachPosition'),
        year: num(r, 'SeasonYear'),
        week: num(r, 'SeasonWeek'),
        stage: str(r, 'SeasonStage'),
        contractYears: num(r, 'ContractLength'),
        status: str(r, 'ContractStatus'),
      });
    }
    carousel.sort((a, b) => (b.year || 0) - (a.year || 0) || (b.week || 0) - (a.week || 0));
  }

  return { headlines, awards, confChampions, carousel };
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
    // The mode changes which name wins, so it has to change the cache key too — otherwise
    // switching back to the save's coach just serves the previous parse.
    cm: opts.coachNameMode || null,
  });
  // v7: coach résumé (career record, national/conference titles, record at THIS school).
  // v8: live job security (CurrentJobSecurityStatus/Percentage) instead of the stale
  //     season-start field; COACH_FIREREPORTED dropped as meaningless.
  // v9: RTG — mode detection, the user player, school interest, depth position.
  // v10: depth entries returned as a LIST (which row is the user's is still unverified).
  // v13: postseason rows carry a score before kickoff — the record decides what was played.
  // v14: team schemes and team colours.
  const cf = isPath ? cacheFile(pathOrFile, `snap|v16|${optKey}`) : null;
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
  // Scores alone lie about the postseason — see unplayFutureGames().
  const games = unplayFutureGames(buildGames(sgTable), teams);

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

  // The résumé, once we know WHICH coach is the user's. Resolved here rather than in
  // detectUserCoaches so we follow exactly one reference instead of one per human coach.
  if (userCoach) {
    userCoach.career = await resolveCoachCareer(f, userCoach._careerStatsRec);
  }
  for (const c of userCoaches) delete c._careerStatsRec; // never serialize a parser record

  // ROAD TO GLORY. Only looked for when no user COACH was found — a dynasty save should never
  // pay for a full Player-table scan, and the two flags are mutually exclusive in practice.
  let userPlayer = null;
  if (!userCoach) {
    const playerT = await readRecords(pickTable(f, 'Player'));
    userPlayer = detectUserPlayer(playerT);
  }
  const mode = userPlayer ? 'rtg' : 'dynasty';

  // In RTG the player's team is authoritative and the coach heuristic is not just unhelpful,
  // it is WRONG — it resolved Georgia for a player on team 73. Override it.
  if (userPlayer && userPlayer.teamIndex != null) {
    const match = Object.keys(teams)
      .map(Number)
      .find((row) => teams[row].teamIndex === userPlayer.teamIndex);
    if (match !== undefined) userTeamRow = match;
  }

  // If we still don't have a team, but we have a user coach, use the coach's team
  if (userTeamRow == null && userCoach && userCoach.teamIndex != null) {
    const match = Object.keys(teams)
      .map(Number)
      .find((row) => teams[row].teamIndex === userCoach.teamIndex);
    if (match !== undefined) userTeamRow = match;
  }
  // The strongest signal, tried LAST only because everything above is an explicit override
  // (a team the user named, an RTG player, a user coach). If any of those spoke, respect them.
  if (userTeamRow == null) userTeamRow = detectUserTeamByCharacter(teamTable);

  // And that is where the guessing stops.
  //
  // There used to be a "last resort heuristic: most program points" here, on the belief that
  // "CPU teams leave these at 0". They do not — 138 of 143 teams carry program points, and
  // they scale with prestige, so the heuristic did not find the user's team, it found the
  // best program in the country. Three users reported it in one afternoon: one was handed
  // Ohio State, and two separate people, playing ULM and Pitt, were both handed Alabama.
  // Resetting local data could not help, because nothing local was wrong.
  //
  // A wrong team is worse than no team: every article, every recap and every press conference
  // is then confidently about somebody else's program. Null means the app can ask.
  
  // WHO IS ACTUALLY COACHING. The stored name used to win unconditionally, which meant that
  // once a name was saved the app could never follow the save again: retire a coach, start a
  // new one, and every screen kept showing the retired man with no way to change it.
  //
  // The save is the source of truth, so it leads. A stored name is an OVERRIDE now, applied
  // only when the user has explicitly asked for one (coachNameMode === 'custom') or when the
  // save has no user coach to offer — which is the case a custom name existed for.
  const coachFromSave = userCoach ? userCoach.coachName : null;
  const wantsCustom = opts.coachNameMode === 'custom' && !!opts.coachName;
  const coachName = wantsCustom ? opts.coachName : coachFromSave || opts.coachName || null;

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

  // RTG extras. Resolved only in RTG mode so a dynasty parse costs nothing extra.
  let schoolInterest = [];
  let depthPosition = [];
  if (userPlayer) {
    schoolInterest = await buildSchoolInterest(f, teams);
    depthPosition = await readDepthPosition(f);
    // His season line — GAMESPLAYED/GAMESSTARTED are what the week-state is computed from
    // (by diffing against the archived baseline; the row itself is season-cumulative).
    // Reuses the roster resolver so the user player and his teammates can never disagree
    // about which stat table a line lives in.
    try {
      const statsFor = makeStatsResolver(f, si ? num(si, 'CurrentYear') : null);
      userPlayer.stats = await statsFor(userPlayer._rec);
    } catch (e) {
      userPlayer.stats = null;
    }
    delete userPlayer._rec; // never serialize a parser record
  }

  const result = {
    week,
    year: si ? num(si, 'CurrentSeasonYear') : null,
    dynastyYear: si ? num(si, 'CurrentYear') : null,
    calendar,
    coachName,
    /** What the SAVE says, regardless of any override — so the UI can offer the real one. */
    coachNameFromSave: coachFromSave,
    coach: userCoach,
    // "dynasty" | "rtg" — detected, never asked. See detectUserPlayer().
    mode,
    player: userPlayer,
    schoolInterest,
    depthPosition,
    // The league's own life — free, no generation. See buildWorld().
    world: await buildWorld(f, teams, coachTable),
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
  const cf = isPath ? cacheFile(pathOrFile, `recruits|v4|${cap}`) : null;
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
    let homeTown = null;
    let homeState = null;
    if (playerRow != null && playerT.records[playerRow]) {
      const p = playerT.records[playerRow];
      name = [str(p, 'FirstName'), str(p, 'LastName')].filter(Boolean).join(' ') || null;
      position = str(p, 'Position');
      overall = num(p, 'OverallRating');
      if (overall == null) overall = num(p, 'PlayerOverallRating');
      if (stars == null) stars = num(p, 'ProspectStarRating'); // usually on the Player
      // Where he is actually from. Reported: the dossier "never gets their hometown or state
      // correct and it's always completely different than what it really is" — because
      // nothing read it and the prompt told the model to invent one. PLYR_HOME_TOWN is a
      // plain string on the Player row ("Fort Collins", "Oakland", "Camden"); the coach
      // table's HomeTown is the reference blob, which is what that comment was about.
      homeTown = str(p, 'PLYR_HOME_TOWN') || null;
      homeState = stateName(str(p, 'PLYR_HOME_STATE'));
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
      homeTown,
      homeState,
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

// The scouting-relevant slice of a player's 50+ trait ratings. Verified present on a real
// CFB27 save (every name below resolved on the Player table). Kept curated on purpose: the
// whole roster ships to the frontend, so this is the difference between a lean payload and
// 70 players x 50 numbers.
const SCOUT_RATING_FIELDS = {
  speed: 'SpeedRating',
  accel: 'AccelerationRating',
  agility: 'AgilityRating',
  strength: 'StrengthRating',
  awareness: 'AwarenessRating',
  playRec: 'PlayRecognitionRating',
  pursuit: 'PursuitRating',
  tackle: 'TackleRating',
  hitPower: 'HitPowerRating',
  manCover: 'ManCoverageRating',
  zoneCover: 'ZoneCoverageRating',
  press: 'PressRating',
  catching: 'CatchingRating',
  catchTraffic: 'CatchInTrafficRating',
  routeShort: 'ShortRouteRunningRating',
  routeMed: 'MediumRouteRunningRating',
  routeDeep: 'DeepRouteRunningRating',
  release: 'ReleaseRating',
  breakTackle: 'BreakTackleRating',
  trucking: 'TruckingRating',
  juke: 'JukeMoveRating',
  vision: 'BCVisionRating',
  powerMoves: 'PowerMovesRating',
  finesseMoves: 'FinesseMovesRating',
  blockShed: 'BlockSheddingRating',
  passBlock: 'PassBlockRating',
  runBlock: 'RunBlockRating',
  throwPower: 'ThrowPowerRating',
  throwShort: 'ThrowAccuracyShortRating',
  throwMid: 'ThrowAccuracyMidRating',
  throwDeep: 'ThrowAccuracyDeepRating',
  throwPressure: 'ThrowUnderPressureRating',
  throwRun: 'ThrowOnTheRunRating',
  kickPower: 'KickPowerRating',
  kickAccuracy: 'KickAccuracyRating',
};

function scoutRatings(p) {
  const out = {};
  let any = false;
  for (const [key, field] of Object.entries(SCOUT_RATING_FIELDS)) {
    const v = num(p, field);
    if (v != null) {
      out[key] = v;
      any = true;
    }
  }
  return any ? out : null;
}

async function buildRoster(pathOrFile, opts = {}) {
  const teamIndex = opts.teamIndex;
  if (teamIndex == null) return [];
  const isPath = typeof pathOrFile === 'string';
  // v7 adds archetype + scouting trait ratings. The tag MUST be bumped whenever the shape
  // changes or every existing save serves a cached roster missing the new fields.
  const cf = isPath ? cacheFile(pathOrFile, `roster|v7|${teamIndex}`) : null;
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
      // The save's own archetype for this man — "DT_SpeedRusher", "CB_MantoMan",
      // "MLB_RunStopper", "WR_PhysicalRouteRunner". This is what a scouting report is
      // actually about: not how good he is, but what KIND of player he is.
      archetype: str(p, 'PlayerType'),
      // Ability tier the game assigns (None/Bronze/Silver/Gold/Platinum) — a quick read on
      // whether he has a game-breaking trait at all.
      abilityTier: str(p, 'PhysicalAbility1'),
      // The trait ratings a coach games plans against. Curated deliberately: enough to say
      // WHY he's a threat and WHERE he can be attacked, without shipping all 52 per player.
      ratings: scoutRatings(p),
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

// ── League-wide commitment tracker ──────────────────────────────────────────────
// Who committed WHERE, across the whole country. VERIFIED reference walk on a real CFB27
// save: Recruit.RecruitStage (Signed/Committed/SoftCommitted) tells us who's locked in, and
// Recruit.TopSchoolsList -> ProspectTargetSchool[] -> ProspectTargetSchoolN { TeamId,
// TeamInfluence } holds the destination — the committed school is the slot with the highest
// TeamInfluence (TeamId is a TeamIndex -> Team). Landing spots ARE in the save; they're just
// three reference-hops deep. Returns per-school class aggregates + the notable individual
// commitments, both compact.
async function buildCommitments(pathOrFile, opts = {}) {
  const isPath = typeof pathOrFile === 'string';
  const cf = isPath ? cacheFile(pathOrFile, `commitments|v2`) : null;
  if (cf) { const cached = readCache(cf); if (cached) return cached; }
  const f = isPath ? await openSave(pathOrFile) : pathOrFile;

  const teamT = await readRecords(pickTable(f, 'Team'));
  const playerT = await readRecords(pickTable(f, 'Player'));
  const recruitT = await readRecords(pickTable(f, 'Recruit'));
  if (!teamT || !recruitT) return { bySchool: [], notable: [], total: 0 };

  // TeamIndex -> { name, rank }
  const teamByIndex = new Map();
  for (const t of teamT.records) {
    if (t.isEmpty) continue;
    const ti = num(t, 'TeamIndex');
    if (ti == null) continue;
    teamByIndex.set(ti, {
      name: str(t, 'DisplayName') || str(t, 'LongName') || str(t, 'ShortName') || `Team ${ti}`,
      rank: rankOrNull(num(t, 'MediaPoll_CurrentRank')),
    });
  }

  // Referenced tables are resolved by tableId (the slot arrays live in their own tables).
  const byTableId = new Map();
  const getTable = async (id) => {
    if (byTableId.has(id)) return byTableId.get(id);
    const t = f.tables.find((x) => x.header && x.header.tableId === id) || null;
    if (t) await readRecords(t);
    byTableId.set(id, t);
    return t;
  };
  const refFull = (rec, field) => {
    try {
      const fld = rec.fields[field];
      if (fld && fld.referenceData && fld.referenceData.rowNumber != null) {
        return { tableId: fld.referenceData.tableId, row: fld.referenceData.rowNumber };
      }
    } catch (e) { /* not a ref */ }
    return null;
  };

  const tally = new Map(); // school -> aggregate
  const notable = [];
  let total = 0;

  for (const r of recruitT.records) {
    if (r.isEmpty) continue;
    const stage = str(r, 'RecruitStage');
    if (!stage || !/sign|commit/i.test(stage)) continue;

    const ls = refFull(r, 'TopSchoolsList');
    if (!ls) continue;
    const listT = await getTable(ls.tableId);
    const listRow = listT && listT.records[ls.row];
    if (!listRow) continue;

    // Destination = the target-school slot with the highest influence.
    let best = null;
    for (let i = 0; i < 10; i++) {
      const si = refFull(listRow, `ProspectTargetSchool${i}`);
      if (!si) continue;
      const tt = await getTable(si.tableId);
      const row = tt && tt.records[si.row];
      if (!row) continue;
      const inf = num(row, 'TeamInfluence') || 0;
      const tid = num(row, 'TeamId');
      if (tid == null) continue;
      if (best == null || inf > best.inf) best = { tid, inf };
    }
    if (!best || best.inf <= 0) continue; // no clear commitment yet
    const dest = teamByIndex.get(best.tid);
    if (!dest) continue;

    // Player details off the linked Player row.
    const pr = refFull(r, 'Player');
    let name = null, position = null, stars = num(r, 'ProspectStarRating');
    if (pr && playerT) {
      const p = playerT.records[pr.row];
      if (p) {
        name = [str(p, 'FirstName'), str(p, 'LastName')].filter(Boolean).join(' ') || null;
        position = str(p, 'Position');
        if (stars == null) stars = num(p, 'ProspectStarRating');
      }
    }
    if (!name) continue;
    const natRankRaw = num(r, 'NationalRank');
    const nationalRank = natRankRaw != null && natRankRaw > 0 ? natRankRaw : null;
    const signed = /^Signed/i.test(stage);
    const blueChip = (nationalRank != null && nationalRank <= 300) || (stars != null && stars >= 4);

    total++;
    const e = tally.get(dest.name) || { school: dest.name, teamRank: dest.rank, count: 0, blueChips: 0, sumRank: 0, rankedCount: 0, top: [] };
    e.count++;
    if (blueChip) e.blueChips++;
    if (nationalRank != null) { e.sumRank += nationalRank; e.rankedCount++; }
    if (e.top.length < 3) e.top.push(name);
    tally.set(dest.name, e);

    notable.push({ name, position, stars, nationalRank, stage: signed ? 'Signed' : 'Committed', school: dest.name, schoolRank: dest.rank });
  }

  const bySchool = [...tally.values()]
    .map((e) => ({ school: e.school, teamRank: e.teamRank, count: e.count, blueChips: e.blueChips, avgRank: e.rankedCount ? Math.round(e.sumRank / e.rankedCount) : null, top: e.top }))
    // "Winning the trail" = most blue-chips, then class size, then best average rank.
    .sort((a, b) => b.blueChips - a.blueChips || b.count - a.count || (a.avgRank ?? 9e9) - (b.avgRank ?? 9e9));
  notable.sort((a, b) => (a.nationalRank ?? 9e9) - (b.nationalRank ?? 9e9));

  const result = { bySchool: bySchool.slice(0, 40), notable: notable.slice(0, 80), total };
  if (cf) writeCache(cf, result);
  return result;
}

module.exports = { openSave, pickTable, readRecords, buildSnapshot, buildRecruits, buildRoster, buildPortal, buildCommitments, unplayFutureGames, schemeLabel, detectUserTeamByCharacter };
