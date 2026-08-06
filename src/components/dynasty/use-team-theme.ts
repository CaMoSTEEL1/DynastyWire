"use client";

// Paints the page in the user's program colours.
//
// The variables go on <html> rather than a wrapper div on purpose: the presser overlay, the
// settings drawer, the tutorial wizard and the loading overlay all render through portals
// outside the shell's tree, and a scoped wrapper would leave every one of them crimson while
// the page behind it turned maize.
//
// Only the accent tokens move. The paper stack, the ink ramp and the type are the product's
// identity and are never touched — see team-theme.ts for why, and for the readability work
// that decides which of a team's two colours can actually carry an accent.

import { useEffect, useMemo } from "react";
import type { DynastySnapshot } from "@/lib/dynasty/client";
import { teamTheme, themeVariables, type TeamTheme } from "@/lib/dynasty/team-theme";

/**
 * Derive the theme for whichever team the user is. Works unchanged in Road to Glory: an RTG
 * parse overrides `userTeamRow` to the player's school, so `userTeam` is his program there
 * exactly as it is the coach's program in a dynasty.
 */
export function useTeamTheme(
  snapshot: DynastySnapshot | null | undefined,
  enabled: boolean
): TeamTheme | null {
  const theme = useMemo(() => {
    if (!enabled) return null;
    const t = snapshot?.userTeam;
    return t ? teamTheme(t.colorPrimary, t.colorSecondary) : null;
  }, [enabled, snapshot?.userTeam]);

  useEffect(() => {
    const root = document.documentElement;
    const vars = themeVariables(theme);
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    // Removing the properties restores the stylesheet's values, so turning the setting off
    // (or opening a save with no usable colours) falls back to the house crimson rather than
    // stranding the app in the last team's palette.
    return () => {
      for (const k of Object.keys(vars)) root.style.removeProperty(k);
    };
  }, [theme]);

  return theme;
}
