// What's ACTUALLY brewing in the building — computed from the save, not invented.
//
// The Situation Room used to hand the model a record and a roster and ask it to imagine
// drama. That produced plausible fiction that had nothing to do with your team. This module
// reads the real pressure already sitting in the save — a star buried behind a freshman, a
// player paid a fraction of what he's worth, a volatile personality whose confidence just
// cratered, a senior watching his last season from the bench — and turns it into grounded
// seeds. The generator then writes situations ABOUT YOUR ACTUAL ROSTER.
//
// Same contract as the scouting module: no ratings ever reach a rendered string. Heat and
// tier language only. Ratings are an internal ordering signal.

import type { RosterPlayer } from "./client";
import { fakeGpa } from "./academics";
import { classAbbrev, playerLine, projectedStarters, tierFor, TIER_LABEL } from "./scouting";

export type PressureKind =
  | "buried-star"
  | "nil-grievance"
  | "senior-snubbed"
  | "confidence-crash"
  | "academic-watch"
  | "volatile-star"
  | "freshman-surge";

/** 1 = simmering, 2 = real, 3 = about to boil over. */
export type Heat = 1 | 2 | 3;

export interface PressurePoint {
  kind: PressureKind;
  player: RosterPlayer;
  /** The grounded fact behind it — always a real number or state from the save. */
  why: string;
  /** What it turns into if nobody handles it. Seeds the generator's imagination. */
  risk: string;
  heat: Heat;
}

const KIND_LABEL: Record<PressureKind, string> = {
  "buried-star": "Buried talent",
  "nil-grievance": "NIL grievance",
  "senior-snubbed": "Senior on the bench",
  "confidence-crash": "Confidence gone",
  "academic-watch": "Academic watch",
  "volatile-star": "Volatile star",
  "freshman-surge": "Freshman pushing",
};

export function kindLabel(kind: PressureKind): string {
  return KIND_LABEL[kind];
}

const VOLATILE = new Set(["Unpredictable", "Intense"]);
const ovr = (p: RosterPlayer) => p.overall ?? 0;

/** Playing time is the dealbreaker the save spells out; treat it as an accelerant. */
const wantsSnaps = (p: RosterPlayer) => /playingtime|playing time/i.test(p.dealbreaker ?? "");

const isUnderclass = (p: RosterPlayer) => {
  const c = classAbbrev(p.year);
  return c === "Fr." || c === "RFr." || c === "So.";
};
const isSenior = (p: RosterPlayer) => classAbbrev(p.year) === "Sr.";

const bump = (h: number): Heat => (h >= 3 ? 3 : h <= 1 ? 1 : 2);

/**
 * Every real pressure point on the roster, hottest first.
 *
 * Deliberately conservative: each rule needs a concrete fact from the save behind it. A
 * quiet roster returning an empty board is the correct answer — the Situation Room can
 * still generate, it just won't pretend there's a fire where there isn't one.
 */
