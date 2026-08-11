// HIS PHONE — the one surface where the user is a person rather than a reader.
//
// What it was: a generated transcript. The model wrote the incoming texts AND wrote his
// replies, so a week's messages arrived already answered — "got it coach. ill be ready",
// "facts. gotta stay locked in", "ready to work. just taking it one day at a time". Three
// different people, three versions of the same agreeable nothing, and no decision anywhere in
// it. A phone you cannot type into is a screenshot of somebody else's phone.
//
// So the model no longer speaks for him. It writes what people send; HE answers, and the
// answer is a choice with a cost.
//
// Two things make that more than a menu:
//
//   1. RELATIONSHIPS PERSIST. Every contact carries a standing that moves with how he has
//      actually treated them, and it survives the week. Being short with your position coach
//      once is a mood; doing it for a month is a relationship.
//
//   2. SILENCE IS AN ANSWER. Leaving a thread unread is the most realistic thing a
//      nineteen-year-old does with his phone, so it is a real option with a real cost — and
//      it costs different amounts depending on who is waiting.

import type { SagaMeters } from "./saga";

export type ContactKind = "coach" | "teammate" | "rival-for-the-job" | "home" | "reporter" | "old-life";

/**
 * Where he stands with someone.
 *
 * Ordered, and the order is the point: `close` is earned over weeks and lost quickly, which is
 * how it works with actual people.
 */
export type Standing = "close" | "good" | "fine" | "strained" | "cold";

export const STANDING_ORDER: Standing[] = ["cold", "strained", "fine", "good", "close"];

export const STANDING_LABEL: Record<Standing, string> = {
  close: "close",
  good: "good",
  fine: "fine",
  strained: "strained",
  cold: "cold",
};

/** How each kind of person reads a message, and what they will not forgive. */
export const CONTACT_NOTE: Record<ContactKind, string> = {
  coach:
    "He is not your friend and he is not your enemy. He notices effort and he notices excuses, " +
    "and he does not say much either way.",
  teammate: "The group-chat register. Nothing here is serious until it suddenly is.",
  "rival-for-the-job":
    "Everything between you is loaded even when neither of you means it to be. You are both " +
    "being polite about the same job.",
  home: "This one is not about football. That is the entire point of it.",
  reporter: "Everything you say here can be printed. Nothing you say here is private.",
  "old-life": "Somebody who knew you before any of this. They are not impressed, which is a relief.",
};

/** The tone of a reply. Deliberately not "good / bad" — these are ways to be a person. */
export type ReplyTone = "warm" | "locked-in" | "blunt" | "deflect" | "ignore";

export const TONE_LABEL: Record<ReplyTone, string> = {
  warm: "Warm",
  "locked-in": "All business",
  blunt: "Say what you actually think",
  deflect: "Keep it light",
  ignore: "Leave it on read",
};

export interface Contact {
  name: string;
  kind: ContactKind;
  standing: Standing;
  /** Consecutive weeks he has left this person unanswered. */
  ignored: number;
  /** Weeks since anything was exchanged at all. */
  quiet: number;
}

const shift = (s: Standing, by: number): Standing => {
  const i = STANDING_ORDER.indexOf(s);
  return STANDING_ORDER[Math.max(0, Math.min(STANDING_ORDER.length - 1, i + by))];
};

/**
 * What a reply does to the relationship.
 *
 * No tone is universally right, which is the whole design. Being all business with your
 * position coach is exactly correct and is the wrong answer to your father asking how you are.
 * The matrix is small enough to read and argue with, which is better than a formula nobody
 * can predict.
 */
