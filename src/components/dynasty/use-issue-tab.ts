"use client";

// Read a tab's cached content from this week's issue (Tauri store — survives navigation
// AND app restarts). Pages use this to auto-restore what was already written instead of
// showing an empty "generate" call-to-action after every hard nav or relaunch. Returns
// null until the issue loads or when the tab hasn't been written this week.

import { useMemo } from "react";
import { useDynasty } from "./dynasty-context";
import { stableStringify, tabCacheKey } from "@/lib/dynasty/issue";

export function useIssueTab<T>(kind: string, extra?: Record<string, unknown>): T | null {
  const { issue } = useDynasty();
  const extraKey = extra ? stableStringify(extra) : "";
  return useMemo(() => {
    const tab = issue?.tabs[tabCacheKey(kind, extra)];
    return tab?.status === "ready" && tab.data != null ? (tab.data as T) : null;
    // extraKey is the stable serialization of extra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issue, kind, extraKey]);
}