export function pressureBoard(roster: RosterPlayer[], limit = 6): PressurePoint[] {
  if (roster.length === 0) return [];
  const starters = new Set(projectedStarters(roster).map((s) => s.player.name));
  const out: PressurePoint[] = [];

  // Who is on the field at each position, for "behind whom" comparisons.
  const starterAt = new Map<string, RosterPlayer>();
  for (const s of projectedStarters(roster)) {
    const k = (s.position ?? "").toUpperCase();
    if (!starterAt.has(k)) starterAt.set(k, s.player);
  }

  for (const p of roster) {
    if (p.overall == null || !p.name) continue;
    const pos = (p.position ?? "").toUpperCase();
    const benched = !starters.has(p.name);
    const ahead = starterAt.get(pos);
    const volatile = VOLATILE.has(p.personality ?? "");

    // A genuinely good player who isn't playing. The single most common real grievance.
    if (benched && ovr(p) >= 78 && ahead) {
      const heat = bump(1 + (wantsSnaps(p) ? 1 : 0) + (volatile ? 1 : 0));
      out.push({
        kind: "buried-star",
        player: p,
        why: `A ${TIER_LABEL[tierFor(p.overall)]} sitting behind ${playerLine(ahead)}${wantsSnaps(p) ? ", and the one thing that would make him leave is playing time" : ""}.`,
        risk: "He hits the portal, or his camp starts briefing reporters.",
        heat,
      });
      continue;
    }

    // Paid far below what the save says he's worth.
    const worth = p.nilBaseValue ?? 0;
    const paid = p.nilComp ?? 0;
    if (worth > 0 && paid < worth * 0.55 && ovr(p) >= 80) {
      out.push({
        kind: "nil-grievance",
        player: p,
        why: `The collective values him at ${Math.round(worth)}K and pays him ${Math.round(paid)}K.`,
        risk: "A rival collective makes the call he's waiting for.",
        heat: bump(paid < worth * 0.35 ? 3 : 2),
      });
      continue;
    }

    // A senior spending his last season on the bench is a locker-room problem, not a depth
    // chart problem — the room watches how you treat the guy who stayed.
    if (benched && isSenior(p) && ovr(p) >= 72) {
      out.push({
        kind: "senior-snubbed",
        player: p,
        why: `A senior who stayed four years and isn't on the field${ahead ? ` — ${playerLine(ahead)} is ahead of him` : ""}.`,
        risk: "The veterans notice. So does his family, loudly.",
        heat: bump(volatile ? 2 : 1),
      });
      continue;
    }

    // The save tracks confidence directly. A starter who has lost it is a Sunday problem.
    const conf = p.confidence;
    if (conf != null && conf <= 35 && starters.has(p.name)) {
      out.push({
        kind: "confidence-crash",
        player: p,
        why: `A starter whose confidence has bottomed out${volatile ? ` — and he's ${p.personality}` : ""}.`,
        risk: "It shows up on Saturday before it shows up in a meeting.",
        heat: bump(conf <= 20 ? 3 : 2),
      });
      continue;
    }

    // A young player good enough to take someone's job — the other side of a depth fight.
    if (isUnderclass(p) && ovr(p) >= 82 && starters.has(p.name)) {
      out.push({
        kind: "freshman-surge",
        player: p,
        why: `${classAbbrev(p.year)} already starting and grading out as a ${TIER_LABEL[tierFor(p.overall)]}.`,
        risk: "Whoever he passed on the depth chart has something to say about it.",
        heat: 1,
      });
      continue;
    }

    // A volatile personality carrying a real role is a flashpoint waiting for a bad week.
    if (volatile && starters.has(p.name) && ovr(p) >= 84) {
      out.push({
        kind: "volatile-star",
        player: p,
        why: `${p.personality} personality, and the offense/defense runs through him.`,
        risk: "One bad call, one camera, and it's a week-long story.",
        heat: 1,
      });
    }
  }

  // Academics ride on the flavour GPA the app already assigns, so the board agrees with
  // what the academics screen shows.
  for (const p of roster) {
    if (out.some((x) => x.player.name === p.name)) continue;
    const gpa = fakeGpa(p);
    if (gpa.status === "At Risk" && (starters.has(p.name) || ovr(p) >= 78)) {
      out.push({
        kind: "academic-watch",
        player: p,
        why: `Carrying a ${gpa.gpa.toFixed(2)} — the registrar is watching him.`,
        risk: "An eligibility ruling costs you the player, not just the week.",
        heat: bump(starters.has(p.name) ? 2 : 1),
      });
    }
  }

  return out
    .sort((a, b) => b.heat - a.heat || ovr(b.player) - ovr(a.player))
    .slice(0, limit);
}

/** One line per pressure point, for the prompt. No ratings — tier language only. */
export function pressureLine(pp: PressurePoint): string {
  const heat = pp.heat === 3 ? "BOILING" : pp.heat === 2 ? "real" : "simmering";
  return `  [${heat}] ${kindLabel(pp.kind)} — ${playerLine(pp.player)} ${pp.player.position ?? "?"}${pp.player.personality ? `, ${pp.player.personality}` : ""}: ${pp.why} Risk: ${pp.risk}`;
}

// ── Player standing: how you've treated each man, across the season ─────────────
// The room remembers. A player you shielded in week 3 answers differently in week 9 — and
// so does everyone watching how you handled it.

export type Standing = "backed" | "burned" | "mixed" | "neutral";

export interface PlayerStanding {
  name: string;
  /** Net of protective vs punitive decisions involving him. */
  score: number;
  standing: Standing;
  /** Every decision that touched him, most recent first. */
  history: Array<{ week: number; year: number; headline: string; decision: string; tone: string }>;
}

/** A resolved decision, reduced to what standing cares about. Mirrors saga `Resolution`
 * loosely so this module stays free of the saga's heavier types. */
export interface StandingInput {
  playerName: string | null;
  week: number;
  year: number;
  headline: string;
  decision: string;
  tone: string;
  /** True when the decision came with a suspension. */
  suspended?: boolean;
}

const TONE_SCORE: Record<string, number> = {
  protective: 2,
  measured: 0,
  pragmatic: 0,
  hardline: -2,
};

export function standingFor(score: number): Standing {
  if (score >= 2) return "backed";
  if (score <= -2) return "burned";
  if (score === 0) return "neutral";
  return "mixed";
}

export const STANDING_LABEL: Record<Standing, string> = {
  backed: "you backed him",
  burned: "you came down on him",
  mixed: "mixed history",
  neutral: "no history",
};

/** Roll the season's decisions up per player. */
export function playerStandings(decisions: StandingInput[]): PlayerStanding[] {
  const by = new Map<string, PlayerStanding>();
  for (const d of decisions) {
    if (!d.playerName) continue;
    const cur = by.get(d.playerName) ?? { name: d.playerName, score: 0, standing: "neutral" as Standing, history: [] };
    cur.score += (TONE_SCORE[d.tone] ?? 0) - (d.suspended ? 1 : 0);
    cur.history.push({ week: d.week, year: d.year, headline: d.headline, decision: d.decision, tone: d.tone });
    by.set(d.playerName, cur);
  }
  const out = [...by.values()].map((s) => ({
    ...s,
    standing: standingFor(s.score),
    history: s.history.sort((a, b) => b.year - a.year || b.week - a.week),
  }));
  return out.sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
}
