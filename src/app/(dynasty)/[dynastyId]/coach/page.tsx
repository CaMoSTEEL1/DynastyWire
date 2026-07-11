"use client";

import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/section-header";
import { useSettings } from "@/components/settings/settings-context";
import { useDynasty } from "@/components/dynasty/dynasty-context";

// ── Display helpers ──────────────────────────────────────────────────────────

// Prestige can arrive from settings as a slug (old dynasties) or, from the save,
// as a 0–10 number. Handle both so the hub degrades gracefully either way.
const PRESTIGE_CONFIG: Record<string, { label: string; badge: string; desc: string }> = {
  blue_blood:   { label: "Blue Blood",   badge: "border-dw-red text-dw-red bg-dw-red/10",             desc: "Historic program with generational expectations." },
  rising_power: { label: "Rising Power", badge: "border-dw-accent2 text-dw-accent2 bg-dw-accent2/10", desc: "Building toward elite status with momentum." },
  rebuild:      { label: "Rebuild",      badge: "border-ink3 text-ink3 bg-ink3/10",                   desc: "Starting from scratch. Every win matters." },
};

function prestigeFromNumber(n: number): { label: string; badge: string; desc: string } {
  if (n >= 8) return PRESTIGE_CONFIG.blue_blood;
  if (n >= 5) return PRESTIGE_CONFIG.rising_power;
  return PRESTIGE_CONFIG.rebuild;
}

function StatBox({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded border border-dw-border bg-paper2 px-4 py-3 text-center">
      <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">{label}</p>
      <p className="mt-1 font-headline text-2xl font-bold text-ink">{value}</p>
      {sub && <p className="mt-0.5 font-sans text-xs text-ink3">{sub}</p>}
    </div>
  );
}

function PulseRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-dw-border py-3 last:border-b-0">
      <span className="font-sans text-xs uppercase tracking-wider text-ink3">{label}</span>
      {children}
    </div>
  );
}

