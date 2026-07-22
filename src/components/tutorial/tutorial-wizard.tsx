"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  FileText,
  Newspaper,
  MessageCircle,
  Mic,
  Users,
  Tv,
  Settings,
  Globe,
  UserCircle,
  Flame,
  DollarSign,
  Coins,
  Snowflake,
  Zap,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTutorial } from "./tutorial-context";

interface TutorialStep {
  icon: React.ElementType;
  title: string;
  description: string;
}

const steps: TutorialStep[] = [
  {
    icon: Sparkles,
    title: "Welcome to DynastyWire",
    description:
      "Your dynasty has its own living media universe. Every game you play generates headlines, hot takes, and storylines \u2014 all powered by AI. This quick tour will show you everything DynastyWire has to offer.",
  },
  {
    icon: FileText,
    title: "It Reads Your Save Automatically",
    description:
      "Point DynastyWire at your CFB dynasty save once. From then on it watches the file \u2014 every time you advance a week in-game, it re-reads the save and writes that week\u2019s issue in the background. No screenshots, no manual entry. Bring your own Anthropic API key (and optionally an ElevenLabs key for audio); everything stays local on your machine.",
  },
  {
    icon: Newspaper,
    title: "Front Page",
    description:
      "Your personalized front page fills with AI-generated articles, recaps, and feature stories after every week. Headlines shift based on your wins, losses, upsets, and rivalries \u2014 all grounded in your real roster and results, never invented.",
  },
  {
    icon: Globe,
    title: "National Desk",
    description:
      "The whole country\u2019s week from the national media\u2019s chair \u2014 a game-of-the-week story, takes on the ranked slate, the poll pulse, the full around-the-league wire, and a national radio segment you can listen to.",
  },
  {
    icon: UserCircle,
    title: "Coach & Backstory",
    description:
      "Write your coach\u2019s origin story and archetype, and DynastyWire builds a recurring cast around you \u2014 your AD, lead booster, beat writer, and rival coach. Text them directly, and pull a scouting report on your next opponent straight from their real roster.",
  },
  {
    icon: Flame,
    title: "Situation Room",
    description:
      "Off-field storylines land on your desk \u2014 legal trouble, portal threats, locker-room drama, academics. Your decisions move four pressure meters (boosters, fans, media, locker room) that follow you everywhere. Rarely, a serious incident or a failing grade can suspend a player \u2014 and DynastyWire enforces it in your actual save, benching him until he\u2019s served it.",
  },
  {
    icon: MessageCircle,
    title: "Social Feed",
    description:
      "Fan reactions, analyst hot takes, and recruit buzz \u2014 with a rotating cast so it never feels like the same five accounts every week. The tone shifts with your performance: win big and you\u2019re a genius, lose and the fanbase lets you hear about it.",
  },
  {
    icon: Mic,
    title: "Press Conference",
    description:
      "Step to the podium and answer questions from the media \u2014 pick a scripted posture or type your own words and let the room judge them. Your answers shape headlines and how fans, analysts, and recruits see your program.",
  },
  {
    icon: Users,
    title: "Recruiting",
    description:
      "Search the class, open a full AI dossier on any prospect (backstory, film grade, media buzz, socials), then text him directly. Prospects react to your season as it unfolds.",
  },
  {
    icon: DollarSign,
    title: "NIL & The Collective",
    description:
      "Take brand-deal meetings from your AD and boosters \u2014 not all money is clean money \u2014 and distribute NIL to your roster, written straight back into your save. Every player carries an estimated market value based on rating, position, production, and how good your program is.",
  },
  {
    icon: Coins,
    title: "The Book",
    description:
      "A play-money sportsbook over your dynasty. Take the spread or the moneyline on your games and the ranked slate, watch your win probability and line, and let bets settle automatically when the games play. Fake money, real bragging rights \u2014 no save changes.",
  },
  {
    icon: Tv,
    title: "Shows & Podcast Audio",
    description:
      "Studio segments \u2014 GameDay, rankings reveals, portal insider, hot-seat debates \u2014 written from your real week. Add an ElevenLabs key and hit Listen to hear any show read aloud as a gapless podcast, a different voice per host.",
  },
  {
    icon: Snowflake,
    title: "Offseason & Trophy Room",
    description:
      "When your season ends, the offseason takes over \u2014 the portal, signing day, the coaching carousel, and awards. The Trophy Room preserves your legacy across seasons: titles, bowl wins, All-Americans, and milestone victories.",
  },
  {
    icon: Settings,
    title: "Settings & Cost Control",
    description:
      "Budget mode is on by default \u2014 it uses a leaner model and only auto-writes your core sections, and you can check exactly which sections generate automatically so you only pay for what you read. Reopening any past week is always instant and free. Manage dynasties, keys, and immersion options here too.",
  },
  {
    icon: Zap,
    title: "What\u2019s New in v0.1.7",
    description:
      "\u2022 Costs slashed: budget mode on by default + cached week context, so a season now costs what a single week used to.\n\u2022 Choose exactly which sections auto-write each week.\n\u2022 The Book adds spread betting, win probability, and a season record.\n\u2022 Podcast audio is now gapless and stitched for a real broadcast feel \u2014 with a Listen button on shows and the national radio segment.\n\u2022 Player suspensions: rare serious incidents and failed grades bench a player in your actual save, and the whole media universe knows he\u2019s out.\n\u2022 Smarter NIL valuations, GPA on the depth chart, and a pile of polish.",
  },
];

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -80 : 80,
    opacity: 0,
  }),
};

