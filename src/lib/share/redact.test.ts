// Everything here is about one promise: the app has told users "Nothing leaves your machine"
// since the first release, and publishing must not quietly make that a lie.
//
// The fixtures are the real shapes out of the local stores, not invented ones — an Anthropic
// key as it is actually stored, a save path as it is actually written, and the kind of thing
// a tester really typed into a booster DM (a phone number and a person's name).

import { describe, expect, it } from "vitest";
import { REDACTED, findLeaks, redactDeep, redactText, usernameFromPath } from "./redact";

// Shaped exactly like the stored values. Not real keys.
const ANTHROPIC = "sk-ant-api03-QtGroXDfotxg7Axm2ywpz6mZlMe9vCkrLxB7n0Jg7OIYcoxSgp8i4ILJ";
const ELEVEN = "ed0b00e95994450a07941d6015e1791675662d6bccfb6b610518924ae38d7da6";
const SAVE = "C:\\Users\\edg03\\OneDrive\\Documents\\EA SPORTS College Football 27\\saves\\DYNASTY-SKISWORLD";
const OPTS = { secrets: [ANTHROPIC, ELEVEN, SAVE], username: "edg03" };

describe("the username hiding inside a save path", () => {
  it("is found in both path styles", () => {
    expect(usernameFromPath(SAVE)).toBe("edg03");
    expect(usernameFromPath("C:/Users/edg03/Documents")).toBe("edg03");
    expect(usernameFromPath("/Users/lamar/saves")).toBe("lamar");
    expect(usernameFromPath("/home/lamar/saves")).toBe("lamar");
  });

  it("does not invent one", () => {
    expect(usernameFromPath(null)).toBeNull();
    expect(usernameFromPath("saves/DYNASTY-X")).toBeNull();
  });
});

describe("API keys never survive", () => {
  it("removes the exact keys it was handed", () => {
    const out = redactText(`key=${ANTHROPIC} and ${ELEVEN}`, OPTS);
    expect(out).not.toContain(ANTHROPIC);
    expect(out).not.toContain(ELEVEN);
  });

  it("removes a key it was never told about", () => {
    // The backstop that matters: a user pastes a key into a press-conference answer and the
    // publisher has no idea it is in there.
    const stray = "sk-ant-api03-neverSeenBefore1234567890abcdefXYZ";
    expect(redactText(`I typed ${stray} by mistake`, {})).not.toContain(stray);
    expect(redactText("sk-proj-abcdefghijklmnopqrstuvwxyz123456", {})).toContain(REDACTED);
  });

  it("removes a labelled token", () => {
    expect(redactText("Authorization: Bearer abcdef1234567890xyz", {})).toContain(REDACTED);
  });

  it("leaves ordinary prose alone", () => {
    const line = "Kansas State is 13-0 and the Wildcats host the quarterfinal.";
    expect(redactText(line, OPTS)).toBe(line);
  });
});

describe("absolute paths and the account name never survive", () => {
  it("removes a Windows save path", () => {
    const out = redactText(`Failed to open ${SAVE}`, OPTS);
    expect(out).not.toContain("edg03");
    expect(out).not.toContain("OneDrive");
  });

  it("removes a path it was not handed", () => {
    expect(redactText("C:\\Users\\someoneelse\\Documents\\save.dat", {})).toContain(REDACTED);
    expect(redactText("/Users/someoneelse/saves/x", {})).toContain(REDACTED);
    expect(redactText("\\\\NAS\\share\\saves", {})).toContain(REDACTED);
  });

  it("removes the username on its own, without a path around it", () => {
    expect(redactText("logged in as edg03 today", OPTS)).not.toMatch(/\bedg03\b/);
  });

  it("is not fooled by case", () => {
    expect(redactText("EDG03 wrote this", OPTS)).not.toMatch(/edg03/i);
  });
});

describe("it walks keys, not just values", () => {
  it("scrubs an object KEY", () => {
    // This is the shape that matters: the issue cache stores a tab under
    // `figure-text::{"thread":[…]}`, so the conversation is in the key.
    const input = { [`figure-text::{"thread":[{"text":"call me on ${SAVE}"}]}`]: { ok: true } };
    const out = redactDeep(input, OPTS);
    expect(JSON.stringify(out)).not.toContain("edg03");
  });

  it("goes all the way down", () => {
    const deep = { a: [{ b: { c: [`${ANTHROPIC}`] } }] };
    expect(JSON.stringify(redactDeep(deep, OPTS))).not.toContain(ANTHROPIC);
  });

  it("leaves non-strings as they are", () => {
    expect(redactDeep({ n: 12, b: true, z: null }, OPTS)).toEqual({ n: 12, b: true, z: null });
  });
});

describe("the tripwire", () => {
  it("reports what it found, and never the value", () => {
    const leaks = findLeaks({ note: `key ${ANTHROPIC}` }, OPTS);
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks.join(" ")).not.toContain(ANTHROPIC);
  });

  it("is quiet once the value has been redacted", () => {
    const scrubbed = redactDeep({ note: `key ${ANTHROPIC} at ${SAVE}` }, OPTS);
    expect(findLeaks(scrubbed, OPTS)).toEqual([]);
  });

  it("catches a secret hiding in a key", () => {
    expect(findLeaks({ [`path::${SAVE}`]: 1 }, OPTS).length).toBeGreaterThan(0);
  });
});

describe("short settings are not treated as secrets", () => {
  it("ignores a value too short to be one", () => {
    // Blanking every occurrence of a 3-character setting would gut ordinary prose.
    const out = redactText("the win was huge", { secrets: ["win"] });
    expect(out).toBe("the win was huge");
  });
});
