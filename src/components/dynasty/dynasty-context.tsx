"use client";

// Central client-side data provider for the standalone app. Replaces the Supabase
// server-component data flow: resolves the current save, diffs against the archived
// baseline, and exposes the snapshot/delta plus a generate() helper to every screen.
//
// It also owns the Weekly Issue engine (design Q3): generate() is cache-through, keyed
// by (dynasty, year, week, kind), so every screen's existing generate() call gets
// per-week caching for free — reopening a week spends no tokens. When a new week is
// ingested, the issue is written once in the background (default-on, toggleable).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  archiveSave,
  getDelta,
  getSnapshot,
  getRoster,
  listSaves,
  loadSettings,
  saveSettings,
  setLastIngested,
  getLastIngested,
  type DynastyProfile,
  type DynastySettings,
  type DynastySnapshot,
  type LlmConfig,
  type RosterPlayer,
  type WeekDelta,
} from "@/lib/dynasty/client";
import { generateInApp } from "@/lib/dynasty/gen";
import { loadSaga } from "@/lib/dynasty/saga-store";
import { enforceSuspensions, loadSuspensions, isActive, weeksLeft } from "@/lib/dynasty/suspensions";
import { buildSeasonRecord, upsertSeason } from "@/lib/dynasty/archive";
import { disburseWeekly } from "@/lib/dynasty/deals";
import {
  ISSUE_TABS,
  eagerTabs,
  isCacheable,
  cleanExtra,
  tabCacheKey,
} from "@/lib/dynasty/issue";
import {
  loadIssue,
  readTab,
  writeTab,
  type Issue,
} from "@/lib/dynasty/issue-cache";

export type IssueStatus =
  | "idle" // nothing written this week yet (on-demand mode, or pre-generation)
  | "generating" // the background pass is writing this week's issue
  | "partial" // some tabs written, some pending/failed
  | "ready" // every eager tab written
  | "error"; // the eager pass produced only failures

interface DynastyContextValue {
  ready: boolean;
  loading: boolean;
  error: string | null;
  settings: DynastySettings;
  needsOnboarding: boolean;
  /** True when a working provider is configured (Anthropic key, or OpenAI-compatible URL+key). */
  hasApiKey: boolean;
  snapshot: DynastySnapshot | null;
  delta: WeekDelta | null;
  /** The user team's parsed roster (with personalities + stat lines). */
  roster: RosterPlayer[];
  currentSavePath: string | null;
  /** Stable identity of the current dynasty/week — shared by the Saga (see use-saga.ts). */
  dynastyId: string;
  year: number;
  week: number;
  // ---- Multi-dynasty ----
  dynasties: DynastyProfile[];
  activeDynastyId: string | null;
  /** Add a dynasty from a picked save FILE and switch to it. Returns the new profile id. */
  addDynasty: (saveFile: string, opts?: { userTeam?: string; coachName?: string }) => Promise<string>;
  switchDynasty: (id: string) => Promise<void>;
  removeDynasty: (id: string) => Promise<void>;
  updateSettings: (patch: Partial<DynastySettings>) => Promise<void>;
  /** Re-ingest the save. Pass true to bypass the session warm-cache (full re-parse). */
  refresh: (force?: boolean) => Promise<void>;
  /**
   * Generate content for a screen (kind maps to ingest/gen/<kind>.js). Cache-through:
   * cacheable kinds are served from this week's issue when present, and written to it
   * on first generation. Pass opts.force to bypass the cache and rewrite.
   */
  generate: <T = unknown>(
    kind: string,
    extra?: Record<string, unknown>,
    opts?: { force?: boolean }
  ) => Promise<T>;
  // ---- Weekly Issue ----
  issue: Issue | null;
  issueStatus: IssueStatus;
  /** Write this week's full issue in the background (skips tabs already written). */
  generateIssue: () => Promise<void>;
  /** Force-rewrite this week's full issue (spends tokens). */
  regenerateIssue: () => Promise<void>;
}

const DynastyContext = createContext<DynastyContextValue | null>(null);

export function useDynasty() {
  const ctx = useContext(DynastyContext);
  if (!ctx) throw new Error("useDynasty must be used within DynastyProvider");
  return ctx;
}

