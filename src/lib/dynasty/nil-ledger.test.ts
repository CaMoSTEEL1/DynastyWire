// The overlay that stops the NIL page looking like it forgot what you just did.
//
// Only pruneWritten is testable without the Tauri store — but it is the part that decides how
// long the overlay lives, and getting it wrong in either direction is bad: keep an entry too
// long and the row freezes at our number even after the value is changed inside the game;
// drop it too early and the display snaps back to a stale roster, which is the complaint that
// started this ("the NIL system doesn't really work, it constantly resets").

import { describe, expect, it } from "vitest";
import { pruneWritten } from "./nil-ledger";

const roster = (pairs: Array<[string, number]>) => new Map(pairs);

describe("pruneWritten", () => {
  it("keeps what we wrote while the roster still reports the old figure", () => {
    const { pruned, changed } = pruneWritten({ "Kellen Marsh": 500 }, roster([["Kellen Marsh", 120]]));
    expect(pruned).toEqual({ "Kellen Marsh": 500 });
    expect(changed).toBe(false);
  });

  it("retires the entry once the save agrees with it", () => {
    const { pruned, changed } = pruneWritten({ "Kellen Marsh": 500 }, roster([["Kellen Marsh", 500]]));
    expect(pruned).toEqual({});
    expect(changed).toBe(true);
  });

  it("holds a player the roster no longer lists rather than dropping the number", () => {
    // A transfer, or a roster the parser truncated. Forgetting is the failure mode here.
    const { pruned } = pruneWritten({ Ghost: 300 }, roster([]));
    expect(pruned).toEqual({ Ghost: 300 });
  });

  it("prunes per player, not all or nothing", () => {
    const { pruned, changed } = pruneWritten(
      { A: 100, B: 200 },
      roster([
        ["A", 100],
        ["B", 50],
      ])
    );
    expect(pruned).toEqual({ B: 200 });
    expect(changed).toBe(true);
  });

  it("expires the whole overlay once the week has moved on", () => {
    // A new week means an ingest has happened, so the roster is more current than we are.
    // Without this an entry could pin a row for the rest of the dynasty: change the value
    // inside the game and the roster would never match our number again.
    const { pruned, changed } = pruneWritten(
      { A: 500 },
      roster([["A", 400]]),
      { year: 2030, week: 6 },
      { year: 2030, week: 7 }
    );
    expect(pruned).toEqual({});
    expect(changed).toBe(true);
  });

  it("holds the overlay through the week it was written in", () => {
    const { pruned } = pruneWritten(
      { A: 500 },
      roster([["A", 120]]),
      { year: 2030, week: 6 },
      { year: 2030, week: 6 }
    );
    expect(pruned).toEqual({ A: 500 });
  });
});

// ── Money that did not stick ──────────────────────────────────────────────────
// DynastyWire writes NIL into the save FILE. If the game is still open it holds its own copy
// of the dynasty and writes it out on the next autosave, straight over the top — the write
// verifies, and is gone minutes later. The overlay used to hide exactly that: a mismatch was
// kept as a display value, then dropped silently a week on, so the money vanishing looked
// like the app forgetting. These pin the difference between the two.

describe("reporting a write the save did not keep", () => {
  const at = { year: 2030, week: 6 };

  it("reports a value the save has replaced with a lower one", () => {
    const { lost } = pruneWritten(
      { "Morris Bulaga": 300 },
      new Map([["Morris Bulaga", 65]]),
      at,
      { year: 2030, week: 7 }
    );
    expect(lost).toEqual([{ name: "Morris Bulaga", wrote: 300, found: 65 }]);
  });

  it("says nothing when the save kept it", () => {
    const { lost } = pruneWritten(
      { "Morris Bulaga": 300 },
      new Map([["Morris Bulaga", 300]]),
      at,
      { year: 2030, week: 7 }
    );
    expect(lost).toEqual([]);
  });

  it("does not cry loss before the save has been re-read", () => {
    // Same week: the roster in memory still carries the OLD figure by design. That is the
    // overlay doing its job, not money going missing, and warning here would fire on every
    // successful write.
    const { lost, pruned } = pruneWritten(
      { "Morris Bulaga": 300 },
      new Map([["Morris Bulaga", 65]]),
      at,
      at
    );
    expect(lost).toEqual([]);
    expect(pruned["Morris Bulaga"]).toBe(300);
  });

  it("does not call a RAISE a loss", () => {
    // The game can pay a man more than we did — a bump we did not make is not a write we lost.
    const { lost } = pruneWritten(
      { "Morris Bulaga": 300 },
      new Map([["Morris Bulaga", 450]]),
      at,
      { year: 2030, week: 7 }
    );
    expect(lost).toEqual([]);
  });

  it("stays quiet about a player who is no longer on the roster", () => {
    // Transferred, graduated, or simply outside the slice we loaded. Unknown is not lost.
    const { lost } = pruneWritten({ "Morris Bulaga": 300 }, new Map(), at, { year: 2030, week: 7 });
    expect(lost).toEqual([]);
  });

  it("clears the overlay either way once the week has moved", () => {
    // The overlay must never outlive the ingest that supersedes it, whether the write held
    // or not — otherwise a stale figure pins the row for the rest of the dynasty.
    const { pruned } = pruneWritten(
      { "Morris Bulaga": 300 },
      new Map([["Morris Bulaga", 65]]),
      at,
      { year: 2030, week: 7 }
    );
    expect(pruned).toEqual({});
  });
});
