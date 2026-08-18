"use client";

// Dark or light, applied to <html>.
//
// The attribute goes on the document element rather than a wrapper for the same reason the
// team colours do: the presser overlay, the settings drawer, the tutorial wizard and the
// loading overlay all render through portals outside the shell's tree, and a scoped wrapper
// would leave every one of them on the old palette while the page behind them changed.
//
// Dark stays the default and the identity. This is an accessibility and preference option —
// asked for by a user who reads the app in a bright room — not a new house style.

import { useEffect } from "react";
import { PAPER, PAPER_LIGHT } from "@/lib/dynasty/team-theme";

export type AppTheme = "dark" | "light";

export function resolveTheme(setting: unknown): AppTheme {
  return setting === "light" ? "light" : "dark";
}

/** The page colour the accents are judged against. Team colours need this to pick a side. */
export function pageColour(theme: AppTheme): string {
  return theme === "light" ? PAPER_LIGHT : PAPER;
}

export function useAppTheme(setting: unknown): AppTheme {
  const theme = resolveTheme(setting);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.setAttribute("data-theme", "light");
    } else {
      // Removed rather than set to "dark", so the stylesheet's own :root block is what
      // applies. Two sources for the same colours is how they drift apart.
      root.removeAttribute("data-theme");
    }
    // Tells the webview to render form controls, scrollbars and the like to match, which is
    // the difference between a themed app and a themed page inside a dark chrome.
    root.style.colorScheme = theme;
  }, [theme]);

  return theme;
}