export default function TutorialWizard() {
  const { isTutorialOpen, hideTutorial } = useTutorial();
  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(0);

  const goNext = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setDirection(1);
      setCurrentStep((s) => s + 1);
    }
  }, [currentStep]);

  const goBack = useCallback(() => {
    if (currentStep > 0) {
      setDirection(-1);
      setCurrentStep((s) => s - 1);
    }
  }, [currentStep]);

  const handleClose = useCallback(() => {
    hideTutorial();
    setCurrentStep(0);
    setDirection(0);
  }, [hideTutorial]);

  if (!isTutorialOpen) return null;

  const step = steps[currentStep];
  const Icon = step.icon;
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;

  return (
    <AnimatePresence>
      {isTutorialOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Card */}
          <motion.div
            className={cn(
              "relative z-10 w-full max-w-lg",
              "bg-paper border border-dw-border rounded-sm shadow-2xl",
              "overflow-hidden"
            )}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Top decorative rule */}
            <div className="h-1 bg-dw-accent" />

            {/* Step content */}
            <div className="px-8 pt-8 pb-6">
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={currentStep}
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="flex flex-col items-center text-center"
                >
                  {/* Icon */}
                  <div
                    className={cn(
                      "w-16 h-16 rounded-full flex items-center justify-center mb-5",
                      "bg-paper3 border border-dw-border"
                    )}
                  >
                    <Icon className="w-8 h-8 text-dw-accent" />
                  </div>

                  {/* Title */}
                  <h2 className="font-headline text-2xl text-ink tracking-tight mb-3">
                    {step.title}
                  </h2>

                  {/* Description — whitespace-pre-line so the What's New bullet list keeps
                      its line breaks; a multi-line step reads better left-aligned, while
                      single-paragraph steps stay centered like before. */}
                  <p
                    className={cn(
                      "font-serif text-ink2 text-sm leading-relaxed max-w-md whitespace-pre-line",
                      step.description.includes("\n") && "text-left"
                    )}
                  >
                    {step.description}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Divider */}
            <div className="border-t border-dw-border mx-8" />

            {/* Footer */}
            <div className="px-8 py-5 flex items-center justify-between">
              {/* Step dots */}
              <div className="flex items-center gap-1.5">
                {steps.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setDirection(i > currentStep ? 1 : -1);
                      setCurrentStep(i);
                    }}
                    className={cn(
                      "w-2 h-2 rounded-full transition-all duration-200",
                      i === currentStep
                        ? "bg-dw-accent w-4"
                        : "bg-ink3 hover:bg-ink2"
                    )}
                    aria-label={`Go to step ${i + 1}`}
                  />
                ))}
              </div>

              {/* Buttons */}
              <div className="flex items-center gap-2">
                {isFirst ? (
                  <button
                    type="button"
                    onClick={handleClose}
                    className={cn(
                      "px-4 py-2 text-xs uppercase tracking-wider font-sans",
                      "text-ink2 hover:text-ink transition-colors duration-200"
                    )}
                  >
                    Skip
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={goBack}
                    className={cn(
                      "flex items-center gap-1 px-4 py-2 text-xs uppercase tracking-wider font-sans",
                      "text-ink2 hover:text-ink transition-colors duration-200"
                    )}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Back
                  </button>
                )}

                {isLast ? (
                  <button
                    type="button"
                    onClick={handleClose}
                    className={cn(
                      "flex items-center gap-1 px-5 py-2 text-xs uppercase tracking-wider font-sans",
                      "bg-dw-accent text-paper rounded-sm",
                      "transition-colors hover:bg-dw-accent2"
                    )}
                  >
                    Done
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={goNext}
                    className={cn(
                      "flex items-center gap-1 px-5 py-2 text-xs uppercase tracking-wider font-sans",
                      "bg-dw-accent text-paper rounded-sm",
                      "transition-colors hover:bg-dw-accent2"
                    )}
                  >
                    Next
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
