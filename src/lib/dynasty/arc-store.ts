// Where a storyline's history lives between weeks.
//
// The arcs themselves are recomputed from the save every time (see arcs.ts) — this file only
// remembers how long each one has HELD, and whether it ever stopped. That is deliberately the
// smallest possible amount of state: everything derivable from the save is derived, so a user
// who deletes this file loses the chapter numbers and nothing else.

import { LazyStore } from "@tauri-apps/plugin-store";
import type { ArcMemory } from "./arcs";

const store = new LazyStore("dynastywire.arcs.json");
const KEY = (dynastyId: string) => `arcs::${dynastyId}`;

export async function loadArcMemory(dynastyId: string): Promise<ArcMemory[]> {
  return (await store.get<ArcMemory[]>(KEY(dynastyId))) ?? [];
}

export async function saveArcMemory(dynastyId: string, memory: ArcMemory[]): Promise<void> {
  // Bounded: a long dynasty accumulates broken arcs from seasons nobody will ask about again,
  // and the newest are the only ones any chapter is computed from.
  const trimmed = [...memory]
    .sort((a, b) => b.lastSeenYear - a.lastSeenYear || b.lastSeenWeek - a.lastSeenWeek)
    .slice(0, 60);
  await store.set(KEY(dynastyId), trimmed);
  await store.save();
}

export async function clearArcMemory(dynastyId: string): Promise<void> {
  await store.delete(KEY(dynastyId));
  await store.save();
}
