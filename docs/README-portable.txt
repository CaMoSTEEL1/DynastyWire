DYNASTY WIRE v0.1.9 — Portable (single file, no installer)

HOW TO RUN
  1. Double-click DynastyWire.exe. That's it — one self-contained app.
  2. On first launch, pick your dynasty SAVE FILE (e.g. DYNASTY-YOURNAME) and
     paste your API key. Everything stays on your machine.

BRING YOUR OWN API KEY
  - Anthropic (Claude) is the default and supports every feature, including
    reading highlight screenshots.
  - OpenAI-compatible providers also work (OpenAI, OpenRouter, Groq, LM Studio,
    Ollama, Gemini's OpenAI endpoint): Settings -> API keys -> switch provider,
    paste your base URL + key, then "Fetch models".
  - The app never phones home. Your key and save data stay local.

FIRST LOAD IS SLOW, ONCE
  Dynasty Wire reads a lot out of your save (real stats, personalities, every
  team's head coach, the national recruiting board), so the first parse takes a
  minute or two. After that it's fast.

COST
  Budget mode is ON by default and a full season costs roughly what a single
  week used to. Settings -> Weekly issue lets you tick exactly which sections
  auto-write each week, so you only pay for what you actually read. Reopening
  any past week is always free.

WRITING TO YOUR SAVE — READ THIS IF YOU TURN IT ON
  Two separate opt-ins under Settings -> Immersion:
  - "Consequence Sync" writes your Situation Room standing back into the save
    (player confidence, program points, job security). OFF by default.
  - "Write NIL to your save" controls brand-deal and NIL money. ON by default.
    Turn it OFF for a zero-to-hero run — the drama and your hot seat still play
    out, the money just never moves.
  Every write, either way:
  - A timestamped backup goes to  <your saves folder>\dynastywire-backups\
    before each write (the 5 most recent are kept).
  - It refuses to write while College Football 27 is running.
  - Every write is verified by re-reading the save afterward.
  Close the game before syncing, and keep your own backups too.

SUSPENSIONS
  A suspended player is held out of your lineup for the full term and then
  reinstated automatically. His ratings are never modified. If the write is
  pending, close the game and reopen Dynasty Wire.

NOTES
  - Windows may show "Windows protected your PC" (unsigned app). Click
    More info -> Run anyway.
  - Needs the Microsoft Edge WebView2 runtime, already installed on Windows 10/11.
    If the window is blank, install "Evergreen WebView2 Runtime" from Microsoft (free).

BUGS / FEEDBACK
  Post in the Discord with your week, what you clicked, and what you expected.
