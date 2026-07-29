# Design: Season Archive → Stats Export, Year-over-Year Memory, National Drama

Status: PROPOSED (not built). Covers three requested features that share one backbone.

## Why one doc

All three asks reduce to the same missing capability — DynastyWire has no durable memory
of *past seasons*. Build that once (the **Season Archive**) and all three fall out of it:

1. **Stats export / records** — a keepable, multi-year record of every player's numbers.
2. **Year-over-year memory** — year 2 media references year 1 (records, revenge games, a
   player's growth, callbacks to old storylines).
3. **National league drama** — coach reactions and hot takes from across the country, not
   just your team.

Feature 3 is mostly independent of the archive (it runs off the current week's league
results), but it benefits from it (rivalry history) and is grouped here because it's the
same "be a national dynasty player" theme.

---

## Grounding: what the save/data already gives us

Verified against `ingest/snapshot.js`:

- **Per-player multi-year stats live in the save.** `Player.SeasonStats` is an *array* of
  per-season stat rows, each tagged `SEAS_YEAR` (snapshot.js:690). The parser currently
  keeps only the current season and `continue`s past the rest — so every prior year for a
  *still-rostered* player is already on disk, just discarded.
  - **Gap:** a player who graduated/transferred is gone from the save. Their history only
    survives if *we* archived it. → the Archive is required, not optional.
- **Every league result is already parsed.** `buildGames` (snapshot.js:162) reads the whole
  ScheduleGame table — all teams, every week, tagged by year — plus quarter scores.
- **Real head coaches per program** are already in the context (`headCoaches` map, surfaced
  in `gen.ts` as "KNOWN HEAD COACHES"). So "Kirby Smart after losing to Florida" comes from
  real data: Georgia lost + Georgia's HC name, no invention.
- **Decision memory partially exists.** The saga ledger (`saga.ts`) persists every Situation
  Room call, tagged year+week — the seed of long-term memory.
- **Persistence pattern:** one `LazyStore("dynastywire.<name>.json")` per concern
  (settings, saga, issues, betting, suspensions). The Archive adds one more.

---

## Core: the Season Archive

New store: `dynastywire.archive.json`, keyed by dynasty. Shape:

```ts
interface SeasonRecord {
  dynastyId: string;
  year: number;                 // snapshot.year (CurrentSeasonYear)
  team: string;
  coachName: string | null;
  wins: number; losses: number;
  confWins: number | null; confLosses: number | null;
  finalRankMedia: number | null; finalRankCFP: number | null;
  prestige: number | null;
  result: "national-champ" | "made-playoff" | "bowl" | "missed" | null;
  champion: string | null;      // who won the natty that year (from league results)
  // Your season's statistical leaders (name, pos, line) — snapshotted so they survive
  // even after the players leave.
  leaders: { category: string; player: string; position: string | null; stat: string }[];
  // Per-player season line for the WHOLE roster, so year-over-year works for anyone.
  roster: { name: string; position: string | null; year: string | null; overall: number | null; stat: string | null }[];
  // Notable outcomes for revenge/rivalry memory.
  games: { week: number | null; opponent: string; us: number; them: number; won: boolean; rivalry?: boolean }[];
  // The storyline ledger for that year (copied from saga at rollover).
  ledger: { headline: string; decision: string; outcome: string; week: number }[];
  archivedAt: number;
}

interface ArchiveStore { [dynastyId: string]: SeasonRecord[]; } // newest last
```

**When it's written:** a season is "final" when the parsed `snapshot.year` increments past
the archived max, OR the calendar enters the offseason/next year with a completed record.
On that transition we snapshot the *outgoing* year from the last good in-season snapshot.
Detection reuses `computePhase` (offseason) + the year field. Idempotent — re-write the
same year overwrites, never duplicates.

**Robustness:** also expose a manual "Archive this season" button (Trophy Room) so a user
who never left the app open at rollover can force it, and so we can backfill.

---

## Feature 1 — Stats export & multi-year records

**Sidecar change (small):** in `buildStats`, stop discarding non-current years — collect a
`bySeason: { year, line }[]` per player alongside the current-season summary. Gated behind
a flag (`--history`) or always-on in a new `roster-history` command so the hot path stays
lean.

**Store:** the Archive already holds per-season roster lines; the save supplies extra years
for current players. Merge on read (Archive is source of truth; save fills gaps for players
still present).

**UI (Trophy Room):** a "Records & Export" panel:
- Season-by-season table (record, final rank, result, champion).
- Career stat leaders across all archived years.
- **Export** button → downloads `dynasty-<team>-stats.csv` and `.json` (roster lines per
  season + team results + leaders). CSV for spreadsheets, JSON for completeness.
- Tauri `dialog.save` + `fs.writeTextFile` (both plugins already in the app).

**Cost:** zero API — pure data.

---

## Feature 2 — Year-over-Year memory

**Mechanism:** feed a compact **PRIOR SEASONS** block into the shared media context
(`buildMediaContext`), passed via `opts` exactly like `suspensions`/`backstory` today.
Content, tightly summarized to stay cheap and cache-friendly:

- Last 1–2 seasons: record, final rank, result (e.g. "Y1: 8-4, unranked, missed playoff").
- This week's opponent history: "You lost to them 34-14 last year" → revenge framing.
- Returning players' growth: "QB Leber, Y1: 2,600 yds / 18 TD → now Yr2".
- Carried storylines from the ledger ("last year you suspended your RB1 for the bowl").

**Where it's used (prompt tuning per kind):**
- **Press conference** — questions that compare ("A year ago you sat here at 3-3. What's
  different?"). Biggest payoff.
- **Front page / recaps** — callbacks, "second straight year", revenge-game ledes.
- **Social** — fans referencing last year's collapse/breakout.
- **National desk** — "programs on the rise/fall vs a year ago".

**Guardrails:** the block states prior-season facts as fixed truth (same pattern as the
suspensions block) so the model can't invent last year's record. Only emitted when at least
one archived season exists — year 1 is unaffected.

**Cost:** small, shared, prompt-cached prefix → billed once per week's issue, like the
existing context. No new calls.

---

## Feature 3 — National league drama

**New generator `national-drama`** (new issue-tab kind, optional/auto-write-toggleable so it
respects budget mode). Inputs, all real:
- This week's notable league results (from `games`): ranked upsets, top-25 losses, rivalry
  outcomes, blowouts, undefeateds falling.
- The real HC name for each involved program (`headCoaches`).

Output: a set of **coach reactions / quotes** and short **hot-take columns** tied to actual
results — "Kirby Smart, after the Florida loss: '…'", a national pundit's take, a rival
program's message-board mood. Same voice contract as the rest (no invented names beyond
fictional pundits/fans; real coaches only where the save provides them).

**UI:** a "Around the Nation — Reactions" section on the **National Desk**, below the
existing wire. Cache-through per week like every tab.

**Cost:** one extra generation/week, only when the National Desk (or its auto-write
checkbox) is on. Sized ~1,500 tokens. Off by default in budget mode's core set; opt-in.

---

## Cost & caching summary

- Archive + export: **$0** (data only).
- Year-over-year memory: **~$0 marginal** — rides the existing cached context prefix.
- National drama: **one added section**, opt-in, respects the per-section auto-write
  checkboxes already shipped in v0.1.7.

Net: the headline feature (memory) is nearly free; only national drama adds tokens, and
only when the user opts in.

---

## Phased build order

**Phase A — Archive backbone + stats export** (foundation, $0 API)
- `dynastywire.archive.json` store + read/write/merge helpers.
- Rollover detection + manual "Archive season" button.
- Sidecar: emit multi-year stat rows.
- Trophy Room: Records table + CSV/JSON export.
- *Acceptance:* play into a new season → prior year appears in Trophy Room and exports.

**Phase B — Year-over-year memory** (the headline)
- PRIOR SEASONS context block from the Archive, passed through `generate()`.
- Prompt tuning for press-conference, recap, social, national.
- *Acceptance:* in year 2, a presser question references year 1's record; a rematch gets
  revenge framing; both grounded in real archived numbers.

**Phase C — National drama**
- `national-drama` generator + National Desk section + auto-write checkbox.
- *Acceptance:* after a week with a big upset, the National Desk shows a real coach's
  reaction to a real result.

Each phase ships independently and is separately committable.

---

## Decisions (LOCKED)

1. **Export format** — CSV **and** JSON both.
2. **Prior seasons in the memory block** — **ALL** archived seasons (plus opponent-specific
   history). Bigger context, but it rides the cached prefix so cost stays low.
3. **National drama scope** — **all three** (coach quotes + hot-take columns + rival fan
   mood), **no length cap** — it's opt-in, so flesh it out fully.
4. **Rivalry detection** — **yes**, infer from repeat matchups + close/heated history since
   the save doesn't flag rivalries cleanly.

## Build status

- **Phase A — SHIPPED (frontend-only, no exe/sidecar change):**
  - `src/lib/dynasty/archive.ts` — Season Archive store, record builder, CSV/JSON export.
  - `dynasty-context.tsx` — continuous per-season checkpoint on every ingest.
  - `components/trophy/season-records.tsx` — The Vault: season table, career bests, export.
  - Replaces the old "Coming soon" placeholder in the Trophy Room.
  - Verified: type-check, lint, and production build all green. Needs an exe rebuild to
    appear in the portable app (frontend is bundled at build time).
  - **Deferred within Phase A:** the sidecar change to emit *prior-year* stat rows for
    still-rostered players (backfill for mid-dynasty installs). The Archive already captures
    every season played *through the app* going forward; the backfill is a bonus and will
    bundle with the next native rebuild so we don't rebuild the exe twice.
- **Phase B — Year-over-year memory:** not started.
- **Phase C — National drama:** not started.
