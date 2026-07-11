# CFB27 Field Map

## ⭐ SUPERSEDED (2026-07-10): the real CFB27 schema exists — use madden-franchise ≥ 4.3.1

The empirical struggle below is history. **madden-franchise 4.3.1 ships the real CFB27
schema** (`data/schemas/27/C27_468_2.gz`, "College 27"). 4.2.2 (what we first bundled) did
not — that's why we were approximating with Madden 26 and degrading features. Upgraded, the
lib reports `gameYear: 27, schema {major:468, minor:2}` and **every table decodes with real
field names, zero generic**. Verified against the real save.

Credit: the **PocketScout Utilities** CFB27 editor (open source Electron app, uses the same
madden-franchise lib) — its `resources/app/src/modules/*` gave the field semantics below.

### Resolved with the real schema (no more guessing / "coming soon"):
- **User's team — DEFINITIVE:** `Coach` where `IsUserControlled === true` → its `TeamIndex`
  → the `Team` row with that `TeamIndex`. (Real save: coach "Ski Miller", TeamIndex 38 →
  Kansas State.) Replaces the IsSimmed / program-points heuristics that both mispicked.
- **Current week/year:** `SeasonInfo.CurrentWeek`, `.CurrentSeasonYear`, `.CurrentYear`
  (dynasty year). Replaces the fragile `Field_6` guess.
- **Coach / hot seat:** `Coach.SeasonStartJobSecurityStatus`, `COACH_FIREREPORTED`,
  `COACH_PERFORMANCELEVEL`, `Age`, `AwardPoints`, `CareerWinSeasons`, `CareerPlayoffsMade`,
  `CareerLongWinStreak`, contract fields.
- **Recruiting board:** `Recruit.Player` (ref) → `Player.FirstName/LastName/Position/
  OverallRating`; `Recruit.CommitScore`, `ProspectStarRating` (stars), `NationalRank`,
  `PositionRank`, `StateRank`, `Class`, `RecruitStage`.
- Team (424 fields), polls, pipelines, NIL/program points — all real-named now.

### Ingest overhaul applied
`ingest/snapshot.js` now: upgrades to 4.3.1, auto-detects user team+coach via the schema,
uses `CurrentWeek`, and surfaces coach hot-seat/career fields. Recruiting extraction
(Recruit→Player join) is the mapped-but-not-yet-wired next addition.

---

# (Historical) CFB27 Empirical Field Map

Path (c): we don't have the CFB27 schema, so we label the fields the media engine
needs by **before/after autosave diffing**. This doc is the running ledger of what's
been verified. Anything not marked VERIFIED is a hypothesis.

## Method (reusable)

1. Snapshot the dynasty autosave. **The game overwrites the same filename in place**,
   so each snapshot is perishable — copy it off immediately (see `calibration/`).
2. Play/sim one week; snapshot again.
3. Load both with `madden-franchise` (it loads a raw `FBCHUNKS` save *or* an
   already-decompressed `FrTk` body directly). Match tables by `header.uniqueId`
   (stable across saves), compare numeric field values.
4. Fields that changed == the week's events. Numeric fields read correctly even without
   a schema; string fields (names) default to `int` and must be read from the string
   sub-table (table2) instead.

Reference harness: `save-parser/` (Rust container validator) + the diff scripts used to
produce this map. Calibration baselines live in `calibration/`.

## Table read reliability (important)

CFB27 shares its franchise core with Madden 26, so `madden-franchise`'s bundled M26
schema **partially** applies:

- **Matched + aligned** — real field names, correct values (e.g. `SeasonInfo`,
  several `Season*Stats` tables). Trust after spot-check.
- **Matched but drifted** — real names, WRONG offsets/record-size (e.g. `SeasonGame`
  read as 1 record with `HomeScore=500`). Do **not** trust; read generically and
  re-map, or align offsets against known values.
- **CFB-only** — no schema, generic `Field_N`, strings mis-typed as int (e.g. `Team`,
  `Coach`, `Owner`, recruiting tables).

## VERIFIED fields

Big update: the M26 schema labels CFB27's **core franchise tables correctly**. The earlier
"garbage read" was a wrong-table-instance bug — there are multiple tables named `SeasonGame`
(and `Team`, etc.); always pick the instance with the largest `data1RecordCount`. With that
fixed, a week3→week4 diff produced 62 correctly-named, correctly-scored, correctly-ranked
games (e.g. "#31 Texas 35 def. #7 Ole Miss 28"). The field map below is confirmed against
real output.

