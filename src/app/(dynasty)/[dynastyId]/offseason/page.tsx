"use client";

// The Offseason Hub — an interactive command center driven by the save's real offseason
// stage. It gathers the actual data (record, signed recruiting class, transfer portal) and
// generates a stage-aware briefing, regenerating as the user advances through the window.
// The six deep-dive chapters (bowl recap, awards, carousel, spring…) remain as extras below.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { SectionHeader } from "@/components/ui/section-header";
import { getRecruits, getPortal, type Recruit, type PortalBoard } from "@/lib/dynasty/client";
import { issueKey, readTab, writeTab } from "@/lib/dynasty/issue-cache";
import {
  OFFSEASON_PHASES,
  offseasonStageLabel,
  type OffseasonPhase,
  type OffseasonBrief,
} from "@/lib/offseason/types";
import { cn } from "@/lib/utils";

type PhaseContent = Record<string, unknown>;

function Str({ v }: { v: unknown }) {
  return typeof v === "string" && v.trim() ? <p className="mt-2 whitespace-pre-line font-serif leading-relaxed text-ink2">{v}</p> : null;
}

function renderPhase(c: PhaseContent) {
  const headline = (c.headline ?? c.title) as string | undefined;
  const items: React.ReactNode[] = [];
  if (Array.isArray(c.awards)) {
    items.push(
      <ul key="awards" className="mt-3 space-y-1">
        {(c.awards as { name: string; winner: string; description?: string }[]).map((a, i) => (
          <li key={i} className="font-serif text-ink2">
            <span className="font-headline text-ink">{a.name}:</span> {a.winner}
            {a.description ? ` — ${a.description}` : ""}
          </li>
        ))}
      </ul>
    );
  }
  if (Array.isArray(c.socialReactions)) {
    items.push(
      <div key="social" className="mt-4 space-y-2">
        {(c.socialReactions as { handle: string; body: string }[]).map((p, i) => (
          <div key={i} className="rounded border border-dw-border bg-paper2 p-3">
            <span className="font-sans text-xs text-ink3">{p.handle}</span>
            <p className="font-serif text-sm text-ink2">{p.body}</p>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="mt-4 rounded border border-dw-border bg-paper2 p-5">
      {headline && <h3 className="font-headline text-xl text-ink">{headline}</h3>}
      <Str v={c.body} />
      <Str v={c.narrative} />
      {items}
    </div>
  );
}

export default function OffseasonPage() {
  const { needsOnboarding, generate, snapshot, currentSavePath, dynastyId, year, week } = useDynasty();

  const cal = snapshot?.calendar ?? null;
  const stage = cal?.offseasonStage ?? null;
  const total = cal?.offseasonNumStages ?? null;
  const stageLabel = offseasonStageLabel(stage, total);
  const inOffseason = !!cal?.stage && /off\s*season|offseason/i.test(cal.stage);

  const [brief, setBrief] = useState<OffseasonBrief | null>(null);
  const [commits, setCommits] = useState<Recruit[] | null>(null);
  const [portal, setPortal] = useState<PortalBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cacheKey = issueKey(dynastyId, year, week);
  const briefTab = `offseason-brief::stage${stage ?? "x"}`;

  useEffect(() => {
    let cancelled = false;
    setBrief(null);
    (async () => {
      const rec = await readTab<OffseasonBrief>(cacheKey, briefTab);
      if (!cancelled && rec?.data && !rec.data.error) setBrief(rec.data);
    })();
    return () => { cancelled = true; };
  }, [cacheKey, briefTab]);

  const buildHub = useCallback(async () => {
    if (!currentSavePath) return;
    setLoading(true);
    setErr(null);
    try {
      const [recruits, portalBoard] = await Promise.all([
        getRecruits(currentSavePath).catch(() => [] as Recruit[]),
        getPortal(currentSavePath).catch(() => ({ active: false, transferred: [], atRisk: [] } as PortalBoard)),
      ]);
      const cls = recruits.filter((r) => r.committedToUser).sort((a, b) => (a.nationalRank ?? 9e9) - (b.nationalRank ?? 9e9));
      setCommits(cls);
      setPortal(portalBoard);
      const record = snapshot?.userTeam ? `${snapshot.userTeam.wins}-${snapshot.userTeam.losses}` : null;
      const data = await generate<OffseasonBrief>(
        "offseason-brief",
        {
          stageLabel,
          stageNum: stage ?? undefined,
          totalStages: total ?? undefined,
          record,
          isChamp: (snapshot?.userTeam?.rankMedia ?? 99) === 1,
          commits: cls.slice(0, 24).map((c) => ({ name: c.name, position: c.position, nationalRank: c.nationalRank })),
          portalIn: portalBoard.transferred.length,
          portalOut: 0,
          atRisk: portalBoard.atRisk.length,
        },
        { force: true }
      );
      if (!data || data.error) setErr("The briefing didn't come together — try again.");
      else {
        setBrief(data);
        await writeTab(cacheKey, briefTab, { status: "ready", data, error: null, generatedAt: Date.now() }, { dynastyId, year, week });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Offseason hub failed.");
    } finally {
      setLoading(false);
    }
  }, [currentSavePath, snapshot, stageLabel, stage, total, generate, cacheKey, briefTab, dynastyId, year, week]);

  // Deep-dive chapters (secondary)
  const [phaseContent, setPhaseContent] = useState<PhaseContent | null>(null);
  const [loadingPhase, setLoadingPhase] = useState<OffseasonPhase | null>(null);
  const runPhase = useCallback(
    async (phase: OffseasonPhase) => {
      setLoadingPhase(phase);
      setPhaseContent(null);
      try {
        const data = await generate<PhaseContent>("offseason", { phase });
        if (data && !(data as { error?: boolean }).error) setPhaseContent(data);
      } catch { /* ignore */ } finally {
        setLoadingPhase(null);
      }
    },
    [generate]
  );

  const classByPos = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of commits ?? []) { const p = c.position ?? "ATH"; m[p] = (m[p] || 0) + 1; }
    return m;
  }, [commits]);

  if (needsOnboarding) {
    return (
      <div>
        <SectionHeader title="THE OFFSEASON" subtitle="Between the seasons" variant="offseason" />
        <div className="mt-6 rounded border border-dw-border bg-paper2 px-6 py-12 text-center font-serif text-ink2">
          Set up your save + API key in settings to open the offseason.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="THE OFFSEASON"
        subtitle={inOffseason && stage != null && total != null ? `Stage ${stage} of ${total} · ${stageLabel}` : "Between the seasons"}
        variant="offseason"
      />

      {!inOffseason && (
        <div className="rounded border border-dw-yellow/30 bg-dw-yellow/5 px-6 py-4 font-serif text-sm text-dw-yellow">
          Your save isn&apos;t in the offseason right now — this hub comes alive once the season ends and the transfer window opens. You can still generate offseason chapters below.
        </div>
      )}

      {/* Command-center briefing */}
      <div className="overflow-hidden rounded border border-dw-border bg-paper2">
        <div className="h-1 w-full bg-gradient-to-r from-dw-accent2 to-dw-accent" />
        <div className="px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">{stageLabel}</p>
              <h2 className="font-headline text-2xl uppercase tracking-wide text-ink">
                {brief?.headline ?? "Offseason Command Center"}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => void buildHub()}
              disabled={loading}
              className="rounded border border-dw-accent bg-dw-accent px-4 py-2 font-sans text-xs uppercase tracking-wider text-paper hover:bg-dw-accent2 disabled:opacity-50"
            >
              {loading ? "Filing the briefing…" : brief ? "Refresh" : "Open the Offseason"}
            </button>
          </div>
          {err && <p className="mt-3 font-serif text-sm text-dw-red">{err}</p>}
          {brief && (
            <div className="mt-4 space-y-4">
              <p className="whitespace-pre-line font-serif text-ink leading-relaxed">{brief.body}</p>
              {brief.storylines.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {brief.storylines.map((s, i) => (
                    <div key={i} className="rounded border border-dw-border bg-paper px-4 py-3">
                      <p className="font-headline text-sm uppercase tracking-wide text-ink">{s.title}</p>
                      <p className="mt-1 font-serif text-sm text-ink2">{s.text}</p>
                    </div>
                  ))}
                </div>
              )}
              {brief.lookAhead && (
                <p className="font-serif text-sm text-ink2"><span className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Looking ahead:</span> {brief.lookAhead}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Real data panels */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recruiting class */}
        <div className="rounded border border-dw-border bg-paper2 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-headline text-sm uppercase tracking-widest text-ink">Signed Class</h3>
            {commits && <span className="font-sans text-xs text-ink3">{commits.length} commits</span>}
          </div>
          {!commits && <p className="mt-3 font-serif text-sm text-ink3">Open the offseason to pull your signed class.</p>}
          {commits && commits.length === 0 && <p className="mt-3 font-serif text-sm text-ink3">No signees locked in yet at this stage.</p>}
          {commits && commits.length > 0 && (
            <>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(classByPos).map(([pos, n]) => (
                  <span key={pos} className="rounded border border-dw-border px-2 py-0.5 font-sans text-[10px] uppercase tracking-wider text-ink3">{pos} ×{n}</span>
                ))}
              </div>
              <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
                {commits.map((c, i) => (
                  <li key={i} className="flex items-center justify-between border-b border-dw-border/50 py-1 font-serif text-sm text-ink2 last:border-0">
                    <span><span className="font-sans text-xs uppercase tracking-wider text-ink">{c.name}</span> · {c.position}</span>
                    <span className="font-sans text-[10px] text-ink3">{c.nationalRank ? `#${c.nationalRank} nat'l` : ""}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Transfer portal */}
        <div className="rounded border border-dw-border bg-paper2 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-headline text-sm uppercase tracking-widest text-ink">Transfer Portal</h3>
            {portal && (
              <span className="font-sans text-xs text-ink3">{portal.active ? `${portal.transferred.length} in the portal` : "window not open"}</span>
            )}
          </div>
          {!portal && <p className="mt-3 font-serif text-sm text-ink3">Open the offseason to pull the portal board.</p>}
          {portal && portal.active && portal.transferred.length > 0 && (
            <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
              {portal.transferred.slice(0, 24).map((t, i) => (
                <li key={i} className="flex items-center justify-between border-b border-dw-border/50 py-1 font-serif text-sm text-ink2 last:border-0">
                  <span><span className="font-sans text-xs uppercase tracking-wider text-ink">{t.name}</span> · {t.position} {t.overall} · {t.team}</span>
                  <span className="font-sans text-[10px] text-dw-accent2">{t.chance}%</span>
                </li>
              ))}
            </ul>
          )}
          {portal && !portal.active && (
            <>
              <p className="mt-3 font-serif text-sm text-ink3">The in-game portal hasn&apos;t opened yet at this stage. Here&apos;s the league-wide flight-risk watch list:</p>
              <ul className="mt-2 max-h-60 space-y-1 overflow-y-auto pr-1">
                {portal.atRisk.slice(0, 18).map((r, i) => (
                  <li key={i} className="flex items-center justify-between border-b border-dw-border/50 py-1 font-serif text-sm text-ink2 last:border-0">
                    <span><span className="font-sans text-xs uppercase tracking-wider text-ink">{r.name}</span> · {r.position} {r.overall} · {r.team}</span>
                    <span className={cn("font-sans text-[10px]", r.tier === "high" ? "text-dw-red" : "text-ink3")}>{r.tier}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* Deep-dive chapters */}
      <div>
        <h3 className="mb-3 font-headline text-xs uppercase tracking-widest text-ink3">Offseason Chapters</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {OFFSEASON_PHASES.map((p) => (
            <button
              key={p.phase}
              type="button"
              onClick={() => void runPhase(p.phase)}
              disabled={loadingPhase !== null}
              className={cn(
                "rounded border border-dw-border bg-paper2 p-4 text-left transition-colors hover:border-dw-accent disabled:opacity-50",
                loadingPhase === p.phase && "border-dw-accent"
              )}
            >
              <p className="font-headline text-sm uppercase tracking-wide text-ink">{p.title}</p>
              <p className="mt-0.5 font-sans text-xs text-ink3">{p.subtitle}</p>
              {loadingPhase === p.phase && <p className="mt-1 font-sans text-xs text-dw-accent">Writing…</p>}
            </button>
          ))}
        </div>
        {phaseContent && renderPhase(phaseContent)}
      </div>
    </div>
  );
}
