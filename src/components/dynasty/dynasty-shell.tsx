"use client";

// Client shell for the standalone app: wraps the dynasty screens in the DynastyProvider,
// derives the existing SettingsProvider inputs from the parsed snapshot (so child screens
// that use useSettings() keep working), renders the chrome, and gates on first-run setup.

import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { openaiListModels } from "@/lib/dynasty/client";
import { DynastyProvider, useDynasty } from "./dynasty-context";
import { useIssueTab } from "./use-issue-tab";
import { SettingsProvider } from "@/components/settings/settings-context";
import Masthead from "@/components/masthead";
import NavBar from "@/components/navbar";
import BreakingTicker from "@/components/breaking-ticker";
import SettingsDrawer from "@/components/settings/settings-drawer";
import IssueLoadingOverlay from "./issue-loading";
import PresserOverlay from "@/components/press-conference/presser-overlay";
import UpdateGate from "@/components/dynasty/update-gate";
import { TutorialProvider } from "@/components/tutorial/tutorial-context";
import TutorialWizard from "@/components/tutorial/tutorial-wizard";
import { useTeamTheme } from "./use-team-theme";

const UNIVERSE_ITEMS = [
  "SOURCES: Three Power Four programs quietly pursuing the same 5-star QB prospect.",
  "Inside the portal: 30+ starters have entered since Monday. The reshuffling has begun.",
  "Coaching carousel heating up — two ADs confirmed to be making calls this week.",
  "CFP committee: 'Strength of schedule will matter more than ever in the final rankings.'",
  "NIL collective arms race: which conferences are actually winning the money battle.",
  "Analyst: 'The team that wins the portal window wins the national title. Period.'",
];

function buildTicker(
  school: string,
  record: string,
  rank: number | null,
  wire?: { category: string; school: string; headline: string }[] | null
): string[] {
  const items = [
    rank ? `#${rank} ${school} sits at ${record} on the season.` : `${school} sits at ${record} on the season.`,
  ];
  // Real around-the-league items from this week's national wire, when written.
  if (wire && wire.length > 0) {
    for (const w of wire.slice(0, 12)) {
      items.push(`${(w.category || "wire").toUpperCase()}: ${w.headline}`);
    }
    return items;
  }
  const seed = school.length % UNIVERSE_ITEMS.length;
  for (let i = 0; i < 4; i++) items.push(UNIVERSE_ITEMS[(seed + i) % UNIVERSE_ITEMS.length]);
  return items;
}

interface WireItem {
  category: string;
  school: string;
  headline: string;
  blurb?: string;
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const { ready, needsOnboarding, snapshot, loading, error, generate, hasApiKey, settings } = useDynasty();
  // The app wears the user's program. On by default; Settings -> Immersion turns it off, and
  // a team whose only colours are neutrals keeps the house crimson.
  useTeamTheme(snapshot, settings.teamColors !== false);
  // This week's around-the-league items (written by the weekly issue pass) drive the
  // breaking ticker so the whole country feels alive — falls back to evergreen lines
  // until the national desk files.
  const nationalWire = useIssueTab<{ items: WireItem[] }>("national-wire");
  const [lazyWire, setLazyWire] = useState<WireItem[] | null>(null);
  const wireRequested = useRef(false);

  // Guarantee the ticker populates even with auto-generate off: if this week's wire hasn't
  // been written, request it once in the background. generate() is cache-through + de-duped,
  // so this never double-charges against the weekly issue pass.
  useEffect(() => {
    if (wireRequested.current || nationalWire?.items?.length || !hasApiKey || !snapshot?.userTeam) return;
    wireRequested.current = true;
    generate<{ items: WireItem[]; error?: boolean }>("national-wire", {})
      .then((d) => {
        if (!d?.error && Array.isArray(d?.items) && d.items.length) setLazyWire(d.items);
      })
      .catch(() => {});
  }, [nationalWire, hasApiKey, snapshot?.userTeam, generate]);

  const wireItems = nationalWire?.items?.length ? nationalWire.items : lazyWire;

