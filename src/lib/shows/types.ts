export type ShowType = "gameday" | "rankings" | "portal" | "draft" | "hotseat" | "podcast";

export interface ShowPersona {
  name: string;
  role: string;
  affiliation: string;
  personality: string;
}

export interface DialogueLine {
  speaker: string;
  role: string;
  text: string;
  isStageDirection: boolean;
}

export interface ShowTranscript {
  showType: ShowType;
  title: string;
  subtitle: string;
  personas: ShowPersona[];
  dialogue: DialogueLine[];
  week: number;
  error?: boolean;
}

export interface ShowConfig {
  type: ShowType;
  title: string;
  subtitle: string;
  icon: string;
  description: string;
  condition?: (state: { hotSeatLevel: string }) => boolean;
}

export const SHOW_CONFIGS: ShowConfig[] = [
  {
    type: "gameday",
    title: "DynastyWire GameDay",
    subtitle: "Pre-game preview panel",
    icon: "Tv",
    description:
      "Three analysts debate the upcoming matchup, make predictions, and break down key storylines.",
  },
  {
    type: "rankings",
    title: "The Rankings Report",
    subtitle: "Weekly top-25 show",
    icon: "Trophy",
    description:
      "Movement debates, CFP discussion, and who's in and who's out.",
  },
  {
    type: "portal",
    title: "Portal Insider",
    subtitle: "Transfer portal segment",
    icon: "ArrowRightLeft",
    description:
      "The latest portal moves, rumors, and impact analysis.",
  },
  {
    type: "draft",
    title: "Draft Scout",
    subtitle: "NFL draft prospect breakdown",
    icon: "Target",
    description:
      "Senior player evaluations and draft stock updates.",
  },
  {
    type: "podcast",
    title: "The Wire Room",
    subtitle: "Weekly podcast — national voice meets the local homer",
    icon: "Mic",
    description:
      "A long-form weekly pod: a national analyst who sees your program from 30,000 feet and a local diehard who bleeds it — arguing about your week.",
  },
  {
    type: "hotseat",
    title: "Hot Seat Weekly",
    subtitle: "Coaching performance segment",
    icon: "Flame",
    description:
      "Is the coach feeling the heat? Performance analysis and job security discussion.",
    condition: (state) => state.hotSeatLevel !== "none",
  },
];
