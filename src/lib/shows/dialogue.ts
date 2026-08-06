// What is actually spoken in a transcript, and what is only a note on the page.
//
// Shows come back with an `isStageDirection` flag the model sets itself, and it gets it wrong
// in one specific way: a line that OPENS with a direction gets flagged as a direction even
// when the rest of it is a real speaking turn.
//
//   { speaker: "Dominic Farr", isStageDirection: true,
//     text: "[pause] You know what? I respect that. All right, lock of the week…" }
//
// That is a host talking. Trusting the flag cost it twice over: the viewer rendered it in the
// stage-direction style (speaker, then italics, no role and no dash — which is how it was
// spotted), and the podcast player, which filters directions out, skipped it in playback. A
// tester lost three lines of a Wire Room episode that way.
//
// The text can settle it without the model's help. Strip the bracketed asides; if anything
// real is left, somebody said it.

/** `[laughs]`, `[pause]`, `[sound drop]` — the house convention for a direction. */
const BRACKETED = /\[[^\]]*\]/g;
/** The same pattern without /g: a global regex's .test() carries lastIndex between calls and
 * would answer differently every other time it was asked about the same string. */
const HAS_BRACKET = /\[[^\]]*\]/;

/** The line with its bracketed directions removed. */
export function stripDirections(text: string): string {
  return (text ?? "").replace(BRACKETED, " ").replace(/\s+/g, " ").trim();
}

/**
 * True only when the line is NOTHING but direction — "[The panel laughs]", or a bare
 * "[pause]". A line with speech around the brackets is a speaking turn.
 */
export function isDirectionOnly(text: string): boolean {
  const spoken = stripDirections(text);
  // Punctuation left over from stripping ("— [laughs] —") is not speech either.
  return spoken.replace(/[\p{P}\p{S}\s]/gu, "").length === 0;
}

/**
 * Whether this line is a stage direction, reconciling the model's flag with the text.
 *
 * Three cases, and the third is the bug:
 *
 *   "[The panel laughs]"                 -> direction, brackets say so.
 *   "The panel laughs."      flagged     -> direction. No brackets to judge by, so the flag
 *                                           is all there is and it is taken at its word.
 *   "[pause] All right, lock of the week" flagged
 *                                        -> DIALOGUE. The flag is wrong: there is speech
 *                                           either side of the aside. A leading direction
 *                                           does not turn a speaking turn into a note.
 */
export function isStageDirection(text: string, flagged: boolean | null | undefined): boolean {
  if (isDirectionOnly(text)) return true;
  // Flagged, and written as plain prose with no aside — nothing contradicts the model.
  if (flagged && !HAS_BRACKET.test(text ?? "")) return true;
  return false;
}

/**
 * What the voice should actually say. Directions are cues for the reader, not words — left
 * in, ElevenLabs reads "pause" out loud in the middle of the sentence.
 *
 * Returns an empty string for a direction-only line, which the player treats as nothing to
 * synthesize rather than paying for a clip of silence.
 */
export function spokenText(text: string): string {
  return stripDirections(text);
}
