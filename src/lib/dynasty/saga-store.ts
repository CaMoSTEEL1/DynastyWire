// Persistence for the Saga (see saga.ts). One record per dynasty — meters, the resolved-
// situations map, and the ledger all carry forward across weeks, unlike the per-week issue
// cache. Its own Tauri store file so it's independent of settings and issues.

import { LazyStore } from "@tauri-apps/plugin-store";
import {
  newSaga,
  type SagaState,
  type SagaMeters,
} from "./saga";

const store = new LazyStore("dynastywire.saga.json");
const SAGA_PREFIX = "saga::";

export async function loadSaga(dynastyId: string): Promise<SagaState | null> {
  return (await store.get<SagaState>(SAGA_PREFIX + dynastyId)) ?? null;
}

/** Wipe every dynasty's saga (meters, resolved situations, ledger, backstory, threads). */
export async function clearAllSagas(): Promise<void> {
  await store.clear();
  await store.save();
}

export async function saveSaga(state: SagaState): Promise<void> {
  state.updatedAt = Date.now();
  await store.set(SAGA_PREFIX + state.dynastyId, state);
  await store.save();
}

/** Load the saga for a dynasty, creating (and persisting) a seeded one on first run. */
export async function loadOrSeedSaga(
  dynastyId: string,
  seedMeters: SagaMeters
): Promise<SagaState> {
  const existing = await loadSaga(dynastyId);
  if (existing) return existing;
  const seeded = newSaga(dynastyId, seedMeters);
  await saveSaga(seeded);
  return seeded;
}
