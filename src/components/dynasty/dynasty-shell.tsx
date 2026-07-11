"use client";

// Client shell for the standalone app: wraps the dynasty screens in the DynastyProvider,
// derives the existing SettingsProvider inputs from the parsed snapshot (so child screens
// that use useSettings() keep working), renders the chrome, and gates on first-run setup.

import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { DynastyProvider, useDynasty } from "./dynasty-context";
import { SettingsProvider } from "@/components/settings/settings-context";
import Masthead from "@/components/masthead";
import NavBar from "@/components/navbar";
import BreakingTicker from "@/components/breaking-ticker";
import SettingsDrawer from "@/components/settings/settings-drawer";
import { TutorialProvider } from "@/components/tutorial/tutorial-context";
import TutorialWizard from "@/components/tutorial/tutorial-wizard";

const UNIVERSE_ITEMS = [
  "SOURCES: Three Power Four programs quietly pursuing the same 5-star QB prospect.",
  "Inside the portal: 30+ starters have entered since Monday. The reshuffling has begun.",
  "Coaching carousel heating up — two ADs confirmed to be making calls this week.",
  "CFP committee: 'Strength of schedule will matter more than ever in the final rankings.'",
  "NIL collective arms race: which conferences are actually winning the money battle.",
  "Analyst: 'The team that wins the portal window wins the national title. Period.'",
];

function buildTicker(school: string, record: string, rank: number | null): string[] {
  const items = [
    rank ? `#${rank} ${school} sits at ${record} on the season.` : `${school} sits at ${record} on the season.`,
  ];
  const seed = school.length % UNIVERSE_ITEMS.length;
  for (let i = 0; i < 4; i++) items.push(UNIVERSE_ITEMS[(seed + i) % UNIVERSE_ITEMS.length]);
  return items;
}

function ShellInner({ children }: { children: React.ReactNode }) {
  const { ready, needsOnboarding, snapshot, loading, error } = useDynasty();

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
        <Masthead
          school={u.name}
          coachName={dynastyInfo.coachName}
          fanSentiment={null}
          hotSeatLevel={null}
          seasonMomentum={null}
          lastResult={null}
          record={{ wins: u.wins, losses: u.losses }}
        />
        <NavBar dynastyId="current" />
        <BreakingTicker items={buildTicker(u.name, record, u.rankMedia)} />
        <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
        <SettingsDrawer />
        <TutorialWizard />
      </TutorialProvider>
    </SettingsProvider>
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
  const { settings, updateSettings } = useDynasty();
  const [savesFolder, setSavesFolder] = useState(settings.savesFolder ?? "");
  const [userTeam, setUserTeam] = useState(settings.userTeam ?? "");
  const [coachName, setCoachName] = useState(settings.coachName ?? "");
  const [anthropicKey, setKey] = useState(settings.anthropicKey ?? "");

  async function pickFolder() {
    const dir = await open({ directory: true, title: "Select your CFB27 saves folder" });
    if (typeof dir === "string") setSavesFolder(dir);
  }
  async function finish() {
    await updateSettings({ savesFolder, userTeam, coachName, anthropicKey });
  }
  const canFinish = savesFolder && userTeam && anthropicKey;

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md space-y-5">
        <h1 className="font-headline text-3xl">Set up Dynasty Wire</h1>
        <p className="opacity-70 text-sm">Point it at your save, name your program, add your Anthropic key. Nothing leaves your machine.</p>

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide opacity-70">CFB27 saves folder</span>
          <div className="flex gap-2">
            <input className="flex-1 bg-black/30 border border-white/15 rounded px-3 py-2 text-sm" value={savesFolder} readOnly placeholder="…/EA SPORTS College Football 27/saves" />
            <button className="px-3 py-2 border border-white/20 rounded text-sm" onClick={pickFolder}>Browse</button>
          </div>
        </label>

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide opacity-70">Your team</span>
          <input className="w-full bg-black/30 border border-white/15 rounded px-3 py-2 text-sm" value={userTeam} onChange={(e) => setUserTeam(e.target.value)} placeholder="Kansas State" />
        </label>

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide opacity-70">Coach name (optional)</span>
          <input className="w-full bg-black/30 border border-white/15 rounded px-3 py-2 text-sm" value={coachName} onChange={(e) => setCoachName(e.target.value)} placeholder="Coach Prime" />
        </label>

        <label className="block space-y-1">
          <span className="text-xs uppercase tracking-wide opacity-70">Anthropic API key</span>
          <input type="password" className="w-full bg-black/30 border border-white/15 rounded px-3 py-2 text-sm" value={anthropicKey} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
        </label>

        <button
          disabled={!canFinish}
          onClick={finish}
          className="w-full py-2.5 rounded bg-[#b5202a] disabled:opacity-40 font-medium"
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
