// The v2 hallucination baseline.
//
// Before a single generator is restructured, we need a real number: violations per piece,
// by surface and by model. Otherwise the refactor is blind — "it feels better" is not a
// claim, and there is no way to prove a surface improved or to calibrate the ship gate
// (< 0.5 violated facts per piece on the cheap model).
//
// This is observe-only infrastructure. It records what the fact-checker saw and never
// touches the generated payload. Every entry point swallows its own errors: a broken
// baseline must never break a generation.

import { LazyStore } from "@tauri-apps/plugin-store";
import type { ValidationReport, Violation, ViolationKind } from "./validator";

export interface BaselineRow {
  /** ms since epoch — stamped by the caller so this module stays testable. */
  at: number;
  kind: string;
  model: string;
  week: number | null;
  year: number | null;
  violations: number;
  hard: number;
  units: number;
  chars: number;
  counts: Partial<Record<ViolationKind, number>>;
  skipped: string[];
  /** A few offending spans, kept so the number can be eyeballed instead of trusted. */
  samples: { kind: ViolationKind; field: string; claim: string; truth: string | null }[];
}

const store = new LazyStore("dynastywire.baseline.json");
const KEY = "rows";
/** Enough to cover many full seasons of issues; old rows fall off the front. */
const MAX_ROWS = 2000;
const MAX_SAMPLES = 3;

export function rowFromReport(
  report: ValidationReport,
  meta: { model: string; week: number | null; year: number | null; at: number }
): BaselineRow {
  const counts: Partial<Record<ViolationKind, number>> = {};
  let hard = 0;
  for (const v of report.violations) {
    counts[v.kind] = (counts[v.kind] ?? 0) + 1;
    if (v.severity === "hard") hard++;
  }
  return {
    at: meta.at,
    kind: report.kind,
    model: meta.model,
    week: meta.week,
    year: meta.year,
    violations: report.violations.length,
    hard,
    units: report.units,
    chars: report.charsChecked,
    counts,
    skipped: report.skipped,
    samples: report.violations.slice(0, MAX_SAMPLES).map((v: Violation) => ({
      kind: v.kind,
      field: v.field,
      claim: v.claim,
      truth: v.truth,
    })),
  };
}

export async function recordBaseline(row: BaselineRow): Promise<void> {
  try {
    const rows = (await store.get<BaselineRow[]>(KEY)) ?? [];
    rows.push(row);
    await store.set(KEY, rows.length > MAX_ROWS ? rows.slice(rows.length - MAX_ROWS) : rows);
    await store.save();
  } catch {
    // Observe-only: a baseline that cannot be written is not a reason to fail a generation.
  }
}

export async function loadBaseline(): Promise<BaselineRow[]> {
  try {
    return (await store.get<BaselineRow[]>(KEY)) ?? [];
  } catch {
    return [];
  }
}

export async function clearBaseline(): Promise<void> {
  try {
    await store.set(KEY, []);
    await store.save();
  } catch {
    // ignored, as above
  }
}

export interface BaselineCell {
  kind: string;
  model: string;
  pieces: number;
  /** Prose fields scanned across those pieces. */
  units: number;
  violations: number;
  hard: number;
  /** THE metric: violated facts per generated piece. The v2 gate reads this column. */
  perPiece: number;
  /** Per unit of prose, so social's 15 posts compare honestly against a single recap. */
  perUnit: number;
  counts: Partial<Record<ViolationKind, number>>;
  /** Pieces where a check could not run at all. A clean surface and an unchecked surface
   * must never read the same. */
  piecesWithSkips: number;
  /** A few offending spans. Without these a report is a number nobody can audit: on the
   * first real run, 10 of 12 "violations" turned out to be checker false positives, and
   * the only way to tell was reading the claim against what the save says. */
  samples: { kind: ViolationKind; claim: string; truth: string | null }[];
}