  if (!ready) return <FullScreen>Loading…</FullScreen>;
  if (needsOnboarding) return <Onboarding />;
  if (loading && !snapshot) return <FullScreen>Reading your dynasty…</FullScreen>;
  if (error && !snapshot) return <FullScreen>Couldn&apos;t read the save: {error}</FullScreen>;
  if (!snapshot?.userTeam) return <FullScreen>No dynasty data yet. {error ?? ""}</FullScreen>;

  const u = snapshot.userTeam;
  const record = `${u.wins}-${u.losses}`;
  const dynastyInfo = {
    id: "current",
    school: u.name,
    conference: "", // conference not yet mapped from the save
    coachName: snapshot.coachName || "Head Coach",
    prestige: u.prestige != null ? String(u.prestige) : "",
  };
  const seasonInfo = {
    id: "current",
    year: 0,
    currentWeek: snapshot.week ?? 0,
    record: { wins: u.wins, losses: u.losses },
  };

  return (
    <SettingsProvider dynasty={dynastyInfo} initialSeason={seasonInfo}>
      <TutorialProvider>
        <DynastySwitcher />
        <Masthead
          // RTG turns it into a different publication entirely — RoadWire, covering one kid.
          rtg={
            snapshot?.mode === "rtg" && snapshot.player
              ? {
                  playerName: snapshot.player.name,
                  stars: snapshot.player.prospectStars,
                  homeState: snapshot.player.homeState,
                  position: snapshot.player.position,
                  classYear: snapshot.player.classYear,
                }
              : null
          }
          school={u.name}
          coachName={dynastyInfo.coachName}
          fanSentiment={null}
          hotSeatLevel={null}
          seasonMomentum={null}
          lastResult={null}
          record={{ wins: u.wins, losses: u.losses }}
        />
        <NavBar dynastyId="current" />
        <BreakingTicker items={buildTicker(u.name, record, u.rankMedia, wireItems)} />
        <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
        <SettingsDrawer />
        <IssueLoadingOverlay />
        {/* The podium takes over the screen when a game week lands — see presser-overlay.
            DYNASTY ONLY. It is the COACH's press conference: it addresses "Coach <name>",
            asks about his game plan and his program, and writes to the coach's saga meters.
            Fired on a Road to Glory save it put a head coach's presser in front of a
            nineteen-year-old backup — reported from a real save. RTG has its own podium at
            /his-podium and must never see this one. */}
        {snapshot?.mode !== "rtg" && <PresserOverlay />}
        {/* Self-update prompt. Corner toast, always declinable — never interrupts a week. */}
        <UpdateGate />
        <TutorialWizard />
      </TutorialProvider>
    </SettingsProvider>
  );
}