const EMPTY_SETTINGS: DynastySettings = {
  dynasties: [],
  activeDynastyId: null,
  savesFolder: null,
  userTeam: null,
  coachName: null,
  anthropicKey: null,
  provider: null,
  openaiBaseUrl: null,
  openaiKey: null,
  openaiModel: null,
  openaiNoMaxTokens: null,
  hideRecruitOverall: null,
  consequenceSync: null,
  nilWriteToSave: null,
  podcastAudio: null,
  presserTakeover: null,
  budgetMode: null,
  elevenLabsKey: null,
  customVoices: null,
  autoGenerate: null,
  autoGenerateTabs: null,
};

/**
 * Resolve the file the app should actually read for a dynasty: the NEWEST member of that
 * dynasty's family (`<NAME>` and `<NAME>-AUTOSAVE`). The game writes the autosave on every
 * week advance, so following only the user's picked file froze the app on an old week.
 * Returns the picked file unchanged if the folder can't be listed.
 */
async function resolveLiveSave(picked: string): Promise<{ path: string; modified: number }> {
  const folder = picked.replace(/[\\/][^\\/]*$/, "");
  const name = picked.replace(/^.*[\\/]/, "");
  const stem = name.replace(/-AUTOSAVE$/i, "").toUpperCase();
  try {
    const saves = await listSaves(folder);
    const family = saves.filter((s) => {
      const n = s.name.toUpperCase();
      return n === stem || n === `${stem}-AUTOSAVE`;
    });
    if (family.length > 0) {
      const newest = family.reduce((a, b) => (b.modified > a.modified ? b : a));
      return { path: newest.path, modified: newest.modified };
    }
    const exact = saves.find((s) => s.name === name);
    if (exact) return { path: exact.path, modified: exact.modified };
  } catch {
    /* folder unreadable — fall back to the picked path */
  }
  return { path: picked, modified: 0 };
}

function sanitizeId(s: string): string {
  return (
    s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "current"
  );
}

// Status is measured against the tabs that actually auto-write (the user's section
// checkboxes / budget default) — otherwise a lean selection would read "partial" forever.
function computeStatus(issue: Issue | null, tabs: { kind: string }[] = ISSUE_TABS): IssueStatus {
  if (!issue) return "idle";
  const states = tabs.map((t) => issue.tabs[t.kind]?.status);
  if (states.some((s) => s === "generating")) return "generating";
  const ready = states.filter((s) => s === "ready").length;
  const errored = states.filter((s) => s === "error").length;
  if (tabs.length > 0 && ready === tabs.length) return "ready";
  if (ready > 0) return "partial";
  if (errored > 0) return "error";
  return "idle";
}