export function standingAfter(contact: Contact, tone: ReplyTone): Standing {
  const { kind, standing } = contact;
  if (tone === "ignore") {
    // One unanswered text is not a betrayal, whoever sent it — a nineteen-year-old leaves
    // people on read and it means nothing. The severity lives in the REPEAT, not the act, so
    // a single silence costs the same everywhere and only the compounding differs. Not
    // answering a reporter is a media strategy rather than a slight, and costs nothing.
    return shift(standing, kind === "reporter" ? 0 : -1);
  }
  if (tone === "warm") return shift(standing, kind === "reporter" ? 0 : 1);
  if (tone === "locked-in") {
    return shift(standing, kind === "coach" ? 1 : kind === "home" ? -1 : 0);
  }
  if (tone === "blunt") {
    // Honesty reads as respect from the people who work with you, and as a problem in print.
    return shift(standing, kind === "reporter" ? -1 : kind === "rival-for-the-job" ? -1 : 0);
  }
  // deflect
  return shift(standing, kind === "reporter" ? 1 : kind === "home" ? -1 : 0);
}

/**
 * What it costs him beyond the relationship.
 *
 * Small numbers on purpose. One text should never swing a season; a month of them should be
 * visible. Returns a partial so callers can hand it straight to the saga meters.
 */
export function metersAfter(contact: Contact, tone: ReplyTone): Partial<SagaMeters> {
  const out: Partial<SagaMeters> = {};
  if (contact.kind === "reporter") {
    if (tone === "blunt") out.mediaHeat = 4;
    if (tone === "ignore") out.mediaHeat = 2;
    if (tone === "deflect") out.mediaHeat = -2;
  }
  if (contact.kind === "coach") {
    if (tone === "locked-in" || tone === "warm") out.lockerRoom = 1;
    if (tone === "ignore") out.lockerRoom = -3;
  }
  if (contact.kind === "teammate" || contact.kind === "rival-for-the-job") {
    if (tone === "warm") out.lockerRoom = 2;
    if (tone === "blunt") out.lockerRoom = -2;
    if (tone === "ignore") out.lockerRoom = -1;
  }
  return out;
}

/** Fold a week's answers — and a week's silences — into the contact list. */
export function advanceContacts(
  contacts: Contact[],
  answered: { name: string; tone: ReplyTone }[]
): Contact[] {
  const byName = new Map(answered.map((a) => [a.name.toLowerCase(), a.tone]));
  return contacts.map((c) => {
    const tone = byName.get(c.name.toLowerCase());
    if (!tone) {
      // Not messaged at all this week. Nothing happened; nothing is held against him.
      return { ...c, quiet: c.quiet + 1 };
    }
    if (tone === "ignore") {
      const ignored = c.ignored + 1;
      // Sustained silence from someone who keeps writing is its own answer, and home runs out
      // of patience first — a coach reads it as focus, a father reads it as being forgotten.
      const limit = c.kind === "home" ? 2 : 3;
      const extra = ignored >= limit ? -1 : 0;
      return { ...c, standing: shift(standingAfter(c, tone), extra), ignored, quiet: 0 };
    }
    return { ...c, standing: standingAfter(c, tone), ignored: 0, quiet: 0 };
  });
}

/** What the writer needs to know to sound like this person, today. */
export function contactBrief(contacts: Contact[]): string | null {
  if (!contacts.length) return null;
  const lines = contacts.map((c) => {
    const bits = [`  ${c.name} (${c.kind}) — you are ${STANDING_LABEL[c.standing]}.`];
    if (c.ignored >= 2) {
      bits.push(
        `    He has left this person on read ${c.ignored} weeks running. They know. It is in ` +
          "how they write to him now — shorter, or one more try, or a flatness that was not " +
          "there before."
      );
    } else if (c.quiet >= 3) {
      bits.push(`    Nothing between them for ${c.quiet} weeks. A message now has to earn its way back in.`);
    }
    bits.push(`    ${CONTACT_NOTE[c.kind]}`);
    return bits.join("\n");
  });
  return ["WHO IS IN HIS PHONE, AND WHERE HE STANDS WITH THEM:", ...lines].join("\n");
}

/** A fresh contact list. Everyone starts fine — a relationship is something he builds. */
export function newContact(name: string, kind: ContactKind): Contact {
  return { name, kind, standing: "fine", ignored: 0, quiet: 0 };
}
