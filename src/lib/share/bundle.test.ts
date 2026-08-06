// What a spectator is allowed to see, and — more to the point — what they are not.
//
// The tab kinds below are the real ones found in a live issues store, including the awkward
// shape that motivated most of this file: the cache keys a tab as `kind::<json of the
// request>`, so a private conversation can live inside the KEY.

import { describe, expect, it } from "vitest";
import type { Issue, TabState } from "../dynasty/issue-cache";
import { PUBLIC_KINDS, buildBundle, isPublicTab, kindOf, parseBundle } from "./bundle";

const ready = (data: unknown): TabState => ({ status: "ready", data, error: null, generatedAt: 1 });

const issue = (year: number, week: number, tabs: Record<string, TabState>, key?: string): Issue => ({
  key: key ?? `d1::${year}::${week}`,
  dynastyId: "d1",
  year,
  week,
  createdAt: 1,
  updatedAt: 1,
  tabs,
});

const build = (issues: Issue[], redact = {}) =>
  buildBundle({
    handle: "skisworld",
    title: "SKISWORLD — Kansas State",
    mode: "dynasty",
    school: "Kansas State",
    coachName: "Coach Miller",
    issues,
    publishedAt: 1_700_000_000_000,
    redact,
  });

// Every kind actually observed in a real store.
const ALL_KINDS = [
  "brand-deals", "figure-text", "impact-sync", "national-desk", "national-wire", "nil",
  "nil-reaction", "offseason", "offseason-brief", "press-conference", "presser-answers",
  "presser-overlay-seen", "rankings", "recap-lead", "recruit-dossier", "recruiting",
  "rtg-podium", "rtg-situation", "rtg-texts", "rtg-week", "scouting", "shows", "social",
  "storylines", "trophy",
];

describe("the key carries a payload", () => {
  it("reads the kind out of a key that has a whole conversation in it", () => {
    const key = 'figure-text::{"coachMessage":"call me","thread":[{"from":"coach"}]}';
    expect(kindOf(key)).toBe("figure-text");
    expect(isPublicTab(key)).toBe(false);
  });

  it("matches a plain key too", () => {
    expect(kindOf("recap-lead")).toBe("recap-lead");
    expect(isPublicTab("recap-lead")).toBe(true);
  });
});

describe("default-deny", () => {
  it("publishes only the paper", () => {
    const publicOnes = ALL_KINDS.filter((k) => PUBLIC_KINDS.has(k)).sort();
    expect(publicOnes).toEqual([
      "national-desk", "national-wire", "rankings", "recap-lead", "shows", "social", "trophy",
    ]);
  });

  it("keeps the private half private, kind by kind", () => {
    for (const kind of [
      "press-conference", "presser-answers", "figure-text", "rtg-texts", "rtg-situation",
      "nil", "nil-reaction", "brand-deals", "scouting", "recruiting", "recruit-dossier",
      "storylines", "rtg-podium", "rtg-week", "impact-sync",
    ]) {
      expect(isPublicTab(kind), kind).toBe(false);
    }
  });

  it("hides a kind nobody has thought of yet", () => {
    // The whole point of default-deny: a tab added next month is private by omission, and
    // becomes public only when somebody writes it into the allowlist on purpose.
    expect(isPublicTab("some-future-tab")).toBe(false);
  });
});

