# Dynasty Wire — Road to Glory mode

Status: **DECIDED (design locked). Build steps 1-3 and 5 DONE — all five v1 surfaces exist and build. Step 4 (THE GATE) HAS NOT BEEN RUN: no RTG surface has yet been generated against a real save.** Every decision below came out of a full design
interview and is a commitment, not a maybe. Where a decision rests on save data, the field is
named — all of it was read out of a real RTG save (`RTG-SKIYZERSANLOCUS-AUTOSAVE`), not assumed.

---

## What the save actually gives us

Verified by reading the save directly. This section exists because the rest of the document is
only as good as this list.

**RTG saves are the same file format as dynasty saves** — byte-identical size, same schema, the
existing parser opens them unchanged and returns 143 teams, 896 games and 139 head coaches.

- **The user is a PLAYER, not a coach.** `Player.IsUserControlled === true` identifies him
  (`IsCreated` agrees). There is no user-controlled coach, so `snapshot.coach` is null and
  **the existing user-team resolution guesses wrong** — on the test save it picked Georgia
  while the player is on team 73.
- **Player identity:** `Position`, `SchoolYear`, `ProspectStarRating` (what he was rated out of
  high school — `TWO_STAR` on the test save), `RedshirtStatus`, `PLYR_HOME_STATE`,
  `IdealRecruitingPitch`, `RecruitingDealbreaker`, `TeamIndex`.
- **Standing:** `LegacyScore`, `ExperiencePoints`, `PLYR_PERFORMLEVEL`, `ConfidenceRating`,
  `YearlyAwardCount`, `StartingHotCold`, `InjuryStatus`.
- **Stakes:** `PLYR_DRAFTROUND` / `PLYR_DRAFTPICK`, `AbsoluteTransferChance`, `BaseNILValue` /
  `CurrentNILCompensation` / `IsNIL`.
- **Playing time:** `Player.SeasonStats` → `SeasonStats[]` → `SeasonOffensiveStats` (and the
  defensive/kicking equivalents) carrying **`GAMESPLAYED` and `GAMESSTARTED`**, pinned by
  `SEAS_YEAR`, with `YEARBYYEARTEAMINDEX` so a transfer stays attributable. These are SEASON
  CUMULATIVE — "did he play this week" comes from the diff against the archived baseline, which
  the app already keeps.
- **Recruitment:** `SchoolRelationship`, **one row per school, 138 of them** — `ScholarshipScore`,
  `ScholarshipOfferStatus`, `ScholarshipBonusTier`, `CoachTrustBonus`, `TeamNeedScore`,
  `BrandMeterBonus`, `WasDecommitted`.
- **Depth chart:** a real `DepthChart` table with per-position slots, plus `ForcedDepthChartEntry`
  (`Position`, `CurrentDepth`, `LockedDepth`) — RTG's own record of where the user sits.
- **The game writes its own news.** `Story` holds real rows with `Header` + `Tag` (a headline and
  a one-line summary), `Category` (`PREVIOUS_GAME` / `NEXT_GAME` / `POW_INFO`), `CurrentWeek`,
  `Priority`, `IsTopStory`, `IsBreaking` and character refs. Example from the test save:
  *"Road Troubles" / "The Bobcats can't get the win away from home, falling 55-7 to Texas A&M."*
- **RTG's meters are a different model** from dynasty's: `MetersChosenAction` carries
  `TestReadinessChange`, `AcademicsChange`, `LeadershipChange`, `FollowersChange`,
  `ContentMultiplierChange` — academics, leadership, followers, brand. Not media heat / fan
  trust / locker room.
- **The game records narrative outcomes as flags.** `CrossArcDataNameDefinition` contains literal
  entries `LostStartingJob` and `TurnedDownDrills`. `ArcContext` tracks a weekly goal, a named
  teammate actor, and a "DefensiveBoss" rival.
- **RTG continues past college.** `stage: "NFLSeason"`, `GoalsEval_NFLSeasonStartReaction`,
  `ArcDirector_UserPlayerRetirementReaction`, and draft round/pick on the player.

**Caveat on the test save:** it is edited — a two-star freshman rated 99 in every attribute who
is already a top-2 draft pick. Fine for proving field availability, useless as a realism fixture,
and a standing reminder that **RTG players edit saves**, which the "every number is real" promise
has to survive.

---

## The twelve decisions

### 1. RTG ships inside DynastyWire, behind its own front door
One binary. Detection is free and unambiguous (`Coach.IsUserControlled` vs
`Player.IsUserControlled`), so the app always knows which kind of save it opened and never asks.

The spine — parsing, the watcher, the weekly issue cache, the fact-checker, the archive, BYO key,
the self-updater, budget mode — is reused wholesale. What changes is everything the user sees.

