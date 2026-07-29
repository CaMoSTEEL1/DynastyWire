"use client";

// The Vault — DynastyWire's permanent, multi-year record. Reads the Season Archive (written
// continuously as you play) and lets you export every year's numbers to CSV / JSON so you
// keep them forever. Pure data: no API cost.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, FileJson, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import {
  loadArchive,
  toStatsCsv,
  toArchiveJson,
  downloadTextFile,
  type SeasonRecord,
} from "@/lib/dynasty/archive";

const RESULT_STYLE: Record<string, { label: string; cls: string }> = {
  "national-champ": { label: "National Champions", cls: "text-dw-yellow" },
  "made-postseason": { label: "Postseason", cls: "text-dw-green" },
  regular: { label: "—", cls: "text-ink3" },
};

function safeName(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "dynasty";
}

export function SeasonRecords() {
  const { dynastyId, snapshot, year } = useDynasty();
  const [records, setRecords] = useState<SeasonRecord[] | null>(null);

  const reload = useCallback(() => {
    loadArchive(dynastyId).then(setRecords).catch(() => setRecords([]));
  }, [dynastyId]);

  // Load on mount and whenever the season state moves (the provider's checkpoint writes
  // asynchronously, so re-reading on snapshot/year change picks up the freshest record).
  useEffect(() => {
    reload();
  }, [reload, snapshot, year]);

  const team = snapshot?.userTeam?.name ?? records?.[0]?.team ?? "dynasty";

  // Career bests across every archived season (single-season highs).
  const careerBests = useMemo(() => {
    if (!records?.length) return [];
    const cats: { key: keyof SeasonRecord["roster"][number]; label: string; unit: string }[] = [
      { key: "passYds", label: "Passing (season)", unit: "yds" },
      { key: "rushYds", label: "Rushing (season)", unit: "yds" },
      { key: "recYds", label: "Receiving (season)", unit: "yds" },
      { key: "tackles", label: "Tackles (season)", unit: "" },
      { key: "sacks", label: "Sacks (season)", unit: "" },
    ];
    return cats
      .map(({ key, label, unit }) => {
        let best: { player: string; year: number; value: number } | null = null;
        for (const s of records)
          for (const p of s.roster) {
            const v = Number(p[key] ?? 0);
            if (v > 0 && (!best || v > best.value)) best = { player: p.name, year: s.year, value: v };
          }
        return best ? { label, unit, ...best } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
  }, [records]);

  const exportCsv = () => {
    if (!records?.length) return;
    downloadTextFile(`dynastywire-${safeName(team)}-stats.csv`, "text/csv;charset=utf-8", toStatsCsv(records));
  };
  const exportJson = () => {
    if (!records?.length) return;
    downloadTextFile(`dynastywire-${safeName(team)}-archive.json`, "application/json", toArchiveJson(records));
  };

  const hasData = !!records && records.length > 0;

  return (
    <div className="rounded border border-dw-border bg-paper2">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dw-border px-6 py-4">
        <div>
          <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">The Vault</p>
          <h3 className="font-headline text-lg uppercase tracking-wide text-ink">Season Records</h3>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={exportCsv}
            disabled={!hasData}
            className="inline-flex items-center gap-1.5 rounded border border-dw-border px-3 py-1.5 font-sans text-[10px] uppercase tracking-wider text-ink2 hover:border-dw-accent hover:text-dw-accent disabled:opacity-40"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Export CSV
          </button>
          <button
            type="button"
            onClick={exportJson}
            disabled={!hasData}
            className="inline-flex items-center gap-1.5 rounded border border-dw-border px-3 py-1.5 font-sans text-[10px] uppercase tracking-wider text-ink2 hover:border-dw-accent hover:text-dw-accent disabled:opacity-40"
          >
            <FileJson className="h-3.5 w-3.5" /> Export JSON
          </button>
        </div>
      </div>

      {!hasData ? (
        <div className="px-6 py-10 text-center">
          <Download className="mx-auto h-6 w-6 text-ink3" />
          <p className="mt-2 font-serif text-sm text-ink2">
            Your record vault fills in as you play. Finish a game and this season starts tracking —
            every year is kept here and can be exported to a spreadsheet you own.
          </p>
        </div>
      ) : (
        <div className="px-6 py-5">
          {/* Season-by-season */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-left">
              <thead>
                <tr className="border-b border-dw-border font-sans text-[10px] uppercase tracking-wider text-ink3">
                  <th className="py-2 pr-3">Year</th>
                  <th className="py-2 pr-3">Record</th>
                  <th className="py-2 pr-3">Conf</th>
                  <th className="py-2 pr-3">Final Rank</th>
                  <th className="py-2 pr-3">Result</th>
                  <th className="py-2">Champion</th>
                </tr>
              </thead>
              <tbody>
                {records.map((s) => {
                  const res = RESULT_STYLE[s.result ?? "regular"] ?? RESULT_STYLE.regular;
                  return (
                    <tr key={s.year} className="border-b border-dw-border/50 font-serif text-sm text-ink">
                      <td className="py-2 pr-3 font-headline">{s.year}</td>
                      <td className="py-2 pr-3">{s.wins}-{s.losses}</td>
                      <td className="py-2 pr-3 text-ink2">
                        {s.confWins != null ? `${s.confWins}-${s.confLosses ?? 0}` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-ink2">
                        {s.finalRankMedia ? `#${s.finalRankMedia}` : "NR"}
                        {s.finalRankCFP ? ` · CFP #${s.finalRankCFP}` : ""}
                      </td>
                      <td className={cn("py-2 pr-3 font-sans text-[11px] uppercase tracking-wider", res.cls)}>{res.label}</td>
                      <td className="py-2 font-serif text-sm text-ink2">{s.champion ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Career bests */}
          {careerBests.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 font-sans text-[10px] uppercase tracking-widest text-ink3">Career Bests</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {careerBests.map((b) => (
                  <div key={b.label} className="rounded border border-dw-border bg-paper px-3 py-2">
                    <p className="font-sans text-[10px] uppercase tracking-wider text-ink3">{b.label}</p>
                    <p className="font-serif text-sm text-ink">
                      {b.player} <span className="text-ink3">({b.year})</span>
                    </p>
                    <p className="font-headline text-base text-dw-accent2">
                      {b.value.toLocaleString()}{b.unit ? ` ${b.unit}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="mt-5 font-serif text-[11px] italic text-ink3">
            The Vault keeps every season you play through DynastyWire — records, stat lines, and
            leaders — even after players graduate or transfer out of your save.
          </p>
        </div>
      )}
    </div>
  );
}
