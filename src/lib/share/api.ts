// The client half of the forum: publishing a dynasty, and reading someone else's.
//
// Deliberately thin, and deliberately behind one configurable base URL. Everything that makes
// a bundle safe to publish already happened before this file is reached — buildBundle applies
// the allowlist and redacts, and refuses to hand back a bundle whose tripwire still fires. So
// there is exactly one rule here: NOTHING is uploaded that did not come out of buildBundle.
//
// The endpoint is a setting rather than a constant so the app can point at a local worker
// during development, and so a user who does not trust the default host can run their own.

import { parseBundle, type DynastyBundle } from "./bundle";

/** Where the forum lives. Overridable in Settings. */
export const DEFAULT_FORUM_URL = "https://forum.dynastywire.app";

export interface ForumListing {
  /** Stable id for the published dynasty — what a spectator opens. */
  id: string;
  handle: string;
  title: string;
  mode: "dynasty" | "rtg";
  school: string | null;
  coachName: string | null;
  playerName: string | null;
  /** Denormalised so a directory row needs no bundle fetch. */
  record: string | null;
  latestYear: number | null;
  latestWeek: number | null;
  weeks: number;
  updatedAt: number;
}

export interface PublishResult {
  id: string;
  url: string;
}

const jsonHeaders = { "content-type": "application/json" };

class ForumError extends Error {}

async function call<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  const root = (base || DEFAULT_FORUM_URL).replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${root}${path}`, init);
  } catch {
    throw new ForumError("Couldn't reach the forum. Check your connection.");
  }
  if (res.status === 429) throw new ForumError("Too many requests — give it a minute.");
  if (res.status === 404) throw new ForumError("That dynasty isn't on the forum any more.");
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ForumError(detail.slice(0, 200) || `The forum returned ${res.status}.`);
  }
  return (await res.json()) as T;
}

/** The public directory, newest activity first. */
export function listDynasties(base: string, query?: string): Promise<{ items: ForumListing[] }> {
  const q = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
  return call<{ items: ForumListing[] }>(base, `/api/dynasties${q}`);
}

/**
 * Fetch one published dynasty. The response is run back through parseBundle rather than
 * trusted: the allowlist applies on the way IN as well as out, so a tampered or malicious
 * record cannot get a private tab rendered here.
 */
export async function fetchDynasty(base: string, id: string): Promise<DynastyBundle> {
  const raw = await call<unknown>(base, `/api/dynasties/${encodeURIComponent(id)}`);
  const { bundle, error } = parseBundle(JSON.stringify(raw));
  if (!bundle) throw new ForumError(error ?? "That dynasty couldn't be read.");
  return bundle;
}

/**
 * Publish. `bundle` MUST be the object returned by buildBundle — never a hand-assembled one,
 * and never one whose `leaks` came back non-empty.
 */
export function publishDynasty(
  base: string,
  bundle: DynastyBundle,
  token: string
): Promise<PublishResult> {
  return call<PublishResult>(base, "/api/dynasties", {
    method: "PUT",
    headers: { ...jsonHeaders, "x-dw-token": token },
    body: JSON.stringify(bundle),
  });
}

/** Take it down. The owner token is the only thing that authorises this. */
export function unpublishDynasty(base: string, id: string, token: string): Promise<{ ok: true }> {
  return call<{ ok: true }>(base, `/api/dynasties/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "x-dw-token": token },
  });
}

/**
 * A per-dynasty secret, generated locally and never shown. It is what proves an update or a
 * takedown came from the machine that published in the first place — there are no accounts,
 * and a forum where anyone can overwrite anyone else's dynasty is not a forum.
 */
export function newOwnerToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
