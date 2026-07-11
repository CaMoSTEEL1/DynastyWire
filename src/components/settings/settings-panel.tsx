"use client";

// Standalone settings: save folder, team/coach, and BYO API keys — all local, no server.
// Replaces the old Supabase season-transition settings.

import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ChevronDown, ChevronUp, School, FolderOpen, KeyRound, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettings } from "./settings-context";
import { useDynasty } from "@/components/dynasty/dynasty-context";

function Section({
  icon: Icon,
  title,
  defaultOpen = false,
  children,
}: {
  icon: React.ElementType;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-dw-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-paper2"
      >
        <div className="flex items-center gap-3">
          <Icon className="h-4 w-4 text-ink3" />
          <span className="font-headline text-xs uppercase tracking-wider text-ink">{title}</span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-ink3" /> : <ChevronDown className="h-4 w-4 text-ink3" />}
      </button>
      {open && <div className="space-y-4 px-6 pb-6">{children}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase tracking-wider text-ink3">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded border border-dw-border bg-paper2 px-3 py-2 text-sm text-ink outline-none focus:border-dw-crimson";

export default function SettingsPanel() {
  const { close } = useSettings();
  const { settings, updateSettings, refresh, loading } = useDynasty();
  const [team, setTeam] = useState(settings.userTeam ?? "");
  const [coach, setCoach] = useState(settings.coachName ?? "");
  const [key, setKey] = useState(settings.anthropicKey ?? "");
  const [eleven, setEleven] = useState(settings.elevenLabsKey ?? "");
  const [savedMsg, setSavedMsg] = useState("");

  async function pickFolder() {
    const dir = await open({ directory: true, title: "Select your CFB27 saves folder" });
    if (typeof dir === "string") await updateSettings({ savesFolder: dir });
  }
  async function persist() {
    await updateSettings({ userTeam: team, coachName: coach, anthropicKey: key, elevenLabsKey: eleven });
    setSavedMsg("Saved");
    setTimeout(() => setSavedMsg(""), 1500);
  }

  return (
    <div>
      <Section icon={School} title="Program" defaultOpen>
        <Field label="Your team">
          <input className={inputCls} value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Kansas State" />
        </Field>
        <Field label="Coach name">
          <input className={inputCls} value={coach} onChange={(e) => setCoach(e.target.value)} placeholder="Coach Prime" />
        </Field>
      </Section>

      <Section icon={FolderOpen} title="Save file">
        <Field label="CFB27 saves folder">
          <div className="flex gap-2">
            <input className={cn(inputCls, "flex-1")} value={settings.savesFolder ?? ""} readOnly placeholder="…/saves" />
            <button type="button" onClick={pickFolder} className="rounded border border-dw-border px-3 text-sm text-ink hover:bg-paper2">
              Browse
            </button>
          </div>
        </Field>
        <button
          type="button"
          onClick={() => refresh()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded border border-dw-border px-3 py-2 text-sm text-ink hover:bg-paper2 disabled:opacity-40"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Re-read latest save
        </button>
      </Section>

      <Section icon={KeyRound} title="API keys (stored locally)">
        <Field label="Anthropic API key">
          <input type="password" className={inputCls} value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
        </Field>
        <Field label="ElevenLabs key (optional, for voice)">
          <input type="password" className={inputCls} value={eleven} onChange={(e) => setEleven(e.target.value)} placeholder="optional" />
        </Field>
      </Section>

      <div className="flex items-center gap-3 px-6 py-5">
        <button type="button" onClick={persist} className="rounded bg-dw-crimson px-4 py-2 text-sm font-medium text-white">
          Save settings
        </button>
        <button type="button" onClick={close} className="text-sm text-ink3 hover:text-ink">
          Close
        </button>
        {savedMsg && <span className="text-sm text-ink3">{savedMsg}</span>}
      </div>
    </div>
  );
}
