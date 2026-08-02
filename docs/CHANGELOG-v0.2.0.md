# Dynasty Wire v0.2.0

Everything since **v0.1.9**. Covers the v0.1.10 / v0.1.11 builds (which never got a written
changelog) and all of v0.2.0.

---

## 🏆 The media finally knows who your coach is

- **Your coach's whole résumé is now in every story, pulled from your save.** National titles
  won, conference titles, bowl and playoff record, career record, how long he's been coaching
  — and, kept completely separate, **his record at THIS school**. A guy you hired away from
  somewhere else has a career record that says nothing about what he's done for you, and the
  Wire no longer mixes the two.
- **The room writes like it knows.** A two-time champion gets asked why *this* team is short
  of his standard; a first-year hire gets asked to prove he belongs. Fans argue about him with
  his actual record in hand.
- If he's never won a title, the Wire says so plainly instead of leaving a gap for the AI to
  fill with a championship he doesn't have.
- Works immediately — it doesn't need seasons played inside the app, so a dynasty you're
  already ten years into gets it on the first launch.

## 🧠 Year-over-year memory

- **From your second season on, the media remembers.** Last year's record and finish, how the
  program has trended, and the storyline decisions you made that people haven't forgotten.
- **Revenge games are real.** The Wire knows you lost to this opponent last year and frames the
  rematch that way — and knows when you *won*, so it stops writing revenge angles that don't
  exist.
- **Rivalries are inferred from repeat matchups**, since the save doesn't flag them cleanly.
- **Returning players are measured against what they were.** "2,600 yards as a sophomore, and
  now he's the reason you're ranked."
- Press conferences reach back ("a year ago you sat here at 3-3"), fans have long memories, and
  the front page gets its callbacks.
- Costs essentially nothing — it rides the same cached context the week already pays for.

## 🎓 Bowls are bowls, and the playoff is the playoff

- **Fixed: your bowl game was written as a first-round playoff matchup.** The Wire was reading
  "postseason" as "playoff" — true for twelve teams out of 134. It now works out whether you're
  actually in the bracket, and a bowl game is covered as what it is: one game, season over
  either way, no advancing, no "first round", no New Year's Six.
- **Fixed: unranked teams were being written into the playoff race** — the committee, the
  bubble, a New Year's Six push, week after week. Unranked means unranked; none of that talk
  appears unless you're genuinely in it.
- **Fixed: "fighting for bowl eligibility" weeks after you'd clinched it.** The Wire now knows
  the difference between chasing six wins, having them, and being mathematically out.

## 📊 Season stats stopped being written as single-game lines

- **Fixed: "900+ yards in a single game with 100+ carries."** Your season totals were being
  reported as what a player did on Saturday.
- Writers now get each player's **per-game average**, labelled as an average — the number a
  story about one game actually needs, which they'd never had before.
- Every stat line is now labelled as a season total at the number itself, not in a header
  forty players earlier.
- The built-in fact-checker catches it if it ever happens again.

## 🔥 Hot-seat talk in the middle of a great season

- **Fixed.** The Wire was reading a stale job-security value that comes back blank for part of
  the league — and a blank is where hot-seat drama gets invented. It now reads your real,
  current job security. At 14-0 with a safe job, nobody writes that your seat is warm.

## 🎙️ The podium

- **Fixed: pregame answers came back attached to post-game questions.** A week's pregame
  availability and its post-game press conference were sharing one record, so anything you said
  on Tuesday turned up under Saturday's questions after a reload. They're separate now.
- **Fixed: the press conference could hang on the loading screen** with Skip as the only way
  out. Every request now has a deadline, and the screen shows how long it's been waiting.
- **Fixed: the answer buttons were nearly invisible** against the dark takeover. They read as
  buttons now.

## ⬆️ The app updates itself

- **No installer, ever.** DynastyWire is one portable file and it replaces itself. When a new
  version is out you get a small prompt in the corner — always declinable, never forced.
- **It now confirms the update landed** when the app comes back up, and tells you if the swap
  silently failed instead of leaving you to guess which version you're on.
