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
//
// 3. YOU MAY CARRY SEVERAL SPONSORS, BUT NOT UNLIMITED. Deals from different brands stack and
//    all pay. That was true from the start and was never stated, which made it read like a
//    bug — a tester asked outright whether it was intended. It is: a program has more than one
//    sponsor. What was NOT intended is stacking without limit, which is free money, so the
//    number you can hold at once is scaled to what the program could plausibly attract.
//
// 4. A DEAL IS A CONTRACT, NOT A GIFT. Every one carries a record the program is expected to
//    hold up. Beat it and the brand raises the rate mid-run; miss it and they cut the next
//    offer or stop calling. That is the whole point of signing one being a decision.

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


// ── What the brand expects back ────────────────────────────────────────────────
//
// A sponsor paying for exposure is buying a winning team, and the money should behave like it
// knows that. The bar is set from how much the deal pays: an energy drink handing a rebuild
// local money is not demanding a playoff run, and a controversial collective paying the top of
// the market absolutely is.
//
// Expressed as a WIN RATE over the deal's run rather than a raw win total, so a 4-week deal
// and a 12-week deal ask for the same standard of football.

export interface DealExpectation {
  /** Share of games over the run the brand expects won, 0-1. */
  winRate: number;
  /** How it reads on the offer card. */
  label: string;
}

const EXPECTATION: Record<DealReputation, DealExpectation> = {
  clean: { winRate: 0.4, label: "Keep it respectable — win more than a couple over the run." },
  edgy: { winRate: 0.6, label: "They want a winner. Comfortably more wins than losses." },
  controversial: { winRate: 0.75, label: "They are paying for a contender and expect one." },
};

export function expectationFor(reputation: DealReputation): DealExpectation {
  return EXPECTATION[reputation] ?? EXPECTATION.clean;
}

/** How the program did while a deal was running. Supplied by the caller from the schedule. */
export interface DealRecord {
  wins: number;
  losses: number;
}

export type DealVerdict = "exceeded" | "met" | "failed";

/**
 * How the run went against what was asked.
 *
 * A margin band on either side, because a brand that re-negotiates over a single game is not a
 * brand, it is a slot machine. Exceeding takes real daylight above the bar; failing takes real
 * daylight below it; everything between is simply the deal working as agreed.
 */
export function judge(expectation: DealExpectation, record: DealRecord): DealVerdict {
  const played = record.wins + record.losses;
  if (played <= 0) return "met";
  const rate = record.wins / played;
  if (rate >= expectation.winRate + 0.15) return "exceeded";
  if (rate < expectation.winRate - 0.15) return "failed";
  return "met";
}

/** The raise, once a run is clearly going well. Null when nothing has been earned. */
export function midRunBump(deal: ActiveDeal, expectation: DealExpectation, record: DealRecord): number | null {
  const played = record.wins + record.losses;
  // Not on a two-game sample, and never twice.
  if (deal.bumped || played < 3) return null;
  if (judge(expectation, record) !== "exceeded") return null;
  const raised = Math.max(deal.pointsPerWeek + 1, Math.round(deal.pointsPerWeek * 1.6));
  return raised;
}

// ── What a brand remembers about you ───────────────────────────────────────────
//
// The part that makes the whole economy have a memory. Deliver and the next offer from that
// brand is bigger; miss badly enough and it is smaller, or there is no next offer. Persisted
// per dynasty, because a sponsor who got burned in 2031 has not forgotten by 2032.

export type BrandStanding = "eager" | "neutral" | "burned" | "gone";

export interface BrandHistory {
  brand: string;
  standing: BrandStanding;
  /** Runs completed with this brand, and how they went. */
  exceeded: number;
  met: number;
  failed: number;
  lastYear: number;
  lastWeek: number;
}

/** What a standing does to the next offer. "gone" never gets that far — it is not offered. */
export function standingMultiplier(standing: BrandStanding): number {
  switch (standing) {
    case "eager":
      return 1.5;
    case "burned":
      return 0.5;
    default:
      return 1;
  }
}

/**
 * Where a brand stands after one more run.
 *
 * Two failures is the end of the relationship. One is a bad year, which a sponsor will wear
 * once — twice is a pattern, and a brand that keeps coming back after being embarrassed
 * repeatedly makes the whole system feel weightless.
 */
export function nextStanding(prior: BrandHistory | undefined, verdict: DealVerdict): BrandStanding {
  const failures = (prior?.failed ?? 0) + (verdict === "failed" ? 1 : 0);
  if (failures >= 2) return "gone";
  if (verdict === "failed") return "burned";
  if (verdict === "exceeded") return "eager";
  // A met run repairs a burned brand rather than leaving it soured forever.
  return prior?.standing === "burned" ? "neutral" : prior?.standing ?? "neutral";
}

/**
 * How many sponsors a program can carry at once.
 *
 * The cap exists because unlimited stacking is unlimited money. Scaled to prestige for the same
 * reason the stipend is: a rebuild has one local sponsor, a blue blood has a portfolio.
 */
