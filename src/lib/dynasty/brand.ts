// The athlete's brand — followers, posts, and a feed that scales with how many people are
// actually watching.
//
// WHERE THE NUMBER COMES FROM, AND WHY IT'S OURS. The save has an RTG meters economy
// (`FollowersChange`, `ContentMultiplierChange`, `BrandMeterBonus`) but it exposes only the
// DEFINITIONS of what each in-game action changes — there is no readable live follower total
// anywhere in the file. So DynastyWire keeps its own, in its own store, exactly like the saga
// meters. That is also the only option consistent with the no-progression-writes rule: the
// game's meters are part of its progression economy and we do not touch them.
//
// The discipline is the usual one. **Code computes the number; the model writes the noise
// around it.** Every follower movement below is a function of something that actually
// happened — did he play, what he did, whether the team won, whether he posted — so the app
// can say "you gained 4,200 followers this week" and have it mean something. The model is
// never asked to invent a count, and never allowed to contradict one.

import { LazyStore } from "@tauri-apps/plugin-store";
import type { PlayingTime, WeekLine } from "./rtg";

const store = new LazyStore("dynastywire.brand.json");

export interface BrandPost {
  /** What the player wrote. His words, not the model's. */
  text: string;
  year: number;
  week: number;
  /** Followers before this post, so the effect is auditable after the fact. */
  followersBefore: number;
  delta: number;
  /** The model's rendered reaction, cached so it is never re-billed. */
  reaction?: unknown;
  at: number;
}

export interface BrandWeek {
  year: number;
  week: number;
  followers: number;
  delta: number;
  /** Plain English, and the ONLY explanation the user is shown. */
  reason: string;
}

export interface BrandState {
  followers: number;
  posts: BrandPost[];
  history: BrandWeek[];
}

export const EMPTY_BRAND: BrandState = { followers: 0, posts: [], history: [] };

/** Where a two-star freshman starts: a few hundred people, mostly from home. */
export const STARTING_FOLLOWERS = 380;

// ── Reach ───────────────────────────────────────────────────────────────────────

export type BrandTier = "unknown" | "local" | "known" | "star" | "national";

export function brandTier(followers: number): BrandTier {
  if (followers >= 250_000) return "national";
  if (followers >= 50_000) return "star";
  if (followers >= 8_000) return "known";
  if (followers >= 1_500) return "local";
  return "unknown";
}

/** What that tier MEANS for coverage — handed to the social generator so the feed's volume
 * tracks his actual reach instead of being guessed. */
export const TIER_NOTE: Record<BrandTier, string> = {
  unknown:
    "Almost nobody follows him. His posts reach teammates, family and a handful of diehards. " +
    "No reporter is quoting his account and no rival fan has heard of him.",
  local:
    "A local following — the people who watch this program closely. His posts get seen inside " +
    "the fanbase and nowhere else.",
  known:
    "Known to the fanbase and to people who follow the position nationally. Recruiting accounts " +
    "and beat writers now notice what he posts.",
  star:
    "A real following. What he posts becomes content for other accounts, and a bad post travels.",
  national:
    "A national name. Anything he posts is picked up, screenshotted and argued about by people " +
    "with no connection to the program.",
};

// ── The model ───────────────────────────────────────────────────────────────────

export interface FollowerInput {
  followers: number;
  time: PlayingTime;
  line: WeekLine | null;
  /** True when the team won this week, null when unknown. */
  teamWon?: boolean | null;
}

export interface FollowerResult {
  delta: number;
  followers: number;
  reason: string;
}

const round = (n: number): number => Math.round(n);

/**
 * A week's follower movement.
 *
 * Growth is proportional as well as absolute — the same performance moves a 200-follower
 * account and a 200,000-follower account very differently, and a model that adds a flat number
 * makes a star's account feel dead and a nobody's feel absurd. Attention also DECAYS: a player
 * who does not play loses people, which is what makes gaining them mean anything.
 */
export function followerDelta(input: FollowerInput): FollowerResult {
  const base = Math.max(input.followers, 100);
  const state = input.time.state;
  const line = input.line;

  // Touchdowns are the currency of attention; yardage is the supporting evidence.
  const tds = line ? line.passTDs + line.rushTDs + line.recTDs : 0;
  const yards = line ? line.passYds + line.rushYds + line.recYds : 0;
  const turnovers = line ? line.passInts : 0;

  let pct = 0;
  let flat = 0;
  let reason = "";

  switch (state) {
    case "did-not-play":
      // Nobody unfollows in anger — they just drift, and that drift is the whole reason a
      // first start feels like something.
      pct = -0.015;
      reason = "He didn't play. Attention drifts when nothing happens.";
      break;
    case "played-off-bench":
      pct = 0.04;
      flat = 60 + tds * 250 + Math.floor(yards / 4);
      reason = tds
        ? `He got on the field and found the end zone ${tds === 1 ? "once" : `${tds} times`}.`
        : "He got on the field.";
      break;
    case "first-start":
      // THE spike. It happens once in a career, and the jump has to be unmistakable next to a
      // routine start or the moment the whole mode builds toward lands as a rounding error.
      pct = 0.8;
      flat = 1200 + tds * 800 + Math.floor(yards / 2);
      reason = "His first career start — the first week anyone outside the building looked him up.";
      break;
    case "starter":
      pct = 0.06 + tds * 0.03;
      flat = 120 + tds * 400 + Math.floor(yards / 3);
      reason = tds
        ? `He started and accounted for ${tds} touchdown${tds === 1 ? "" : "s"}.`
        : "He started.";
      break;
    case "multi-week-gap":
    case "unknown":
    default:
      return { delta: 0, followers: input.followers, reason: "No reliable reading of his week — the count holds." };
  }

  // The team's result is the amplifier. The same line in a win travels further than in a loss.
  if (input.teamWon === true) pct += 0.02;
  else if (input.teamWon === false) pct -= 0.01;

  // Turnovers cost him, and they cost him more the more people are watching.
  if (turnovers > 0) {
    pct -= 0.015 * turnovers;
    reason += ` ${turnovers} interception${turnovers === 1 ? "" : "s"} cost him some of it.`;
  }

  const delta = round(base * pct + flat);
  const followers = Math.max(0, input.followers + delta);
  return { delta, followers, reason: reason.trim() };
}