// Thin top bar to switch between saved dynasties or add another from a picked save file.
function DynastySwitcher() {
  const { dynasties, activeDynastyId, switchDynasty, addDynasty, loading } = useDynasty();
  const [open_, setOpen] = useState(false);
  if (!dynasties || dynasties.length === 0) return null;
  const active = dynasties.find((d) => d.id === activeDynastyId) ?? dynasties[0];

  async function addAnother() {
    const file = await open({ directory: false, multiple: false, title: "Select another dynasty save file" });
    if (typeof file === "string") await addDynasty(file);
    setOpen(false);
  }

  return (
    <div className="w-full bg-paper2 border-b border-dw-border">
      <div className="max-w-7xl mx-auto px-4 py-1.5 flex items-center justify-between">
        <span className="font-sans text-[10px] uppercase tracking-widest text-ink3">Dynasty</span>
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 font-sans text-xs text-ink hover:text-dw-accent"
          >
            <span className="max-w-[16rem] truncate">{active?.label ?? "Current"}</span>
            <span className="text-ink3">{loading ? "•••" : "▾"}</span>
          </button>
          {open_ && (
            <div className="absolute right-0 z-50 mt-1 w-64 rounded border border-dw-border bg-paper shadow-2xl">
              {/* TWO LISTS, not one (DESIGN-rtg-mode.md decision 9). A dynasty and a Road to
                  Glory career are different products sharing a binary, and mixing them in one
                  flat list is where "it feels like its own thing" quietly dies. Mode is
                  detected from the save, so nothing here has to be chosen by the user. */}
              {([
                { key: "dynasty", head: "Dynasties", items: dynasties.filter((d) => (d.mode ?? "dynasty") !== "rtg") },
                { key: "rtg", head: "Road to Glory", items: dynasties.filter((d) => d.mode === "rtg") },
              ] as const)
                .filter((g) => g.items.length > 0)
                .map((g) => (
                  <div key={g.key} className="border-b border-dw-border last:border-b-0">
                    <p className="px-3 pt-2 pb-1 font-sans text-[9px] uppercase tracking-[0.25em] text-ink3">
                      {g.head}
                    </p>
                    {g.items.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (d.id !== active?.id) void switchDynasty(d.id);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-left font-serif text-sm hover:bg-paper2",
                    d.id === active?.id ? "text-dw-accent" : "text-ink"
                  )}
                >
                  {/* An RTG career is identified by WHO, not by which school. */}
                  <span className="truncate">{d.mode === "rtg" && d.playerName ? d.playerName : d.label}</span>
                  {d.id === active?.id && <span className="text-[10px] uppercase tracking-wider text-dw-accent">Active</span>}
                </button>
                    ))}
                  </div>
                ))}
              <button
                type="button"
                onClick={addAnother}
                className="flex w-full items-center gap-2 border-t border-dw-border px-3 py-2 text-left font-sans text-xs uppercase tracking-wider text-ink3 hover:bg-paper2 hover:text-dw-accent"
              >
                + Add a dynasty
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center text-center px-6 text-lg opacity-80">
      {children}
    </div>
  );
}

