"use client";

// Recruiting hub. The board is the real recruit board read from the save (getRecruits).
// Search it by name, click a prospect to open his dossier — an AI scouting department that
// writes his backstory, breaks down his film, surfaces what the recruiting media says and
// what he's posting, and lets the coach actually text him. Grounded in each recruit's real
// ratings/rankings and the program's real season.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/section-header";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useIssueTab } from "@/components/dynasty/use-issue-tab";
import { useSaga } from "@/components/dynasty/use-saga";
import { getRecruits, type Recruit } from "@/lib/dynasty/client";
import { findRecruitEntry, recruitThreadKey } from "@/lib/dynasty/saga";
import { starString } from "@/lib/dynasty/stars";
import { TREND_CONFIG } from "@/lib/recruiting/types";

// ── Dossier types (shape the recruit-dossier generator returns) ────────────────
interface Film {
  grade: string;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  comp: string;
  projection: string;
}
interface DossierArticle { outlet: string; headline: string; body: string }
interface RecruitSocial { handle: string; platform: string; body: string; likes: number }
interface Dossier {
  backstory: string;
  film: Film;
  article: DossierArticle;
  social: RecruitSocial[];
  interest: string;
  error?: boolean;
}
interface ChatMsg { from: "coach" | "recruit"; text: string; mood?: string }

interface RecruitingColumn {
  headline: string;
  subhead: string;
  trend: string;
  trendReason: string;
  beats: { title: string; text: string }[];
}

const DOSSIER_TABS = ["Backstory", "Film", "Buzz", "Social", "Texts"] as const;
type DossierTab = (typeof DOSSIER_TABS)[number];

// Stars aren't stored in the save — they're derived from the prospect's real national rank.
// See lib/dynasty/stars.ts.
function stars(stored: number | null, nationalRank?: number | null): string {
  return starString(stored, nationalRank);
}

function TrendBadge({ trend }: { trend: string }) {
  const config = TREND_CONFIG[trend] ?? TREND_CONFIG.stable;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded border px-2.5 py-1 font-sans text-xs uppercase tracking-wider border-current", config.color)} title={config.label}>
      <span className="text-sm leading-none">{config.icon}</span>
      <span>{config.label}</span>
    </span>
  );
}

