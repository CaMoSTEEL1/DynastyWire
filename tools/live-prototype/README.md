# Live game reader — prototype (option A)

Answers one question: **can DynastyWire know what is happening in a game while it is being
played?** The save cannot tell us — it is written once per week advance, not per play — so
this reads the screen instead.

Proven against a real CFB 27 game (Utah at Kansas State, Sugar Bowl):

```
[21:46:36] LOCKED ON  1st 6:50  3rd & 1   UTAH  KANSAS STATE 0
[21:47:11] down: 4th & 1
```

Clock ticking live, play clock counting down, down and distance changing, and an event
emitted from a confirmed state change.

## Running it

Both scripts need the game running. Windows' built-in OCR engine does the reading; nothing is
installed and nothing touches the game process.

```powershell
# find the score bar on your setup - prints every line on screen with coordinates
powershell -ExecutionPolicy Bypass -File tools\live-prototype\watch.ps1 -Calibrate

# watch it, and emit events
powershell -ExecutionPolicy Bypass -File tools\live-prototype\live.ps1 -Region "360,925,1280,70" -Raw
```

`-Region` is `x,y,w,h` of the score bar. `360,925,1280,70` is correct for 1920x1080; other
resolutions need calibrating once.

## What it does and does not touch

Screen capture plus OCR. **No memory reads, no injection, no hooking** — the same thing OBS
and Discord do, which is what makes it safe to run beside EA's anti-cheat. That was a design
constraint, not an accident.

## What was learned, and what is still hard

**The bar only exists during live play.** Play-call overlays, replays, cutscenes and menus
have no score bar at all, so "no read" is the normal case and can never be treated as the game
changing. Roughly half of ticks see nothing.

**OCR of a score bar is noisy.** Real reads from this game include `1 2:00` with the clock
split, `O` for zero, `3rd & 1:` with the play clock bleeding in, and outright junk like
`@ 4 UTAH O e I KANSAS STATE`. Exact matching is useless; every field is extracted tolerantly
and an event only fires once the same new state has been seen twice. One flickery frame is
not a touchdown.

**Reliable today:** quarter, game clock, play clock, down and distance, team names.
**Intermittent:** the score digits, which read on some frames and not others. Good enough to
detect that a score changed, not yet good enough to trust a single reading.
**Not attempted:** who scored. That flashes in a banner and needs a vision call fired at the
moment an event is detected — the design sketched earlier, where cheap local detection
triggers the one expensive call.

## Event vocabulary

The taxonomy follows Bandroom's `trigger_event_map.json` — 43 event keys over 17 triggers
(`TD_HOME`, `TURNOVER`, `OFF_1ST_DOWN`, `PENALTY`, `BIG_PLAY`, …). Used with explicit
permission from its author, KingSupremeLIVE.

## If this becomes a product

The PowerShell here is a prototype, not a shipping design. Real version:

- capture and OCR move into the Rust side of Tauri (`windows` crate → `Windows.Media.Ocr`),
  so there is no PowerShell dependency and no per-tick process spawn
- the crop is calibrated once per user and stored, rather than passed on the command line
- events feed the existing media engine, so the wire and the podcast can react to a
  touchdown while the drive is still going — which is the thing Bandroom does not do, and
  the only reason this is worth building rather than reimplementing someone else's tool
