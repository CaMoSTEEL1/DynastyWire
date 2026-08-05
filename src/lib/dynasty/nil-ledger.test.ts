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
