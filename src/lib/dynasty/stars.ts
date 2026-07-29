// Recruit star ratings. VERIFIED against a real CFB27 save: the Recruit table has NO star
// field — it carries NationalRank, ProductionGrade, PositionRank and StateRank only. (The
// old code read `ProspectStarRating`, which doesn't exist in this schema, so stars always
// came back null and the UI showed "—".)
//
// National rank IS stored and real, and it's what star ratings actually track in recruiting
// media, so we derive stars from it using the industry's rough class shape: a handful of
// five-stars, a few hundred four-stars, then the long three-star tail.

/** Class-size cutoffs by national rank (top-N). */
const FIVE_STAR_MAX = 32;
const FOUR_STAR_MAX = 300;
const THREE_STAR_MAX = 1200;

/** Stars for a prospect, derived from his national rank. Null when he isn't ranked. */
export function starsFromRank(nationalRank: number | null | undefined): number | null {
  if (nationalRank == null || nationalRank <= 0) return null;
  if (nationalRank <= FIVE_STAR_MAX) return 5;
  if (nationalRank <= FOUR_STAR_MAX) return 4;
  if (nationalRank <= THREE_STAR_MAX) return 3;
  return 2;
}

/**
 * The star count to display: the save's own value when it ever provides one, otherwise the
 * rank-derived rating.
 */
export function recruitStars(
  stored: number | null | undefined,
  nationalRank: number | null | undefined
): number | null {
  if (typeof stored === "number" && stored > 0) return stored;
  return starsFromRank(nationalRank);
}

/** "★★★★" for display, or "—" when the prospect is unranked. */
export function starString(
  stored: number | null | undefined,
  nationalRank: number | null | undefined
): string {
  const n = recruitStars(stored, nationalRank);
  return n != null ? "★".repeat(Math.max(0, Math.min(5, n))) : "—";
}