export interface BaselineSummary {
  cells: BaselineCell[];
  totals: { pieces: number; violations: number; perPiece: number };
  /** ms-since-epoch range the rows cover, so a report can be tied to a build and a week. */
  span: { first: number; last: number } | null;
}

/** Aggregate rows into the per-surface, per-model table the gate is measured against. */
export function summarizeBaseline(rows: BaselineRow[]): BaselineSummary {
  const by = new Map<string, BaselineCell>();
  for (const r of rows) {
    const key = `${r.kind}::${r.model}`;
    let cell = by.get(key);
    if (!cell) {
      cell = {
        kind: r.kind,
        model: r.model,
        pieces: 0,
        units: 0,
        violations: 0,
        hard: 0,
        perPiece: 0,
        perUnit: 0,
        counts: {},
        piecesWithSkips: 0,
        samples: [],
      };
      by.set(key, cell);
    }
    cell.pieces++;
    cell.violations += r.violations;
    cell.hard += r.hard;
    if (r.skipped.length) cell.piecesWithSkips++;
    for (const [k, n] of Object.entries(r.counts)) {
      const vk = k as ViolationKind;
      cell.counts[vk] = (cell.counts[vk] ?? 0) + (n ?? 0);
    }
    cell.units += r.units;
    for (const s of r.samples) {
      if (cell.samples.length < MAX_SAMPLES) cell.samples.push(s);
    }
  }
  const cells = [...by.values()].map((c) => ({
    ...c,
    perPiece: c.pieces ? round(c.violations / c.pieces) : 0,
    perUnit: c.units ? round(c.violations / c.units) : 0,
  }));
  cells.sort((a, b) => b.perPiece - a.perPiece || a.kind.localeCompare(b.kind));
  const pieces = cells.reduce((n, c) => n + c.pieces, 0);
  const violations = cells.reduce((n, c) => n + c.violations, 0);
  const times = rows.map((r) => r.at).filter((t) => typeof t === "number" && t > 0);
  return {
    cells,
    totals: { pieces, violations, perPiece: pieces ? round(violations / pieces) : 0 },
    span: times.length ? { first: Math.min(...times), last: Math.max(...times) } : null,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * The private baseline publication (v2 step 2), as plain text: worst surface first, which
 * is also the order the seven frozen surfaces get ported in.
 */
export function formatBaseline(summary: BaselineSummary, appVersion?: string): string {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const lines = [
    `DynastyWire — hallucination baseline (observe-only)${appVersion ? ` · app ${appVersion}` : ""}`,
    `pieces: ${summary.totals.pieces} · violations: ${summary.totals.violations} · per piece: ${summary.totals.perPiece}` +
      (summary.span ? ` · ${day(summary.span.first)} → ${day(summary.span.last)}` : ""),
    "",
    "surface / model — per piece (violations / pieces) — top kinds",
  ];
  for (const c of summary.cells) {
    const top = Object.entries(c.counts)
      .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
      .slice(0, 3)
      .map(([k, n]) => `${k}×${n}`)
      .join(", ");
    lines.push(
      `${c.kind} / ${c.model} — ${c.perPiece} (${c.violations}/${c.pieces})` +
        (top ? ` — ${top}` : " — clean") +
        (c.piecesWithSkips ? ` · ${c.piecesWithSkips} piece(s) had unrunnable checks` : "")
    );
  }

  // The claims themselves. A rate with no examples can't be audited, and on the first real
  // run most "violations" were the checker's fault, not the model's.
  const withSamples = summary.cells.filter((c) => c.samples.length);
  if (withSamples.length) {
    lines.push("", "flagged claims (what the piece said → what the save says)");
    for (const c of withSamples) {
      for (const s of c.samples) {
        lines.push(`  [${c.kind}] ${s.kind}: "${s.claim}"${s.truth ? ` → ${s.truth}` : ""}`);
      }
    }
  }
  return lines.join("\n");
}
