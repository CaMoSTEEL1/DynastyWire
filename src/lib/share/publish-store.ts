// What this machine has published, and the secret that proves it.
//
// There are no accounts on the forum. Ownership is a per-dynasty token generated here, kept
// here, and sent with every update or takedown — so the only machine that can overwrite or
// remove a published dynasty is the one that published it. Lose the token and the listing
// becomes read-only forever, which is the correct failure: far better than a forum where
// anyone can overwrite anyone.
//
// The token is a secret and lives in its own store file, never in a bundle. redact.ts is
// handed it as a known secret before publishing, so it cannot travel even by accident.

import { LazyStore } from "@tauri-apps/plugin-store";
import { newOwnerToken } from "./api";

const store = new LazyStore("dynastywire.publish.json");

export type Visibility = "private" | "public";

export interface PublishState {
  /** "private" (default) means it has never left this machine. */
  visibility: Visibility;
  /** Set once published; the id a spectator opens. */
  id: string | null;
  /** Proof of ownership. Never leaves this file except as an auth header. */
  token: string;
  /** When we last uploaded, and what we uploaded. */
  publishedAt: number | null;
  weeksPublished: number | null;
}

interface StoreShape {
  [dynastyId: string]: PublishState;
}

const fresh = (): PublishState => ({
  visibility: "private",
  id: null,
  token: newOwnerToken(),
  publishedAt: null,
  weeksPublished: null,
});

async function all(): Promise<StoreShape> {
  return (await store.get<StoreShape>("dynasties")) ?? {};
}

/** Read the state for a dynasty, minting a token the first time it is asked for. */
export async function loadPublishState(dynastyId: string): Promise<PublishState> {
  const map = await all();
  const existing = map[dynastyId];
  if (existing?.token) return existing;
  const created = { ...fresh(), ...(existing ?? {}), token: existing?.token || newOwnerToken() };
  map[dynastyId] = created;
  await store.set("dynasties", map);
  await store.save();
  return created;
}

export async function savePublishState(
  dynastyId: string,
  patch: Partial<PublishState>
): Promise<PublishState> {
  const map = await all();
  const next = { ...(map[dynastyId] ?? fresh()), ...patch };
  map[dynastyId] = next;
  await store.set("dynasties", map);
  await store.save();
  return next;
}

/** Every token this machine holds — handed to the redactor so none can ever be published. */
export async function allTokens(): Promise<string[]> {
  return Object.values(await all())
    .map((s) => s.token)
    .filter((t): t is string => typeof t === "string" && t.length > 0);
}