function Onboarding() {
  const { settings, updateSettings, addDynasty } = useDynasty();
  const [saveFile, setSaveFile] = useState("");
  const [userTeam, setUserTeam] = useState(settings.userTeam ?? "");
  const [coachName, setCoachName] = useState(settings.coachName ?? "");
  const [provider, setProvider] = useState<"anthropic" | "openai">(settings.provider ?? "anthropic");
  const [anthropicKey, setKey] = useState(settings.anthropicKey ?? "");
  const [oaiUrl, setOaiUrl] = useState(settings.openaiBaseUrl ?? "");
  const [oaiKey, setOaiKey] = useState(settings.openaiKey ?? "");
  const [oaiModel, setOaiModel] = useState(settings.openaiModel ?? "");
  const [models, setModels] = useState<string[] | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);

  async function fetchModels() {
    if (!oaiUrl.trim() || !oaiKey.trim() || fetchingModels) return;
    setFetchingModels(true);
    try {
      setModels(await openaiListModels(oaiUrl.trim(), oaiKey.trim()));
    } catch {
      setModels(null);
    } finally {
      setFetchingModels(false);
    }
  }

  async function pickFile() {
    // CFB27 saves have no file extension (e.g. DYNASTY-SKISWORLD), so no filter.
    const file = await open({
      directory: false,
      multiple: false,
      title: "Select your dynasty SAVE FILE (e.g. DYNASTY-…)",
    });
    if (typeof file === "string") setSaveFile(file);
  }
  async function finish() {
    // Save the (global) provider config first, then create the dynasty from the picked file.
    await updateSettings({
      provider,
      anthropicKey: anthropicKey.trim() || null,
      openaiBaseUrl: oaiUrl.trim() || null,
      openaiKey: oaiKey.trim() || null,
      openaiModel: oaiModel.trim() || null,
    });
    await addDynasty(saveFile, {
      userTeam: userTeam.trim() || undefined,
      coachName: coachName.trim() || undefined,
    });
  }
  const fileName = saveFile.replace(/^.*[\\/]/, "");
  const canFinish =
    saveFile && (provider === "anthropic" ? !!anthropicKey.trim() : !!(oaiKey.trim() && oaiUrl.trim()));

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md space-y-5">
        <h1 className="font-headline text-3xl">Set up Dynasty Wire</h1>
        <p className="opacity-70 text-sm">Pick the exact dynasty save file you want covered, add your Anthropic key. Nothing leaves your machine. You can add more dynasties later.</p>

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide opacity-70">Dynasty save file</span>
          <div className="flex gap-2">
            <input className="flex-1 bg-black/30 border border-white/15 rounded px-3 py-2 text-sm" value={fileName} readOnly placeholder="DYNASTY-… (pick the file, not the folder)" />
            <button className="px-3 py-2 border border-white/20 rounded text-sm" onClick={pickFile}>Browse</button>
          </div>
          {saveFile && <span className="block text-[11px] opacity-50 truncate">{saveFile}</span>}
        </label>

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide opacity-70">Your team (optional — auto-detected)</span>
          <input className="w-full bg-black/30 border border-white/15 rounded px-3 py-2 text-sm" value={userTeam} onChange={(e) => setUserTeam(e.target.value)} placeholder="Kansas State" />
        </label>

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide opacity-70">Coach name (optional)</span>
          <input className="w-full bg-black/30 border border-white/15 rounded px-3 py-2 text-sm" value={coachName} onChange={(e) => setCoachName(e.target.value)} placeholder="Coach Prime" />
        </label>

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide opacity-70">AI provider</span>
          <select
            className="w-full bg-black/30 border border-white/15 rounded px-3 py-2 text-sm"
            value={provider}
            onChange={(e) => setProvider(e.target.value as "anthropic" | "openai")}
          >
            <option value="anthropic">Claude (Anthropic)</option>
            <option value="openai">OpenAI-compatible (any provider / local)</option>
          </select>
        </label>

        {provider === "anthropic" ? (
          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wide opacity-70">Anthropic API key</span>
            <input type="password" className="w-full bg-black/30 border border-white/15 rounded px-3 py-2 text-sm" value={anthropicKey} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
          </label>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide opacity-70">API base URL (v1 endpoint)</span>
              <input className="w-full bg-black/30 border border-white/15 rounded px-3 py-2 text-sm" value={oaiUrl} onChange={(e) => setOaiUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide opacity-70">API key</span>
              <input type="password" className="w-full bg-black/30 border border-white/15 rounded px-3 py-2 text-sm" value={oaiKey} onChange={(e) => setOaiKey(e.target.value)} placeholder="sk-…" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs uppercase tracking-wide opacity-70">Model name</span>
              <div className="flex gap-2">
                <input className="flex-1 bg-black/30 border border-white/15 rounded px-3 py-2 text-sm" value={oaiModel} onChange={(e) => setOaiModel(e.target.value)} placeholder="gpt-4o-mini" />
                <button
                  type="button"
                  onClick={() => void fetchModels()}
                  disabled={fetchingModels || !oaiUrl.trim() || !oaiKey.trim()}
                  className="px-3 py-2 border border-white/20 rounded text-xs disabled:opacity-40"
                >
                  {fetchingModels ? "…" : "Fetch models"}
                </button>
              </div>
              {models && models.length > 0 && (
                <select
                  className="w-full bg-black/30 border border-white/15 rounded px-3 py-2 text-sm"
                  value={models.includes(oaiModel) ? oaiModel : ""}
                  onChange={(e) => { if (e.target.value) setOaiModel(e.target.value); }}
                >
                  <option value="">— pick from {models.length} available —</option>
                  {models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              )}
            </label>
          </>
        )}

        <button
          disabled={!canFinish}
          onClick={finish}
          className="w-full py-2.5 rounded bg-dw-crimson disabled:opacity-40 font-medium"
        >
          Enter the Wire
        </button>
      </div>
    </div>
  );
}

export default function DynastyShell({ children }: { children: React.ReactNode }) {
  return (
    <DynastyProvider>
      <ShellInner>{children}</ShellInner>
    </DynastyProvider>
  );
}
