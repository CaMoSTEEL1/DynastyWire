> **v0.2.0** — everything since v0.1.9
>
> 🏗️ **What v0.2.0 actually is**
>
> This is the first half of an architecture rewrite, and it's the reason the fixes below are fixes instead of another round of asking the AI nicely.
>
> The app had already run the experiment on itself. The scouting report works — *"at least the scouting report gets the names right!"* — because **the code works out the facts and the AI only writes the prose around them.** The game recap was the opposite: handed a pile of context and asked to figure out, in writing, who mattered and what it meant. Same AI, same save, same week, opposite results.
>
> So the wrong names and the mixed-up stats were never really an AI problem. They were an architecture problem — one this app had already solved in one corner. v2 makes that corner the whole app: **the recap, the stakes, the bowl/playoff picture, your history and your coach's résumé are all computed first**, then handed over as facts the writer isn't allowed to argue with.
>
> On top of that, **every piece is now fact-checked against your save** — invented people, players on the wrong team, wrong scores, wrong records, stat lines that belong to someone else. You can see the running count yourself at Settings → Fact-check baseline.
>
> The rule underneath all of it: it punishes **contradiction**, never **invention**. A fan can be an idiot about whether you deserved to win. He can't be wrong about who plays for you. Your invented beat writer, the student section, the 3rd-and-8 call, the weather — all still yours.
>
> Two of seven sections are fully rewritten so far (front page + Around the League). The rest are fact-checked but not yet rebuilt — that's the back half of v2.
>
> ✨ **New**
>
> • New: **the media knows your coach.** Titles won, career record, his record at THIS school, how long he's been here, whether he's safe — all pulled from your save. A two-time champ gets asked different questions than a first-year hire, and if he's never won anything the Wire says so instead of handing him a ring he doesn't have
>
> • New: **year-over-year memory** — from your second season on, the media remembers. Last year's record, revenge games (and it knows when you *won*, so it stops inventing them), rivalries, what a returning player used to be, and the decisions you made that people haven't forgotten
>
> • New: **the app updates itself** — one portable file, no installer, a small prompt in the corner you can always decline. It now confirms the update landed when it comes back up, and tells you if it didn't
>
> • New: the weekly issue waits while an update is pending instead of writing pages the restart throws away
>
> • New: Settings → Fact-check baseline — every generated piece is checked against your save and recorded, so there's a real number on how often the Wire gets a fact wrong
>
> 🐛 **Fixes**
>
> • Fixed: **the AI talking about overalls.** It was being handed raw 0-99 ratings and writing "an 88 overall corner" — nobody in football talks like that. It never sees a number now, only football language: all-conference, a quality starter, the weak link
>
> • Fixed: your bowl game was written as a first round playoff matchup. Bowls are bowls now — one game, season over either way, no bracket, no "first round"
>
> • Fixed: unranked teams were being pushed into the playoff race, the committee and the New Year's Six every week. That talk is gone unless you're actually in it
>
> • Fixed: "fighting for bowl eligibility" weeks after you'd already clinched it. It knows when it's settled — and when you're mathematically out
>
> • Fixed: season totals written as single-game lines. No more 900-yard, 100-carry games — writers now get a real per-game average to work from
>
> • Fixed: hot-seat talk in the middle of a great season. It reads your actual job security now, not a stale value that comes back blank
>
> • Fixed: pregame press conference answers coming back attached to post-game questions after a reload
>
> • Fixed: the press conference hanging on the loading screen with Skip as the only way out
>
> • Fixed: the answer buttons at the podium were nearly invisible
>
> • Fixed: players showing up on the wrong team and stat lines getting swapped between them — recaps are built on computed facts now instead of the AI sorting through a wall of data
>
> • Fixed: Around the League inventing people. One piece named ten players who don't exist; it uses your save's real programs, coaches and rosters now
>
> • Fixed: articles dating things to 2024 instead of your dynasty's year
>
> • Fixed: the front page occasionally printing the AI's refusal instead of an article
>
> • Fixed: a week's issue interrupted mid-write sitting at "writing…" forever
>
> • Fixed: using an OpenAI-compatible provider with no vision support dumped a huge error instead of saying so
