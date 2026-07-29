// Brand-deal economy. Two rules make this fair and non-cheaty:
//
// 1. DEALS ARE PROGRAM-SCALED. A blue blood commands national money; a 2-prestige program
//    gets local-car-dealership money. The model only supplies the brand/pitch/risk — the
//    actual value is computed here from program prestige, deterministically, so a rebuild
//    at Georgia State can't be handed Alabama's checkbook.
//
// 2. STIPENDS PAY WEEKLY, NOT UP FRONT. A "500 points over 10 weeks" deal pays its weekly
//    slice once per in-game week, tracked here. The old code wrote points × weeks the
//    instant you signed — the whole run, immediately — which is what users saw as "getting
//    that total amount multiple times."

import { LazyStore } from "@tauri-apps/plugin-store";
import { applyImpact } from "./client";

const store = new LazyStore("dynastywire.deals.json");

export type DealReputation = "clean" | "edgy" | "controversial";

/** Per-week ceiling at MAX prestige, by how dirty the money is. */
const TOP_PER_WEEK: Record<DealReputation, number> = {
  clean: 60,
  edgy: 110,
  controversial: 200,
};

/**
 * How much of the national market a program can actually command, from prestige (1-10).
 * Curved so the bottom of the sport stays genuinely small: a 1-2 prestige rebuild sees
 * ~5 points/week, a mid-major ~20, a blue blood the full ceiling.
 */
export function programFactor(prestige: number | null | undefined): number {
  const p = Math.max(1, Math.min(10, prestige ?? 5));
  return 0.08 + 0.92 * Math.pow((p - 1) / 9, 1.6);
}

/**
 * The real per-week value of a deal for THIS program. `raw` is the model's suggestion — it
 * only nudges within the band, so a hallucinated 6,000 can't blow up the economy.
 */
export function scaleStipend(
  raw: number | null | undefined,
  reputation: DealReputation,
  prestige: number | null | undefined
): number {
  const ceiling = TOP_PER_WEEK[reputation] ?? TOP_PER_WEEK.clean;
  const band = ceiling * programFactor(prestige);
  // The model's number only decides where in the 60%-100% band this deal lands.
  const suggested = typeof raw === "number" && raw > 0 ? raw : ceiling;
  const ratio = Math.max(0.6, Math.min(1, suggested / ceiling));
  return Math.max(1, Math.round(band * ratio));
}

export interface ActiveDeal {
  brand: string;
  pointsPerWeek: number;
  weeks: number;
  startYear: number;
  startWeek: number;
  /** "<year>::<week>" slices already paid — makes disbursement idempotent. */
  paidKeys: string[];
  signedAt: number;
}

interface DealStore {
  [dynastyId: string]: ActiveDeal[];
}

const weekKey = (year: number, week: number) => `${year}::${week}`;
const absWeek = (year: number, week: number) => year * 30 + week;

export async function loadDeals(dynastyId: string): Promise<ActiveDeal[]> {
  const all = (await store.get<DealStore>("dynasties")) ?? {};
  return all[dynastyId] ?? [];
}

async function save(dynastyId: string, list: ActiveDeal[]): Promise<void> {
  const all = (await store.get<DealStore>("dynasties")) ?? {};
  all[dynastyId] = list;
  await store.set("dynasties", all);
  await store.save();
}

/** Register a signed deal. No money moves here — the weekly pass disburses it. */
export async function signDeal(
  dynastyId: string,
  deal: Omit<ActiveDeal, "paidKeys" | "signedAt">
): Promise<ActiveDeal[]> {
  const list = await loadDeals(dynastyId);
  if (list.some((d) => d.brand === deal.brand && weeksLeftOn(d, deal.startYear, deal.startWeek) > 0)) {
    return list; // already running — never double-register
  }
  list.unshift({ ...deal, paidKeys: [], signedAt: Date.now() });
  await save(dynastyId, list);
  return list;
}

export function weeksLeftOn(d: ActiveDeal, year: number, week: number): number {
  const elapsed = absWeek(year, week) - absWeek(d.startYear, d.startWeek);
  return Math.max(0, d.weeks - Math.max(0, elapsed));
}

/** Deals still paying out as of (year, week). */
export function activeDeals(list: ActiveDeal[], year: number, week: number): ActiveDeal[] {
  return list.filter((d) => weeksLeftOn(d, year, week) > 0);
}

let inFlight = false;

/**
 * Pay every deal's slice for THIS in-game week — once. Safe to call on every ingest: a week
 * already paid is skipped, so revisiting or reopening the app never double-pays.
 */
export async function disburseWeekly(
  dynastyId: string,
  savePath: string,
  teamIndex: number,
  year: number,
  week: number
): Promise<{ paid: number; brands: string[] }> {
  if (inFlight) return { paid: 0, brands: [] };
  inFlight = true;
  try {
    const list = await loadDeals(dynastyId);
    const wk = weekKey(year, week);
    const due = list.filter((d) => weeksLeftOn(d, year, week) > 0 && !d.paidKeys.includes(wk));
    if (due.length === 0) return { paid: 0, brands: [] };

    const total = due.reduce((s, d) => s + Math.max(0, Math.round(d.pointsPerWeek)), 0);
    if (total <= 0) return { paid: 0, brands: [] };

    const res = await applyImpact(savePath, { teamIndex, programPointsDelta: total }).catch(() => null);
    if (!res?.ok) return { paid: 0, brands: [] }; // save locked → retry next ingest

    for (const d of due) d.paidKeys.push(wk);
    await save(dynastyId, list);
    return { paid: total, brands: due.map((d) => d.brand) };
  } finally {
    inFlight = false;
  }
}

export async function clearDeals(dynastyId: string): Promise<void> {
  const all = (await store.get<DealStore>("dynasties")) ?? {};
  delete all[dynastyId];
  await store.set("dynasties", all);
  await store.save();
}