/** What one of HIS OWN posts does. The user writes it; code decides what it costs or earns. */
export interface PostInput {
  followers: number;
  /** How the piece was judged — supplied by the generator's structured output, not invented
   * here. `reach` is how far it travelled, `backlash` whether it aged badly in an hour. */
  reach: "ignored" | "local" | "viral";
  backlash: boolean;
}

export function postDelta(input: PostInput): FollowerResult {
  const base = Math.max(input.followers, 100);
  const byReach = { ignored: 0.002, local: 0.03, viral: 0.35 } as const;
  let pct = byReach[input.reach];
  let reason =
    input.reach === "viral"
      ? "The post travelled a long way past his own following."
      : input.reach === "local"
        ? "The post did what his posts usually do."
        : "The post barely registered.";
  if (input.backlash) {
    // A bad post still gets reach — that is exactly why it hurts. Losses are smaller than
    // gains in absolute terms but they are the ones people remember.
    pct = -Math.abs(pct) * 0.6;
    reason += " It did not land well.";
  }
  const delta = round(base * pct);
  return { delta, followers: Math.max(0, input.followers + delta), reason };
}

// ── Rendering ───────────────────────────────────────────────────────────────────

export function fmtFollowers(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export interface BrandBlockInput {
  state: BrandState;
  /** This week's movement, already computed. */
  week?: FollowerResult | null;
}

/** The locked brand table the generators write around. */
export function brandBlock(input: BrandBlockInput): string {
  const followers = input.week?.followers ?? input.state.followers;
  const tier = brandTier(followers);
  const lines = [
    "=== HIS PLATFORM (computed — these numbers are real and may not be contradicted) ===",
    `  Followers: ${fmtFollowers(followers)} (${followers.toLocaleString("en-US")}).`,
    `  Reach: ${TIER_NOTE[tier]}`,
  ];
  if (input.week && input.week.delta !== 0) {
    const d = input.week.delta;
    lines.push(
      `  This week: ${d > 0 ? "+" : ""}${d.toLocaleString("en-US")} followers. ${input.week.reason}`
    );
  }
  const recent = input.state.posts.slice(-3);
  if (recent.length) {
    lines.push("  HIS OWN RECENT POSTS (he wrote these — react to them as his actual words):");
    for (const p of recent) {
      lines.push(`    "${p.text}" (${p.delta > 0 ? "+" : ""}${p.delta.toLocaleString("en-US")} followers)`);
    }
  }
  lines.push(
    "  NEVER state a follower count other than the one above, never invent a viral moment that " +
      "is not listed, and scale every engagement number in the feed to this reach."
  );
  return lines.join("\n");
}

// ── Store ───────────────────────────────────────────────────────────────────────

const KEY = (dynastyId: string) => `brand::${dynastyId}`;

export async function loadBrand(dynastyId: string): Promise<BrandState> {
  try {
    return (await store.get<BrandState>(KEY(dynastyId))) ?? { ...EMPTY_BRAND, followers: STARTING_FOLLOWERS };
  } catch {
    return { ...EMPTY_BRAND, followers: STARTING_FOLLOWERS };
  }
}

export async function saveBrand(dynastyId: string, state: BrandState): Promise<void> {
  try {
    await store.set(KEY(dynastyId), state);
    await store.save();
  } catch {
    /* a brand that cannot be written is not a reason to fail a generation */
  }
}

/**
 * Record a week's movement — idempotent per (year, week), because the provider remounts on
 * every tab switch and a week that pays its follower delta twice would compound silently.
 */
export function applyWeek(
  state: BrandState,
  year: number,
  week: number,
  result: FollowerResult
): BrandState {
  if (state.history.some((h) => h.year === year && h.week === week)) return state;
  return {
    ...state,
    followers: result.followers,
    history: [...state.history, { year, week, followers: result.followers, delta: result.delta, reason: result.reason }],
  };
}

export function applyPost(state: BrandState, post: BrandPost): BrandState {
  return { ...state, followers: Math.max(0, post.followersBefore + post.delta), posts: [...state.posts, post] };
}
