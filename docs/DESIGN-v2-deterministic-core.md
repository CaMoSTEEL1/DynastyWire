# Dynasty Wire v2 — The Deterministic Core

Status: DECIDED (design locked). IN PROGRESS — first move done.
Decisions below came out of a full design interview. Each one is a commitment, not a maybe.

**Build log**

- *Step 1 — validator (done).* Ships observe-only in `src/lib/dynasty/validator.ts` with 34
  tests, wired into `generateInApp` so every generation is fact-checked and recorded,
  readable at Settings → Fact-check baseline. Nothing is repaired yet, by design.
- *Step 2 — baseline (measured 2026-07-29).* 24 real `recap-lead` generations from the
  archived Kansas State saves (6 game weeks × ported/pre-port prompt × Haiku 4.5/Sonnet 5),
  fact-checked against the same saves.

  | prompt | model | violations / piece |
  |---|---|---|
  | ported | haiku-4-5 | 0.00 |
  | ported | sonnet-5 | 0.20 |
  | pre-port | haiku-4-5 | 0.17 |
  | pre-port | sonnet-5 | 0.00 |

  **Measured rate: 2 real violations in 23 scored pieces (~0.09), already well under the
  0.5 gate — and the A/B is inconclusive at this sample size** (one violation on each
  side). Both survivors are the same failure: an invented staff/player name ("offensive
  coordinator Reese Talbot", "Kicker Carey Reisner").

  **Do not read this as "the surface is fixed."** The checker only covers what it can prove
  from the save: invented names, explicit team attribution, scores, records, ranks. The
  community's other complaint — *mixed stats* — has no check at all, so a piece that
  swaps two players' season lines scores clean today. Treat 0.09 as a floor on a narrow
  class, not a hallucination rate.

  The first pass of this run reported 1.17–1.67/piece. Almost all of it was the validator:
  Title Case headlines read as people, `K-State` matching a single-letter position cue,
  "Hurley ran for 120 against NC State" read as a misattribution, shared nicknames
  (Kansas State and Northwestern are both Wildcats) resolved last-write-wins, records read
  as scores, and hypotheticals ("the 14-0 record will change to 14-1") read as claims.
  Every one is fixed with a regression test written from the real copy that broke it —
  and **not one was caught by the fixtures written before seeing real output.**
- *Step 3 — porting (2 of 7 done).* `national-wire` is on the deterministic core
  (`src/lib/dynasty/national.ts`), ported second because the first tester report ranked it
  worst by an order of magnitude: **10 invented people in a single piece** against 0.5 for
  the ported recap and 0 for `national-desk`.

  **The cause was a contradiction between our own prompts, not the model.**
  `buildNationalWireSpec` told it to *"INVENT realistic fictional ones"* for any name it
  wasn't given; `SYSTEM_PROMPT` calls an unlisted other-team name a hard error. The surface
  could not satisfy both. Code now picks the programs in the news (ranked upsets first, then
  the top of the poll), supplies their real head coaches — free, already in the snapshot —
  and their real rosters, so there is nothing left to invent. Recruits stay invented on
  purpose: high-school prospects aren't in the save.

  Rosters for other programs are fetched **on demand at generation time**, capped at 6
  teams, because each one re-parses a ~10MB save. Anything that fails to load is reported as
  rosterless and covered by role only — `teamsToLoad()` is shared by the fetch and the
  prompt so the two can never disagree about which programs matter.

- *Step 3 (cont.) — `recap-lead`.* On the deterministic core:
  `src/lib/dynasty/recap.ts` computes how the game turned (quarter-by-quarter swing, shape,
  the quarter that moved it), what the result is worth (record, streak, bowl math from the
  schedule) and who could have decided it, and the prompt is built on that locked table.
  The 40-player dump and the wall of roster-separation warnings are gone from a game week;
  the shared context still carries the no-game weeks, which gain only the locked stakes.
  31 core tests plus 10 asserting the rendered prompt.

- *Step 2 (cont.) — the stat check (done).* The gap named below is closed: `validator.ts`
  now carries every player's SEASON-TO-DATE totals as ground truth and checks stat lines
  stated in prose against them. Two kinds:

  - **`mixed-stat`** — the number is exactly some OTHER player's season total in the same
    category. That is the swap fingerprint, it is the complaint the community actually
    filed, and it holds in any tense.
  - **`wrong-stat`** — an explicitly SEASON-framed line ("2,600 yards this season") that
    contradicts that player's real total.

  **What it deliberately does NOT check, and why the whole design bends around it:** the
  save has season totals and a final score. *It has no box score.* So "he ran for 120
  tonight" is invented per-game texture the house style asks for — not a contradiction — and
  flagging it would recreate the false-positive disaster of the first baseline run. A
  per-game line is therefore only catchable by the swap fingerprint, never by comparison.
  The check also stays silent on hedges ("nearly 1,400"), on rounding (2,600 for 2,588),
  on sentences naming two players (whose line is it?), and on **prior-season and career
  claims** — which year-over-year memory has now made a *correct* thing for the model to
  write. 11 regression tests, including one asserting the phrases actually parse: a pattern
  that silently matches nothing would make every "stays silent" case pass for the wrong
  reason, which is exactly how the pre-baseline fixtures caught none of the real bugs.

- *Step 3 (cont.) — the stakes port (2026-08-01, from a tester report).* One tester's first
  season produced three complaints that are all the same bug, and it is the thesis of this
  document restated: **the context stated the WEEK and left the STAKES to the model.**

  > "the wire will not stop referring to my bowl game (New Orleans Bowl) as a first round
  > playoff matchup. Wouldn't stop bringing up that the team was 'fighting for bowl
  > eligibility' while we were already Bowl Eligible, and seemed to think my, at the time,
  > 7-3 Sun Belt team was 'fighting for a playoff spot' while unranked the entire season, and
  > would always try and say we're pushing for a New Years Six Bowl appearance."

  `computePhase` mapped `BowlSeason1` straight onto "Playoff First Round". But that week type
  means *the postseason has started*, not *the playoff bracket has started* — and ~120 of 134
  teams spend it in an ordinary bowl. **The default was wrong for almost every team in the
  game.** Everything downstream inherited it: `rankings` literally asserted "$SCHOOL is IN
  the College Football Playoff", social got "it's the playoff", and the presser note told
  every November team the CFP picture was live.

  `src/lib/dynasty/postseason.ts` now computes it. Bowl eligibility is arithmetic on the
  record and the *regular-season* schedule (a scheduled bowl game must never read as another
  chance to become bowl eligible). Playoff membership is the CFP poll against a field size
  derived from the save's own postseason length. `weekShape()` is shared by the phase and the
  outlook so the two can never disagree about whether it is even the postseason — the same
  discipline `teamsToLoad()` uses. `PhaseInfo.playoffGame` replaced every
  `phase.key === "postseason"` that meant "in the bracket". 14 tests, fixtured as an unranked
  Group of Five team, because that is the majority case the old default got wrong.

- *Step 3 (cont.) — season totals as game lines.* The same report:

  > "in previews and game recaps, the wire is almost always stating season stats as if they
  > were the game stats, ex. saying my running back had 900+ yards in a single game with
  > 100+ carries"

  The prompt had already spent six lines forbidding exactly this, in capitals, and it kept
  happening — which is the clearest possible evidence for the thesis. The reason is
  structural: **a recap is about ONE game, the save has no box score, and the only number on
  the page is a cumulative total.** The writer isn't ignoring the rule; he has nothing else
  to reach for.

  So the fix is not another rule. Code now computes the **per-game average** and hands it
  over labelled as one ("HIS AVERAGE GAME (total ÷ 8, use THIS to describe a single game)"),
  and every total is prefixed at the point of the number rather than in a header forty
  players earlier. The validator gained `season-stat-as-game`, which fires when a game-framed
  sentence quotes a player's exact season total (with three games of separation, since in
  week one they are legitimately the same number) — so the fix is measurable instead of
  hoped for.

