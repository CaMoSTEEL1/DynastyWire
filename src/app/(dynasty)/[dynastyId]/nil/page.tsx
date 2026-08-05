"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/section-header";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useIssueTab } from "@/components/dynasty/use-issue-tab";
import { useSaga } from "@/components/dynasty/use-saga";
import { issueKey, readTab, writeTab } from "@/lib/dynasty/issue-cache";
import { applyImpact, type ImpactResult, type RosterPlayer } from "@/lib/dynasty/client";

// Points → money: 1 program point = $1,000 of NIL compensation. Transparent + fixed so the
// budgeting math is easy to reason about ("I have 6,900 points = $6.9M to distribute").
const POINTS_PER_K = 1;
// Format a $K figure — rolls up to $X.XM once it crosses a million so big valuations stay
// readable (a national-champ QB reads "$4.2M", not "$4,200K").
const fmtMoney = (k: number | null | undefined) =>
  k == null ? "—" : k >= 1000 ? `$${(k / 1000).toFixed(k % 1000 === 0 ? 0 : 1)}M` : `$${k.toLocaleString()}K`;

// Flavor GPA lives in the shared academics lib — the Situation Room uses the same numbers,
// and an At-Risk player can (rarely) be ruled academically ineligible there.
import { fakeGpa, GPA_COLOR } from "@/lib/dynasty/academics";
import { loadSuspensions, isActive, type Suspension } from "@/lib/dynasty/suspensions";
import { playerMarketValue } from "@/lib/dynasty/valuation";
import { scaleStipend, signDeal } from "@/lib/dynasty/deals";
import { commitWrites, loadLedger, pruneWritten, saveDrafts, setWritten as persistWritten } from "@/lib/dynasty/nil-ledger";

