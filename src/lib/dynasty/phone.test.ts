// The phone only works if a reply is a decision.
//
// It used to generate his answers for him — three people, three versions of the same
// agreeable nothing, no choice anywhere. So what is pinned here is that the tones actually
// DIVERGE: that being all business is right with a coach and wrong with your father, and that
// silence costs something, and costs different amounts depending on who is waiting.

import { describe, expect, it } from "vitest";
import {
  advanceContacts,
  contactBrief,
  metersAfter,
  newContact,
  standingAfter,
  type Contact,
} from "./phone";

const C = (kind: Contact["kind"], over: Partial<Contact> = {}): Contact => ({
  ...newContact("Somebody", kind),
  ...over,
});

describe("no tone is universally right", () => {
  it("rewards all business with a coach and punishes it at home", () => {
    // The whole design in one assertion. A menu where one option is simply best is not a
    // decision, it is a formality.
    expect(standingAfter(C("coach"), "locked-in")).toBe("good");
    expect(standingAfter(C("home"), "locked-in")).toBe("strained");
  });

  it("makes honesty cheap with teammates and expensive in print", () => {
    expect(standingAfter(C("teammate"), "blunt")).toBe("fine");
    expect(standingAfter(C("reporter"), "blunt")).toBe("strained");
    expect(metersAfter(C("reporter"), "blunt").mediaHeat).toBeGreaterThan(0);
  });

  it("lets deflecting work on a reporter and fail on family", () => {
    expect(standingAfter(C("reporter"), "deflect")).toBe("good");
    expect(standingAfter(C("home"), "deflect")).toBe("strained");
  });
});

describe("silence is an answer", () => {
  it("costs the most at home and nothing with a reporter", () => {
    expect(standingAfter(C("home"), "ignore")).toBe("strained");
    expect(standingAfter(C("coach"), "ignore")).toBe("strained");
    // Not answering a reporter is a media strategy, not a betrayal.
    expect(standingAfter(C("reporter"), "ignore")).toBe("fine");
  });

  it("compounds when it becomes a habit", () => {
    let list = [C("home", { name: "Dad" })];
    for (let i = 0; i < 3; i++) list = advanceContacts(list, [{ name: "Dad", tone: "ignore" }]);
    expect(list[0].ignored).toBe(3);
    expect(list[0].standing).toBe("cold");
  });

  it("resets the moment he answers", () => {
    const list = advanceContacts([C("home", { name: "Dad", ignored: 2 })], [{ name: "Dad", tone: "warm" }]);
    expect(list[0].ignored).toBe(0);
  });

  it("does not hold a week against him when nobody wrote", () => {
    // Not being messaged is not the same as ignoring someone.
    const list = advanceContacts([C("teammate", { name: "Marcus" })], []);
    expect(list[0].standing).toBe("fine");
    expect(list[0].quiet).toBe(1);
  });
});

describe("what the writer is told", () => {
  it("states where he stands and how that reads in the messages", () => {
    const brief = contactBrief([C("home", { name: "Dad", ignored: 3, standing: "cold" })])!;
    expect(brief).toContain("Dad (home) — you are cold.");
    expect(brief).toContain("left this person on read 3 weeks running");
  });

  it("says nothing at all with an empty phone", () => {
    expect(contactBrief([])).toBeNull();
  });
});
