"use client";

// Central client-side data provider for the standalone app. Replaces the Supabase
// server-component data flow: resolves the current save, diffs against the archived
// baseline, and exposes the snapshot/delta plus a generate() helper to every screen.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  archiveSave,
  generate as generateKind,
  getDelta,
  getSnapshot,
  listSaves,
  loadSettings,
  saveSettings,
  setLastIngested,
  getLastIngested,
  type DynastySettings,
  type DynastySnapshot,
  type WeekDelta,
} from "@/lib/dynasty/client";

interface DynastyContextValue {
  ready: boolean;
  loading: boolean;
  error: string | null;
  settings: DynastySettings;
  needsOnboarding: boolean;
  snapshot: DynastySnapshot | null;
  delta: WeekDelta | null;
  currentSavePath: string | null;
  updateSettings: (patch: Partial<DynastySettings>) => Promise<void>;
  refresh: () => Promise<void>;
  /** Generate content for a screen (kind maps to ingest/gen/<kind>.js). */
  generate: <T = unknown>(kind: string, extra?: Record<string, unknown>) => Promise<T>;
}

const DynastyContext = createContext<DynastyContextValue | null>(null);

export function useDynasty() {
  const ctx = useContext(DynastyContext);
  if (!ctx) throw new Error("useDynasty must be used within DynastyProvider");
  return ctx;
}

const EMPTY_SETTINGS: DynastySettings = {
  savesFolder: null,
  userTeam: null,
  coachName: null,
  anthropicKey: null,
  elevenLabsKey: null,
};

export function DynastyProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<DynastySettings>(EMPTY_SETTINGS);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<DynastySnapshot | null>(null);
  const [delta, setDelta] = useState<WeekDelta | null>(null);
  const [currentSavePath, setCurrentSavePath] = useState<string | null>(null);
  const [beforePath, setBeforePath] = useState<string | null>(null);

  // Load persisted settings once on mount.
  useEffect(() => {
    loadSettings()
      .then((s) => setSettings(s))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const needsOnboarding = ready && (!settings.savesFolder || !settings.anthropicKey || !settings.userTeam);

  const refresh = useCallback(async () => {
    if (!settings.savesFolder || !settings.userTeam) return;
    setLoading(true);
    setError(null);
    try {
      const saves = await listSaves(settings.savesFolder);
      if (saves.length === 0) throw new Error("No dynasty saves found in that folder.");
      const current = saves[0].path;
      setCurrentSavePath(current);

      const snap = await getSnapshot(current, settings.userTeam);
      setSnapshot(snap);

      // Diff against the archived baseline from the previous ingest, if any.
      const baseline = await getLastIngested();
      if (baseline && baseline !== current) {
        try {
          setDelta(await getDelta(baseline, current, settings.userTeam));
        } catch {
          setDelta(null);
        }
      }
      // Archive the current save as the new baseline for next time.
      const archived = await archiveSave(current, `${settings.savesFolder}/.dynastywire`, `week-${snap.week ?? "x"}`);
      setBeforePath(baseline ?? archived);
      await setLastIngested(archived);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [settings.savesFolder, settings.userTeam]);

  // Auto-refresh once settings are complete.
  useEffect(() => {
    if (!needsOnboarding) refresh();
  }, [needsOnboarding, refresh]);

  const updateSettings = useCallback(async (patch: Partial<DynastySettings>) => {
    await saveSettings(patch);
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  const generate = useCallback(
    async <T,>(kind: string, extra?: Record<string, unknown>): Promise<T> => {
      if (!currentSavePath || !settings.anthropicKey) {
        throw new Error("Not ready to generate (missing save or API key).");
      }
      return generateKind<T>(
        kind,
        beforePath ?? currentSavePath,
        currentSavePath,
        settings.anthropicKey,
        {
          team: settings.userTeam ?? undefined,
          coach: settings.coachName ?? undefined,
          extra,
        }
      );
    },
    [currentSavePath, beforePath, settings.anthropicKey, settings.userTeam, settings.coachName]
  );

  const value = useMemo<DynastyContextValue>(
    () => ({
      ready,
      loading,
      error,
      settings,
      needsOnboarding,
      snapshot,
      delta,
      currentSavePath,
      updateSettings,
      refresh,
      generate,
    }),
    [ready, loading, error, settings, needsOnboarding, snapshot, delta, currentSavePath, updateSettings, refresh, generate]
  );

  return <DynastyContext.Provider value={value}>{children}</DynastyContext.Provider>;
}