export function maxConcurrentDeals(prestige: number | null | undefined): number {
  const p = Math.max(1, Math.min(10, prestige ?? 5));
  return 1 + Math.floor(p / 3);
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
  /** What the brand is paying for. Stored on the deal so the bar cannot move under the user. */
  reputation?: DealReputation;
  /** The record when this was signed, so the run's own record can be worked out later. */
  recordAtSigning?: { wins: number; losses: number };
  /** True once the mid-run raise has been given. It happens at most once. */
  bumped?: boolean;
  /** Set when the run finishes. Absent while it is still going. */
  verdict?: DealVerdict;
}

interface DealStore {
  [dynastyId: string]: ActiveDeal[];
}

interface BrandStore {
  [dynastyId: string]: BrandHistory[];
}

export async function loadBrands(dynastyId: string): Promise<BrandHistory[]> {
  const all = (await store.get<BrandStore>("brands")) ?? {};
  return all[dynastyId] ?? [];
}

async function saveBrands(dynastyId: string, list: BrandHistory[]): Promise<void> {
  const all = (await store.get<BrandStore>("brands")) ?? {};
  all[dynastyId] = list;
  await store.set("brands", all);
  await store.save();
}

/** What a brand thinks of this program right now. Unknown brands start neutral. */
export function standingOf(history: BrandHistory[], brand: string): BrandStanding {
  return history.find((h) => h.brand === brand)?.standing ?? "neutral";
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
  deal: Omit<ActiveDeal, "paidKeys" | "signedAt">,
  /** Program prestige, for the concurrency cap. Omit to leave the cap off. */
  prestige?: number | null
): Promise<ActiveDeal[]> {
  const list = await loadDeals(dynastyId);
  if (list.some((d) => d.brand === deal.brand && weeksLeftOn(d, deal.startYear, deal.startWeek) > 0)) {
    return list; // already running — never double-register
  }
  if (prestige != null) {
    const running = activeDeals(list, deal.startYear, deal.startWeek).length;
    // At the cap. Refusing here rather than in the UI means no caller can route around it.
    if (running >= maxConcurrentDeals(prestige)) return list;
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


/** What a review pass changed, so the UI can say it out loud rather than move numbers silently. */
export interface DealReview {
  raises: { brand: string; from: number; to: number }[];
  finished: { brand: string; verdict: DealVerdict; standing: BrandStanding }[];
}

/**
 * Settle up on every deal whose run has moved.
 *
 * Called once per ingest alongside the disbursement. Two things happen here and nothing else:
 * a run that is clearly going well gets its raise, and a run that has ENDED gets its verdict
 * written into the brand's memory.
 *
 * The record is the program's own, measured from the point the deal was signed — passed in
 * rather than derived, because this module has no business reading a schedule.
 */
export async function reviewDeals(
  dynastyId: string,
  year: number,
  week: number,
  now: DealRecord
): Promise<DealReview> {
  const list = await loadDeals(dynastyId);
  if (!list.length) return { raises: [], finished: [] };
  const brands = await loadBrands(dynastyId);
  const out: DealReview = { raises: [], finished: [] };
  let changed = false;

  for (const deal of list) {
    if (deal.verdict) continue; // already settled
    const since = deal.recordAtSigning ?? { wins: 0, losses: 0 };
    const record: DealRecord = {
      wins: Math.max(0, now.wins - since.wins),
      losses: Math.max(0, now.losses - since.losses),
    };
    const expectation = expectationFor(deal.reputation ?? "clean");
    const running = weeksLeftOn(deal, year, week) > 0;

    if (running) {
      const raised = midRunBump(deal, expectation, record);
      if (raised != null) {
        out.raises.push({ brand: deal.brand, from: deal.pointsPerWeek, to: raised });
        deal.pointsPerWeek = raised;
        deal.bumped = true;
        changed = true;
      }
      continue;
    }

    // The run is over. Judge it once, and let the brand remember.
    const verdict = judge(expectation, record);
    deal.verdict = verdict;
    changed = true;
    const prior = brands.find((b) => b.brand === deal.brand);
    const standing = nextStanding(prior, verdict);
    const updated: BrandHistory = {
      brand: deal.brand,
      standing,
      exceeded: (prior?.exceeded ?? 0) + (verdict === "exceeded" ? 1 : 0),
      met: (prior?.met ?? 0) + (verdict === "met" ? 1 : 0),
      failed: (prior?.failed ?? 0) + (verdict === "failed" ? 1 : 0),
      lastYear: year,
      lastWeek: week,
    };
    if (prior) brands[brands.indexOf(prior)] = updated;
    else brands.push(updated);
    out.finished.push({ brand: deal.brand, verdict, standing });
  }

  if (changed) {
    await save(dynastyId, list);
    await saveBrands(dynastyId, brands);
  }
  return out;
}

export async function clearDeals(dynastyId: string): Promise<void> {
  const all = (await store.get<DealStore>("dynasties")) ?? {};
  delete all[dynastyId];
  await store.set("dynasties", all);
  const brands = (await store.get<BrandStore>("brands")) ?? {};
  delete brands[dynastyId];
  await store.set("brands", brands);
  await store.save();
}
