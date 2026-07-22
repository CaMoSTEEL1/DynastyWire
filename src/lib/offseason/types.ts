export type OffseasonPhase =
  | "bowl_recap"
  | "awards"
  | "portal_window"
  | "coaching_carousel"
  | "signing_day"
  | "spring_preview";

export interface OffseasonContent {
  phase: OffseasonPhase;
  title: string;
  content: Record<string, unknown>;
  generated: boolean;
}

export interface BowlRecapContent {
  headline: string;
  body: string;
  socialReactions: Array<{ handle: string; body: string; type: string }>;
}

export interface AwardsContent {
  awards: Array<{ name: string; winner: string; description: string }>;
  allConference: Array<{ name: string; position: string }>;
  narrative: string;
}

export interface PortalContent {
  entries: Array<{
    name: string;
    position: string;
    direction: "in" | "out";
    reason: string;
    impact: string;
  }>;
  narrative: string;
}

export interface CarouselContent {
  rumors: Array<{
    staffName: string;
    role: string;
    school: string;
    likelihood: string;
    narrative: string;
  }>;
  headline: string;
}

export interface SigningDayContent {
  decisions: Array<{
    name: string;
    position: string;
    stars: number;
    decision: "committed" | "flipped" | "decommitted" | "surprise";
    narrative: string;
  }>;
  classGrade: string;
  summary: string;
}

export interface SpringPreviewContent {
  headline: string;
  body: string;
  keyStorylines: string[];
  preseasonRanking: number | null;
}

// The 9 in-game offseason stages (CurrentOffseasonStage 1..9), mapped to human labels for
// the hub header. The exact per-stage boundaries vary by save, so the label is a guide; the
// hub's content is driven by the REAL data present (record, signed class, portal), not by
// asserting stage-specific events.
export const OFFSEASON_STAGE_LABELS: string[] = [
  "Season Wrapped",       // 1
  "Awards & Honors",      // 2
  "Draft Decisions",      // 3
  "Transfer Portal Opens",// 4
  "Portal & Roster Churn",// 5
  "Coaching Carousel",    // 6
  "National Signing Day", // 7
  "Spring Practice",      // 8
  "Preseason Setup",      // 9
];

export function offseasonStageLabel(stage: number | null | undefined, total: number | null | undefined): string {
  if (stage == null) return "The Offseason";
  const idx = Math.max(0, Math.min(OFFSEASON_STAGE_LABELS.length - 1, stage - 1));
  return OFFSEASON_STAGE_LABELS[idx] ?? "The Offseason";
}

export interface OffseasonBrief {
  headline: string;
  stageLabel: string;
  body: string;
  storylines: { title: string; text: string }[];
  lookAhead: string;
  error?: boolean;
}

export interface OffseasonPhaseConfig {
  phase: OffseasonPhase;
  title: string;
  subtitle: string;
  description: string;
}

export const OFFSEASON_PHASES: OffseasonPhaseConfig[] = [
  {
    phase: "bowl_recap",
    title: "Bowl Game Recap",
    subtitle: "The final chapter of the season",
    description:
      "Final articles and social reactions for how the season ended.",
  },
  {
    phase: "awards",
    title: "Awards Ceremony",
    subtitle: "Honors and accolades",
    description:
      "Heisman, All-Conference, All-American — who earned the hardware?",
  },
  {
    phase: "portal_window",
    title: "Transfer Portal Window",
    subtitle: "The portal is open",
    description:
      "Who's leaving? Who's arriving? The roster reshuffles.",
  },
  {
    phase: "coaching_carousel",
    title: "Coaching Carousel",
    subtitle: "Staff changes and rumors",
    description:
      "Interview requests, departures, and loyalty decisions.",
  },
  {
    phase: "signing_day",
    title: "Signing Day",
    subtitle: "The next generation arrives",
    description:
      "Uncommitted recruits make their final decisions.",
  },
  {
    phase: "spring_preview",
    title: "Spring Preview",
    subtitle: "Looking ahead",
    description: "What to expect from the upcoming season.",
  },
];
