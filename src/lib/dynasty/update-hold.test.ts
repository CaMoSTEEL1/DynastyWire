// The one-bit signal that stops the eager pass paying for work a restart will discard.
//
// Small enough to look trivial, and it isn't: the bug it fixes is money. The prompt appears
// a few seconds after launch, by which time the pass is already writing — so the flag has to
// be readable imperatively from inside a running loop AND reactively from a component. And
// it must never get stuck on: a hold that outlives its prompt silently disables auto-write.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { isUpdateHeld, setUpdateHold, subscribeUpdateHold } from "./update-hold";

beforeEach(() => setUpdateHold(false));

describe("update hold", () => {
  it("starts released", () => {
    expect(isUpdateHeld()).toBe(false);
  });

  it("is readable imperatively, for the loop that is already running", () => {
    setUpdateHold(true);
    expect(isUpdateHeld()).toBe(true);
    setUpdateHold(false);
    expect(isUpdateHeld()).toBe(false);
  });

  it("notifies on a change, so the paused pass resumes when the prompt is answered", () => {
    const seen = vi.fn();
    const stop = subscribeUpdateHold(seen);
    setUpdateHold(true);
    setUpdateHold(false);
    stop();
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("does not notify when nothing changed", () => {
    const seen = vi.fn();
    const stop = subscribeUpdateHold(seen);
    setUpdateHold(true);
    setUpdateHold(true);
    stop();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("stops notifying once unsubscribed", () => {
    const seen = vi.fn();
    subscribeUpdateHold(seen)();
    setUpdateHold(true);
    expect(seen).not.toHaveBeenCalled();
  });

  it("releases whatever the sequence — a stuck hold would kill auto-write for good", () => {
    setUpdateHold(true);
    setUpdateHold(true);
    setUpdateHold(false);
    expect(isUpdateHeld()).toBe(false);
  });
});
