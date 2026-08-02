"use client";

import { cn } from "@/lib/utils";
import { DateTime } from "luxon";

interface MastheadProps {
  /** RTG turns the paper into a different publication — see the render below. */
  rtg?: { playerName: string | null; stars: string | null; homeState: string | null; position: string | null; classYear: string | null } | null;
  school?: string;
  coachName?: string;
  fanSentiment?: string | null;
  hotSeatLevel?: string | null;
  seasonMomentum?: string | null;
  lastResult?: "W" | "L" | null;
  record?: { wins: number; losses: number } | null;
}

function getReactiveTagline(props: MastheadProps): { text: string; color: string } {
  const { school, coachName, fanSentiment, hotSeatLevel, seasonMomentum, lastResult, record } = props;

  if (!school || record === null || record === undefined) {
    return { text: "Your Dynasty. Your Story.", color: "text-ink2" };
  }

  // Hot seat takes priority — it's the most dramatic state
  if (hotSeatLevel === "volcanic") {
    return {
      text: `Sources inside the program: the pressure on Coach ${coachName ?? "the staff"} has never been higher.`,
      color: "text-dw-red",
    };
  }
  if (hotSeatLevel === "hot") {
    return {
      text: `The fanbase wants answers. Is the clock ticking on Coach ${coachName ?? "the staff"}?`,
      color: "text-dw-yellow",
    };
  }

  // Freefall momentum
  if (seasonMomentum === "freefall") {
    return {
      text: `Something has to change in ${school}'s locker room. The Wire is watching.`,
      color: "text-dw-red",
    };
  }

  // Ecstatic fans + surging
  if (fanSentiment === "ecstatic" && seasonMomentum === "surging") {
    return {
      text: `The ${school} dynasty is surging. Can anybody stop them?`,
      color: "text-dw-green",
    };
  }
  if (fanSentiment === "ecstatic") {
    return {
      text: `${school} faithful are electric. ${record.wins}-${record.losses} and building something special.`,
      color: "text-dw-green",
    };
  }

  // Furious fans
  if (fanSentiment === "furious") {
    return {
      text: `Fans in ${school} are furious. The pressure is mounting on the program.`,
      color: "text-dw-red",
    };
  }
  if (fanSentiment === "restless") {
    return {
      text: `The natives are getting restless in ${school}. Something has to give.`,
      color: "text-dw-yellow",
    };
  }

  // Momentum-based
  if (seasonMomentum === "surging" && lastResult === "W") {
    return {
      text: `${school} is rolling. Momentum is everything right now.`,
      color: "text-dw-green",
    };
  }
  if (seasonMomentum === "sliding" || lastResult === "L") {
    return {
      text: `${school} needs a response. The media is taking notes.`,
      color: "text-ink3",
    };
  }

  // Default win state
  if (lastResult === "W") {
    return {
      text: `${school} moves to ${record.wins}-${record.losses}. The story continues.`,
      color: "text-ink2",
    };
  }

  // Generic fallback
  return {
    text: `Covering the ${school} dynasty under Coach ${coachName ?? "the staff"}.`,
    color: "text-ink2",
  };
}

export default function Masthead({
  school,
  coachName,
  fanSentiment,
  hotSeatLevel,
  seasonMomentum,
  lastResult,
  record,
  rtg,
}: MastheadProps) {
  const now = DateTime.now();
  const formattedDate = now.toFormat("EEEE, MMMM d, yyyy");

  const tagline = rtg
    ? {
        // Never "under Coach Head Coach" — reported from a real RTG save. There is no user
        // coach in this mode, so the subtitle is about him.
        text: [
          rtg.playerName ?? "The player",
          rtg.classYear && rtg.position ? `· ${rtg.classYear} ${rtg.position}` : null,
          school ? `at ${school}` : null,
        ]
          .filter(Boolean)
          .join(" "),
        color: "text-ink2",
      }
    : getReactiveTagline({ school, coachName, fanSentiment, hotSeatLevel, seasonMomentum, lastResult, record });
  const isAlert = hotSeatLevel === "volcanic" || fanSentiment === "furious" || seasonMomentum === "freefall";

  return (
    <header className={cn("w-full bg-paper py-5 md:py-8")}>
      <div className="max-w-7xl mx-auto px-4">
        {/* Top meta bar — school left, date right */}
        <div className="flex items-baseline justify-between mb-3 md:mb-4">
          <span className="font-sans text-[10px] uppercase tracking-widest text-ink3">
            {rtg
              ? // The whole premise of the mode, in the kicker: the paper is not covering a
                // program, it is covering ONE KID — and it says what he was rated, because
                // being overlooked is the story.
                [
                  "Covering",
                  rtg.stars ? `the ${rtg.stars.replace(/_/g, " ").toLowerCase()} recruit` : "the recruit",
                  rtg.homeState ? `from ${rtg.homeState}` : null,
                  school ? `· ${school}` : null,
                ]
                  .filter(Boolean)
                  .join(" ")
              : school
                ? `Covering the ${school} Dynasty`
                : "Dynasty Football Coverage"}
          </span>
          <span className="font-serif text-xs text-ink3">{formattedDate}</span>
        </div>

        {/* Publication name */}
        <h1
          className={cn(
            "font-headline text-ink uppercase tracking-[0.3em] text-center",
            "text-3xl sm:text-4xl md:text-5xl lg:text-6xl",
            "leading-tight"
          )}
        >
          {rtg ? "RoadWire" : "DynastyWire"}
        </h1>

        {/* Rule diamond */}
        <div className="rule-diamond my-4 md:my-5">
          <span className="diamond" />
        </div>

        {/* Reactive tagline */}
        <p
          className={cn(
            "font-serif italic text-center",
            "text-sm sm:text-base md:text-lg",
            tagline.color
          )}
        >
          {tagline.text}
        </p>

        {/* Hot seat / crisis pulse indicator */}
        {isAlert && (
          <div className="mt-3 flex items-center justify-center gap-2">
            <span className={cn(
              "h-1.5 w-1.5 rounded-full animate-pulse",
              hotSeatLevel === "volcanic" || fanSentiment === "furious" ? "bg-dw-red" : "bg-dw-yellow"
            )} />
            <span className={cn(
              "font-sans text-[10px] uppercase tracking-widest",
              hotSeatLevel === "volcanic" || fanSentiment === "furious" ? "text-dw-red" : "text-dw-yellow"
            )}>
              {hotSeatLevel === "volcanic"
                ? "Hot Seat Alert"
                : fanSentiment === "furious"
                ? "Fan Unrest"
                : "Momentum Sliding"}
            </span>
            <span className={cn(
              "h-1.5 w-1.5 rounded-full animate-pulse",
              hotSeatLevel === "volcanic" || fanSentiment === "furious" ? "bg-dw-red" : "bg-dw-yellow"
            )} />
          </div>
        )}
      </div>
    </header>
  );
}
