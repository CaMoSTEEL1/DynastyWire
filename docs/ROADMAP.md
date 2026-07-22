# Dynasty Wire — Roadmap

Community-driven roadmap, ordered by (impact ÷ effort). Bugs always jump the queue.
Sources: Discord #suggestions and #bugs.

## ✅ Shipped in v0.1.3
- Gemini / provider "bad provider JSON" — diagnostic errors (shows what the endpoint
  actually returned + the correct Gemini base URL), scheme/paste tolerance, and
  array-content fallback for reasoning modes
- "Uncap max tokens" setting for OpenAI-compatible providers (local reasoning models)
- Shows / Draft Scout stuck-on-transcript bug (back button now dismisses for real)
- Recruit dossiers persist per recruit across weeks and app restarts
- Recruit text threads keyed stably (name+position — rank drift was orphaning history),
  with legacy-key migration
- **Around the League: featured stories** — the 3 biggest national items each week now
  carry a full multi-paragraph wire story; click the card on the Front Page to read

## ✅ Shipped in v0.1.4
- Stale-week bug: the app now follows the dynasty family (manual save + `-AUTOSAVE`,
  newest wins); warm cache gated on the save's modified time instead of a 10-min TTL
- Identity-leak bug: unknown coach/school stays unknown — no more real-world coach or
  big-school substitution (Shane Beamer / Tennessee reports)
- Hide recruit OVR toggle (Settings → Immersion) for star/film-based scouting
- Settings + Help pinned outside the scrolling tab strip (always visible)

## ✅ Shipped in v0.1.5
- **Roster-reasoned press**: real per-player season stat lines (pass/rush/receive,
  tackles/sacks/INTs, starts) parsed from the save and fed to every generator — the
  press now KNOWS the freshman is out-producing the senior and asks about it by name
- **Playoff-caliber press**: season-phase engine (regular / late-season stakes /
  conference championship / bowls-CFP) — postseason pressers talk seeding, the natty,
  opt-outs, portal noise, and recruiting-while-game-planning
- **Player personalities**: the save's real personality field (Intense / Leader /
  TeamPlayer / Entertainer / Unpredictable) governs how players behave in situations,
  locker-room reactions, and text threads — an Intense player stands his ground now
- **Own-words podium in the Situation Room**: media gauntlet questions accept free-typed
  answers (same judged-reaction engine as the Press Conference page)
- **Coordinator careers**: the save's real job (OC / DC / HC) is detected — coordinator
  careers get coordinator coverage (unit + play-calling questions, HC-job-stock talk),
  and the Coach page shows the real title
- **Consequence Sync** (opt-in): the meters now write BACK into the save — locker-room
  trust moves real player ConfidenceRating values, booster confidence adds/withholds
  ProgramPoints, and AD standing sets the coach's job-security percentage. Safety rails:
  timestamped backups (keeps 5) before every write, refuses while the game is running,
  verifies each write by re-reading the file, once per week
- **Two-way player stats**: the parser now keeps a player's offensive AND defensive
  season lines when both exist for the current year — two-way players show both splits
  in every generator's context
- **The Wire Room podcast**: new weekly long-form show — a national analyst and a local
  homer argue about your week from opposite lenses (Shows tab)
- **Highlight screenshots → accurate recaps**: attach screenshots of the game's
  highlight/stat screens on the Front Page; a vision pass transcribes the real plays and
  the lead story is rewritten around them (Anthropic + OpenAI-compatible vision)

## 🎯 Next up (v0.2)

### 1. Per-game two-way box-score ledger
Season-level two-way splits shipped in v0.1.5. Remaining piece: the game discards the
second-position PER-GAME lines after each week.
- Parser work: extract per-player GameOffensiveStats/GameDefensiveStats each week and
  accumulate into a season ledger stored per dynasty
- UI: player page/section with week-by-week offense + defense splits

### 2. Voice for the Wire Room podcast
The podcast transcript shipped in v0.1.5 — ElevenLabs narration is the natural next
step (key field already exists in settings).

### 3. Player photos / portraits
Requested for rosters and recruits. The game renders headshots weekly, so the assets
exist client-side.
- Research phase: locate portrait assets (game install/cache) and their id → player
  mapping; likely Frostbite texture assets requiring extraction
- Fallback plan if extraction is impractical: user-supplied image folder mapped by
  player name (drop a folder of PNGs, we match names), plus generated initials avatars
- No copyrighted asset redistribution — the app only reads what's on the user's disk

## 🔭 Later
- Season archive / back-issues browser (issues are already stored per week — needs UI)
- Multi-year memory: storylines that reference prior seasons' ledger events
- Weekly digest export (share your week's front page as an image/PDF)
- Voice: ElevenLabs narration for pressers and shows

## Notes
- Anything marked "parser work" is verified against a real save before shipping —
  field maps are never guessed.
- Bugs from #bugs always ship before roadmap items.
