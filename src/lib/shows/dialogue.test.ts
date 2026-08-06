// Reported from a real Wire Room episode: three lines were skipped entirely during podcast
// playback. All three were dialogue that happened to open with "[pause]", and the model had
// flagged them as stage directions — so the viewer rendered them in the direction style
// (speaker, italics, no role, no dash) and the player filtered them out of the audio.
//
// The three that went missing are the fixtures.

import { describe, expect, it } from "vitest";
import { isDirectionOnly, isStageDirection, spokenText, stripDirections } from "./dialogue";

const SKIPPED = [
  "[pause] You know what? I respect that. All right, lock of the week…",
  "[pause] We're back. Bucky, before the break you said something about playoff math…",
  "[pause] Okay, so you're setting this up like it's actually competitive…",
];

describe("the lines that were skipped", () => {
  it("are dialogue, whatever the model flagged them as", () => {
    for (const text of SKIPPED) {
      expect(isStageDirection(text, true), text).toBe(false);
      expect(isStageDirection(text, false), text).toBe(false);
    }
  });

  it("keeps every word the host actually said", () => {
    expect(spokenText(SKIPPED[0])).toBe("You know what? I respect that. All right, lock of the week…");
  });

  it("does not read the cue out loud", () => {
    for (const text of SKIPPED) {
      expect(spokenText(text)).not.toMatch(/\[|\]|pause/i);
    }
  });
});

describe("real stage directions are still directions", () => {
  it("catches a line that is nothing but an aside", () => {
    for (const text of ["[The panel laughs]", "[pause]", "  [sound drop]  ", "[laughs] [pause]"]) {
      expect(isDirectionOnly(text), text).toBe(true);
      expect(isStageDirection(text, false), text).toBe(true);
      expect(spokenText(text), text).toBe("");
    }
  });

  it("trusts the flag on prose with no brackets to judge by", () => {
    // "The panel laughs." has no aside to reconcile against, so the model's word is all
    // there is — and it is usually right.
    expect(isStageDirection("The panel laughs.", true)).toBe(true);
    expect(isStageDirection("The panel laughs.", false)).toBe(false);
  });

  it("treats leftover punctuation as silence, not speech", () => {
    expect(isDirectionOnly("— [laughs] —")).toBe(true);
    expect(isDirectionOnly("[pause]...")).toBe(true);
  });
});

describe("asides inside a line", () => {
  it("keeps the speech and drops the cue wherever it sits", () => {
    expect(spokenText("That's the one [laughs] and I stand by it.")).toBe(
      "That's the one and I stand by it."
    );
    expect(spokenText("I'll say it. [pause]")).toBe("I'll say it.");
  });

  it("is dialogue even when flagged, because there is speech around the aside", () => {
    expect(isStageDirection("That's the one [laughs] and I stand by it.", true)).toBe(false);
  });

  it("collapses the whitespace the removal leaves behind", () => {
    expect(stripDirections("Well  [pause]   then")).toBe("Well then");
  });
});

describe("repeat calls answer the same way", () => {
  it("does not drift on the second ask", () => {
    // The bracket test used to run on a /g regex, whose lastIndex survives between calls —
    // the same string would have come back true, then false, then true.
    const line = "The panel laughs.";
    const answers = [1, 2, 3, 4].map(() => isStageDirection(line, true));
    expect(answers).toEqual([true, true, true, true]);

    const withAside = "[pause] Go on.";
    expect([1, 2, 3, 4].map(() => isStageDirection(withAside, true))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("nothing at all", () => {
  it("survives empty and missing text", () => {
    expect(spokenText("")).toBe("");
    expect(isDirectionOnly("")).toBe(true);
    expect(isStageDirection("", false)).toBe(true);
  });
});
