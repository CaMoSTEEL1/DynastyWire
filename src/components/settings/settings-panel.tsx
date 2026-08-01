"use client";

// Standalone settings: save folder, team/coach, and BYO API keys — all local, no server.
// Replaces the old Supabase season-transition settings.

import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { ChevronDown, ChevronUp, School, FolderOpen, KeyRound, RefreshCw, Newspaper, Plus, Trash2, AlertTriangle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettings } from "./settings-context";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { openaiListModels, clearAllSettings, resolveLlm, type DynastySettings } from "@/lib/dynasty/client";
import { modelLabel } from "@/lib/dynasty/gen";
import { refreshCustomVoices, type ElevenVoice } from "@/lib/dynasty/tts";
import { ISSUE_TABS, eagerTabs } from "@/lib/dynasty/issue";
import { clearAllIssues } from "@/lib/dynasty/issue-cache";
import { clearAllSagas } from "@/lib/dynasty/saga-store";
import { clearBaseline, formatBaseline, loadBaseline, summarizeBaseline, type BaselineSummary } from "@/lib/dynasty/baseline";

/** Destructive action with an inline two-step confirm (no browser dialogs in the webview),
 * which reloads afterward so every screen re-reads the now-empty stores. */
function ResetButton({
  label,
  detail,
  confirmLabel,
  onReset,
  danger = false,
}: {
  label: string;
  detail: string;
  confirmLabel: string;
  onReset: () => Promise<void>;
  danger?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded border border-dw-border bg-paper2 p-3">
      <p className={cn("font-sans text-xs font-semibold uppercase tracking-wider", danger ? "text-dw-red" : "text-ink")}>
        {label}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink3">{detail}</p>
      {!armed ? (
        <button
          type="button"
          onClick={() => setArmed(true)}
          className={cn(
            "mt-2 rounded border px-3 py-1.5 font-sans text-[11px] uppercase tracking-wider transition-colors",
            danger
              ? "border-dw-red/50 text-dw-red hover:bg-dw-red/10"
              : "border-dw-border text-ink2 hover:bg-paper3"
          )}
        >
          {label}
        </button>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-sans text-[11px] text-dw-red">{confirmLabel}</span>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onReset();
                window.location.href = "/";
              } catch {
                setBusy(false);
                setArmed(false);
              }
            }}
            className="rounded border border-dw-red bg-dw-red/20 px-3 py-1.5 font-sans text-[11px] uppercase tracking-wider text-dw-red hover:bg-dw-red/30 disabled:opacity-50"
          >
            {busy ? "Clearing…" : "Yes, do it"}
          </button>
          <button
            type="button"
            onClick={() => setArmed(false)}
            className="font-sans text-[11px] uppercase tracking-wider text-ink3 hover:text-ink"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/** The v2 hallucination baseline, read-only. Observe-only fact-checking runs on every
 * generation; this is the one place the accumulated number can actually be looked at,
 * which is what makes "hallucinations are down" a measurement instead of a vibe. */
function BaselineReport({ settings }: { settings: DynastySettings }) {
  const [summary, setSummary] = useState<BaselineSummary | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async () => setSummary(summarizeBaseline(await loadBaseline()));
  // Which transport the NEXT generation records under. Shown because the baseline is keyed
  // by model: play a week on a different provider and the numbers silently describe it.
  const llm = resolveLlm(settings);

  return (
    <div className="space-y-2">
      <p className="text-[11px] leading-relaxed text-ink3">
        Every generated piece is checked against the save for contradictions — players on the
        wrong team, scores, records, poll numbers. Nothing is rewritten; this only counts.
      </p>
      <p className="font-sans text-[11px] text-ink3">
        Recording as{" "}
        {llm ? (
          <span className="text-ink2">
            {llm.provider} · {modelLabel(llm)}
          </span>
        ) : (
          <span className="text-dw-red">no provider configured — nothing will generate</span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={load}
          className="rounded border border-dw-border px-3 py-1.5 font-sans text-[11px] uppercase tracking-wider text-ink2 hover:bg-paper3"
        >
          {summary ? "Refresh" : "Show baseline"}
        </button>
        {summary && summary.totals.pieces > 0 && (
          <>
            <button
              type="button"
              onClick={async () => {
                // Stamp the build: a tester's report is only useful if I know which
                // version's checker produced it.
                const v = await getVersion().catch(() => undefined);
                await navigator.clipboard.writeText(formatBaseline(summary, v));
                setCopied(true);
              }}
              className="rounded border border-dw-border px-3 py-1.5 font-sans text-[11px] uppercase tracking-wider text-ink2 hover:bg-paper3"
            >
              {copied ? "Copied" : "Copy report"}
            </button>
            <button
              type="button"
              onClick={async () => {
                await clearBaseline();
                await load();
              }}
              className="font-sans text-[11px] uppercase tracking-wider text-ink3 hover:text-ink"
            >
              Clear
            </button>
          </>
        )}
      </div>
      {summary &&
        (summary.totals.pieces === 0 ? (
          <p className="text-[11px] text-ink3">Nothing recorded yet — generate a week first.</p>
        ) : (
          <div className="rounded border border-dw-border bg-paper2 p-3">
            <p className="font-sans text-xs font-semibold uppercase tracking-wider text-ink">
              {summary.totals.perPiece} violations per piece
              <span className="ml-2 font-normal normal-case tracking-normal text-ink3">
                across {summary.totals.pieces} pieces
              </span>
            </p>
            <ul className="mt-2 space-y-1">
              {summary.cells.slice(0, 12).map((c) => (
                <li key={`${c.kind}::${c.model}`} className="flex items-baseline justify-between gap-3 text-[11px]">
                  <span className="text-ink2">
                    {c.kind}
                    <span className="ml-2 text-ink3">{c.model}</span>
                  </span>
                  <span className={cn("font-sans tabular-nums", c.perPiece >= 0.5 ? "text-dw-red" : "text-ink3")}>
                    {c.perPiece} <span className="text-ink3">({c.violations}/{c.pieces})</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] leading-relaxed text-ink3">
              v2 ships when the frozen surfaces hold under 0.5 per piece on the budget model.
            </p>
          </div>
        ))}
    </div>
  );
}

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

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-4 text-left"
    >
      <span className="font-serif text-sm text-ink">{label}</span>
      <span
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
          checked ? "border-dw-crimson bg-dw-crimson/80" : "border-dw-border bg-paper2"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-paper transition-all",
            checked ? "left-[18px]" : "left-0.5"
          )}
        />
      </span>
    </button>
  );
}

const inputCls =
  "w-full rounded border border-dw-border bg-paper2 px-3 py-2 text-sm text-ink outline-none focus:border-dw-crimson";

export default function SettingsPanel() {
  const { close } = useSettings();
  const {
    settings,
    updateSettings,
    refresh,
    loading,
    generateIssue,
    regenerateIssue,
    issueStatus,
    issue,
    dynasties,
    activeDynastyId,
    addDynasty,
    switchDynasty,
    removeDynasty,
  } = useDynasty();
  const [team, setTeam] = useState(settings.userTeam ?? "");
  const [coach, setCoach] = useState(settings.coachName ?? "");
  const [key, setKey] = useState(settings.anthropicKey ?? "");
  const [eleven, setEleven] = useState(settings.elevenLabsKey ?? "");
  const [provider, setProvider] = useState<"anthropic" | "openai">(settings.provider ?? "anthropic");
  const [oaiUrl, setOaiUrl] = useState(settings.openaiBaseUrl ?? "");
  const [oaiKey, setOaiKey] = useState(settings.openaiKey ?? "");
  const [oaiModel, setOaiModel] = useState(settings.openaiModel ?? "");
  const [oaiNoCap, setOaiNoCap] = useState(settings.openaiNoMaxTokens === true);
  const [models, setModels] = useState<string[] | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [voices, setVoices] = useState<ElevenVoice[] | null>(null);
  const [fetchingVoices, setFetchingVoices] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState("");

  // Confirms which of the user's own voices the shows will cast from — and refreshes the
  // session cache, so voices added on elevenlabs.io land without restarting the app.
  async function fetchVoices() {
    const apiKey = eleven.trim();
    if (!apiKey || fetchingVoices) return;
    setFetchingVoices(true);
    setVoicesError(null);
    try {
      setVoices(await refreshCustomVoices(apiKey));
    } catch (e) {
      setVoices(null);
      setVoicesError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetchingVoices(false);
    }
  }

  async function fetchModels() {
    if (!oaiUrl.trim() || !oaiKey.trim() || fetchingModels) return;
    setFetchingModels(true);
    setModelsError(null);
    try {
      setModels(await openaiListModels(oaiUrl.trim(), oaiKey.trim()));
    } catch (e) {
      setModels(null);
      setModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetchingModels(false);
    }
  }

  async function pickAndAdd() {
    const file = await open({
      directory: false,
      multiple: false,
      title: "Select a dynasty save file (e.g. DYNASTY-…)",
    });
    if (typeof file === "string") await addDynasty(file);
  }
  async function persist() {
    await updateSettings({
      userTeam: team,
      coachName: coach,
      anthropicKey: key,
      elevenLabsKey: eleven,
      provider,
      openaiBaseUrl: oaiUrl.trim() || null,
      openaiKey: oaiKey.trim() || null,
      openaiModel: oaiModel.trim() || null,
      openaiNoMaxTokens: oaiNoCap,
    });
    setSavedMsg("Saved");
    setTimeout(() => setSavedMsg(""), 1500);
  }

  return (
    <div>
      <Section icon={School} title="Immersion">
        <Toggle
          checked={settings.hideRecruitOverall === true}
          onChange={(v) => void updateSettings({ hideRecruitOverall: v })}
          label="Hide recruit OVR on the board"
        />
        <Toggle
          checked={settings.budgetMode !== false}
          onChange={(v) => void updateSettings({ budgetMode: v })}
          label="Budget mode — cut API cost (on by default)"
        />
        <p className="text-[11px] leading-relaxed text-ink3">
          Uses a cheaper, faster model and only auto-writes the core sections each week —
          everything else generates when you open that tab. Combined with context caching,
          this cuts a week&apos;s spend by 90%+ vs. full mode. Turn it off for the richest
          writing if credits aren&apos;t a concern.
        </p>
        <Toggle
          checked={settings.consequenceSync === true}
          onChange={(v) => void updateSettings({ consequenceSync: v })}
          label="Consequence Sync — meters affect your actual save"
        />
        <Toggle
          checked={settings.nilWriteToSave !== false}
          onChange={(v) => void updateSettings({ nilWriteToSave: v })}
          label="Write NIL to your save (on by default)"
        />
        <p className="text-[11px] leading-relaxed text-ink3">
          Lets brand deals and NIL allotments add program points / NIL money to your actual
          save. Turn it OFF for a zero-to-hero or no-NIL run — the Boardroom and Situation Room
          still play out and still move your hot seat, they just never touch your players&apos;
          money or your program points. Nothing about your save is changed while it&apos;s off.
        </p>
        <Toggle
          checked={settings.presserTakeover !== false}
          onChange={(v) => void updateSettings({ presserTakeover: v })}
          label="Podium takeover — the press conference interrupts you"
        />
        <p className="text-[11px] leading-relaxed text-ink3">
          When a new game week lands, the press conference takes over the screen instead of
          waiting in a tab — one reporter at a time, up close. Skippable with Esc, and it only
          fires once per week. Turn it off to keep the podium where it was.
        </p>
        <Toggle
          checked={settings.podcastAudio === true}
          onChange={(v) => void updateSettings({ podcastAudio: v })}
          label="Podcast audio — read shows aloud (ElevenLabs)"
        />
        <p className="text-[11px] leading-relaxed text-ink3">
          When on, opening a show auto-plays it with AI voices (a different voice per host,
          re-rolled weekly). Needs your ElevenLabs key below, and it uses your credits — leave
          it off if you&apos;d rather just read.
        </p>
        <p className="text-[11px] leading-relaxed text-ink3">
          Writes the Situation Room meters back into the game: locker-room trust moves your
          players&apos; confidence ratings, booster confidence adds or withholds program points,
          and AD trust sets your coach&apos;s job security. Modifies the save file (a timestamped
          backup is made every time, and it refuses to write while the game is running).
        </p>
        <p className="text-[11px] leading-relaxed text-ink3">
          Real staffs don&apos;t see a prospect&apos;s true rating — hide it and scout by stars,
          rankings, and the film breakdown in each dossier instead.
        </p>
      </Section>

      <Section icon={School} title="Program" defaultOpen>
        <Field label="Your team">
          <input className={inputCls} value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Kansas State" />
        </Field>
        <Field label="Coach name">
          <input className={inputCls} value={coach} onChange={(e) => setCoach(e.target.value)} placeholder="Coach Prime" />
        </Field>
      </Section>

      <Section icon={FolderOpen} title="Dynasties" defaultOpen>
        <p className="text-[11px] leading-relaxed text-ink3">
          Each dynasty is a specific save FILE. The Wire reads exactly the file you pick —
          never the newest one in the folder — so it always covers the right program.
        </p>
        <div className="space-y-1.5">
          {(dynasties ?? []).map((d) => {
            const isActive = d.id === activeDynastyId;
            return (
              <div
                key={d.id}
                className={cn(
                  "flex items-center justify-between gap-2 rounded border px-3 py-2",
                  isActive ? "border-dw-crimson bg-dw-crimson/10" : "border-dw-border bg-paper2"
                )}
              >
                <button
                  type="button"
                  onClick={() => { if (!isActive) void switchDynasty(d.id); }}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate font-serif text-sm text-ink">{d.label}</span>
                  <span className="block truncate text-[10px] text-ink3">{d.saveFile}</span>
                </button>
                {isActive ? (
                  <span className="shrink-0 font-sans text-[10px] uppercase tracking-wider text-dw-crimson">Active</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void removeDynasty(d.id)}
                    aria-label="Remove dynasty"
                    className="shrink-0 text-ink3 hover:text-dw-red"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={pickAndAdd}
            className="inline-flex items-center gap-2 rounded border border-dw-border px-3 py-2 text-sm text-ink hover:bg-paper2"
          >
            <Plus className="h-4 w-4" /> Add a dynasty
          </button>
          <button
            type="button"
            onClick={() => refresh(true)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded border border-dw-border px-3 py-2 text-sm text-ink hover:bg-paper2 disabled:opacity-40"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Re-read this save
          </button>
        </div>
      </Section>

      <Section icon={Newspaper} title="Weekly issue" defaultOpen>
        <Toggle
          checked={settings.autoGenerate !== false}
          onChange={(v) => {
            void updateSettings({ autoGenerate: v });
            if (v) void generateIssue(); // start this week's issue right away on enable
          }}
          label="Auto-write each week's issue"
        />
        <p className="text-[11px] leading-relaxed text-ink3">
          When you advance a week in-game, the Wire writes the issue in the background —
          one issue per in-game week, cached after, so reopening is instant and free. Turn
          off to write each section on demand instead.
        </p>
        <div className="space-y-1.5 rounded border border-dw-border bg-paper2 p-3">
          <p className="font-sans text-[10px] uppercase tracking-wider text-ink3">
            Sections to auto-write
          </p>
          <p className="text-[11px] leading-relaxed text-ink3">
            Only checked sections generate automatically each week (each one costs API
            credits). Unchecked sections still write themselves the first time you open
            that tab — you lose nothing, you just don&apos;t pay for sections you never read.
          </p>
          {(() => {
            const effective = new Set(eagerTabs(settings).map((t) => t.kind));
            return ISSUE_TABS.map((t) => (
              <label
                key={t.kind}
                className="flex cursor-pointer items-center gap-2.5 py-0.5"
              >
                <input
                  type="checkbox"
                  checked={effective.has(t.kind)}
                  onChange={() => {
                    const next = new Set(effective);
                    if (next.has(t.kind)) next.delete(t.kind);
                    else next.add(t.kind);
                    void updateSettings({
                      autoGenerateTabs: ISSUE_TABS.filter((x) => next.has(x.kind)).map((x) => x.kind),
                    });
                  }}
                  className="h-3.5 w-3.5 accent-dw-crimson"
                />
                <span className="font-serif text-sm text-ink">{t.label}</span>
              </label>
            ));
          })()}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => generateIssue()}
            disabled={issueStatus === "generating"}
            className="inline-flex items-center gap-2 rounded border border-dw-crimson bg-dw-crimson/10 px-3 py-2 text-sm text-dw-crimson hover:bg-dw-crimson/20 disabled:opacity-40"
          >
            <Newspaper className={cn("h-4 w-4", issueStatus === "generating" && "animate-pulse")} />
            {issueStatus === "generating" ? "Writing this week's issue…" : "Write this week's issue now"}
          </button>
          <button
            type="button"
            onClick={() => regenerateIssue()}
            disabled={issueStatus === "generating"}
            className="inline-flex items-center gap-2 rounded border border-dw-border px-3 py-2 text-sm text-ink hover:bg-paper2 disabled:opacity-40"
          >
            <RefreshCw
              className={cn("h-4 w-4", issueStatus === "generating" && "animate-spin")}
            />
            Regenerate (rewrite all)
          </button>
        </div>
        {issue?.updatedAt && issueStatus !== "generating" && (
          <p className="text-[10px] uppercase tracking-wider text-ink3">
            Last written {new Date(issue.updatedAt).toLocaleString()}
          </p>
        )}
      </Section>

      <Section icon={KeyRound} title="AI provider & API keys (stored locally)">
        <Field label="Provider">
          <select
            className={inputCls}
            value={provider}
            onChange={(e) => setProvider(e.target.value as "anthropic" | "openai")}
          >
            <option value="anthropic">Claude (Anthropic)</option>
            <option value="openai">OpenAI-compatible (any provider / local models)</option>
          </select>
        </Field>
        {provider === "anthropic" ? (
          <Field label="Anthropic API key">
            <input type="password" className={inputCls} value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" />
          </Field>
        ) : (
          <>
            <Field label="API base URL (the provider's v1 endpoint)">
              <input className={inputCls} value={oaiUrl} onChange={(e) => setOaiUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
            </Field>
            <Field label="API key">
              <input type="password" className={inputCls} value={oaiKey} onChange={(e) => setOaiKey(e.target.value)} placeholder="sk-…" />
            </Field>
            <Field label="Model name">
              <div className="flex gap-2">
                <input className={cn(inputCls, "flex-1")} value={oaiModel} onChange={(e) => setOaiModel(e.target.value)} placeholder="gpt-4o-mini" />
                <button
                  type="button"
                  onClick={() => void fetchModels()}
                  disabled={fetchingModels || !oaiUrl.trim() || !oaiKey.trim()}
                  className="rounded border border-dw-border px-3 text-xs text-ink hover:bg-paper2 disabled:opacity-40"
                  title="List the models this key can use (model ids are case-sensitive)"
                >
                  {fetchingModels ? "Fetching…" : "Fetch models"}
                </button>
              </div>
            </Field>
            {modelsError && <p className="text-[11px] text-dw-red">{modelsError}</p>}
            {models && models.length > 0 && (
              <Field label={`Available models (${models.length}) — pick one`}>
                <select
                  className={inputCls}
                  value={models.includes(oaiModel) ? oaiModel : ""}
                  onChange={(e) => { if (e.target.value) setOaiModel(e.target.value); }}
                >
                  <option value="">— select a model —</option>
                  {models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </Field>
            )}
            <Toggle
              checked={oaiNoCap}
              onChange={setOaiNoCap}
              label="Uncap max tokens (for local reasoning models)"
            />
            <p className="text-[11px] leading-relaxed text-ink3">
              Works with anything exposing an OpenAI-style /v1/chat/completions endpoint —
              OpenAI, OpenRouter, Groq, Together, or local models via LM Studio / Ollama
              (e.g. http://localhost:11434/v1). Gemini: use
              https://generativelanguage.googleapis.com/v1beta/openai. Uncapping max tokens lets
              reasoning models think freely — leave it OFF for paid APIs or costs can spike.
            </p>
          </>
        )}
        <Field label="ElevenLabs key (optional, for voice)">
          <input type="password" className={inputCls} value={eleven} onChange={(e) => setEleven(e.target.value)} placeholder="optional" />
        </Field>
        <Toggle
          checked={settings.customVoices !== false}
          onChange={(v) => void updateSettings({ customVoices: v })}
          label="Cast shows with my own ElevenLabs voices"
        />
        <p className="text-[11px] leading-relaxed text-ink3">
          Uses the voices on your ElevenLabs account — cloned, designed, or saved from the
          voice library — instead of the stock premade ones. Name a voice after a persona
          (&ldquo;Marcus Cole&rdquo;) and that persona always speaks with it; everyone else gets
          a gender-matched voice from your library, re-rolled weekly. Accounts with no custom
          voices fall back to the premades automatically.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchVoices()}
            disabled={fetchingVoices || !eleven.trim()}
            className="rounded border border-dw-border px-3 py-1.5 font-sans text-[11px] uppercase tracking-wider text-ink hover:bg-paper2 disabled:opacity-40"
            title="Re-read your ElevenLabs voice library"
          >
            {fetchingVoices ? "Checking…" : "Check my voices"}
          </button>
          {voicesError ? (
            <span className="text-[11px] text-dw-red">{voicesError}</span>
          ) : voices ? (
            <span className="text-[11px] text-ink3">
              {voices.length === 0
                ? "No custom voices on this account — shows will use the premades."
                : `${voices.length} custom ${voices.length === 1 ? "voice" : "voices"}: ${voices.map((v) => v.name).join(", ")}`}
            </span>
          ) : null}
        </div>
      </Section>

      <Section icon={ShieldCheck} title="Fact-check baseline">
        <BaselineReport settings={settings} />
      </Section>

      {/* Escape hatch: upgrading across versions could leave a half-written store behind,
          and a user stuck on a load error had no way back without hand-deleting files. */}
      <Section icon={AlertTriangle} title="Reset local data">
        <p className="text-[11px] leading-relaxed text-ink3">
          Wipes Dynasty Wire&apos;s own local files and starts you over as a brand-new user.
          Use this if the app is stuck, showing data from a save you removed, or behaving
          oddly after an update. <strong className="text-ink2">Your CFB27 save files are never
          touched</strong> — only Dynasty Wire&apos;s settings, cached issues, and saga history.
        </p>
        <div className="space-y-2">
          <ResetButton
            label="Clear generated content only"
            detail="Deletes cached weekly issues (articles, shows, pressers). Keeps your dynasties, API key, and Situation Room history."
            confirmLabel="Delete all generated content?"
            onReset={async () => {
              await clearAllIssues();
            }}
          />
          <ResetButton
            label="Full reset — start as a new user"
            detail="Deletes everything: API keys, dynasties, cached issues, meters, backstory, recruit threads."
            confirmLabel="Erase ALL Dynasty Wire data? This cannot be undone."
            danger
            onReset={async () => {
              await clearAllIssues();
              await clearAllSagas();
              await clearAllSettings();
              try {
                sessionStorage.clear();
                localStorage.clear();
              } catch {
                /* private mode — stores are already cleared */
              }
            }}
          />
        </div>
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
