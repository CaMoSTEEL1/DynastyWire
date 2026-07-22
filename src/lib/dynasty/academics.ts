// Flavor academics — the game doesn't track them, so every player carries a stable,
// deterministic GPA (a name hash nudged by personality). Costs nothing to show, never
// changes between renders, and gives the At-Risk tier real teeth: an At-Risk player can
// — rarely — be ruled academically ineligible, which lands on the coach's desk as a
// Situation and suspends him through the same enforcement as a disciplinary suspension.

import type { RosterPlayer } from "./client";

export interface GpaRead {
  gpa: number;
  status: "Dean's List" | "Eligible" | "At Risk";
}

export function fakeGpa(p: RosterPlayer): GpaRead {
  let h = 0;
  for (const ch of p.name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  h = Math.abs(h);
  let gpa = 2.3 + (h % 170) / 100; // 2.30 – 3.99
  const pers = p.personality ?? "";
  if (pers === "Leader" || pers === "TeamPlayer") gpa += 0.2;
  else if (pers === "Unpredictable") gpa -= 0.3;
  else if (pers === "Entertainer") gpa -= 0.1;
  gpa = Math.max(1.8, Math.min(4.0, Math.round(gpa * 100) / 100));
  const status: GpaRead["status"] = gpa >= 3.7 ? "Dean's List" : gpa >= 2.3 ? "Eligible" : "At Risk";
  return { gpa, status };
}

export const GPA_COLOR: Record<string, string> = {
  "Dean's List": "text-dw-green",
  Eligible: "text-ink3",
  "At Risk": "text-dw-red",
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** How many weeks an academic ruling sits a player. */
export const ACADEMIC_SUSPENSION_WEEKS = 2;

/**
 * The registrar's desk: at most ONE At-Risk player, in roughly one week out of eight,
 * gets ruled academically ineligible. Deterministic per (dynasty, year, week) so the same
 * week always surfaces the same case (or none) — sparse by design, a season sees maybe
 * one or two. Only fires during weeks a game could actually be missed (week >= 1).
 */
export function academicCase(
  roster: RosterPlayer[],
  dynastyId: string,
  year: number,
  week: number
): { player: RosterPlayer; gpa: number } | null {
  if (week < 1 || roster.length === 0) return null;
  const atRisk = roster.filter((p) => fakeGpa(p).status === "At Risk");
  if (atRisk.length === 0) return null;
  const h = hash(`${dynastyId}::${year}::${week}::academics`);
  if (h % 8 !== 3) return null; // the sparseness dial (~12% of weeks)
  const p = atRisk[h % atRisk.length];
  return { player: p, gpa: fakeGpa(p).gpa };
}