**Where this leaves the plan.** The port is done and measured, and the measurement does not
support porting the other six yet — not because they look fine, but because the instrument
was too narrow to rank them. The instrument is now wider; what is still missing is sample.

1. ~~**Widen the checker to the failure the community actually reported.**~~ Done — see
   step 2 (cont.) above, plus `season-stat-as-game`. The remaining honest caveat: the stat
   check can only fire where the save carries a stat line (top-40 players), and a *prior*-
   season stat claim is skipped rather than verified, because `buildGroundTruth` does not yet
   hold archived seasons.

   **There is no checker for the stakes.** Bowl-vs-playoff, "fighting for eligibility" and
   New Year's Six talk are all now stated correctly in the context, but nothing detects the
   model contradicting them — that would need phrase-level checks against
   `outlook.standing`, and it is the obvious next widening.
2. **Get a bigger sample.** 23 pieces and 2 violations cannot separate two prompts. The
   observe-only wiring already records every generation the user makes, so this accrues for
   free during normal play — read it at Settings → Fact-check baseline rather than paying
   for another synthetic run. **The baseline predating the stat check is not comparable to
   the one after it** — the instrument changed, so re-measure from a clean slate before
   reading any movement as improvement.

Decision #8's gate (< 0.5 per piece on the cheap model) is *already met* on this surface by
the current numbers, which is a signal the gate is calibrated against the wrong thing rather
than a signal that v2 is done. Recalibrate it once the stat check lands.

