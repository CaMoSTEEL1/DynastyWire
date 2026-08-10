// What NIL you've set, remembered across a tab switch and across a write.
//
// Two separate "it keeps resetting" complaints, one cause each:
//
//  1. The number boxes read straight off `roster[].nilComp`, which only changes when the save
//     is re-ingested. Push a player to $500K and the row snapped back to his old figure the
//     instant the write returned — the money WAS in the save, but the screen said otherwise.
//  2. The dynasty provider remounts on every tab switch, taking un-pushed edits with it. Set
//     eleven players, glance at the depth chart, come back to nothing.
//
// So both halves are persisted here. `written` is what we told the save (the display overlay,
// pruned once the roster catches up and agrees); `drafts` are edits typed but not yet pushed.

import { LazyStore } from "@tauri-apps/plugin-store";

const store = new LazyStore("dynastywire.nil.json");

export interface NilLedger {
  /** playerName -> value in $K we successfully wrote to the save. */
  written: Record<string, number>;
  /** The in-game week those writes were made in. The overlay does not outlive it. */
  writtenAt: { year: number; week: number } | null;
  /** playerName -> value in $K typed but not yet pushed. */
  drafts: Record<string, number>;
}

interface LedgerStore {
  [dynastyId: string]: NilLedger;
}

async function all(): Promise<LedgerStore> {
  return (await store.get<LedgerStore>("dynasties")) ?? {};
}

export async function loadLedger(dynastyId: string): Promise<NilLedger> {
  const l = (await all())[dynastyId];
  return {
    written: { ...(l?.written ?? {}) },
    writtenAt: l?.writtenAt ?? null,
    drafts: { ...(l?.drafts ?? {}) },
  };
}

async function put(dynastyId: string, ledger: NilLedger): Promise<void> {
  const map = await all();
  map[dynastyId] = ledger;
  await store.set("dynasties", map);
  await store.save();
}

/** Remember edits in progress so a tab switch doesn't throw them away. */
export async function saveDrafts(dynastyId: string, drafts: Record<string, number>): Promise<void> {
  const l = await loadLedger(dynastyId);
  await put(dynastyId, { ...l, drafts });
}

/** Replace the overlay wholesale — used after pruning so the pruned map is what persists. */
export async function setWritten(
  dynastyId: string,
  written: Record<string, number>,
  writtenAt: { year: number; week: number } | null
): Promise<void> {
  const l = await loadLedger(dynastyId);
  await put(dynastyId, { ...l, written, writtenAt });
}

/**
 * Record a successful write. The written values become the display truth until the save is
 * re-read, and the matching drafts are cleared — they've been spent.
 */
export async function commitWrites(
  dynastyId: string,
  values: Record<string, number>,
  at: { year: number; week: number } | null = null
): Promise<NilLedger> {
  const l = await loadLedger(dynastyId);
  const written = { ...l.written, ...values };
  const drafts = { ...l.drafts };
  for (const name of Object.keys(values)) delete drafts[name];
  const next: NilLedger = { written, writtenAt: at ?? l.writtenAt, drafts };
  await put(dynastyId, next);
  return next;
}

/** A write we made that the save no longer agrees with. */
export interface LostWrite {
  name: string;
  /** What we wrote, and verified at the time. */
  wrote: number;
  /** What the save says now. */
  found: number;
}

export interface PruneResult {
  pruned: Record<string, number>;
  changed: boolean;
  /**
   * Writes the save has since disagreed with.
   *
   * This is the failure the overlay was accidentally CONCEALING. DynastyWire writes NIL to the
   * save file on disk and verifies it. If the game is still running with that dynasty loaded,
   * it holds its own copy in memory and writes it out on the next autosave — straight over the
   * top. The money is gone, the player is unpaid again, and the only sign was a figure that
   * "kept resetting" a week later.
   *
   * Detected only after the week has moved, because that is the point at which an ingest has
   * definitely happened and the roster is more current than we are. Before that, a mismatch
   * just means the app has not re-read the save yet, which is not a loss.
   */
  lost: LostWrite[];
}

/**
 * Drop overlay entries that have done their job — and say which ones did not.
 *
 * Two ways an entry expires. The ordinary one: the save now reports the number we wrote, so
 * the overlay is redundant. The backstop: it was written in an earlier in-game week, which
 * means an ingest has happened since and whatever the roster says now is more current than we
 * are. Without the second rule an entry could pin a row forever — if the value were changed
 * inside the game the roster would never match ours again, and the row would show our stale
 * figure for the rest of the dynasty.
 *
 * The backstop used to drop those entries SILENTLY, which is exactly how a write the game
 * overwrote looked like the app forgetting rather than the money vanishing. Now they come back
 * as `lost` so somebody can be told.
 */
export function pruneWritten(
  written: Record<string, number>,
  rosterValues: Map<string, number>,
  writtenAt: { year: number; week: number } | null = null,
  now: { year: number; week: number } | null = null
): PruneResult {
  const moved =
    writtenAt != null && now != null && (writtenAt.year !== now.year || writtenAt.week !== now.week);

  if (moved) {
    // The week has advanced, so the save has been re-read. Anything it does not agree with
    // was not kept — with one exception: a value the game raised on its own is not a loss,
    // and neither is one we cannot see at all (he transferred, graduated, or is off the list).
    const lost: LostWrite[] = [];
    for (const [name, value] of Object.entries(written)) {
      const live = rosterValues.get(name);
      if (live == null || live === value || live > value) continue;
      lost.push({ name, wrote: value, found: live });
    }
    return { pruned: {}, changed: Object.keys(written).length > 0, lost };
  }

  const pruned: Record<string, number> = {};
  let changed = false;
  for (const [name, value] of Object.entries(written)) {
    const live = rosterValues.get(name);
    if (live != null && live === value) changed = true;
    else pruned[name] = value;
  }
  return { pruned, changed, lost: [] };
}

export async function clearLedger(dynastyId: string): Promise<void> {
  const map = await all();
  delete map[dynastyId];
  await store.set("dynasties", map);
  await store.save();
}