// Depth-chart order: group by position, sort by OVR (top = starter).
function byDepthChart(roster: RosterPlayer[]): { pos: string; players: RosterPlayer[] }[] {
  const groups = new Map<string, RosterPlayer[]>();
  for (const p of roster) {
    const pos = p.position ?? "ATH";
    if (!groups.has(pos)) groups.set(pos, []);
    groups.get(pos)!.push(p);
  }
  const POS_ORDER = ["QB", "HB", "FB", "WR", "TE", "LT", "LG", "C", "RG", "RT", "LE", "RE", "DT", "LOLB", "MLB", "ROLB", "CB", "FS", "SS", "K", "P"];
  return [...groups.entries()]
    .map(([pos, players]) => ({ pos, players: players.sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0)) }))
    .sort((a, b) => {
      const ai = POS_ORDER.indexOf(a.pos); const bi = POS_ORDER.indexOf(b.pos);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
}

// ── Brand-deal meetings (AD / booster) ────────────────────────────────────────
interface BrandDeal {
  brand: string; category: string; broker: "AD" | "Booster"; pitch: string;
  stipendPoints: number; weeks: number; reputation: "clean" | "edgy" | "controversial";
  upside: string; risk: string;
  effects: { fanTrust: number; mediaHeat: number; boosterConfidence: number };
}
const REP_STYLE: Record<string, string> = {
  clean: "text-dw-green border-dw-green/40",
  edgy: "text-dw-yellow border-dw-yellow/40",
  controversial: "text-dw-red border-dw-red/40",
};

function BrandDeals() {
  const { generate, snapshot, dynastyId, year, week, settings } = useDynasty();
  const writeNil = settings.nilWriteToSave !== false; // default on
  // Deal value is OUR call, not the model's: scaled to this program's prestige so a rebuild
  // gets local money and a blue blood gets national money.
  const prestige = snapshot?.userTeam?.prestige ?? null;
  const perWeek = useCallback(
    (d: BrandDeal) => scaleStipend(d.stipendPoints, d.reputation, prestige),
    [prestige]
  );
  const saga = useSaga();
  const teamIndex = snapshot?.userTeam?.teamIndex ?? null;
  const [deals, setDeals] = useState<BrandDeal[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [signed, setSigned] = useState<Record<string, boolean>>({});
  const [busyBrand, setBusyBrand] = useState<string | null>(null);

  const cacheKey = issueKey(dynastyId, year, week);
  const TAB = "brand-deals";

  useEffect(() => {
    let cancelled = false;
    setDeals(null); setSigned({});
    (async () => {
      const rec = await readTab<{ deals: BrandDeal[]; signed: Record<string, boolean> }>(cacheKey, TAB);
      if (!cancelled && rec?.data?.deals) { setDeals(rec.data.deals); setSigned(rec.data.signed ?? {}); }
    })();
    return () => { cancelled = true; };
  }, [cacheKey]);

  const persist = useCallback(async (d: BrandDeal[], s: Record<string, boolean>) => {
    await writeTab(cacheKey, TAB, { status: "ready", data: { deals: d, signed: s }, error: null, generatedAt: Date.now() }, { dynastyId, year, week });
  }, [cacheKey, dynastyId, year, week]);

  const pull = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const data = await generate<{ deals: BrandDeal[]; error?: boolean }>("brand-deals", {}, { force: true });
      if (!data || data.error || !Array.isArray(data.deals) || data.deals.length === 0) setErr("No offers on the table right now — try again.");
      else { setDeals(data.deals); setSigned({}); await persist(data.deals, {}); }
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't reach the boardroom."); }
    finally { setLoading(false); }
  }, [generate, persist]);

  const accept = useCallback(async (d: BrandDeal) => {
    // The per-brand `signed` guard (persisted with the week's deals) makes this idempotent —
    // a signed deal never re-applies, even if the card re-renders or the tab is reopened.
    if (signed[d.brand] || busyBrand) return;
    setBusyBrand(d.brand);
    try {
      // Reputational tradeoff hits the meters immediately (this always happens, even with
      // NIL-to-save turned off — the hot seat still moves).
      await saga.adjustMeters(d.effects);
      // Register the deal on the ledger — NO money moves here. Its weekly slice is paid out
      // once per in-game week by disburseWeekly(). (The old code wrote the ENTIRE run's
      // points the moment you signed, which is what people saw as a runaway payout.)
      if (writeNil && d.stipendPoints > 0) {
        await signDeal(dynastyId, {
          brand: d.brand,
          pointsPerWeek: perWeek(d),
          weeks: Math.max(1, Math.round(d.weeks || 1)),
          startYear: year,
          startWeek: week,
        }).catch(() => {});
      }
      const nextSigned = { ...signed, [d.brand]: true };
      setSigned(nextSigned);
      if (deals) await persist(deals, nextSigned);
    } finally { setBusyBrand(null); }
  }, [signed, busyBrand, saga, writeNil, dynastyId, year, week, perWeek, deals, persist]);

  return (
    <div className="mb-8 overflow-hidden rounded border border-dw-border bg-paper2">
      <div className="h-1 w-full bg-gradient-to-r from-dw-accent2 via-dw-yellow to-dw-red" />
      <div className="px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Boardroom · Brand Deals</p>
            <h3 className="font-headline text-xl uppercase tracking-wide text-ink">NIL Partnership Offers</h3>
          </div>
          <button
            type="button"
            onClick={() => void pull()}
            disabled={loading}
            className="rounded border border-dw-accent bg-dw-accent px-4 py-2 font-sans text-xs uppercase tracking-wider text-paper hover:bg-dw-accent2 disabled:opacity-50"
          >
            {loading ? "Taking the meeting…" : deals ? "New Offers" : "Take the Meeting"}
          </button>
        </div>
        <p className="mt-2 font-serif text-xs text-ink3">
          Your AD and lead booster bring deals to the table. Offers are sized to your
          program&apos;s stature — a rebuild gets local money, a blue blood gets national money —
          and the stipend pays out <strong className="text-ink2">week by week</strong>, not all at
          once. Not all money is good money: a controversial brand pays more and poisons fan
          trust.{!writeNil && " NIL-to-save is off, so nothing is written to your save."}
        </p>
        {err && <p className="mt-3 font-serif text-sm text-dw-red">{err}</p>}

        {deals && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {deals.map((d) => {
              const isSigned = signed[d.brand];
              const eff = d.effects;
              return (
                <div key={d.brand} className={cn("rounded border p-4", isSigned ? "border-dw-green/40 bg-dw-green/5" : "border-dw-border bg-paper")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-headline text-sm uppercase tracking-wide text-ink">{d.brand}</span>
                    <span className={cn("rounded border px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-wider", REP_STYLE[d.reputation])}>{d.reputation}</span>
                  </div>
                  <p className="font-sans text-[10px] uppercase tracking-wider text-ink3">{d.category} · via {d.broker}</p>
                  <p className="mt-2 font-serif text-sm text-ink2">{d.pitch}</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 font-sans text-[11px]">
                    <span className="text-dw-green">+{perWeek(d).toLocaleString()} pts per week</span>
                    <span className="text-ink3">
                      × {d.weeks}wk · {(perWeek(d) * d.weeks).toLocaleString()} total
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-sans text-[10px]">
                    {eff.fanTrust !== 0 && <span className={eff.fanTrust > 0 ? "text-dw-green" : "text-dw-red"}>Fans {eff.fanTrust > 0 ? "+" : ""}{eff.fanTrust}</span>}
                    {eff.mediaHeat !== 0 && <span className={eff.mediaHeat > 0 ? "text-dw-red" : "text-dw-green"}>Media heat {eff.mediaHeat > 0 ? "+" : ""}{eff.mediaHeat}</span>}
                    {eff.boosterConfidence !== 0 && <span className={eff.boosterConfidence > 0 ? "text-dw-green" : "text-dw-red"}>Boosters {eff.boosterConfidence > 0 ? "+" : ""}{eff.boosterConfidence}</span>}
                  </div>
                  {d.risk && <p className="mt-1.5 font-serif text-[11px] italic text-ink3">{d.risk}</p>}
                  <div className="mt-3">
                    {isSigned ? (
                      <span className="font-sans text-[10px] uppercase tracking-wider text-dw-green">✓ Signed</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void accept(d)}
                        disabled={busyBrand === d.brand}
                        className="rounded border border-dw-accent bg-dw-accent/15 px-3 py-1.5 font-sans text-[10px] uppercase tracking-wider text-dw-accent hover:bg-dw-accent/25 disabled:opacity-40"
                      >
                        {busyBrand === d.brand ? "Signing…" : "Sign the Deal"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

interface NilPost { handle: string; displayName: string; type: string; body: string; likes: number; reposts: number }

function NILManager() {
  const { roster, snapshot, currentSavePath, generate, dynastyId, year, week, settings } = useDynasty();
  const team = snapshot?.userTeam ?? null;
  const teamIndex = team?.teamIndex ?? null;
  const writeNil = settings.nilWriteToSave !== false; // default on

  // Names currently serving a suspension — badged in the depth chart.
  const [suspended, setSuspended] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    loadSuspensions(dynastyId)
      .then((l: Suspension[]) => {
        if (cancelled) return;
        setSuspended(new Set(l.filter((s) => isActive(s, year, week)).map((s) => s.playerName.toLowerCase())));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dynastyId, year, week]);

  // Draft NIL edits keyed by player name (only changed players are written), plus the
  // overlay of what we've already written. Both are persisted — see nil-ledger.ts for why
  // holding them in component state alone made the page look like it kept resetting.
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [written, setWritten] = useState<Record<string, number>>({});
  const [ledgerReady, setLedgerReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImpactResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reactions, setReactions] = useState<NilPost[] | null>(null);

  const depth = useMemo(() => byDepthChart(roster ?? []), [roster]);
  const posOf = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const p of roster ?? []) m.set(p.name, p.position ?? null);
    return m;
  }, [roster]);

  // What the save currently reports, by player — used to retire overlay entries the roster
  // has caught up with.
  const rosterValues = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of roster ?? []) m.set(p.name, p.nilComp ?? 0);
    return m;
  }, [roster]);

  // Restore drafts and the written overlay. Without this a tab switch (which remounts the
  // whole provider) wiped every edit that hadn't been pushed yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const l = await loadLedger(dynastyId).catch(() => null);
      if (cancelled || !l) { if (!cancelled) setLedgerReady(true); return; }
      const { pruned, changed } = pruneWritten(l.written, rosterValues, l.writtenAt, { year, week });
      setWritten(pruned);
      setEdits(l.drafts);
      setLedgerReady(true);
      if (changed) await persistWritten(dynastyId, pruned, l.writtenAt).catch(() => {});
    })();
    return () => { cancelled = true; };
    // rosterValues is intentionally excluded: this restores once per dynasty, and pruning
    // against a later roster happens on the next mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynastyId, year, week]);

  /** The value the save (or our last successful write) says this player is on. */
  const currentOf = useCallback(
    (p: RosterPlayer) => written[p.name] ?? p.nilComp ?? 0,
    [written]
  );

  // Persist drafts as they're typed. Cheap — one small JSON file, and it is the difference
  // between losing an afternoon's allotment and not.
  useEffect(() => {
    if (!ledgerReady) return;
    void saveDrafts(dynastyId, edits).catch(() => {});
  }, [edits, dynastyId, ledgerReady]);

  // The spendable pool. RemainingProgramPoints when the save exposes it, else the full budget.
  const pool = (team?.pointsRemaining && team.pointsRemaining > 0 ? team.pointsRemaining : team?.pointBudget) ?? 0;

  const changes = useMemo(() => {
    const out: { name: string; from: number; to: number }[] = [];
    for (const g of depth) for (const p of g.players) {
      const cur = currentOf(p);
      const next = edits[p.name];
      if (next != null && next !== cur) out.push({ name: p.name, from: cur, to: next });
    }
    return out;
  }, [edits, depth, currentOf]);

  const netK = changes.reduce((s, c) => s + (c.to - c.from), 0); // total NIL added ($K)
  const pointCost = Math.max(0, netK) * POINTS_PER_K;
  const overBudget = pointCost > pool;

  async function push() {
    if (!currentSavePath || teamIndex == null || changes.length === 0 || busy) return;
    if (!writeNil) { setErr("NIL-to-save is turned off in Settings → Immersion. Turn it on to write deals to your save."); return; }
    setBusy(true); setErr(null);
    try {
      const res = await applyImpact(currentSavePath, {
        teamIndex,
        nil: changes.map((c) => ({ name: c.name, value: c.to })),
        // Deduct the net points spent (only when adding NIL; refunds when lowering aren't credited back).
        programPointsDelta: netK > 0 ? -pointCost : 0,
      });
      if (!res.ok) { setErr(res.detail || "The save refused the write. Close the game and try again."); return; }
      setResult(res);
      const dealsForWire = changes.map((c) => ({ name: c.name, position: posOf.get(c.name) ?? undefined, from: c.from, to: c.to }));
      // Hold what we just wrote. The roster in memory still carries the OLD figures until the
      // next ingest, so without this overlay every row visibly snapped back the moment the
      // write succeeded — the "it constantly resets" report.
      const applied = Object.fromEntries(changes.map((c) => [c.name, c.to]));
      const next = await commitWrites(dynastyId, applied, { year, week }).catch(() => null);
      setWritten(next ? next.written : (w) => ({ ...w, ...applied }));
      setEdits({});
      // The wire reacts — big deals get big reactions, small deals barely register.
      setReactions(null);
      try {
        const wire = await generate<{ posts: NilPost[]; error?: boolean }>("nil-reaction", { deals: dealsForWire }, { force: true });
        if (wire && !wire.error && Array.isArray(wire.posts)) setReactions(wire.posts);
      } catch { /* reactions are a bonus */ }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "NIL write failed.");
    } finally { setBusy(false); }
  }

  if (!roster || roster.length === 0) {
    return null;
  }

  return (
    <div className="mb-8 overflow-hidden rounded border border-dw-border bg-paper2">
      <div className="h-1 w-full bg-gradient-to-r from-dw-green via-dw-accent2 to-dw-accent" />
      <div className="px-6 py-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">NIL Collective · Allot Anytime</p>
            <h3 className="font-headline text-xl uppercase tracking-wide text-ink">Player NIL Deals</h3>
          </div>
          <div className="text-right">
            <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">Program Points</p>
            <p className="font-headline text-lg font-bold text-ink">{pool.toLocaleString()} <span className="font-sans text-xs text-ink3">= {fmtMoney(Math.round(pool / POINTS_PER_K))} to give</span></p>
          </div>
        </div>
        <p className="mt-2 font-serif text-xs text-ink3">
          1 program point = $1K NIL. Raise a player&apos;s deal to reward production; it writes to your
          save (backed up + verified) and applies in-game. Do it whenever during the season.
        </p>

        {result?.ok && (
          <p className="mt-3 rounded border border-dw-green/30 bg-dw-green/5 px-3 py-2 font-sans text-[10px] uppercase tracking-wider text-dw-green">
            NIL written to your save ✓{result.verified === false ? " (partial — see console)" : ""} · {result.applied?.nil?.length ?? 0} players updated
          </p>
        )}

        {reactions && reactions.length > 0 && (
          <div className="mt-3 space-y-2 rounded border border-dw-border bg-paper p-3">
            <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">The Wire Reacts</p>
            {reactions.map((p, i) => (
              <div key={i} className="border-b border-dw-border/40 pb-2 last:border-0">
                <p className="font-sans text-[11px] text-ink3">
                  <span className="text-ink">{p.displayName}</span> {p.handle}
                  <span className="ml-2 rounded border border-dw-border px-1 text-[9px] uppercase tracking-wider">{p.type}</span>
                </p>
                <p className="font-serif text-sm text-ink2">{p.body}</p>
                <p className="mt-0.5 font-sans text-[9px] text-ink3">♥ {p.likes.toLocaleString()} · ↻ {p.reposts.toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
        {err && <p className="mt-3 font-serif text-sm text-dw-red">{err}</p>}

        <div className="mt-4 max-h-[28rem] space-y-4 overflow-y-auto pr-1">
          {depth.map((g) => (
            <div key={g.pos}>
              <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">{g.pos}</p>
              <div className="mt-1 space-y-1">
                {g.players.map((p, i) => {
                  const cur = currentOf(p);
                  const val = edits[p.name] ?? cur;
                  return (
                    <div key={p.name} className="flex items-center gap-3 border-b border-dw-border/40 py-1.5 last:border-0">
                      <span className="w-6 text-center font-sans text-[10px] text-ink3">{i === 0 ? "ST" : i + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-serif text-sm text-ink">
                        {p.name} <span className="font-sans text-[10px] text-ink3">{p.overall} OVR{p.year ? ` · ${p.year}` : ""}</span>
                        {suspended.has(p.name.toLowerCase()) && (
                          <span className="ml-2 rounded border border-dw-red/50 px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-wider text-dw-red">
                            Suspended
                          </span>
                        )}
                      </span>
                      {(() => { const g = fakeGpa(p); return (
                        <span
                          className={cn("w-28 shrink-0 text-right font-sans text-[10px]", GPA_COLOR[g.status])}
                          title={g.status}
                        >
                          {g.gpa.toFixed(2)} GPA{g.status !== "Eligible" ? ` · ${g.status}` : ""}
                        </span>
                      ); })()}
                      <span
                        className="hidden w-24 text-right font-sans text-[10px] text-ink3 sm:block"
                        title="DynastyWire's estimated NIL market value (rating, position, production, and how good the program is)"
                      >
                        worth {fmtMoney(playerMarketValue(p, team))}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="font-sans text-[10px] text-ink3">$</span>
                        <input
                          type="number"
                          min={0}
                          value={val}
                          onChange={(e) => setEdits((s) => ({ ...s, [p.name]: Math.max(0, Number(e.target.value) || 0) }))}
                          className={cn(
                            "w-20 rounded border bg-paper px-2 py-1 text-right font-sans text-xs text-ink focus:outline-none",
                            val !== cur ? "border-dw-accent2" : "border-dw-border"
                          )}
                        />
                        <span className="font-sans text-[10px] text-ink3">K</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-dw-border pt-4">
          <p className="font-sans text-xs text-ink3">
            {changes.length === 0
              ? "Edit any player's deal to begin."
              : `${changes.length} change${changes.length === 1 ? "" : "s"} · ${netK >= 0 ? "+" : ""}${fmtMoney(netK)} NIL · ${pointCost.toLocaleString()} points`}
            {overBudget && <span className="ml-2 text-dw-red">over budget</span>}
          </p>
          <div className="flex gap-2">
            {changes.length > 0 && (
              <button type="button" onClick={() => setEdits({})} className="rounded border border-dw-border px-3 py-1.5 font-sans text-[10px] uppercase tracking-wider text-ink3 hover:text-ink">
                Reset
              </button>
            )}
            <button
              type="button"
              onClick={() => void push()}
              disabled={busy || changes.length === 0 || overBudget || !writeNil}
              title={writeNil ? undefined : "NIL-to-save is off (Settings → Immersion)"}
              className="rounded border border-dw-accent bg-dw-accent px-4 py-2 font-sans text-xs uppercase tracking-wider text-paper hover:bg-dw-accent2 disabled:opacity-40"
            >
              {busy ? "Writing to save…" : !writeNil ? "NIL Writes Off" : "Push NIL to Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface MarketNote {
  label: string;
  text: string;
}

interface NILMarketColumn {
  headline: string;
  body: string;
  marketTemp: string;
  tempReason: string;
  notes: MarketNote[];
}

const TEMP_CONFIG: Record<string, { label: string; color: string }> = {
  cold: { label: "Cold", color: "text-ink3" },
  warm: { label: "Warm", color: "text-dw-yellow" },
  hot: { label: "Hot", color: "text-dw-accent" },
  "red-hot": { label: "Red Hot", color: "text-dw-red" },
};

function TempBadge({ temp }: { temp: string }) {
  const cfg = TEMP_CONFIG[temp] ?? TEMP_CONFIG.warm;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border border-current px-2.5 py-1 font-sans text-xs uppercase tracking-wider",
        cfg.color
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {cfg.label} Market
    </span>
  );
}

export default function NILPage() {
  const { snapshot, loading, error, generate, hasApiKey, currentSavePath } =
    useDynasty();

  const [column, setColumn] = useState<NILMarketColumn | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Restore this week's market column from the persisted issue cache on mount.
  const cachedColumn = useIssueTab<NILMarketColumn>("nil");
  useEffect(() => {
    if (!column && cachedColumn) setColumn(cachedColumn);
  }, [cachedColumn, column]);

  const canGenerate = Boolean(currentSavePath && hasApiKey);

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      const result = await generate<NILMarketColumn>("nil", {});
      setColumn(result);
    } catch (err) {
      setGenError(
        err instanceof Error ? err.message : "Failed to generate NIL report."
      );
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div>
        <SectionHeader title="NIL & PORTAL" subtitle="Money moves and roster drama" />
        <div className="mt-8 rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
          <p className="font-serif italic text-ink3">Reading your save&hellip;</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <SectionHeader title="NIL & PORTAL" subtitle="Money moves and roster drama" />
        <div className="mt-8 rounded border border-dw-red/30 bg-dw-red/10 px-6 py-12 text-center">
          <p className="font-serif text-dw-red">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="NIL & PORTAL" subtitle="Money moves and roster drama" />

      {/* NIL economy: brand-deal meetings (headroom vs reputation) + player allotment. */}
      <div className="mt-6">
        <BrandDeals />
        <NILManager />
      </div>

      <div className="space-y-6">

        <div className="rounded border border-dw-border bg-paper">
          <div className="flex items-center justify-between gap-4 border-b border-dw-border bg-paper2 px-4 py-3">
            <h3 className="font-headline text-sm uppercase tracking-wider text-ink2">
              Market Watch
            </h3>
            {column && <TempBadge temp={column.marketTemp} />}
          </div>

          <div className="px-5 py-5">
            {!column ? (
              <div className="py-6 text-center">
                <p className="font-serif text-sm text-ink2">
                  Generate a read on your program&apos;s NIL collective and
                  transfer-portal climate — grounded in this season&apos;s results.
                </p>

                {genError && (
                  <p className="mt-3 font-sans text-sm text-dw-red">{genError}</p>
                )}

                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating || !canGenerate}
                  className={cn(
                    "mt-6 inline-flex items-center gap-2 rounded border border-dw-accent bg-dw-accent/10 px-5 py-2.5",
                    "font-headline text-sm uppercase tracking-wider text-dw-accent",
                    "transition-colors hover:bg-dw-accent/20",
                    "disabled:cursor-not-allowed disabled:opacity-50"
                  )}
                >
                  {generating ? "Reading the market…" : "Generate NIL Report"}
                </button>

                {!canGenerate && (
                  <p className="mt-3 font-sans text-xs text-ink3">
                    Add your save and API key in settings to generate.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <h4 className="font-headline text-xl leading-tight text-ink">
                  {column.headline}
                </h4>
                <p className="mt-2 font-serif text-sm leading-relaxed text-ink2">
                  {column.body}
                </p>
                {column.tempReason && (
                  <p className="mt-2 font-serif italic text-sm text-ink3">
                    {column.tempReason}
                  </p>
                )}

                <div className="my-5 flex items-center gap-3 text-dw-accent/60">
                  <span className="h-px flex-1 bg-dw-border" />
                  <span className="text-xs">&#9670;</span>
                  <span className="h-px flex-1 bg-dw-border" />
                </div>

                <div className="space-y-4">
                  {(column.notes ?? []).map((note, i) => (
                    <div key={i} className="border-l-2 border-dw-border pl-4">
                      <h5 className="font-headline text-xs uppercase tracking-wider text-dw-accent2">
                        {note.label}
                      </h5>
                      <p className="mt-1 font-serif text-sm leading-relaxed text-ink2">
                        {note.text}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="mt-6 border-t border-dw-border pt-4">
                  <button
                    type="button"
                    onClick={handleGenerate}
                    disabled={generating}
                    className={cn(
                      "inline-flex items-center gap-2 rounded border border-dw-border bg-paper2 px-4 py-2",
                      "font-sans text-xs text-ink3",
                      "transition-colors hover:border-dw-accent hover:text-dw-accent",
                      "disabled:cursor-not-allowed disabled:opacity-50"
                    )}
                  >
                    {generating ? "Regenerating…" : "Regenerate Report"}
                  </button>
                  {genError && (
                    <p className="mt-2 font-sans text-xs text-dw-red">{genError}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