---

## The insight this is built on

The codebase already ran the experiment:

- `scouting.ts` / `pressure.ts` / `traits.ts` — **code computes the facts, the model writes
  prose around locked tables.** Community response: *"at least the scouting report gets the
  names right!"*
- `recap-lead` — **model gets a context blob and writes 450-600 words freely.** Community
  response: players on the wrong teams, mixed stats, "recap articles are the main thing I've
  seen issues with."

Same model. Same save. Same week. Opposite outcomes.

So hallucination is **not** a model problem, **not** a prompt problem, and "turn off budget
mode" is a tax, not a fix. It's an architecture problem that's already solved in one corner
of the app. v2 makes that corner the whole app.

---

## The ten decisions

### 1. v2 is an ARCHITECTURE overhaul, not a feature release
Every generator moves to the `scouting.ts` pattern. Features ride along; they aren't the point.

### 2. Contract = facts-in **and** validate-out
Keep feeding locked tables (facts-in). ADD a code-level fact-checker on the output
(validate-out). Facts-in alone has failed repeatedly — the model can always ignore its input.
We own ground truth (every valid name, its team, every score/rank/record), so violations are
detectable in code at **zero API cost**.

### 3. On violation: repair first, retry as fallback
- Misattributed player → **demote to role-only** ("their linebacker"). This is already the
  rule the prompt states; the repair just enforces it.
- Wrong number (score/record/rank) → correct it from the save.
- Only if a passage can't be salvaged → regenerate **that one section**.
Never silently ship a known-false claim. Never regenerate the whole piece for one bad name.

### 4. Facts checked everywhere, voice free everywhere
The validator runs on **all 25 generator kinds**. Per-surface config controls only *what
counts as a checkable claim*.

Key distinction, from community feedback: cgnobody defends **wrong opinions**
(*"crazy bandwagon fan talking out of their ass"*), not **wrong facts**. A fan may be an
idiot about whether you deserved to win; he may not be wrong about who plays for you.
So: social keeps unhinged takes, but cannot move your RB to another school. Recruit dossiers
keep invented hometowns, but cannot fake a national rank.

### 5. Model routing: cheap for structured, premium for showpieces
The validator fixes **accuracy**; it does not fix **prose quality**. Haiku fact-checked is
correct and still flatter than Sonnet.

But the deterministic core changes the shape of the work: once code computes the facts, most
surfaces stop being long-form prose and become tables, one-liners and short takes — where
cheap models are genuinely fine. Only 1–2 surfaces are real artistic writing.