// ── Dossier modal ──────────────────────────────────────────────────────────────
function DossierModal({
  recruit,
  onClose,
}: {
  recruit: Recruit;
  onClose: () => void;
}) {
  const { generate, snapshot, settings } = useDynasty();
  const hideOvr = settings.hideRecruitOverall === true;
  const saga = useSaga();
  // Stable per-recruit identity (name+position) with a legacy-key fallback so threads and
  // dossiers saved under the old rank-based key aren't lost.
  const rKey = recruitThreadKey(recruit.name, recruit.position);
  const thread: ChatMsg[] = (findRecruitEntry(saga.state?.recruitThreads, recruit.name, recruit.position).value ?? []) as ChatMsg[];
  const savedDossier = findRecruitEntry(saga.state?.recruitDossiers, recruit.name, recruit.position).value as Dossier | null;
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<DossierTab>("Backstory");
  const [draft, setDraft] = useState("");
  const [texting, setTexting] = useState(false);

  // A dossier written earlier (any week) opens instantly — no regenerate needed.
  useEffect(() => {
    if (!dossier && savedDossier && typeof savedDossier.backstory === "string") {
      setDossier(savedDossier);
    }
  }, [dossier, savedDossier]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await generate<Dossier>("recruit-dossier", { recruit });
      if (d?.error) throw new Error("The scouting report came back empty.");
      setDossier(d);
      await saga.saveRecruitDossier(rKey, d); // persist across weeks + restarts
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build the dossier.");
    } finally {
      setLoading(false);
    }
  }, [generate, recruit, saga, rKey]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || texting) return;
    setDraft("");
    const next = [...thread, { from: "coach" as const, text }];
    await saga.appendRecruitThread(rKey, [{ from: "coach", text }]); // persist immediately
    setTexting(true);
    try {
      const reply = await generate<{ reply: string; mood?: string }>(
        "recruit-text",
        { recruit, thread: next, coachMessage: text },
        { force: true }
      );
      if (reply?.reply) {
        await saga.appendRecruitThread(rKey, [{ from: "recruit", text: reply.reply, mood: reply.mood }]);
      }
    } catch {
      await saga.appendRecruitThread(rKey, [{ from: "recruit", text: "…", mood: "cooling" }]);
    } finally {
      setTexting(false);
    }
  }, [draft, texting, thread, generate, recruit, saga, rKey]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="my-8 w-full max-w-2xl rounded border border-dw-border bg-paper shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-dw-border bg-paper2 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-sans text-[10px] uppercase tracking-widest text-ink3">
                {recruit.nationalRank ? `#${recruit.nationalRank} nat'l` : "Prospect"}
              </span>
              <span className="text-dw-accent2">{stars(recruit.stars, recruit.nationalRank)}</span>
            </div>
            <h2 className="font-headline text-2xl uppercase tracking-wide text-ink">{recruit.name}</h2>
            <p className="font-sans text-xs text-ink3">
              {recruit.position ?? "ATH"}{recruit.overall && !hideOvr ? ` · ${recruit.overall} OVR` : ""}{recruit.class ? ` · ${recruit.class}` : ""}{recruit.stage ? ` · ${recruit.stage}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="font-sans text-sm text-ink3 hover:text-ink">✕</button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          {!dossier && !loading && !error && (
            <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center">
              <p className="font-serif text-ink2">
                Open the recruiting department&apos;s full dossier on {recruit.name.split(" ")[0]} — backstory, film breakdown, what the media&apos;s saying, and his socials. Then text him.
              </p>
              <button type="button" onClick={() => void load()} className="mt-4 rounded border border-dw-accent bg-dw-accent px-5 py-2.5 font-sans text-xs uppercase tracking-wider text-paper hover:bg-dw-accent2">
                Build the Dossier
              </button>
            </div>
          )}
          {loading && <p className="py-10 text-center font-sans text-xs uppercase tracking-wider text-dw-accent">Scouts are filing their report…</p>}
          {error && <p className="rounded border border-dw-red/30 bg-dw-red/10 px-4 py-6 text-center font-serif text-dw-red">{error}</p>}

          {dossier && (
            <div>
              {/* Tabs */}
              <div className="mb-4 flex flex-wrap gap-1 border-b border-dw-border">
                {DOSSIER_TABS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={cn(
                      "border-b-2 px-3 py-2 font-sans text-xs uppercase tracking-wider transition-colors",
                      tab === t ? "border-dw-accent text-dw-accent" : "border-transparent text-ink3 hover:text-ink"
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {tab === "Backstory" && (
                <div className="space-y-3">
                  <p className="whitespace-pre-line font-serif leading-relaxed text-ink">{dossier.backstory}</p>
                  <div className="rounded border border-dw-accent2/30 bg-dw-accent2/5 px-4 py-3">
                    <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Interest in {snapshot?.userTeam?.name ?? "your program"}</p>
                    <p className="mt-1 font-serif text-sm text-ink2">{dossier.interest}</p>
                  </div>
                </div>
              )}

              {tab === "Film" && dossier.film && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dw-accent font-headline text-lg font-bold text-dw-accent">
                      {dossier.film.grade}
                    </span>
                    <p className="flex-1 font-serif text-sm italic text-ink2">{dossier.film.summary}</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="font-sans text-[10px] uppercase tracking-widest text-dw-green">Strengths</p>
                      <ul className="mt-1 space-y-1">
                        {dossier.film.strengths?.map((s, i) => <li key={i} className="font-serif text-sm text-ink">+ {s}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="font-sans text-[10px] uppercase tracking-widest text-dw-red">Needs Work</p>
                      <ul className="mt-1 space-y-1">
                        {dossier.film.weaknesses?.map((s, i) => <li key={i} className="font-serif text-sm text-ink2">− {s}</li>)}
                      </ul>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-dw-border pt-3">
                    <p className="font-sans text-xs text-ink3"><span className="uppercase tracking-wider">Comp:</span> <span className="text-ink2">{dossier.film.comp}</span></p>
                    <p className="font-sans text-xs text-ink3"><span className="uppercase tracking-wider">Projection:</span> <span className="text-ink2">{dossier.film.projection}</span></p>
                  </div>
                </div>
              )}

              {tab === "Buzz" && dossier.article && (
                <article>
                  <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">{dossier.article.outlet}</p>
                  <h3 className="mt-1 font-headline text-xl leading-tight text-ink">{dossier.article.headline}</h3>
                  <p className="mt-3 whitespace-pre-line font-serif leading-relaxed text-ink2">{dossier.article.body}</p>
                </article>
              )}

              {tab === "Social" && (
                <div className="space-y-3">
                  {dossier.social?.map((p, i) => (
                    <div key={i} className="rounded border border-dw-border bg-paper2 p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-sans text-xs text-ink">{p.handle}</span>
                        <span className="font-sans text-[10px] uppercase tracking-wider text-ink3">{p.platform}</span>
                      </div>
                      <p className="mt-1.5 font-serif text-ink leading-snug">{p.body}</p>
                      <p className="mt-1.5 font-sans text-[10px] text-ink3">♥ {typeof p.likes === "number" ? p.likes.toLocaleString() : p.likes}</p>
                    </div>
                  ))}
                </div>
              )}

              {tab === "Texts" && (
                <div className="space-y-3">
                  <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Text {recruit.name.split(" ")[0]}</p>
                  <div className="min-h-[6rem] space-y-2 rounded border border-dw-border bg-paper p-3">
                    {thread.length === 0 && <p className="py-4 text-center font-serif text-sm text-ink3">Start the conversation. He knows who you are.</p>}
                    {thread.map((m, i) => {
                      const mine = m.from === "coach";
                      return (
                        <div key={i} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                          <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2 font-serif text-sm leading-snug", mine ? "rounded-br-sm bg-dw-accent text-paper" : "rounded-bl-sm bg-paper3 text-ink")}>
                            {!mine && <span className="mb-0.5 block font-sans text-[9px] uppercase tracking-wider text-ink3">{recruit.name.split(" ")[0]}</span>}
                            {m.text}
                          </div>
                        </div>
                      );
                    })}
                    {texting && <p className="font-sans text-[10px] uppercase tracking-wider text-ink3">typing…</p>}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
                      placeholder={`Text ${recruit.name.split(" ")[0]}…`}
                      className="flex-1 rounded border border-dw-border bg-paper2 px-3 py-2 font-serif text-sm text-ink placeholder:text-ink3 focus:border-dw-accent2/60 focus:outline-none"
                    />
                    <button type="button" onClick={() => void send()} disabled={!draft.trim() || texting} className="rounded border border-dw-accent2 bg-dw-accent2/20 px-4 py-2 font-sans text-xs uppercase tracking-wider text-dw-accent2 hover:bg-dw-accent2/30 disabled:opacity-40">
                      Send
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function RecruitingPage() {
  const { snapshot, loading, error, generate, hasApiKey, currentSavePath, settings } = useDynasty();
  // Immersion option: hide exact recruit ratings (you don't see true OVR on the trail IRL).
  const hideOvr = settings.hideRecruitOverall === true;

  const [recruits, setRecruits] = useState<Recruit[] | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"board" | "committed" | "all">("board");
  const [selected, setSelected] = useState<Recruit | null>(null);

  const RENDER_CAP = 150; // the full class is ~4,000; render a bounded slice, search the rest

  const [column, setColumn] = useState<RecruitingColumn | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const canGenerate = Boolean(currentSavePath && hasApiKey);

  const boardCount = useMemo(() => (recruits ?? []).filter((r) => r.onBoard).length, [recruits]);
  const committedCount = useMemo(
    () => (recruits ?? []).filter((r) => r.committedToUser).length,
    [recruits]
  );

  // Searching always spans the FULL class; the scope chips only shape the default view.
  const filtered = useMemo(() => {
    if (!recruits) return [];
    const q = query.trim().toLowerCase();
    let base = recruits;
    if (!q) {
      if (scope === "board") base = recruits.filter((r) => r.onBoard);
      else if (scope === "committed") base = recruits.filter((r) => r.committedToUser);
    } else {
      base = recruits.filter(
        (r) => r.name.toLowerCase().includes(q) || (r.position ?? "").toLowerCase().includes(q)
      );
    }
    return base;
  }, [recruits, query, scope]);
  const shown = filtered.slice(0, RENDER_CAP);

  async function loadBoard() {
    if (!currentSavePath || loadingBoard) return;
    setLoadingBoard(true);
    setBoardError(null);
    try {
      const r = await getRecruits(currentSavePath);
      setRecruits(r);
      try {
        sessionStorage.setItem(`dw.board.${currentSavePath}`, JSON.stringify(r));
      } catch { /* quota — skip */ }
    } catch (err) {
      setBoardError(err instanceof Error ? err.message : "Couldn't read the recruiting board.");
    } finally {
      setLoadingBoard(false);
    }
  }

  // Auto-load the board on mount: instantly from the session warm-copy when available,
  // otherwise a background read from the save (parser-side disk cache makes it quick).
  const bootedBoard = useRef(false);
  useEffect(() => {
    if (bootedBoard.current || !currentSavePath || recruits) return;
    bootedBoard.current = true;
    try {
      const raw = sessionStorage.getItem(`dw.board.${currentSavePath}`);
      if (raw) {
        setRecruits(JSON.parse(raw));
        return;
      }
    } catch { /* fall through */ }
    void loadBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSavePath, recruits]);

  // Restore this week's trail report from the persisted issue cache on mount.
  const cachedColumn = useIssueTab<RecruitingColumn>("recruiting");
  useEffect(() => {
    if (!column && cachedColumn) setColumn(cachedColumn);
  }, [cachedColumn, column]);

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      setColumn(await generate<RecruitingColumn>("recruiting", {}));
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Failed to generate recruiting column.");
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div>
        <SectionHeader title="RECRUITING" subtitle="The war room" variant="recruiting" />
        <div className="mt-8 rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
          <p className="font-serif italic text-ink3">Reading your save&hellip;</p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div>
        <SectionHeader title="RECRUITING" subtitle="The war room" variant="recruiting" />
        <div className="mt-8 rounded border border-dw-red/30 bg-dw-red/10 px-6 py-12 text-center">
          <p className="font-serif text-dw-red">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="RECRUITING" subtitle="The war room — scout, read, and work the trail" variant="recruiting" />

      <div className="mt-6 space-y-6">
        {/* Board */}
        <div className="rounded border border-dw-border bg-paper">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dw-border bg-paper2 px-4 py-3">
            <h3 className="font-headline text-sm uppercase tracking-wider text-ink2">The Board</h3>
            {recruits && (
              <div className="flex flex-wrap items-center gap-2">
                {([
                  ["board", `My Board${boardCount ? ` (${boardCount})` : ""}`],
                  ["committed", `Committed${committedCount ? ` (${committedCount})` : ""}`],
                  ["all", "All Recruits"],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setScope(key)}
                    className={cn(
                      "rounded-full border px-3 py-1 font-sans text-[11px] uppercase tracking-wider transition-colors",
                      scope === key && !query
                        ? "border-dw-accent bg-dw-accent/10 text-dw-accent"
                        : "border-dw-border text-ink3 hover:text-ink"
                    )}
                  >
                    {label}
                  </button>
                ))}
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search all recruits…"
                  className="w-40 rounded border border-dw-border bg-paper px-3 py-1.5 font-sans text-xs text-ink placeholder:text-ink3 focus:border-dw-accent/60 focus:outline-none"
                />
                <button type="button" onClick={loadBoard} disabled={loadingBoard} className="font-sans text-xs text-ink3 hover:text-dw-accent disabled:opacity-50">
                  {loadingBoard ? "Reading…" : "Refresh"}
                </button>
              </div>
            )}
          </div>
          <div className="px-4 py-4">
            {!recruits ? (
              <div className="py-6 text-center">
                <p className="font-serif text-sm text-ink2">Load your recruiting board straight from your dynasty file — your commits and targets first, with every prospect in the class searchable. Click any name to open his full dossier.</p>
                {boardError && <p className="mt-3 font-sans text-sm text-dw-red">{boardError}</p>}
                <button
                  type="button"
                  onClick={loadBoard}
                  disabled={loadingBoard || !currentSavePath}
                  className={cn(
                    "mt-5 inline-flex items-center gap-2 rounded border border-dw-accent bg-dw-accent/10 px-5 py-2.5",
                    "font-headline text-sm uppercase tracking-wider text-dw-accent transition-colors hover:bg-dw-accent/20",
                    "disabled:cursor-not-allowed disabled:opacity-50"
                  )}
                >
                  {loadingBoard ? "Reading the board…" : "Load Recruiting Board"}
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-6 text-center font-serif text-sm text-ink2">
                {query
                  ? `No prospect matches "${query}".`
                  : scope === "board"
                    ? "No recruits on your board yet in this save. Try All Recruits, or search a name."
                    : scope === "committed"
                      ? "No prospects have committed to you yet. Try My Board or All Recruits."
                      : "No recruits found in this save."}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-dw-border font-sans text-[10px] uppercase tracking-widest text-ink3">
                      <th className="py-2 pr-2">Nat</th>
                      <th className="py-2 pr-2">Recruit</th>
                      <th className="py-2 pr-2">Pos</th>
                      <th className="py-2 pr-2">Stars</th>
                      {!hideOvr && <th className="py-2 pr-2">OVR</th>}
                      <th className="py-2 pr-2">Status</th>
                      <th className="py-2">Stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r, i) => (
                      <tr
                        key={i}
                        onClick={() => setSelected(r)}
                        className="cursor-pointer border-b border-dw-border/50 transition-colors last:border-0 hover:bg-paper2"
                      >
                        <td className="py-2 pr-2 font-sans text-ink3">{r.nationalRank ?? "—"}</td>
                        <td className="py-2 pr-2 font-headline text-ink hover:text-dw-accent">{r.name}</td>
                        <td className="py-2 pr-2 text-ink2">{r.position ?? "—"}</td>
                        <td className="py-2 pr-2 text-dw-accent2">{stars(r.stars, r.nationalRank)}</td>
                        {!hideOvr && <td className="py-2 pr-2 text-ink2">{r.overall ?? "—"}</td>}
                        <td className="py-2 pr-2">
                          {r.committedToUser ? (
                            <span className="rounded border border-dw-green/40 px-1.5 py-0.5 font-sans text-[10px] uppercase tracking-wider text-dw-green">Committed</span>
                          ) : r.onBoard ? (
                            <span className="rounded border border-dw-accent2/40 px-1.5 py-0.5 font-sans text-[10px] uppercase tracking-wider text-dw-accent2">On Board</span>
                          ) : (
                            <span className="text-ink3">—</span>
                          )}
                        </td>
                        <td className="py-2 text-ink3">{r.stage ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 font-sans text-xs text-ink3">
                  {query
                    ? `${filtered.length} match${filtered.length === 1 ? "" : "es"} across all recruits`
                    : scope === "board"
                      ? `${filtered.length} on your board`
                      : scope === "committed"
                        ? `${filtered.length} committed to you`
                        : `${recruits.length} recruits — searchable`}
                  {filtered.length > RENDER_CAP ? ` · showing first ${RENDER_CAP}, refine your search` : ""} · click a name for the dossier
                </p>
              </div>
            )}
          </div>
        </div>

        {/* On The Trail column */}
        <div className="rounded border border-dw-border bg-paper">
          <div className="flex items-center justify-between gap-4 border-b border-dw-border bg-paper2 px-4 py-3">
            <h3 className="font-headline text-sm uppercase tracking-wider text-ink2">On The Trail</h3>
            {column && <TrendBadge trend={column.trend} />}
          </div>
          <div className="px-5 py-5">
            {!column ? (
              <div className="py-6 text-center">
                <p className="font-serif text-sm text-ink2">Generate an insider read on where your program stands on the trail — grounded in this week&apos;s results.</p>
                {genError && <p className="mt-3 font-sans text-sm text-dw-red">{genError}</p>}
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating || !canGenerate}
                  className={cn(
                    "mt-6 inline-flex items-center gap-2 rounded border border-dw-accent bg-dw-accent/10 px-5 py-2.5",
                    "font-headline text-sm uppercase tracking-wider text-dw-accent transition-colors hover:bg-dw-accent/20",
                    "disabled:cursor-not-allowed disabled:opacity-50"
                  )}
                >
                  {generating ? "Working the phones…" : "Generate Trail Report"}
                </button>
                {!canGenerate && <p className="mt-3 font-sans text-xs text-ink3">Add your save and API key in settings to generate.</p>}
              </div>
            ) : (
              <div>
                <h4 className="font-headline text-xl leading-tight text-ink">{column.headline}</h4>
                <p className="mt-1 font-serif italic text-sm text-ink3">{column.subhead}</p>
                {column.trendReason && <p className="mt-3 font-serif text-sm text-ink2">{column.trendReason}</p>}
                <div className="my-5 flex items-center gap-3 text-dw-accent/60">
                  <span className="h-px flex-1 bg-dw-border" /><span className="text-xs">&#9670;</span><span className="h-px flex-1 bg-dw-border" />
                </div>
                <div className="space-y-4">
                  {(column.beats ?? []).map((beat, i) => (
                    <div key={i} className="border-l-2 border-dw-border pl-4">
                      <h5 className="font-headline text-xs uppercase tracking-wider text-ink3">{beat.title}</h5>
                      <p className="mt-1 font-serif text-sm leading-relaxed text-ink2">{beat.text}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-6 border-t border-dw-border pt-4">
                  <button type="button" onClick={handleGenerate} disabled={generating} className="inline-flex items-center gap-2 rounded border border-dw-border bg-paper2 px-4 py-2 font-sans text-xs text-ink3 transition-colors hover:border-dw-accent hover:text-dw-accent disabled:opacity-50">
                    {generating ? "Regenerating…" : "Regenerate"}
                  </button>
                  {genError && <p className="mt-2 font-sans text-xs text-dw-red">{genError}</p>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {selected && <DossierModal recruit={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
