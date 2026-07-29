# Dynasty Wire v2 — The Deterministic Core

Status: DECIDED (design locked), NOT STARTED (no code yet).
Decisions below came out of a full design interview. Each one is a commitment, not a maybe.

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

1. Build the validator (observe-only) + fixture tests. Run it against current generators.
2. Publish the baseline privately: violations per piece, per surface, per model.
3. Port the 7 in measured-worst-first order.
4. Add per-kind model routing.
5. Layer year-over-year memory on the locked-facts pattern.
6. Ship when the gate is met.
