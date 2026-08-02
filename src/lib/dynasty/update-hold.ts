"use client";

// A one-bit signal: "an update is on screen, don't start spending money."
//
// The eager weekly pass fires the moment a save and a key are ready. The update check lands
// a few seconds later. So the normal sequence is: the pass starts writing, the prompt
// appears, the user clicks update, the process is replaced mid-request — and every section
// that was in flight is paid for and thrown away. A tester watched exactly this on first
// launch.
//
// So the pass waits while the prompt is up, and resumes the moment it is answered or
// dismissed. Only the AUTOMATIC pass: anything the user asked for by name — opening a tab,
// stepping to the podium, "write this week" — still runs, because they asked for it and
// they can see what they're doing.
//
// A module-level store rather than a React context: the prompt and the provider are
// rendered as siblings, and threading a context between them would mean moving one of them
// for a boolean.

import { useSyncExternalStore } from "react";

let held = false;
const listeners = new Set<() => void>();

export function setUpdateHold(next: boolean): void {
  if (held === next) return;
  held = next;
  for (const l of listeners) l();
}

export function isUpdateHeld(): boolean {
  return held;
}

/** Exported for `useSyncExternalStore` and for the test that proves a change notifies. */
export function subscribeUpdateHold(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** True while an update prompt is waiting on the user (or installing). */
export function useUpdateHold(): boolean {
  // The server snapshot is `false`: nothing is on screen during prerender, and a static
  // export renders this page at build time.
  return useSyncExternalStore(subscribeUpdateHold, isUpdateHeld, () => false);
}
