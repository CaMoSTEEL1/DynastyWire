"use client";

import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import {
  Newspaper,
  MessageCircle,
  Mic,
  Users,
  Trophy,
  Tv,
  Award,
  Settings,
  HelpCircle,
  UserCircle,
  Flame,
  Globe,
  Snowflake,
  DollarSign,
  Coins,
  Archive,
  ListOrdered,
  Globe2,
} from "lucide-react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useSettings } from "@/components/settings/settings-context";
import { useTutorial } from "@/components/tutorial/tutorial-context";

interface NavbarProps {
  dynastyId: string;
}

const navItems = [
  { label: "Front Page", slug: "", icon: Newspaper },
  { label: "National", slug: "national", icon: Globe },
  { label: "Coach", slug: "coach", icon: UserCircle },
  { label: "Situation Room", slug: "situation-room", icon: Flame },
  { label: "Social", slug: "social", icon: MessageCircle },
  { label: "Press Conference", slug: "press-conference", icon: Mic },
  { label: "Recruiting", slug: "recruiting", icon: Users },
  { label: "NIL", slug: "nil", icon: DollarSign },
  { label: "Offseason", slug: "offseason", icon: Snowflake },
  { label: "Rankings", slug: "rankings", icon: Trophy },
  { label: "The Slate", slug: "scoreboard", icon: ListOrdered },
  { label: "Shows", slug: "shows", icon: Tv },
  { label: "The Book", slug: "betting", icon: Coins },
  { label: "Archive", slug: "archive", icon: Archive },
  { label: "Trophy Room", slug: "trophy-room", icon: Award },
  { label: "The Forum", slug: "forum", icon: Globe2 },
] as const;

// ROAD TO GLORY gets its own front door (DESIGN-rtg-mode.md, decision 9). None of the dynasty
// tabs apply — you don't run the program, you play for it — so the strip is replaced wholesale
// rather than appended to. The two zero-cost surfaces (Recruitment, Depth) sit next to the two
// that spend, so the cheap half of the mode is always visible.
const rtgNavItems = [
  { label: "The Week", slug: "the-week", icon: Newspaper },
  { label: "His Feed", slug: "my-social", icon: MessageCircle },
  { label: "His Podium", slug: "his-podium", icon: Mic },
  { label: "His Phone", slug: "his-phone", icon: MessageCircle },
  { label: "His Week", slug: "his-week-decision", icon: Flame },
  { label: "His Gameplan", slug: "his-gameplan", icon: ListOrdered },
  { label: "The Room", slug: "the-room", icon: Users },
  { label: "Recruitment", slug: "recruitment", icon: Trophy },
  { label: "The Slate", slug: "scoreboard", icon: ListOrdered },
  { label: "Archive", slug: "archive", icon: Archive },
  { label: "The Forum", slug: "forum", icon: Globe2 },
] as const;

export default function Navbar({ dynastyId }: NavbarProps) {
  const pathname = usePathname();
  const { snapshot } = useDynasty();
  const { toggle } = useSettings();
  // Detected from the save, never asked — a Road to Glory save flags a PLAYER as
  // user-controlled where a dynasty save flags a COACH.
  const items = snapshot?.mode === "rtg" ? rtgNavItems : navItems;
  const { showTutorial } = useTutorial();

  function isActive(slug: string): boolean {
    const base = `/${dynastyId}`;
    if (slug === "") {
      return pathname === base || pathname === `${base}/`;
    }
    return pathname === `${base}/${slug}` || pathname.startsWith(`${base}/${slug}/`);
  }

  return (
    // The tab strip scrolls horizontally on narrow windows; Settings used to scroll off the
    // right edge entirely and users couldn't find it. The nav is now a flex row with a
    // PINNED action cluster (help + settings) that never scrolls away.
    <nav className="flex w-full items-stretch border-t border-b border-dw-border bg-paper2">
      <ul
        className={cn(
          "flex min-w-0 flex-1 items-center gap-0",
          "md:gap-1",
          "overflow-x-auto scrollbar-hide",
          "px-2 md:px-4"
        )}
      >
        {items.map(({ label, slug, icon: Icon }) => {
          const active = isActive(slug);
          // Plain <a> full-page navigation (not next/link): client-side routing needs RSC
          // payload fetches that fail silently over Tauri's asset protocol, eating the click.
          // Each route exports its own index.html (trailingSlash), so hard navs always work.
          const href = slug === "" ? `/${dynastyId}/` : `/${dynastyId}/${slug}/`;

          return (
            <li key={slug}>
              <a
                href={href}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-3 md:px-4 md:py-3",
                  "font-sans text-xs md:text-sm uppercase tracking-wider",
                  "transition-colors duration-200 whitespace-nowrap",
                  "border-b-2",
                  active
                    ? "text-dw-accent border-dw-accent"
                    : "text-ink2 border-transparent hover:text-ink hover:border-ink3"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
              </a>
            </li>
          );
        })}

      </ul>

      {/* Pinned actions — outside the scrolling list so Settings is ALWAYS reachable. */}
      <div className="flex shrink-0 items-center border-l border-dw-border bg-paper2 pr-1 md:pr-2">
        <button
          type="button"
          onClick={showTutorial}
          className={cn(
            "flex items-center gap-1.5 px-3 py-3",
            "font-sans text-xs md:text-sm uppercase tracking-wider",
            "transition-colors duration-200 whitespace-nowrap",
            "text-ink2 hover:text-ink"
          )}
          aria-label="Help"
        >
          <HelpCircle className="w-4 h-4 shrink-0" />
        </button>
        <button
          type="button"
          onClick={toggle}
          className={cn(
            "flex items-center gap-1.5 px-3 py-3",
            "font-sans text-xs md:text-sm uppercase tracking-wider",
            "transition-colors duration-200 whitespace-nowrap",
            "text-ink2 hover:text-ink"
          )}
          aria-label="Settings"
        >
          <Settings className="w-4 h-4 shrink-0" />
          <span className="hidden md:inline">Settings</span>
        </button>
      </div>
    </nav>
  );
}
