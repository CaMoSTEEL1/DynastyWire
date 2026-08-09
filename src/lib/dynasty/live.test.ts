// The rules that decide whether something happened in a live game.
//
// Everything here is written against what a real capture of a real game actually produces.
// A live run of the reader against a Sugar Bowl included, in the space of a minute: a clean
// bar, a frame with no bar at all, and a phantom read of `[("Utah", 1)]` — a score that never
// existed, on one frame, gone by the next. That phantom is the whole reason for the
// confirmation gate, and it is in these tests by name.

import { describe, expect, it } from "vitest";
import {
  confirm,
  freshConfirmer,
  deriveEvents,
  guessCrop,
  boardLine,
  mergeLog,
  momentLines,
  playsForResult,
  scoringPlays,
  stateKey,
  worthCalling,
  type LiveEvent,
  type LiveLog,
  type LiveState,
  type LiveWord,
} from "./live";

const state = (over: Partial<LiveState> = {}): LiveState => ({
  raw: "",
  quarter: "1st",
  clock: "9:58",
  down: "1st & 10",
  situation: null,
  scores: [
    ["Utah", 0],
    ["Kansas State", 0],
  ],
  onScreen: true,
  ...over,
});

describe("what a points change means", () => {
  const scored = (team: string, n: number) =>
    deriveEvents(state(), state({ scores: [["Utah", 0], ["Kansas State", n]] }))
      .filter((e) => e.team === team);

  it("reads six as a touchdown and seven as one with the kick", () => {
    expect(scored("Kansas State", 6)[0].kind).toBe("touchdown");
    expect(scored("Kansas State", 7)[0].text).toMatch(/TOUCHDOWN, extra point good/);
    expect(scored("Kansas State", 8)[0].text).toMatch(/two-point/);
  });

  it("reads three as a field goal and one as the extra point", () => {
    expect(scored("Kansas State", 3)[0].kind).toBe("field-goal");
    expect(scored("Kansas State", 1)[0].kind).toBe("pat");
  });

  it("does not pretend to know whether two points was a safety or a conversion", () => {
    // The scoreboard cannot tell us, so neither will we.
    expect(scored("Kansas State", 2)[0].text).toMatch(/safety or a conversion/i);
  });

  it("names the team and its new total", () => {
    expect(scored("Kansas State", 7)[0].text).toContain("Kansas State 7");
  });
});

describe("what is NOT a scoring play", () => {
  it("ignores a team appearing for the first time", () => {
    // Early reads often catch one side of the bar before the other. A team arriving with 14
    // on it has not just scored 14 — the bar was simply half-read a moment ago.
    const before = state({ scores: [["Kansas State", 14]] });
    const after = state({ scores: [["Kansas State", 14], ["Utah", 7]] });
    expect(deriveEvents(before, after).filter((e) => e.team === "Utah")).toHaveLength(0);
  });

  it("ignores a score going backwards", () => {
    const before = state({ scores: [["Utah", 7]] });
    const after = state({ scores: [["Utah", 0]] });
    expect(deriveEvents(before, after).filter((e) => e.team)).toHaveLength(0);
  });

  it("says nothing at all when only the play clock moved", () => {
    // Most ticks look like this. An event feed that fires every second is noise.
    expect(deriveEvents(state(), state())).toEqual([]);
  });
});

describe("downs and quarters", () => {
  it("calls a reset to first down what it is", () => {
    const e = deriveEvents(state({ down: "3rd & 4" }), state({ down: "1st & 10" }));
    expect(e[0].kind).toBe("first-down");
    expect(e[0].text).toMatch(/First down/);
  });

  it("reports later downs without dressing them up", () => {
    const e = deriveEvents(state({ down: "1st & 10" }), state({ down: "3rd & 4" }));
    expect(e[0].kind).toBe("down");
    expect(e[0].text).toBe("3rd & 4");
  });

  it("announces a new quarter", () => {
    const e = deriveEvents(state({ quarter: "1st" }), state({ quarter: "2nd" }));
    expect(e.some((x) => x.kind === "quarter" && /Start of the 2nd/.test(x.text))).toBe(true);
  });

  it("stamps events with the GAME clock, not the wall clock", () => {
    const e = deriveEvents(state({ down: "1st & 10" }), state({ down: "2nd & 6", clock: "7:41" }));
    expect(e[0].at).toBe("7:41");
  });
});