export function DynastyProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<DynastySettings>(EMPTY_SETTINGS);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<DynastySnapshot | null>(null);
  const [delta, setDelta] = useState<WeekDelta | null>(null);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [oppRoster, setOppRoster] = useState<RosterPlayer[]>([]);
  const [currentSavePath, setCurrentSavePath] = useState<string | null>(null);
  const [beforePath, setBeforePath] = useState<string | null>(null);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [issueStatus, setIssueStatus] = useState<IssueStatus>("idle");

  // Load persisted settings once on mount.
  useEffect(() => {
    loadSettings()
      .then((s) => setSettings(s))
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  // The active dynasty: the exact save FILE the user picked. Falls back to the first saved
  // dynasty if the active id is stale. Legacy single-save settings still work via the
  // fallbacks below until the user re-picks a file.
  const activeProfile = useMemo<DynastyProfile | null>(() => {
    const list = settings.dynasties ?? [];
    if (list.length === 0) return null;
    return list.find((d) => d.id === settings.activeDynastyId) ?? list[0];
  }, [settings.dynasties, settings.activeDynastyId]);

  const saveFile = activeProfile?.saveFile ?? null;
  const effTeam = activeProfile?.userTeam ?? settings.userTeam ?? null;
  const effCoach = activeProfile?.coachName ?? settings.coachName ?? null;

  // Resolve the LLM transport from settings: Anthropic by default, or any OpenAI-compatible
  // endpoint (base URL + key + model) when the user picked that provider.
  const llm = useMemo<LlmConfig | null>(() => {
    // Budget mode defaults ON (null = on): cheaper model + lean auto-write out of the box.
    const budgetMode = settings.budgetMode !== false;
    if (settings.provider === "openai") {
      if (settings.openaiKey && settings.openaiBaseUrl) {
        return {
          provider: "openai",
          apiKey: settings.openaiKey,
          baseUrl: settings.openaiBaseUrl,
          model: settings.openaiModel ?? undefined,
          noMaxTokens: settings.openaiNoMaxTokens === true,
          budgetMode,
        };
      }
      return null;
    }
    return settings.anthropicKey ? { provider: "anthropic", apiKey: settings.anthropicKey, budgetMode } : null;
  }, [settings.provider, settings.anthropicKey, settings.openaiKey, settings.openaiBaseUrl, settings.openaiModel, settings.openaiNoMaxTokens, settings.budgetMode]);
  const hasApiKey = llm != null;

  // Onboarding needs a picked save file + a working provider. Team auto-detects from the save.
  const needsOnboarding = ready && (!saveFile || !hasApiKey);

  // Stable identity of the current week's issue: (dynasty, year, week). Prefer the profile
  // id so the Saga/issue cache follow the dynasty even if the team name changes.
  const dynastyId = useMemo(
    () =>
      sanitizeId(
        activeProfile?.id ??
          effTeam ??
          snapshot?.userTeam?.name ??
          snapshot?.coachName ??
          "current"
      ),
    [activeProfile?.id, effTeam, snapshot?.userTeam?.name, snapshot?.coachName]
  );
  const year = snapshot?.year ?? snapshot?.dynastyYear ?? 0;
  const week = snapshot?.week ?? 0;
  // One in-game week has TWO editions: the pregame preview (before you play) and the postgame
  // issue (after). They must cache separately — with a shared key, the preview written before
  // kickoff was served back as "this week's issue" after the game, and the recap never wrote.
  // Postgame keeps the legacy key shape so issues cached by earlier builds still resolve.
  const isPregame = useMemo(() => {
    const row = snapshot?.userTeamRow;
    if (snapshot == null || row == null || snapshot.week == null) return false;
    const userGames = (snapshot.games ?? []).filter(
      (g) => g.homeRow === row || g.awayRow === row
    );
    const maxYear = userGames.reduce((m, g) => (g.year != null && g.year > m ? g.year : m), -1);
    const g = userGames.find(
      (x) => (x.year == null || maxYear < 0 || x.year === maxYear) && x.week === snapshot.week
    );
    return !!g && !g.played;
  }, [snapshot]);
  const currentIssueKey = snapshot?.userTeam
    ? `${dynastyId}::${year}::${week}${isPregame ? "::pre" : ""}`
    : null;

  // The nav uses hard page navigations (Tauri's asset protocol breaks Next client routing),
  // so this provider remounts on every tab switch. The session warm-cache makes those
  // remounts instant — but it is gated on the save file's MODIFIED TIME, never a timer, so a
  // week advance can never be served from cache.
  const warmKey = `dw.ingest.${dynastyId}`;

  const refresh = useCallback(async (force = false) => {
    if (!saveFile) return; // no dynasty picked yet

    // Follow the dynasty, not one frozen file. CFB27 writes "<NAME>-AUTOSAVE" every time you
    // advance a week, so a user who picked the manual save "<NAME>" would otherwise read a
    // stale week forever ("it doesn't update when I advance"). Read whichever member of this
    // dynasty's family is newest. Directory listing only — no parse — so this is cheap.
    const live = await resolveLiveSave(saveFile);
    const current = live.path;

    if (!force && typeof window !== "undefined") {
      try {
        const raw = sessionStorage.getItem(warmKey);
        if (raw) {
          const c = JSON.parse(raw) as {
            savePath: string; mtime: number; snapshot: DynastySnapshot;
            delta: WeekDelta | null; beforePath: string | null; roster?: RosterPlayer[];
            oppRoster?: RosterPlayer[];
          };
          // Same file AND unchanged on disk — otherwise fall through to a real re-ingest.
          if (c.savePath === current && c.mtime === live.modified && live.modified > 0 && c.snapshot) {
            setCurrentSavePath(current);
            setSnapshot(c.snapshot);
            setDelta(c.delta ?? null);
            setBeforePath(c.beforePath ?? null);
            if (Array.isArray(c.roster)) setRoster(c.roster);
            setOppRoster(Array.isArray(c.oppRoster) ? c.oppRoster : []);
            return;
          }
        }
      } catch { /* corrupt cache — fall through to a full ingest */ }
    }

    setLoading(true);
    setError(null);
    try {
      setCurrentSavePath(current);

      const snap = await getSnapshot(current, effTeam ?? undefined);
      setSnapshot(snap);

      // Per-dynasty baseline so switching dynasties never diffs across programs.
      const baseline = await getLastIngested(dynastyId);
      let d: WeekDelta | null = null;
      if (baseline && baseline !== current) {
        try {
          d = await getDelta(baseline, current, effTeam ?? undefined);
        } catch {
          d = null;
        }
      }
      setDelta(d);
      const folder = current.replace(/[\\/][^\\/]*$/, "");
      const archived = await archiveSave(current, `${folder}/.dynastywire`, `${dynastyId}-week-${snap.week ?? "x"}`);
      const before = baseline ?? archived;
      setBeforePath(before);
      await setLastIngested(archived, dynastyId);

      const writeWarm = (roster?: RosterPlayer[], oppRoster?: RosterPlayer[]) => {
        try {
          sessionStorage.setItem(
            warmKey,
            JSON.stringify({ savePath: current, mtime: live.modified, snapshot: snap, delta: d, beforePath: before, roster, oppRoster })
          );
        } catch { /* quota — skip */ }
      };
      writeWarm();

      // This week's opponent (played result first, else the next scheduled game) — their
      // REAL roster feeds generation so opposing names come from the save, never invented.
      const oppTeamIndex = (() => {
        const row = snap.userTeamRow;
        if (row == null) return null;
        const oppName = d?.userResult
          ? (d.userResult.home === snap.userTeam?.name ? d.userResult.away : d.userResult.home)
          : null;
        if (oppName) {
          const hit = Object.values(snap.teams ?? {}).find((t) => t.name === oppName);
          if (hit?.teamIndex != null) return hit.teamIndex;
        }
        const next = (snap.games ?? [])
          .filter((g) => (g.homeRow === row || g.awayRow === row) && !g.played)
          .sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || (a.week ?? 0) - (b.week ?? 0))[0];
        if (!next) return null;
        const oppRow = next.homeRow === row ? next.awayRow : next.homeRow;
        return oppRow != null ? snap.teams?.[String(oppRow)]?.teamIndex ?? null : null;
      })();

      // Roster is only needed for player-specific generation (situations, awards, NIL), so
      // fetch it in the background — it never blocks the front page, and it's cached per
      // save-state after the first read. Folded into the warm cache once it lands.
      getRoster(current, effTeam ?? snap.userTeam?.name ?? undefined)
        .then(async (r) => {
          setRoster(r);
          writeWarm(r);
          if (oppTeamIndex != null) {
            try {
              const opp = await getRoster(current, undefined, oppTeamIndex);
              setOppRoster(opp);
              writeWarm(r, opp);
            } catch {
              setOppRoster([]);
            }
          } else {
            setOppRoster([]);
          }
        })
        .catch(() => setRoster([]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [saveFile, effTeam, dynastyId, warmKey]);

  // Auto-refresh once settings are complete.
  useEffect(() => {
    if (!needsOnboarding) refresh();
  }, [needsOnboarding, refresh]);

  // Suspension enforcement: after every ingest, reconcile active suspensions against the
  // save — apply the temporary OVR drop for players still serving, restore the original
  // rating for those who've served. A locked save (game running) just retries next ingest.
  useEffect(() => {
    const ti = snapshot?.userTeam?.teamIndex;
    if (!currentSavePath || ti == null) return;
    void enforceSuspensions(
      dynastyId, currentSavePath, ti, year, week, snapshot?.dynastyYear ?? null
    ).catch(() => {});
    // Brand deals pay their weekly slice here — once per in-game week, idempotent, and only
    // when NIL-to-save is on. This is what makes a "500 over 10 weeks" deal actually arrive
    // over ten weeks instead of landing in a lump the moment it's signed.
    if (settings.nilWriteToSave !== false) {
      void disburseWeekly(dynastyId, currentSavePath, ti, year, week).catch(() => {});
    }
  }, [dynastyId, currentSavePath, snapshot, year, week, settings.nilWriteToSave]);

  // Season Archive checkpoint: continuously upsert THIS season's record (record, stat lines,
  // games, leaders, storyline ledger) keyed by year. Idempotent, so by the time a new season
  // starts, last year's final record is already saved — that's the durable multi-year memory
  // the save itself doesn't keep. Runs off the parsed snapshot; no API cost, no save writes.
  useEffect(() => {
    if (!snapshot?.userTeam || year <= 0) return;
    let cancelled = false;
    (async () => {
      const ledger = await loadSaga(dynastyId).then((s) => s?.ledger ?? []).catch(() => []);
      if (cancelled) return;
      const record = buildSeasonRecord(snapshot, roster, ledger, dynastyId);
      if (record) await upsertSeason(record).catch(() => {});
    })();
    return () => { cancelled = true; };
    // Rebuild when the record could have changed: new result, new roster data, new week.
  }, [dynastyId, year, week, snapshot, roster]);

  // Watch-folder auto-sync: when the game overwrites the dynasty autosave, the Rust
  // watcher emits `dynasty-saved` and we re-ingest automatically. (The wow feature.)
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (!saveFile) return;
    const folder = saveFile.replace(/[\\/][^\\/]*$/, "");
    let unlisten: (() => void) | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    invoke("start_watch", { folder }).catch(() => {});
    // Only re-ingest when the CHANGE is to the active dynasty's file — ignore other saves /
    // autosaves in the same folder so switching dynasties stays clean.
    // Match the whole dynasty family, not one filename: a week advance writes
    // "<NAME>-AUTOSAVE", which an exact-name check ignored — that was the "it never updates"
    // bug. Either member firing means this dynasty moved.
    const stem = saveFile.replace(/^.*[\\/]/, "").replace(/-AUTOSAVE$/i, "").toUpperCase();
    listen<string>("dynasty-saved", (evt) => {
      const changed =
        typeof evt.payload === "string" ? evt.payload.replace(/^.*[\\/]/, "").toUpperCase() : "";
      if (!changed || changed === stem || changed === `${stem}-AUTOSAVE`) {
        // DEBOUNCE: the game writes the ~10MB save in bursts (and autosaves periodically), so a
        // single save fires many FS events. Re-parsing on each one pins the CPU and lags the app.
        // Coalesce the burst into ONE full re-parse ~2.5s after the writes settle.
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          debounce = undefined;
          refreshRef.current(true); // real change → full re-parse
        }, 2500);
      }
    })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => {
      if (debounce) clearTimeout(debounce);
      if (unlisten) unlisten();
    };
  }, [saveFile]);

  const updateSettings = useCallback(async (patch: Partial<DynastySettings>) => {
    setSettings((prev) => {
      const merged = { ...prev, ...patch };
      let updatedDynasties = false;
      if (patch.userTeam !== undefined || patch.coachName !== undefined) {
        if (merged.activeDynastyId && merged.dynasties) {
          merged.dynasties = merged.dynasties.map(d => {
            if (d.id === merged.activeDynastyId) {
              updatedDynasties = true;
              return { 
                ...d, 
                userTeam: patch.userTeam !== undefined ? (patch.userTeam || null) : d.userTeam,
                coachName: patch.coachName !== undefined ? (patch.coachName || null) : d.coachName
              };
            }
            return d;
          });
        }
      }
      void saveSettings(updatedDynasties ? { ...patch, dynasties: merged.dynasties } : patch);
      return merged;
    });
  }, []);

  // ---- Multi-dynasty management ----

  const addDynasty = useCallback(
    async (file: string, opts?: { userTeam?: string; coachName?: string }): Promise<string> => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `dyn-${Date.now()}`;
      const base = file.replace(/^.*[\\/]/, "").replace(/^DYNASTY-/i, "");
      const label = opts?.userTeam ? `${base} — ${opts.userTeam}` : base;
      const profile: DynastyProfile = {
        id,
        label,
        saveFile: file,
        userTeam: opts?.userTeam ?? null,
        coachName: opts?.coachName ?? null,
      };
      setSettings((prev) => {
        const dynasties = [...(prev.dynasties ?? []), profile];
        void saveSettings({ dynasties, activeDynastyId: id });
        return { ...prev, dynasties, activeDynastyId: id };
      });
      return id;
    },
    []
  );

  const switchDynasty = useCallback(async (id: string) => {
    // Clear the current view so the switch reads clean, then re-ingest via the effect.
    setSnapshot(null);
    setDelta(null);
    setRoster([]);
    setError(null);
    await updateSettings({ activeDynastyId: id });
  }, [updateSettings]);

  const removeDynasty = useCallback(async (id: string) => {
    setSettings((prev) => {
      const dynasties = (prev.dynasties ?? []).filter((d) => d.id !== id);
      const activeDynastyId =
        prev.activeDynastyId === id ? (dynasties[0]?.id ?? null) : prev.activeDynastyId;
      void saveSettings({ dynasties, activeDynastyId });
      return { ...prev, dynasties, activeDynastyId };
    });
  }, []);

  // De-dupe concurrent generate() calls for the same tab (e.g. a page mounting while
  // the background issue pass is running) so the user is never charged twice.
  const inflight = useRef<Map<string, Promise<unknown>>>(new Map());

  const generate = useCallback(
    async <T,>(
      kind: string,
      extra?: Record<string, unknown>,
      opts?: { force?: boolean }
    ): Promise<T> => {
      if (!currentSavePath || !llm || !snapshot) {
        throw new Error("Not ready to generate (missing save or API key).");
      }
      const cacheable = !!currentIssueKey && isCacheable(kind);
      const tKey = tabCacheKey(kind, extra);
      const force = opts?.force === true;

      if (cacheable && !force) {
        const cached = await readTab<T>(currentIssueKey!, tKey);
        if (cached?.status === "ready" && cached.data != null) return cached.data;
      }

      const flightKey = `${currentIssueKey ?? currentSavePath}::${tKey}`;
      if (!force) {
        const existing = inflight.current.get(flightKey);
        if (existing) return existing as Promise<T>;
      }

      const run = (async () => {
        // The coach's persistent backstory (saga) rides along as context for every kind, so
        // recaps/social/situations stay consistent with who this coach is. LazyStore caches
        // the read, so this is cheap per call.
        const backstory = await loadSaga(dynastyId)
          .then((s) => s?.backstory ?? null)
          .catch(() => null);
        // Active suspensions ride into EVERY generator: the save carries a temporary 40 OVR
        // for suspended players (that's what benches them), so the context must restore
        // their real rating and state the suspension as fact — otherwise the media universe
        // hallucinates a star who "collapsed to 40 overall".
        const suspensions = await loadSuspensions(dynastyId)
          .then((list) =>
            list
              .filter((s) => isActive(s, year, week))
              .map((s) => ({
                playerName: s.playerName,
                position: s.position ?? null,
                reason: s.reason,
                source: s.source,
                weeksLeft: weeksLeft(s, year, week),
                originalOverall: s.originalOverall,
              }))
          )
          .catch(() => []);
        // In-app generation: no sidecar spawn. Built from the already-parsed snapshot/delta.
        const data = await generateInApp<T>(kind, llm, snapshot, delta, {
          team: settings.userTeam ?? undefined,
          coach: settings.coachName ?? undefined,
          extra: cleanExtra(extra),
          roster,
          oppRoster,
          backstory,
          suspensions,
        });
        // Don't cache a generator's own error payload — let the next visit retry.
        const isErr = !!(
          data &&
          typeof data === "object" &&
          (data as Record<string, unknown>).error
        );
        if (cacheable && !isErr) {
          await writeTab(
            currentIssueKey!,
            tKey,
            { status: "ready", data, error: null, generatedAt: Date.now() },
            { dynastyId, year, week }
          );
        }
        return data;
      })();

      inflight.current.set(flightKey, run);
      try {
        return await run;
      } finally {
        inflight.current.delete(flightKey);
      }
    },
    [
      currentSavePath,
      snapshot,
      delta,
      roster,
      oppRoster,
      currentIssueKey,
      dynastyId,
      year,
      week,
      llm,
      settings.userTeam,
      settings.coachName,
    ]
  );

  const generateRef = useRef(generate);
  useEffect(() => {
    generateRef.current = generate;
  }, [generate]);

  // The eager background pass: write each issue tab once, in order, updating progress
  // as it goes. Skips tabs already written unless forced.
  const runIssue = useCallback(
    async (force: boolean) => {
      if (!currentIssueKey || !hasApiKey) return;
      setIssueStatus("generating");
      // Cost control: the eager pass writes only the sections the user selected (or the
      // default set — the core trio in budget mode, everything otherwise). Sections not in
      // the list stay lazy — generated only when the user actually opens that tab. This is
      // the single biggest lever on the per-week API spend that was blowing through budgets.
      const eager = eagerTabs(settings);
      for (const tab of eager) {
        const existing = await readTab(currentIssueKey, tab.kind);
        if (!force && existing?.status === "ready") continue;
        const seeded = await writeTab(
          currentIssueKey,
          tab.kind,
          { status: "generating", data: null, error: null, generatedAt: null },
          { dynastyId, year, week }
        );
        setIssue({ ...seeded });
        try {
          const data = await generateRef.current(tab.kind, {}, { force });
          // generate() caches successes but deliberately not error payloads — resolve
          // the seeded "generating" placeholder so status doesn't hang on this tab.
          const isErr = !!(
            data &&
            typeof data === "object" &&
            (data as Record<string, unknown>).error
          );
          if (isErr) {
            await writeTab(
              currentIssueKey,
              tab.kind,
              {
                status: "error",
                data: null,
                error: "The generator returned an error.",
                generatedAt: Date.now(),
              },
              { dynastyId, year, week }
            );
          }
        } catch (e) {
          await writeTab(
            currentIssueKey,
            tab.kind,
            {
              status: "error",
              data: null,
              error: e instanceof Error ? e.message : String(e),
              generatedAt: Date.now(),
            },
            { dynastyId, year, week }
          );
        }
        const cur = await loadIssue(currentIssueKey);
        if (cur) setIssue({ ...cur });
      }
      const final = await loadIssue(currentIssueKey);
      setIssue(final ? { ...final } : null);
      setIssueStatus(computeStatus(final, eager));
    },
    [currentIssueKey, dynastyId, year, week, hasApiKey, settings]
  );

  const runIssueRef = useRef(runIssue);
  useEffect(() => {
    runIssueRef.current = runIssue;
  }, [runIssue]);

  const generateIssue = useCallback(() => runIssueRef.current(false), []);
  const regenerateIssue = useCallback(() => runIssueRef.current(true), []);

  // When a new week is ingested: load its cached issue (instant, no tokens). If it isn't
  // complete and auto-generate is on (default), kick the background pass once.
  useEffect(() => {
    if (!currentIssueKey || !hasApiKey) {
      setIssue(null);
      setIssueStatus("idle");
      return;
    }
    let cancelled = false;
    (async () => {
      const cached = await loadIssue(currentIssueKey);
      if (cancelled) return;
      setIssue(cached);
      setIssueStatus(computeStatus(cached, eagerTabs(settings)));
      const auto = settings.autoGenerate !== false; // default-on
      // "Complete" is measured against the sections that actually auto-write (the user's
      // checkboxes, or the default set) — otherwise auto-write would re-fire forever
      // chasing lazy tabs.
      const eager = eagerTabs(settings);
      const complete =
        !!cached && eager.every((t) => cached.tabs[t.kind]?.status === "ready");
      if (auto && !complete) void runIssueRef.current(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [currentIssueKey, settings, hasApiKey]);

  const value = useMemo<DynastyContextValue>(
    () => ({
      ready,
      loading,
      error,
      settings,
      needsOnboarding,
      hasApiKey,
      snapshot,
      delta,
      roster,
      currentSavePath,
      dynastyId,
      year,
      week,
      dynasties: settings.dynasties ?? [],
      activeDynastyId: activeProfile?.id ?? settings.activeDynastyId ?? null,
      addDynasty,
      switchDynasty,
      removeDynasty,
      updateSettings,
      refresh,
      generate,
      issue,
      issueStatus,
      generateIssue,
      regenerateIssue,
    }),
    [
      ready,
      loading,
      error,
      settings,
      needsOnboarding,
      hasApiKey,
      snapshot,
      delta,
      roster,
      currentSavePath,
      dynastyId,
      year,
      week,
      activeProfile,
      addDynasty,
      switchDynasty,
      removeDynasty,
      updateSettings,
      refresh,
      generate,
      issue,
      issueStatus,
      generateIssue,
      regenerateIssue,
    ]
  );

  return <DynastyContext.Provider value={value}>{children}</DynastyContext.Provider>;
}
