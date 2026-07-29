// Player suspensions — the rare, heavy consequence a Situation Room decision (or an
// academic-eligibility ruling) can hand down. A suspension is ENFORCED in the actual save:
// the player's OverallRating is temporarily dropped to SUSPENDED_OVR so the game itself
// buries him on the depth chart and he doesn't play; when the weeks are served, the
// original rating is written back automatically.
//
// Persisted in its own per-dynasty Tauri store (like the sportsbook) so it never races
// the saga's serialized write chain. All writes go through the sidecar's impact command,
// which refuses while the game holds the file, backs the save up, and verifies — a locked
// game just means "retry on the next ingest", never a lost suspension.

import { LazyStore } from "@tauri-apps/plugin-store";
import { applyImpact, type InjurySnapshot } from "./client";

const store = new LazyStore("dynastywire.suspensions.json");

/** @deprecated Kept only so older UI copy still compiles. Suspensions no longer touch
 * ratings — see the note on enforceSuspensions. */
export const SUSPENDED_OVR = 40;

export interface Suspension {
  playerName: string;
  position?: string | null;
  /** The situation headline / ruling that caused it. */
  reason: string;
  source: "situation" | "academics";
  /** Length in in-game weeks. */
  weeks: number;
  startYear: number;
  startWeek: number;
  /** The player's real OVR captured by the save write — restored when served.
   * @deprecated ratings are no longer touched; kept so old records still load. */
  originalOverall: number | null;
  /** The player's injury fields exactly as they were before we held him out, so a genuinely
   * hurt player is put back the way he was instead of blanket-healed. */
  priorInjury?: InjurySnapshot | null;
  /** True while the hold-out is live in the save file. */
  applied: boolean;
  /** True once served AND the original rating is back (or nothing was ever written). */
  lifted: boolean;
  createdAt: number;
}

interface SuspensionStore {
  list: Suspension[];
}

function key(dynastyId: string): string {
  return `suspensions::${dynastyId}`;
}

export async function loadSuspensions(dynastyId: string): Promise<Suspension[]> {
  const saved = await store.get<SuspensionStore>(key(dynastyId));
  return saved?.list ?? [];
}

async function save(dynastyId: string, list: Suspension[]): Promise<void> {
  await store.set(key(dynastyId), { list });
  await store.save();
}

// Seasons never exceed ~22 in-game weeks, so this gives a strictly increasing timeline
// across season rollovers (a Week 19 suspension still counts down into next season).
function absWeek(year: number, week: number): number {
  return year * 30 + week;
}

/** Whole suspended weeks still to serve as of (year, week). */
export function weeksLeft(s: Suspension, year: number, week: number): number {
  const served = absWeek(year, week) - absWeek(s.startYear, s.startWeek);
  return Math.max(0, s.weeks - Math.max(0, served));
}

export function isActive(s: Suspension, year: number, week: number): boolean {
  return !s.lifted && weeksLeft(s, year, week) > 0;
}

/** Record a new suspension (dedupes an already-active one for the same player). The OVR
 * drop itself lands via enforceSuspensions — call it right after. */
export async function addSuspension(
  dynastyId: string,
  s: Omit<Suspension, "originalOverall" | "applied" | "lifted" | "createdAt">
): Promise<Suspension[]> {
  const list = await loadSuspensions(dynastyId);
  const dupe = list.some(
    (x) => !x.lifted && x.playerName.toLowerCase() === s.playerName.toLowerCase() &&
      weeksLeft(x, s.startYear, s.startWeek) > 0
  );
  if (!dupe) {
    list.unshift({ ...s, originalOverall: null, applied: false, lifted: false, createdAt: Date.now() });
    await save(dynastyId, list);
  }
  return list;
}

// One enforcement pass at a time — refresh + a page action can both trigger it.
let inFlight = false;

/**
 * Reconcile every suspension against the save: apply the OVR drop for active ones not yet
 * written, and restore the original OVR for served ones. Safe to call often — a locked
 * save (game running) leaves records untouched for the next pass. Returns the fresh list.
 */
export async function enforceSuspensions(
  dynastyId: string,
  savePath: string,
  teamIndex: number,
  year: number,
  week: number,
  dynastyYear?: number | null
): Promise<Suspension[]> {
  if (inFlight) return loadSuspensions(dynastyId);
  inFlight = true;
  try {
    const list = await loadSuspensions(dynastyId);
    let changed = false;
    for (const s of list) {
      if (s.lifted) continue;
      const left = weeksLeft(s, year, week);
      if (left > 0 && !s.applied) {
        // Hold him out for the remaining term. VERIFIED against a real save: the game sits
        // players by InjuryStatus (injured players keep their true rating), so this is the
        // lever that actually removes him from the field.
        const res = await applyImpact(savePath, {
          teamIndex,
          availability: [
            { name: s.playerName, out: true, weeks: left, week, year: dynastyYear ?? null },
          ],
        }).catch(() => null);
        const hit = res?.ok
          ? res.applied?.availability?.find((a) => a.name === s.playerName.toLowerCase() && a.out)
          : null;
        if (hit) {
          s.applied = true;
          s.priorInjury = hit.before ?? null;
          changed = true;
        }
      } else if (left <= 0) {
        // Served: put his exact prior state back (healthy, or the injury he already had).
        if (s.applied) {
          const res = await applyImpact(savePath, {
            teamIndex,
            availability: [{ name: s.playerName, out: false, restore: s.priorInjury ?? null }],
          }).catch(() => null);
          if (res?.ok) {
            s.applied = false;
            s.lifted = true;
            changed = true;
          }
        } else {
          s.lifted = true;
          changed = true;
        }
      }
    }
    if (changed) await save(dynastyId, list);
    return list;
  } finally {
    inFlight = false;
  }
}