describe("the confirmation gate", () => {
  const fresh = freshConfirmer();

  it("refuses to believe a state it has seen only once", () => {
    const { settled } = confirm(fresh, state());
    expect(settled).toBeNull();
  });

  it("believes a state seen twice", () => {
    const a = confirm(fresh, state());
    const b = confirm(a.next, state());
    expect(b.settled).not.toBeNull();
    expect(b.settled!.clock).toBe("9:58");
  });

  it("throws away the phantom score a real capture produced", () => {
    // Verbatim from a live run: one frame read [("Utah", 1)] and the next did not. Without
    // this gate that frame is an extra point that never happened.
    let c = fresh;
    // Four reads: three for the scoreboard to earn trust, one more for a state carrying it
    // to be confirmed. See SCORE_READS.
    for (let i = 0; i < 4; i++) c = confirm(c, state()).next;
    expect(c.scores).toEqual([["Utah", 0], ["Kansas State", 0]]);
    const before = c.confirmed!;

    const phantom = confirm(c, state({ scores: [["Utah", 1]] }));
    // It may settle - the down and quarter are unchanged and real - but it settles carrying
    // the TRUSTED scoreboard, so no points can come out of it. That is the guarantee.
    expect(phantom.next.scores).toEqual([["Utah", 0], ["Kansas State", 0]]);
    const events = phantom.settled ? deriveEvents(before, phantom.settled) : [];
    expect(events.filter((e) => e.team)).toHaveLength(0);
  });

  it("ignores frames with no bar on screen entirely", () => {
    // Play calls, replays and cutscenes. About half of all reads. None of them mean the score
    // is nil or the clock stopped.
    let c = confirm(fresh, state()).next;
    c = confirm(c, state()).next;
    const blank = confirm(c, state({ onScreen: false, scores: [], clock: null, down: null }));
    expect(blank.settled).toBeNull();
    expect(blank.next.confirmed).not.toBeNull();
  });

  it("settles a genuine score once it has held still long enough", () => {
    let c = fresh;
    for (let i = 0; i < 4; i++) c = confirm(c, state()).next;
    const before = c.confirmed!;

    const td = state({ scores: [["Utah", 0], ["Kansas State", 7]] });
    // One read of a new score changes nothing downstream.
    expect(confirm(c, td).next.scores).toEqual([["Utah", 0], ["Kansas State", 0]]);
    for (let i = 0; i < 4; i++) c = confirm(c, td).next;

    expect(c.confirmed!.scores).toEqual([["Utah", 0], ["Kansas State", 7]]);
    const e = deriveEvents(before, c.confirmed!);
    expect(e.some((x) => x.kind === "touchdown" && x.team === "Kansas State")).toBe(true);
  });

  it("a two-sided phantom cannot get through either", () => {
    // The nastier one, seen three times in 200 reads: [("Utah", 1), ("Kansas State", 0)].
    // It has two teams, so the half-read guard does not catch it - only holding still does.
    let c = fresh;
    for (let i = 0; i < 4; i++) c = confirm(c, state()).next;
    const twoSided = state({ scores: [["Utah", 1], ["Kansas State", 0]] });
    let d = confirm(c, twoSided).next;
    d = confirm(d, twoSided).next; // twice is still not enough
    expect(d.scores).toEqual([["Utah", 0], ["Kansas State", 0]]);
    expect(deriveEvents(c.confirmed!, { ...twoSided, scores: d.scores }).filter((e) => e.team)).toHaveLength(0);
  });
});

describe("finding the score bar", () => {
  const w = (text: string, x: number, y: number): LiveWord => ({ text, x, y });

  it("locates the bar from the row the clock is on", () => {
    const crop = guessCrop([
      w("MENU", 100, 200),
      w("UTAH", 420, 950),
      w("0", 700, 952),
      w("9:58", 1210, 955),
      w("1st", 1500, 951),
    ]);
    expect(crop).not.toBeNull();
    expect(crop!.y).toBeLessThan(950);
    expect(crop!.x).toBeLessThan(420);
    expect(crop!.w).toBeGreaterThan(1000);
    // Tall enough for the score numerals, which are about twice the height of the clock we
    // located the bar by and are the reason a snug box reads a game as scoreless.
    expect(crop!.h).toBeGreaterThanOrEqual(85);
  });

  it("declines rather than guessing when no clock is on screen", () => {
    expect(guessCrop([w("DYNASTY", 260, 713), w("ROAD TO GLORY", 300, 650)])).toBeNull();
  });
});

// ── Replaying a real drive ──────────────────────────────────────────────────────
// The two bugs below were both invisible in unit tests written from the design, and both
// obvious within one drive of watching an actual game. They are pinned here.