describe("building a bundle", () => {
  it("drops the private tabs and keeps the public ones", () => {
    const { bundle } = build([
      issue(2032, 12, {
        "recap-lead": ready({ headline: "Wildcats roll" }),
        social: ready({ posts: [] }),
        "press-conference": ready({ questions: ["how did it feel"] }),
        'figure-text::{"thread":[{"text":"my number is 404-187-1728"}]}': ready({ reply: "ok" }),
      }),
    ]);
    expect(Object.keys(bundle.weeks[0].tabs).sort()).toEqual(["recap-lead", "social"]);
  });

  it("does not carry the request payload through in the key", () => {
    const { bundle } = build([
      issue(2032, 12, { 'shows::{"showType":"podcast"}': ready({ dialogue: [] }) }),
    ]);
    expect(Object.keys(bundle.weeks[0].tabs)).toEqual(["shows"]);
  });

  it("never publishes a tab that was still being written", () => {
    const { bundle } = build([
      issue(2032, 12, {
        "recap-lead": { status: "generating", data: null, error: null, generatedAt: null },
        social: { status: "error", data: null, error: "boom", generatedAt: 1 },
        rankings: ready({ headline: "Holds at #1" }),
      }),
    ]);
    expect(Object.keys(bundle.weeks[0].tabs)).toEqual(["rankings"]);
  });

  it("skips a week with nothing public in it", () => {
    const { bundle } = build([
      issue(2032, 11, { "press-conference": ready({ q: 1 }) }),
      issue(2032, 12, { "recap-lead": ready({ headline: "x" }) }),
    ]);
    expect(bundle.weeks.map((w) => w.week)).toEqual([12]);
  });

  it("drops the pregame edition and keeps the week as it finished", () => {
    const { bundle } = build([
      issue(2032, 12, { "recap-lead": ready({ headline: "preview" }) }, "d1::2032::12::pre"),
      issue(2032, 12, { "recap-lead": ready({ headline: "final" }) }),
    ]);
    expect(bundle.weeks).toHaveLength(1);
    expect((bundle.weeks[0].tabs["recap-lead"] as { headline: string }).headline).toBe("final");
  });

  it("orders newest first, across seasons", () => {
    const { bundle } = build([
      issue(2031, 3, { "recap-lead": ready({}) }),
      issue(2032, 1, { "recap-lead": ready({}) }),
      issue(2031, 9, { "recap-lead": ready({}) }),
    ]);
    expect(bundle.weeks.map((w) => `${w.year}w${w.week}`)).toEqual(["2032w1", "2031w9", "2031w3"]);
  });
});

describe("nothing secret gets out", () => {
  const SAVE = "C:\\Users\\edg03\\OneDrive\\Documents\\saves\\DYNASTY-SKISWORLD";
  const KEY = "sk-ant-api03-QtGroXDfotxg7Axm2ywpz6mZlMe9vCkrLxB7n0Jg7OIYcox";

  it("scrubs a secret that reached a public tab", () => {
    const { bundle, leaks } = build(
      [issue(2032, 12, { "recap-lead": ready({ body: `written from ${SAVE} using ${KEY}` }) })],
      { secrets: [SAVE, KEY], username: "edg03" }
    );
    const json = JSON.stringify(bundle);
    expect(json).not.toContain("edg03");
    expect(json).not.toContain(KEY);
    expect(leaks).toEqual([]);
  });

  it("works out the username from the save path it was given", () => {
    const { bundle } = build(
      [issue(2032, 12, { "recap-lead": ready({ body: "edg03 filed this" }) })],
      { secrets: [SAVE] }
    );
    expect(JSON.stringify(bundle)).not.toContain("edg03");
  });
});

describe("reading someone else's bundle", () => {
  it("round-trips", () => {
    const { bundle } = build([issue(2032, 12, { "recap-lead": ready({ headline: "Wildcats roll" }) })]);
    const { bundle: back, error } = parseBundle(JSON.stringify(bundle));
    expect(error).toBeNull();
    expect(back?.weeks[0].tabs["recap-lead"]).toEqual({ headline: "Wildcats roll" });
  });

  it("re-applies the allowlist to a hand-edited file", () => {
    // A bundle is untrusted input. Someone can put whatever they like in a JSON file; the
    // reader must not render a private tab just because the file claimed it was there.
    const forged = JSON.stringify({
      bundleVersion: 1,
      weeks: [{ year: 2032, week: 12, tabs: { "recap-lead": { h: 1 }, "figure-text": { thread: ["private"] } } }],
    });
    const { bundle } = parseBundle(forged);
    expect(Object.keys(bundle!.weeks[0].tabs)).toEqual(["recap-lead"]);
  });

  it("refuses a bundle from a newer version rather than half-rendering it", () => {
    const { bundle, error } = parseBundle(JSON.stringify({ bundleVersion: 99, weeks: [] }));
    expect(bundle).toBeNull();
    expect(error).toMatch(/newer version/i);
  });

  it("refuses anything that is not a bundle", () => {
    expect(parseBundle("not json").error).toBeTruthy();
    expect(parseBundle("{}").error).toBeTruthy();
    expect(parseBundle(JSON.stringify({ bundleVersion: 1 })).error).toBeTruthy();
  });
});