function LoadingDots() {
  return (
    <div className="mt-8 flex items-center justify-center py-16">
      <div className="flex gap-1.5">
        <span className="h-2 w-2 animate-pulse rounded-full bg-dw-accent" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-dw-accent [animation-delay:200ms]" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-dw-accent [animation-delay:400ms]" />
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function CoachPage() {
  const { dynasty } = useSettings();
  const { snapshot, loading, error } = useDynasty();

  const team = snapshot?.userTeam ?? null;

  // Resolve prestige from either the settings slug or the save's numeric value.
  const numericPrestige = team?.prestige;
  const prestige =
    typeof numericPrestige === "number"
      ? prestigeFromNumber(numericPrestige)
      : PRESTIGE_CONFIG[dynasty.prestige] ?? PRESTIGE_CONFIG.rebuild;

  const wins = team?.wins ?? 0;
  const losses = team?.losses ?? 0;
  const gamesPlayed = wins + losses;
  const winPct =
    gamesPlayed > 0 ? `${Math.round((wins / gamesPlayed) * 1000) / 10}%` : "—";

  // Simple standing derived from record — no hot-seat/contract data in the save yet.
  const standing =
    gamesPlayed === 0
      ? { label: "Season Opener", color: "text-ink2", desc: "The season hasn't kicked off." }
      : wins > losses
        ? { label: "Winning Season", color: "text-dw-green", desc: "The program is trending up." }
        : wins === losses
          ? { label: "Even Keel", color: "text-dw-yellow", desc: "Every game from here defines the year." }
          : { label: "Under Pressure", color: "text-dw-red", desc: "The margin for error is gone." };

  if (loading && !snapshot) {
    return (
      <div>
        <SectionHeader title="COACH PROFILE" subtitle="Your program at a glance" />
        <LoadingDots />
      </div>
    );
  }

  if (error && !snapshot) {
    return (
      <div>
        <SectionHeader title="COACH PROFILE" subtitle="Your program at a glance" />
        <div className="mt-8 rounded border border-dw-red/40 bg-dw-red/5 px-6 py-8 text-center">
          <p className="font-serif text-sm text-ink2">
            Couldn&apos;t read your save. {error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <SectionHeader
        title="COACH PROFILE"
        subtitle={dynasty.conference ? `${dynasty.school} — ${dynasty.conference}` : dynasty.school}
      />

      {/* ── Identity Card ──────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded border border-dw-border bg-paper2">
        <div className="h-1 w-full bg-gradient-to-r from-dw-red via-dw-accent2 to-dw-accent" />
        <div className="px-6 py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-dw-red text-xl font-bold text-paper">
                {dynasty.coachName.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">Head Coach</p>
                <h1 className="font-headline text-2xl uppercase tracking-wide text-ink">
                  {dynasty.coachName}
                </h1>
                <p className="font-serif text-sm italic text-ink3">{team?.name ?? dynasty.school}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:flex-col sm:items-end">
              <span
                className={cn(
                  "inline-block rounded border px-3 py-1 font-sans text-xs font-semibold uppercase tracking-wider",
                  prestige.badge
                )}
              >
                {prestige.label}
              </span>
              {typeof snapshot?.week === "number" && (
                <span className="rounded border border-dw-border bg-paper3 px-3 py-1 font-sans text-xs text-ink3">
                  Week {snapshot.week}
                </span>
              )}
            </div>
          </div>
          <p className="mt-4 font-serif text-sm italic text-ink3">{prestige.desc}</p>
        </div>
      </div>

      {/* ── Season Snapshot ─────────────────────────────────────────────── */}
      {team ? (
        <>
          <div>
            <h3 className="mb-3 font-headline text-xs uppercase tracking-widest text-ink3">
              Season Snapshot
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatBox label="Record" value={`${wins}-${losses}`} />
              <StatBox
                label="Media Rank"
                value={team.rankMedia ? `#${team.rankMedia}` : "NR"}
                sub={team.rankCFP ? `CFP #${team.rankCFP}` : undefined}
              />
              <StatBox
                label="Conf Record"
                value={
                  team.confWins != null && team.confLosses != null
                    ? `${team.confWins}-${team.confLosses}`
                    : "—"
                }
                sub={dynasty.conference || undefined}
              />
              <StatBox label="Win Rate" value={winPct} sub={`${gamesPlayed} played`} />
            </div>
          </div>

          {/* ── Program Pulse (degraded — save has record + prestige only) ─── */}
          <div>
            <h3 className="mb-3 font-headline text-xs uppercase tracking-widest text-ink3">
              Program Pulse
            </h3>
            <div className="rounded border border-dw-border bg-paper2 px-5 py-1">
              <PulseRow label="Standing">
                <span className={cn("font-sans text-sm font-semibold uppercase tracking-wider", standing.color)}>
                  {standing.label}
                </span>
              </PulseRow>
              <PulseRow label="Program Prestige">
                <span className="font-sans text-sm font-semibold uppercase tracking-wider text-ink2">
                  {typeof numericPrestige === "number" ? `${numericPrestige}/10` : prestige.label}
                </span>
              </PulseRow>
              <PulseRow label="Overall Rating">
                <span className="font-sans text-sm font-semibold uppercase tracking-wider text-ink2">
                  {team.ratingOVR != null ? team.ratingOVR : "—"}
                </span>
              </PulseRow>
            </div>
            <p className="mt-2 font-serif text-xs italic text-ink3">{standing.desc}</p>
          </div>

          {/* ── Hot Seat & Career (real coach data from the save) ──────────── */}
          {snapshot?.coach && (
            <div>
              <h3 className="mb-3 font-headline text-xs uppercase tracking-widest text-ink3">
                Hot Seat &amp; Career
              </h3>
              <div className="rounded border border-dw-border bg-paper2 px-5 py-1">
                {snapshot.coach.jobSecurity && (
                  <PulseRow label="Job Security">
                    <span
                      className={cn(
                        "font-sans text-sm font-semibold uppercase tracking-wider",
                        /hot|fire|danger/i.test(snapshot.coach.jobSecurity)
                          ? "text-dw-red"
                          : /warm|lukewarm/i.test(snapshot.coach.jobSecurity)
                            ? "text-dw-yellow"
                            : "text-dw-green"
                      )}
                    >
                      {snapshot.coach.jobSecurity}
                      {snapshot.coach.fireReported ? " · FIRE REPORTED" : ""}
                    </span>
                  </PulseRow>
                )}
                {snapshot.coach.careerWinSeasons != null && (
                  <PulseRow label="Winning Seasons">
                    <span className="font-sans text-sm font-semibold uppercase tracking-wider text-ink2">
                      {snapshot.coach.careerWinSeasons}
                    </span>
                  </PulseRow>
                )}
                {snapshot.coach.careerPlayoffs != null && (
                  <PulseRow label="Playoffs Made">
                    <span className="font-sans text-sm font-semibold uppercase tracking-wider text-ink2">
                      {snapshot.coach.careerPlayoffs}
                    </span>
                  </PulseRow>
                )}
                {snapshot.coach.careerLongWinStreak != null && (
                  <PulseRow label="Longest Win Streak">
                    <span className="font-sans text-sm font-semibold uppercase tracking-wider text-ink2">
                      {snapshot.coach.careerLongWinStreak}
                    </span>
                  </PulseRow>
                )}
                {snapshot.coach.age != null && (
                  <PulseRow label="Age">
                    <span className="font-sans text-sm font-semibold uppercase tracking-wider text-ink2">
                      {snapshot.coach.age}
                    </span>
                  </PulseRow>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
          <p className="font-serif text-ink2">
            No team data in this save yet. Play a week to start tracking your program.
          </p>
        </div>
      )}
    </div>
  );
}