describe("the two bugs a real drive exposed", () => {
  it("confirms while the clock is running", () => {
    // The clock used to be part of the key, so every read had a unique fingerprint and
    // NOTHING could ever be confirmed during live play. The prototype only looked like it
    // worked because it happened to be watching during a stoppage.
    const a = state({ clock: "11:59" });
    const b = state({ clock: "11:57" });
    expect(stateKey(a)).toBe(stateKey(b));

    let c = freshConfirmer();
    c = confirm(c, a).next;
    expect(confirm(c, b).settled).not.toBeNull();
  });

  it("refuses the rank badge that a half-read bar hands over as a score", () => {
    // Verbatim, seven times in one drive: `UTAH 1 KANSAS STATE 1st 11:59 KICKOFF`. Kansas
    // State's zero was missed and Utah absorbed its #1 RANK as a score. Twice consecutively,
    // so confirmation alone would not have saved us.
    const good = state({ scores: [["Utah", 0], ["Kansas State", 0]] });
    const half = state({ scores: [["Utah", 1]], clock: "11:59" });

    // A one-sided board is not a scoreboard, so it cannot be a scoring play...
    expect(deriveEvents(good, half).filter((e) => e.team)).toHaveLength(0);
    // ...and it does not read as a different state either, so it cannot displace the truth.
    expect(stateKey(half)).not.toBe("1st|1st & 10|Utah=1");

    let c = freshConfirmer();
    c = confirm(c, good).next;
    c = confirm(c, good).next;
    const p1 = confirm(c, half);
    const p2 = confirm(p1.next, half);
    const events = p2.settled ? deriveEvents(c.confirmed!, p2.settled) : [];
    expect(events.filter((e) => e.kind === "pat")).toHaveLength(0);
  });

  it("still reads a real score change on a full board", () => {
    // The fix must not be so cautious that it misses the thing it exists to catch.
    const before = state({ scores: [["Utah", 0], ["Kansas State", 0]] });
    const after = state({ scores: [["Utah", 0], ["Kansas State", 7]], down: "1st & 10" });
    const e = deriveEvents(before, after);
    expect(e.some((x) => x.kind === "touchdown" && x.team === "Kansas State")).toBe(true);
  });

  it("handles a distance the game writes as a word", () => {
    // Real capture: "2nd & inches".
    const e = deriveEvents(state({ down: "1st & 10" }), state({ down: "2nd & inches" }));
    expect(e[0].text).toBe("2nd & inches");
  });
});

// ── Handing a watched game to the newsroom ─────────────────────────────────────

