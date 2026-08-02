// The weekly issue store, and the two ways a week's state used to go wrong.
//
// The Tauri store is a file behind an IPC bridge that does not exist in node, so it is
// mocked with an in-memory map. Everything under test here is this module's own logic.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, unknown>();
vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    async get<T>(k: string): Promise<T | null> {
      return (mem.get(k) as T) ?? null;
    }
    async set(k: string, v: unknown) {
      mem.set(k, v);
    }
    async delete(k: string) {
      mem.delete(k);
    }
    async clear() {
      mem.clear();
    }
    async save() {}
  },
}));

import { issueKey, loadIssue, loadIssueLive, readTab, writeTab } from "./issue-cache";

const META = { dynastyId: "d1", year: 2029, week: 12 };
const ready = (data: unknown) => ({ status: "ready" as const, data, error: null, generatedAt: 1 });
const generating = { status: "generating" as const, data: null, error: null, generatedAt: null };

beforeEach(() => mem.clear());

describe("a week's key", () => {
  it("is the same string for the same week", () => {
    expect(issueKey("d1", 2029, 12)).toBe("d1::2029::12");
  });

  // The pregame suffix is applied by the dynasty context, not here — this asserts the two
  // keys are genuinely different storage, which is the whole fix for pregame answers turning
  // up under post-game questions.
  it("keeps a pregame edition separate from the played week", async () => {
    const week = issueKey("d1", 2029, 12);
    const pre = `${week}::pre`;
    await writeTab(pre, "presser-answers", ready({ answers: { 0: "pregame take" } }), META);
    await writeTab(week, "presser-answers", ready({ answers: { 0: "post-game take" } }), META);

    expect((await readTab(pre, "presser-answers"))?.data).toEqual({ answers: { 0: "pregame take" } });
    expect((await readTab(week, "presser-answers"))?.data).toEqual({ answers: { 0: "post-game take" } });
  });

  it("does not serve one edition's answers to the other", async () => {
    const week = issueKey("d1", 2029, 12);
    await writeTab(`${week}::pre`, "presser-answers", ready({ answers: { 0: "pregame take" } }), META);
    expect(await readTab(week, "presser-answers")).toBeNull();
  });
});

describe("tabs orphaned mid-write", () => {
  it("drops a tab left generating, because nothing can still be writing it", async () => {
    const key = issueKey("d1", 2029, 12);
    await writeTab(key, "recap-lead", generating, META);
    await writeTab(key, "social", ready({ posts: [] }), META);

    const live = await loadIssueLive(key);
    expect(live?.tabs["recap-lead"]).toBeUndefined();
    expect(live?.tabs.social?.status).toBe("ready");
  });

  it("persists the cleanup, so the next read is already honest", async () => {
    const key = issueKey("d1", 2029, 12);
    await writeTab(key, "recap-lead", generating, META);
    await loadIssueLive(key);
    expect((await loadIssue(key))?.tabs["recap-lead"]).toBeUndefined();
  });

  it("leaves a finished week completely alone", async () => {
    const key = issueKey("d1", 2029, 12);
    await writeTab(key, "recap-lead", ready({ headline: "x" }), META);
    const before = await loadIssue(key);
    const after = await loadIssueLive(key);
    expect(after?.tabs).toEqual(before?.tabs);
  });

  it("returns null for a week that was never written", async () => {
    expect(await loadIssueLive(issueKey("d1", 2029, 99))).toBeNull();
  });
});