### 2. Ship the coverage first, but design for the interaction
Phased: the beat lands first, the interaction follows. **The surfaces are not to be built
read-only**, because they will be rebuilt if they are. The interactions, in order: the podium
(a player's media availability), texts with the coach and teammates, and an RTG situation room.

The reason coverage-only is not the destination: in dynasty you are the protagonist *and* the
decision-maker. Strip the decisions and it is a newsletter about someone else's football.

### 3. DynastyWire owns the week BETWEEN games. It never races the game's own moments
**The app cannot suppress CFB27's pop-ups**, and the arc director keeps firing regardless of what
a second app does. So "play the game's situations in DynastyWire instead" is not achievable and
designing for it guarantees the two contradict each other.

Instead: the save tells us what the arc director already did (`LostStartingJob`,
`TurnedDownDrills`, meter movement, `Story` rows). DynastyWire **covers the aftermath** — you turn
down drills in-game, and on Monday your position coach texts you about it. No contradiction is
possible, because it is reacting to something that definitively happened.

The situations DynastyWire *does* run are the ones the game never shows: the group chat after a
blowout, the reporter who wants a quote about the starter ahead of you, the collective calling.

### 4. Opt-in `ConfidenceRating` writes. Nothing that touches progression
RTG **is** the grind from two-star to first-round pick. `ExperiencePoints`, skill points and
ratings are the game's progression economy, and an app that hands you XP for a good text message
is a trainer, not a companion.

So: `ConfidenceRating` only (hot/cold — it affects performance without being progression),
opt-in, same pattern as dynasty's Consequence Sync. Everything else stays in DynastyWire's own
store, exactly like the saga meters already do.

### 5. The surfaces are player-shaped. Team coverage is a separate, later layer
v1 is about him, with visibility of the world around him. The full team/league layer (front page,
Around the League, rankings, the slate — mostly reusable as-is) is a **separate** phase.

### 6. Week-based, reusing the weekly issue engine
Same cache, same archive, same cost controls, same per-section auto-write checkboxes.

**Known cost of this choice:** RTG advances faster than dynasty, and if the user sims three weeks
before opening the app, `GAMESPLAYED` jumps by three and the week cannot be attributed. Dynasty
has the same property and gets away with it because people open it every week. Accepted, not
solved.

### 7. Player week-states drive the framing
`did-not-play` / `played-off-bench` / `first-start` / `starter`, plus `unknown` and
`multi-week-gap`, computed from the games-played and games-started diff.

**CORRECTION FROM THE BUILD.** This originally listed `mop-up` and `rotational` as separate
states. The save carries GAMESPLAYED / GAMESSTARTED and **not snap counts**, so those two are
not distinguishable from each other and claiming "mop-up duty" would be an invention.
Collapsed to `played-off-bench` until a snap source is found.

**DISCOVERED IN THE BUILD — RTG gets a real box score, which dynasty never had.** Following
ONE player across two snapshots means subtracting last week's season line from this week's
yields *his actual game*. `weekLine()` returns it only when exactly one game happened in
between and null otherwise, which is the RTG guard against the "900+ yards in a single game"
class of bug. This is the strongest argument that RTG coverage can be *better* than dynasty
coverage rather than a thinner version of it — the same pattern as the existing
`weekStateOf` (`game` / `pregame` / `bye` / `preseason` / `season-over`), and consumed the same
way: each generator carries a different framing per state.

**A `did-not-play` week produces a real piece about not playing** — the scout-team rep, the
silence from the position coach, the guy ahead of you having a night. Not filler: for a backup
freshman that IS the experience, and it is the part the game never dramatizes. It is also what
makes the first snap land.

Sections with no material still write (the per-section checkboxes remain the cost lever).

### 8. v1 is five surfaces
1. **The Week** — the front page equivalent, about him, framed by the week-state. *The only
   generated surface in v1, and therefore the whole cost model.*
2. **The Group Chat** — texts with the position coach and teammates. Short, voicey, no long-form
   structure to get wrong.
3. **The Podium** — the player's media availability. Proven engine; a freshman handling a
   question is a different animal from a coach handling one.
4. **Your Recruitment** — straight off `SchoolRelationship`. Zero invention, zero tokens.
5. **The Depth Chart Above You** — who is ahead, what he did this week, how big the gap is. Real
   data via `DepthChart` / `ForcedDepthChartEntry`. Zero tokens.

**4 and 5 cost nothing** and carry much of the mode's perceived value. Budget mode for RTG is
close to "The Week only".

Not in v1: the RTG situation room, draft-stock tracking, the team/league layer.

### 9. Two front doors, fully separate
Separate profile lists, separate settings. RTG never inherits a dynasty concept — no `userTeam`,
no `coachName`; the profile is identified by the *player* and his school, read from the save.
Mode is detected silently on add and never asked.

### 10. A mandatory, user-written backstory, seeded from the save
Dynasty's coach backstory is optional because the program carries the story. **RTG has no
program**, so without a character The Week is a paragraph about a freshman who took no snaps.

Pre-filled from real facts (star rating, home state, position, class, which schools offered), and
it names the recurring cast — mapped to what the game already tracks: the **position coach**
(`CoachTrustBonus` has a face), **the guy ahead of you** (already named by the depth chart), a
**teammate/roommate** (`ArcContext` tracks a `TeamPlayer` actor), the **beat writer**, and
**home** — a parent or hometown coach, because the person you call after a bad week is the
emotional register dynasty does not have.

Written once, free forever, and it is what makes a text from "Coach Reyes" land differently from
one from "your position coach".

### 11. The app ends on draft night
RTG continues into an NFL career; DynastyWire does not follow. The entire app — voice, polls,
bowls, conferences, recruiting, the validator's ground truth — is college, and the NFL stage's
fidelity in the save is unverified.

Draft night is covered richly as a **finale** (stock, projection, where he went, the reaction),
and then the career closes into The Archive as a keepable, exportable record of the whole arc.
"Two-star freshman to first-round pick" is the story; an app that builds to draft night and
delivers it is complete.

### 12. Prove the load-bearing assumption before building the mode
**The riskiest sentence in this document is: *a well-written piece about not playing is good
content.*** Every other decision survives being wrong. That one is load-bearing under The Week,
under the week-states, and under the entire footnote-to-headline arc. If it reads as padding,
RTG mode is a stats viewer with a group chat.

**The test, before any surface is built:** point the existing engine at a real RTG save,
hand-assemble the context for three real weeks — one `did-not-play`, one mop-up, one first start
— generate The Week for each, and read them. One afternoon, about a dollar.

This follows the lesson the codebase has already paid for twice: fixtures written before seeing
real output caught none of the real bugs, and the deterministic recap was only worth porting
because it was measured first.

---

## Build order

1. ~~**Parser** — mode detection, the user player, his school relationships, his depth
   position.~~ **DONE.** Cache key at `snap|v11`. Verified against a real RTG save (mode `rtg`,
   the player resolved, his season line resolved, 22 of 138 schools carrying a live offer) and
   against a dynasty save (unchanged: mode `dynasty`, coach + resume + job security intact).
   **Fixed along the way:** the user-team heuristic picked the WRONG SCHOOL on RTG saves; the
   player's `TeamIndex` now overrides it.
2. ~~**Deterministic core** (`rtg.ts`) — week-state from the diff, locked player facts, the
   recruitment board.~~ **DONE.** Pure, 17 tests. "Who is ahead" is deferred: `ForcedDepthChartEntry`
   returned TWO QB rows on a real save with nothing saying which is the user's, so the parser
   exposes the list and the core refuses to guess.
3. ~~**The Week generator** — prompt spec built on those locked facts, framing per week-state.~~
   **DONE** as kind `rtg-week`, 2 prompt-level tests including the load-bearing no-appearance
   case. Not yet wired to a UI surface or the issue cache.
4. **THE GATE: run decision 12's test.** Three real generations, read them. Do not proceed on a
   bad result — redesign.
5. ~~Surfaces 4 and 5 (free data), then 2 and 3 (the interactions).~~ **DONE.** All five ship:
   The Week (`the-week`), His Feed (`my-social`, with the post composer), His Podium
   (`his-podium`), The Room (`the-room`), Your Recruitment (`recruitment`). The nav is
   replaced wholesale in RTG mode off `snapshot.mode`.
   - **The Room deviates from the design**: `ForcedDepthChartEntry` was unusable (two QB rows,
     no way to tell which is the user's), so the room is rebuilt from the roster and ordered
     by GAMES STARTED then production — never by rating.
   - **Brand/followers was added** beyond the original five (`brand.ts`): the save has an RTG
     meters economy but no readable live follower total, so DynastyWire keeps its own. Code
     computes every movement from real playing time and production; the model never states a
     count. The UI says out loud that the number is ours, not the game's.
6. Two front doors (separate profile lists), the mandatory backstory flow, RTG settings.
   **NOT BUILT** — RTG currently shares the dynasty profile list and has no backstory step,
   so decisions 9 and 10 are still outstanding.

---

## Explicitly NOT in RTG v1

- Team and league coverage (decision 5 — a separate phase)
- The RTG situation room (decision 8)
- Any NFL coverage beyond draft night (decision 11)
- Progression write-backs of any kind (decision 4)
- Mirroring or pre-empting the game's own pop-up moments (decision 3)