- **Cheap model**: wire items, social, rankings, takes, table-to-sentence work
- **Premium model**: the lead recap, the retrospective
- Context also shrinks (code did the reasoning, so no 40-player dump), so this is cheaper
  than today overall AND better where writing is actually read.
- Requires **per-kind model routing** — new plumbing.

### 6. Payload = core + year-over-year memory
A pure architecture release is **invisible** — "we refactored the generators" is not a
Discord post. The core *unlocks* the most-requested feature: memory was previously unsafe
because the model confabulated prior seasons; under locked facts it's just another table,
and the Season Archive (shipped v0.1.8) already holds the data. Low marginal cost, and it
gives v2 something users can see.

**SHIPPED** — `src/lib/dynasty/history.ts` renders the PRIOR SEASONS block and it rides the
shared (prompt-cached) context, so the marginal cost is ~$0. Details and guardrails in
`DESIGN-season-archive.md` → Build status → Phase B.

### 7. Rollout = big-bang v2.0
One loud release, matching what the community was already promised.

**Caveat accepted:** release cadence and internal build order are separate. Build the
validator **first internally** (observe-only) to get a real hallucination baseline per
surface/model before porting anything — you just don't ship it as its own release. Otherwise
you're refactoring blind and can't prove any surface improved.

**Known risk:** big-bang's failure mode is never shipping. Mitigated by #8.

### 8. Done = metric gate + frozen surface list
v2 ships when the frozen list hits a hallucination threshold **on the cheap model**
(target: **< 0.5 violated facts per piece** — calibrate once the baseline exists).
Anything not on the list is v2.1 **by definition**. No additions after day one.

### 9. The frozen list (7 surfaces get the deterministic restructure)
1. `recap-lead` — the flagship offender
2. `national-desk`
3. `national-wire`
4. `press-conference`
5. `shows`
6. `social`
7. `rankings`

Already deterministic (no work): `scouting`, `storylines`.
Everything else: validator-only in v2; restructure in v2.1.

### 10. Voice: facts locked, angle and texture free
**The validator punishes contradiction, never invention.**

- Code owns: names, team attribution, scores, records, ranks.
- Model owns: the lede, the angle, structure, quotes, and all invented in-game color (a
  3rd-and-8 call, a dropped snap, the student section, a fictional beat writer's byline).
- `HOUSE_STYLE` stays untouched. Showpieces get the premium model and the loosest structure.

---

## Implementation notes (surfaced during design)

**False-positive trap.** A generated fan/pundit could share a name with a real player
elsewhere in the league. The checker must:
- scope itself to *assertive claims about this game and its teams*, and
- allowlist personas generated in the same payload (bylines, reporters, fan handles).

**The metric.** Violations per piece, by surface and by model. This is the number that turns
"it feels better" into "hallucinations down 90%" — and it's the v2 marketing claim.

**Test infrastructure exists.** 119 vitest tests across `scouting`/`pressure`/`traits`/
`week-state` already pass. The validator should ship with fixture-based tests (known-bad
generated text → expected violations), since it's pure logic over known inputs.

---

## Explicitly NOT in v2

- Player portraits (unscoped Frostbite asset research — could sink the release)
- Per-game box-score ledger
- ElevenLabs custom voices (still open from earlier; not part of this design)
- National drama / league-wide coach reactions (archive spec Phase C)
- Open-sourcing / game-agnostic engine split (a FIFA/FC port was requested in Discord)

---

## First moves

1. ~~Build the validator (observe-only) + fixture tests. Run it against current generators.~~ **done**
2. ~~Publish the baseline privately: violations per piece, per surface, per model.~~ **done**
   (and widened with the stat check — re-measure from scratch)
3. Port the 7 in measured-worst-first order. **2 of 7: `recap-lead`, `national-wire`.**
4. Add per-kind model routing.
5. ~~Layer year-over-year memory on the locked-facts pattern.~~ **done**
6. Ship when the gate is met.
