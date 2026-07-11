# Screen migration contract (6b/6c/6d)

Goal: make each dynasty screen build under Next.js `output: "export"` — **no server
components using request-time data, no Supabase, no `fetch('/api/...')`** — wired to the
new local data layer. This is the standalone Tauri app; data comes from the parsed save.

## Hard requirement
`npm run build` (static export) must succeed. A screen that can't fully map its data yet
must **degrade gracefully** (render a small "reading from your save…" / "coming soon"
panel) rather than break the build. Builds > fidelity.

## Data contract — use these, don't reinvent

```ts
import { useDynasty } from "@/components/dynasty/dynasty-context";
const { snapshot, delta, generate, settings, loading, error } = useDynasty();
// snapshot: DynastySnapshot { week, userTeam:{name,wins,losses,rankMedia,prestige,...}, teams, games }
// delta:    WeekDelta { weekPlayed, userResult, results[], rankingMoves[] } | null
// generate<T>(kind, extra?) -> Promise<T>   // kind maps to ingest/gen/<kind>.js
```

`useSettings()` (unchanged interface) still gives `dynasty {school, coachName, prestige}`
and `season {currentWeek, record}` — many child components already use it; keep them working.

All pages must be Client Components (`"use client"`). Fetch nothing over HTTP.

## Generation: add one file, no shared edits

For any AI content a screen needs, create `ingest/gen/<kind>.js` (copy
`ingest/gen/press-conference.js`). Export `generate(ctx, apiKey, extra)`; use
`callClaude(ctx, apiKey, prompt, maxTokens)` from `./_shared`. `ctx` has `userContext`
(grounded truth — never invent), `school`, `coachName`, `week`, plus `snapshot`/`delta`.

Recover the OLD prompt/voice for your feature from git (routes still in HEAD):
`git show HEAD:src/app/api/<feature>/.../route.ts` and
`git show HEAD:src/lib/<feature>/generators.ts`. Port the prompt faithfully.

Then call it from the screen: `await generate("<kind>", { ...options })`.

## Per-screen steps
1. `"use client"`, remove all Supabase + `/api` fetches.
2. Read data from `useDynasty()` / `useSettings()`.
3. For generated content: add `ingest/gen/<kind>.js`, call `generate(...)`, render result
   with a button (content is generated on demand, cached in component state).
4. Adapt the feature's components under `src/components/<feature>/` to the new data shapes.
   Delete components that are now obsolete (screenshot/OCR upload, manual entry).
5. Loading/empty/error states. Keep the DynastyWire editorial aesthetic (dark, crimson
   `#b5202a`, Playfair headlines) — don't restyle, just keep it working.

## DO NOT TOUCH (shared foundation — owned centrally)
`src/app/layout.tsx`, `src/app/(dynasty)/[dynastyId]/layout.tsx`,
`src/components/dynasty/*`, `src/lib/dynasty/client.ts`,
`src/components/settings/settings-context.tsx`, `src/components/masthead.tsx`,
`src/components/navbar.tsx`, `src/components/breaking-ticker.tsx`,
`ingest/cli.js`, `ingest/generate.js`, `ingest/gen/_shared.js`, `next.config.ts`.
Only add NEW files under `ingest/gen/`. Everything else in your assigned feature is yours.