describe("what the newsroom is told about a watched game", () => {
  const play = (over: Partial<LiveEvent>): LiveEvent => ({
    kind: "touchdown",
    text: "",
    team: "Kansas State",
    at: "8:42",
    quarter: "2nd",
    seen: 1000,
    total: 7,
    phrase: "touchdown, extra point good",
    ...over,
  });

  const log = (events: LiveEvent[], final: [string, number][]): LiveLog => ({
    events,
    final,
    updatedAt: 0,
  });

  const result = (homeScore: number, awayScore: number) => ({
    home: "Kansas State",
    away: "Tennessee",
    homeScore,
    awayScore,
  });

  it("folds an extra point into the touchdown it followed", () => {
    // The bar updates 0 → 7 sometimes and 0 → 6 → 1 other times, depending on where the read
    // lands relative to the kick. Two events is two drives to anyone reading it.
    const merged = scoringPlays([
      play({ kind: "touchdown", total: 6, phrase: "touchdown", seen: 1000 }),
      play({ kind: "pat", total: 7, phrase: "extra point", seen: 4000 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].total).toBe(7);
    expect(merged[0].phrase).toBe("touchdown, extra point good");
  });

  it("keeps a genuinely separate extra point that arrives much later", () => {
    const separate = scoringPlays([
      play({ kind: "touchdown", total: 6, seen: 1000 }),
      play({ kind: "pat", total: 7, seen: 400_000 }),
    ]);
    expect(separate).toHaveLength(2);
  });

  it("states when each score happened and what the game stood at", () => {
    const { plays, complete } = playsForResult(
      log(
        [
          play({ quarter: "1st", at: "9:12", total: 7, seen: 1 }),
          play({ team: "Tennessee", quarter: "2nd", at: "3:30", total: 3, phrase: "field goal", seen: 2 }),
        ],
        [["Kansas State", 7], ["Tennessee", 3]]
      ),
      result(7, 3)
    );
    expect(complete).toBe(true);
    expect(plays[0]).toBe("1st quarter, 9:12 — Kansas State touchdown, extra point good. Kansas State 7, Tennessee 0.");
    expect(plays[1]).toBe("2nd quarter, 3:30 — Tennessee field goal. Kansas State 7, Tennessee 3.");
  });

  it("says so when the watch ended before the game did", () => {
    // Otherwise three scoring plays read as the complete list, and a 24-21 game gets written
    // as though it were 7-3.
    const { plays, complete } = playsForResult(
      log([play({ total: 7 })], [["Kansas State", 7], ["Tennessee", 0]]),
      result(24, 21)
    );
    expect(complete).toBe(false);
    expect(plays).toHaveLength(2);
    expect(plays[1]).toMatch(/NOT the complete list/);
  });

  it("refuses a log whose teams are not this game's teams", () => {
    // A log left over from a different game is the failure that puts a score nobody recognises
    // into the locked facts. Dropped whole rather than partly believed.
    const stale = log([play({ total: 7 })], [["Utah", 7], ["Ohio State", 0]]);
    expect(playsForResult(stale, result(24, 21)).plays).toEqual([]);
  });

  it("refuses a log that says a team scored more than it finished with", () => {
    const impossible = log([play({ total: 28 })], [["Kansas State", 28], ["Tennessee", 0]]);
    expect(playsForResult(impossible, result(21, 14)).plays).toEqual([]);
  });

  it("offers nothing when there is no result to reconcile against", () => {
    expect(playsForResult(log([play({})], [["Kansas State", 7], ["Tennessee", 0]]), null).plays).toEqual([]);
    expect(playsForResult(null, result(7, 0)).plays).toEqual([]);
  });
});

describe("keeping the week's log", () => {
  const play = (team: string, total: number, seen: number): LiveEvent => ({
    kind: "touchdown",
    text: "",
    team,
    at: "8:42",
    quarter: "2nd",
    seen,
    total,
    phrase: "touchdown, extra point good",
  });

  it("appends a second sitting to the first", () => {
    const first = mergeLog(null, [play("Kansas State", 7, 1)], [["Kansas State", 7], ["Tennessee", 0]], 0);
    const both = mergeLog(first, [play("Tennessee", 7, 2)], [["Kansas State", 7], ["Tennessee", 7]], 0);
    expect(both.events).toHaveLength(2);
    expect(both.final).toEqual([["Kansas State", 7], ["Tennessee", 7]]);
  });

  it("does not score the same touchdown twice when a game is replayed", () => {
    // A restart puts the board back to nil and every score happens again. A team can only
    // reach a given total once, so that is the identity.
    const first = mergeLog(null, [play("Kansas State", 7, 1)], [["Kansas State", 7], ["Tennessee", 0]], 0);
    const again = mergeLog(first, [play("Kansas State", 7, 900)], [["Kansas State", 7], ["Tennessee", 0]], 0);
    expect(again.events).toHaveLength(1);
    expect(again.events[0].seen).toBe(1);
  });

  it("keeps the last board it knew when a sitting ends with nothing readable", () => {
    const first = mergeLog(null, [play("Kansas State", 7, 1)], [["Kansas State", 7], ["Tennessee", 0]], 0);
    expect(mergeLog(first, [], [], 0).final).toEqual([["Kansas State", 7], ["Tennessee", 0]]);
  });

  it("keeps only scoring, not every down of the game", () => {
    const down: LiveEvent = { kind: "down", text: "3rd & 4", team: null, at: "8:00", quarter: "2nd", seen: 5 };
    expect(mergeLog(null, [down, play("Tennessee", 3, 6)], [], 0).events).toHaveLength(1);
  });
});

describe("when the booth is worth interrupting for", () => {
  const ev = (kind: LiveEvent["kind"], over: Partial<LiveEvent> = {}): LiveEvent => ({
    kind,
    text: kind,
    team: null,
    at: "8:42",
    quarter: "2nd",
    seen: 1,
    ...over,
  });

  it("speaks on a score and on a new quarter", () => {
    expect(worthCalling([ev("touchdown")])).toBe(true);
    expect(worthCalling([ev("field-goal")])).toBe(true);
    expect(worthCalling([ev("quarter")])).toBe(true);
  });

  it("stays quiet on downs", () => {
    // A booth that talks on every first down is why nobody leaves live commentary on, and
    // downs outnumber scores by an order of magnitude — this is the cost control too.
    expect(worthCalling([ev("down"), ev("first-down"), ev("situation")])).toBe(false);
  });

  it("tells the booth what changed, oldest first, with the game clock on it", () => {
    const lines = momentLines([
      ev("quarter", { text: "Start of the 2nd", seen: 20 }),
      ev("touchdown", { text: "TOUCHDOWN — State 7", seen: 10, quarter: "1st", at: "0:12" }),
      ev("down", { text: "3rd & 4", seen: 15 }),
    ]);
    expect(lines).toEqual(["1st 0:12 — TOUCHDOWN — State 7", "2nd 8:42 — Start of the 2nd"]);
  });

  it("renders the scoreboard as a sentence, and refuses a half-read one", () => {
    expect(boardLine(state({ scores: [["Utah", 7], ["Kansas State", 14]] }))).toBe("Utah 7, Kansas State 14");
    expect(boardLine(state({ scores: [["Utah", 7]] }))).toBe("");
    expect(boardLine(null)).toBe("");
  });
});