- **The weekly issue waits while an update is pending** instead of writing pages that the
  restart throws away.
- A week's issue that was interrupted mid-write no longer sits at "writing…" forever.

## ✍️ Accuracy work (v0.1.10 / v0.1.11)

- **Recaps are built on computed facts now.** How the game actually turned — the quarter that
  moved it, whether it was a comeback or a collapse, what the result is worth — is worked out
  in code, and the writer builds the story around it instead of guessing from a wall of data.
- **Fixed: players showing up on the wrong team, and mixed-up stat lines**, the two things the
  recap earned the most complaints for.
- **Fixed: Around the League inventing people.** One piece named ten players who don't exist.
  It now uses the real programs, their real head coaches and their real rosters.
- **Fixed: articles dating things to 2024.** The season was never actually stated anywhere in
  the context, so the AI fell back on whatever year it assumed. Every story now knows what year
  your dynasty is in.
- **Fixed: the front page occasionally printing the AI's refusal instead of an article.** It was
  being told the game hadn't been played *and* that the record already included the result, and
  it declined to write rather than make something up. Fair enough — the contradiction is gone.
- **New: Settings → Fact-check baseline.** Every generated piece is checked against your save
  and recorded, so there's a real number for how often the Wire gets a fact wrong instead of a
  vibe.
- **Fixed: using an OpenAI-compatible provider with no vision support** dumped a multi-megabyte
  error instead of saying so.

## 🗣️ Nobody says "an 88 overall corner"

- **The AI no longer sees a rating at all.** It was being handed raw 0-99 numbers and writing
  them into copy — the loudest possible tell that a video game wrote the article.
- Every rating is translated into football language before the writer ever sees it:
  *elite, all-conference, a quality starter, a solid starter, shaky, the weak link.* Stating a
  rating number is now a hard rule violation on every surface.
- The scouting report has worked this way since v0.1.9. This extends it to articles, press
  conferences, shows, social, the portal segment, the offseason and recruiting — everywhere it
  was still leaking.

---

## 🏗️ Under the hood: the v2 rewrite

This release is the first half of an architecture overhaul, and it's worth explaining because
it's the reason the fixes above are *fixes* rather than another round of asking the AI nicely.

The app had already run the experiment on itself. The scouting report works — the community's
words were *"at least the scouting report gets the names right!"* — because **code computes the
facts and the AI only writes the prose around locked tables.** The game recap was the opposite:
it got handed a pile of context and was asked to work out, in prose, who mattered and what it
meant. Same model, same save, same week, opposite results.

So hallucination here was never a model problem or a prompt problem. It's an architecture
problem, and it was already solved in one corner of the app. v2 makes that corner the whole app.

What that meant in practice this release:

- **The recap is computed first.** How the game turned — the quarter that moved it, whether it
  was a comeback or a collapse, what the result is worth, who could plausibly have decided it —
  is worked out in code and handed over as facts that can't be argued with. The 40-player data
  dump the writer used to sort through is gone.
- **The stakes are computed.** Bowl math, playoff standing, and whether a postseason game is a
  bracket game are arithmetic, not vibes. That's three of this release's bugs in one change.
- **The past is computed.** Prior seasons and the coach's résumé are tables, not recollection —
  which is what finally made memory safe to ship at all.
- **Output is fact-checked.** Every generated piece is checked against your save for things that
  can be proven wrong: invented people, players on the wrong team, wrong scores, wrong records,
  wrong ranks, and now stat lines that belong to someone else. It's recorded at Settings →
  Fact-check baseline, so "it feels better" can be replaced with a number.
- **The rule that shapes all of it:** the checker punishes *contradiction*, never *invention*. A
  fan can be an idiot about whether you deserved to win. He cannot be wrong about who plays for
  you. Invented beat writers, student-section detail, a 3rd-and-8 call, the weather — all still
  yours.

Two of seven flagged sections are fully rewritten so far (the front-page recap and Around the
League). The rest are fact-checked but not yet restructured; that's the back half of v2.