| Table | Field | Meaning | Evidence |
|-------|-------|---------|----------|
| `SeasonInfo` (singleton) | `Field_6` | Current week index | `2 → 3` after simming one week |
| `SeasonGame` (983 recs) | `HomeScore`, `AwayScore` | Final scores | 62 games went 0→score in one week |
| `SeasonGame` | `HomeScoreQuarter1..4`, `AwayScoreQuarter1..4`, `HomeScoreOT`, `AwayScoreOT` | Quarter/OT scoring | changed with finals |
| `SeasonGame` | `HomeTeam`, `AwayTeam` | Team references (resolve via `.referenceData.rowNumber` → Team row) | resolved to correct names |
| `SeasonGame` | `SeasonWeek`, `SeasonYear`, `SeasonGameNum`, `GameStatus`, `IsSimmed` | Game context | `IsSimmed=false` ⇒ the user actually played it (⇒ identifies user's team) |
| `Team` (143 recs) | `DisplayName`, `LongName`, `ShortName`, `NickName`, `City`, `Mascot_AssetName` | Team identity strings | names resolved correctly |
| `Team` | `HomeWin`, `HomeLoss`, `RoadWin`, `RoadLoss`, `ConfWin`, `ConfLoss`, `ConfTie`, `NonConfWin/Loss`, `DivisionWin/Loss`, `SeasonWinLossStreak` | Full W/L splits | present, numeric |
| `Team` | `MediaPoll_CurrentRank`, `MediaPoll_LastWeeksRank`, `CoachesPoll_CurrentRank`, `CFPPoll_CurrentRank`, `TeamRank` | All three polls + prev-week | ranks attached to games |
| `Team` | `TeamPrestige`, `TEAM_RATINGOVR/OFF/DEF/QB/…`, `OffensiveRank`, `DefensiveRank`, `CurSeasonConfStanding` | Ratings + standings | present |
| `Team` | `TeamIndex` | Team's stable id (distinct from row index) | present |
| `SeasonCoachStats` (464) | `Wins`, `Losses` | Coach season record | 30 wins / 48 losses moved in a week |
| `Coach` (632) | `CurrentWinStreak`, `SeasWinStreak`, `EarnedContractPoints_ThisYear` | Coach streaks/contract | changed with results |

### Gotchas confirmed
- Multiple same-named tables exist — select by max `data1RecordCount`.
- Isolated `readRecords()` on some tables returns 1 dud record; the real data reads fine when
  you pick the right instance.
- Team refs in `SeasonGame` are reference fields → use `record.fields.HomeTeam.referenceData.rowNumber`.

## User's team: a confirmed setting, not an auto-guess

Auto-detection failed twice and should not be trusted:
- `SeasonGame.IsSimmed=false` → picked the opponent (Air Force), because the user's
  *opponent* also appears in the unsimmed game.
- Max program points → picked Oklahoma; program points are NOT user-only, every team
  accumulates them.

Decision: the user **confirms their team once at setup** (dropdown over `Team.DisplayName`),
stored as a setting. `buildSnapshot(path, { userTeamName | userTeamRow })` pins it.
Ground truth for this save: **Kansas State = Team row 7, TeamIndex 6**.
Gotcha: name matching must be exact-first — `"arkansas state".includes("kansas state")` is
true, so a naive contains-match resolves the wrong team.

Best-effort auto-*seed* for the dropdown (unverified, polish later): `Owner` table row 0 is
the human coach (this save: "Mark Price"); chase Owner→coach→coached-team to pre-select.

## Still to map
- Recruit commit/star fields (needs a recruiting-action calibration pass).
- Player-level per-game stat lines (large stat tables; map when building player features).

## Strong leads (unverified)

- `Owner` table (2 records, 80 fields) — likely the user coach/owner entity; `Field_80 = 5000000`
  looks like a budget/cash value. User's controlled-team id probably lives here or in a
  `MySchool*` / `CareerHub*` singleton.
- `SeasonGame` (983 records) — holds per-game results; M26 names present (`HomeScore`,
  `AwayScoreQuarter1`, `SeasonWeek`, uniforms) but offsets drifted → needs generic re-read.
- `Season*Stats` tables — matched M26, aggregate stat fields labeled correctly.

## Still to map (the ~25 the media engine needs)

- User's controlled team id + team name (string via table2)
- Team record: wins, losses, conf W/L, points for/against, current ranking
- Per-game: home team ref, away team ref, home score, away score, week, result
- Player: name (table2), position, overall rating, class/year, team ref
- Recruit: name (table2), position, star rating, committed-team ref, status

## Next calibration passes

1. Sim a week where **the user's team plays a scored game** → pins `SeasonGame`
   home/away score + team-ref fields (watch 0→score transitions).
2. Diff across a game the user wins/loses → pins Team `wins`/`losses`.
3. Sign/commit a recruit → pins Recruit commit + star fields.
