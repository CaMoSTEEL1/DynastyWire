// WHO HE IS, beyond what the save knows.
//
// This is decision 10, and it is mandatory on purpose. Dynasty's coach backstory is optional
// because the PROGRAM carries the story — you have a school, a record, boosters, a history.
// Road to Glory has none of that. Strip the character out and The Week is a paragraph about a
// freshman who took zero snaps, which is not a product.
//
// The save gives the skeleton (star rating, home state, position, class, which schools wanted
// him) and it is pre-filled from exactly that, so the form opens mostly answered. What it
// cannot give is a person: the town, the family, why he picked this school over 137 others,
// and the handful of people whose opinion of him actually matters.
//
// The cast is mapped onto things the game already tracks, so these names are not decoration —
// they attach to real data. The position coach has a `CoachTrustBonus`. The man ahead of him
// is already named by the depth chart. `ArcContext` literally tracks a teammate actor.

import { LazyStore } from "@tauri-apps/plugin-store";
import type { RtgPlayer, SchoolInterest } from "./client";

const store = new LazyStore("dynastywire.rtgcharacter.json");

/** Why he is here — the frame every piece of coverage is written through. */
export type RtgArc =
  /** Overlooked, and everyone knows it. */
  | "underrated"
  /** Big rating, big expectations, hasn't happened yet. */
  | "blue-chip"
  /** Home-state kid who stayed. */
  | "hometown"
  /** Took the money/the depth chart over the name. */
  | "calculated"
  /** Second school. He has already left somewhere. */
  | "transfer";

export const ARC_LABEL: Record<RtgArc, string> = {
  underrated: "Overlooked",
  "blue-chip": "Blue-chip",
  hometown: "Hometown kid",
  calculated: "Calculated",
  transfer: "Second chance",
};

export const ARC_NOTE: Record<RtgArc, string> = {
  underrated:
    "He was not supposed to be here. Everything he gets is read through the fact that nobody " +
    "wanted him, and he has a chip about it whether or not he admits it.",
  "blue-chip":
    "He arrived with expectations attached. Nothing he does is neutral — a good game is what " +
    "he is supposed to do, a bad one is a story.",
  hometown:
    "He stayed home. The town has an opinion about that, and so does everyone who left.",
  calculated:
    "He picked this place with his eyes open — the depth chart, the money, the fit. People " +
    "who romanticise recruiting hold it against him.",
  transfer:
    "This is not his first school. Whatever happened at the last one follows him here.",
};

export interface RtgCharacter {
  /** The frame. */
  arc: RtgArc;
  /** His hometown in the user's words — the save gives only a state. */
  hometown: string;
  /** 2-3 sentences: his path, his family, what drives him. */
  bio: string;
  /** THE CAST — the people whose opinion of him matters. */
  positionCoach: string;
  aheadOfHim: string;
  teammate: string;
  reporter: string;
  /** The person he calls after a bad week. */
  home: string;
  /** What he tells people he wants. */
  goal: string;
}

export const EMPTY_CHARACTER: RtgCharacter = {
  arc: "underrated",
  hometown: "",
  bio: "",
  positionCoach: "",
  aheadOfHim: "",
  teammate: "",
  reporter: "",
  home: "",
  goal: "",
};

/** True once there is enough of a person to write about. Deliberately not "every field". */
export function isComplete(c: RtgCharacter | null | undefined): boolean {
  if (!c) return false;
  return !!(c.hometown.trim() && c.bio.trim() && c.positionCoach.trim() && c.home.trim());
}

/**
 * Pre-fill from the save so the form opens mostly answered rather than as a blank wall — the
 * friction of a mandatory setup step is the one real argument against making it mandatory.
 */
export function seedFromSave(
  player: RtgPlayer | null | undefined,
  interest: SchoolInterest[] | undefined,
  school: string | null
): RtgCharacter {
  const stars = (player?.prospectStars ?? "").toUpperCase();
  const arc: RtgArc = /FIVE|FOUR/.test(stars)
    ? "blue-chip"
    : player?.homeState && school && school.toLowerCase().includes(player.homeState.toLowerCase())
      ? "hometown"
      : "underrated";

  const offers = (interest ?? []).filter(
    (s) => s.offerStatus && !/^(none|invalid)$/i.test(s.offerStatus) && s.school !== school
  );
  const bio = [
    player?.prospectStars
      ? `A ${player.prospectStars.replace(/_/g, " ").toLowerCase()} prospect${player.homeState ? ` out of ${player.homeState}` : ""}.`
      : "",
    offers.length
      ? `Also had ${offers.slice(0, 3).map((o) => o.school).join(", ")} in on him.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    ...EMPTY_CHARACTER,
    arc,
    hometown: player?.homeState ?? "",
    bio,
    goal: "Play.",
  };
}

/** The locked character block the generators write around. */
export function characterBlock(c: RtgCharacter | null | undefined): string | null {
  if (!isComplete(c) || !c) return null;
  const lines = [
    `=== WHO HE IS (the user wrote this — it is TRUE, and it is the frame for everything) ===`,
    `  ${ARC_LABEL[c.arc]}: ${ARC_NOTE[c.arc]}`,
    c.hometown ? `  Home: ${c.hometown}.` : "",
    c.bio ? `  ${c.bio}` : "",
    c.goal ? `  What he says he wants: ${c.goal}` : "",
    "",
    "  THE PEOPLE WHOSE OPINION OF HIM MATTERS — use these names, never invent replacements:",
    c.positionCoach ? `    ${c.positionCoach} — his position coach. The one who decides if he plays.` : "",
    c.aheadOfHim ? `    ${c.aheadOfHim} — the man ahead of him. They share a room every day.` : "",
    c.teammate ? `    ${c.teammate} — his closest teammate.` : "",
    c.reporter ? `    ${c.reporter} — the beat writer who covers the team.` : "",
    c.home ? `    ${c.home} — home. The call he makes after a bad week.` : "",
    "",
    "  These people RECUR. Do not invent a different position coach, a different beat writer, or",
    "  a new best friend — this cast is the continuity of his story.",
  ].filter(Boolean);
  return lines.join("\n");
}

// ── Store ───────────────────────────────────────────────────────────────────────

const KEY = (dynastyId: string) => `character::${dynastyId}`;

export async function loadCharacter(dynastyId: string): Promise<RtgCharacter | null> {
  try {
    return (await store.get<RtgCharacter>(KEY(dynastyId))) ?? null;
  } catch {
    return null;
  }
}

export async function saveCharacter(dynastyId: string, c: RtgCharacter): Promise<void> {
  try {
    await store.set(KEY(dynastyId), c);
    await store.save();
  } catch {
    /* ignored — a character that cannot be written must not break a generation */
  }
}
