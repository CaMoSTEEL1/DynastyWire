"use client";

// The athlete's brand, as React sees it.
//
// Two jobs: hold the baseline snapshot of the player (last week's reading, which is what the
// week-state and the real game line are diffed from), and settle this week's follower movement
// exactly once.
//
// "Exactly once" is load-bearing. The provider remounts on every tab switch — the nav uses hard
// navigations — so a week that paid its follower delta on mount would compound every time the
// user clicked a tab. `applyWeek` is idempotent per (year, week) and this hook leans on that
// rather than trying to be careful.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import {
  applyPost,
  applyWeek,
  followerDelta,
  loadBrand,
  postDelta,
  saveBrand,
  STARTING_FOLLOWERS,
  type BrandPost,
  type BrandState,
  type FollowerResult,
} from "@/lib/dynasty/brand";
import { playingTime, weekLine } from "@/lib/dynasty/rtg";
import type { RtgPlayer } from "@/lib/dynasty/client";

/** Last week's reading of the player, kept separately from the save so the diff survives the
 * game overwriting the autosave. */
const baselineStore = new LazyStore("dynastywire.rtgbaseline.json");

export function useBrand() {
  const { snapshot, dynastyId, year, week, delta } = useDynasty();
  const player = snapshot?.player ?? null;

  const [brand, setBrand] = useState<BrandState>({ followers: STARTING_FOLLOWERS, posts: [], history: [] });
  const [baseline, setBaseline] = useState<RtgPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const settled = useRef<string | null>(null);

  // Load both stores once per dynasty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [b, base] = await Promise.all([
        loadBrand(dynastyId),
        baselineStore.get<RtgPlayer>(`baseline::${dynastyId}`).catch(() => null),
      ]);
      if (cancelled) return;
      setBrand(b);
      setBaseline(base ?? null);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [dynastyId]);

  const time = useMemo(() => playingTime(player, baseline), [player, baseline]);
  const line = useMemo(() => weekLine(player, baseline, time), [player, baseline, time]);

  // This week's movement. Computed from real playing time and real production, never guessed.
  const week_: FollowerResult | null = useMemo(() => {
    if (!ready || !player) return null;
    const userTeam = snapshot?.userTeam;
    const result = delta?.userResult ?? null;
    const teamWon =
      result && userTeam?.name
        ? result.winner === userTeam.name
        : null;
    return followerDelta({ followers: brand.followers, time, line, teamWon });
  }, [ready, player, brand.followers, time, line, delta, snapshot]);

  // Settle it — once per (year, week), per the idempotence in applyWeek.
  //
  // REPORTED BUG: this used to bail when the delta was 0, which it ALWAYS is on a save with no
  // prior reading — so the baseline was never written and every week read as "unknown"
  // forever. The baseline must be seeded on first sight whether or not any followers moved.
  useEffect(() => {
    if (!ready || !player) return;
    const key = `${dynastyId}::${year}::${week}`;
    if (settled.current === key) return;
    settled.current = key;
    if (week_ && week_.delta !== 0) {
      setBrand((prev) => {
        const next = applyWeek(prev, year, week, week_);
        if (next !== prev) void saveBrand(dynastyId, next);
        return next;
      });
    }
    // Roll the baseline forward so NEXT week diffs against this one. Unconditional: without
    // this the app can never learn anything about a week.
    void baselineStore
      .set(`baseline::${dynastyId}`, player)
      .then(() => baselineStore.save())
      .catch(() => {});
    // week_ is derived; keying on the week is the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, player, dynastyId, year, week]);

  /** Record a post the player wrote, with the reach the model judged. */
  const recordPost = useCallback(
    async (text: string, reach: "ignored" | "local" | "viral", backlash: boolean, reaction?: unknown) => {
      const before = brand.followers;
      const result = postDelta({ followers: before, reach, backlash });
      const post: BrandPost = {
        text,
        year,
        week,
        followersBefore: before,
        delta: result.delta,
        reaction,
        at: Date.now(),
      };
      const next = applyPost(brand, post);
      setBrand(next);
      await saveBrand(dynastyId, next);
      return result;
    },
    [brand, dynastyId, year, week]
  );

  return { brand, baseline, week: week_, time, line, ready, recordPost };
}
