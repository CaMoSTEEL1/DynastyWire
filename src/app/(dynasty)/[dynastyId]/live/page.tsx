"use client";

// THE BOOTH — what is happening in the game, while it is happening.
//
// Everything on this page comes off the screen of the running game, not the save. The save is
// written once per week advance, so it cannot know a snap happened; the score bar can.
//
// The polling here is deliberately unexciting. It reads once a second, hands each read to the
// confirmation gate in lib/dynasty/live.ts, and only paints when a state has been seen twice.
// About half of all reads see no bar at all — play calls, replays, cutscenes — and that is
// shown as "between plays" rather than as a game where the score is nil.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/section-header";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import {
  DEFAULT_CROP,
  calibrate,
  confirm,
  deriveEvents,
  freshConfirmer,
  gameRunning,
  guessCrop,
  readBar,
  type Confirmer,
  type CropRegion,
  type LiveEvent,
  type LiveState,
} from "@/lib/dynasty/live";
import { Radio, Crosshair, Loader2, Play, Square } from "lucide-react";

const KIND_STYLE: Record<string, string> = {
  touchdown: "border-dw-green/50 text-dw-green",
  "field-goal": "border-dw-green/40 text-dw-green",
  pat: "border-dw-border text-ink2",
  "safety-or-2pt": "border-dw-yellow/40 text-dw-yellow",
  score: "border-dw-yellow/40 text-dw-yellow",
  "first-down": "border-dw-accent/40 text-dw-accent",
  down: "border-dw-border text-ink3",
  quarter: "border-dw-accent2/40 text-dw-accent2",
  situation: "border-dw-border text-ink3",
};

export default function LivePage() {
  const { snapshot, settings, updateSettings } = useDynasty();

  const [running, setRunning] = useState<boolean | null>(null);
  const [watching, setWatching] = useState(false);
  const [state, setState] = useState<LiveState | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [blind, setBlind] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState(false);

  // The gate lives in a ref: it must survive re-renders without causing them, and a stale
  // closure here would mean confirming against a state from two seconds ago.
  const gate = useRef<Confirmer>(freshConfirmer());
  const stop = useRef(false);

  const crop: CropRegion = useMemo(() => {
    const s = settings.liveCrop;
    return s && typeof s === "object" ? (s as CropRegion) : DEFAULT_CROP;
  }, [settings.liveCrop]);

  // Every team in the league, so an OCR'd name can be snapped onto the save's own spelling.
  // This is what turns "IKANSAS STATE" back into Kansas State.
  const teams = useMemo(
    () => Object.values(snapshot?.teams ?? {}).map((t) => t.name).filter(Boolean),
    [snapshot?.teams]
  );

  useEffect(() => {
    let cancelled = false;
    void gameRunning().then((r) => { if (!cancelled) setRunning(r); });
    const id = setInterval(() => { void gameRunning().then((r) => setRunning(r)); }, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const tick = useCallback(async () => {
    try {
      const read = await readBar(crop, teams);
      if (!read.onScreen) { setBlind((b) => b + 1); return; }
      const { next, settled } = confirm(gate.current, read);
      const previous = gate.current.confirmed;
      gate.current = next;
      if (!settled) return;
      setState(settled);
      if (previous) {
        const fresh = deriveEvents(previous, settled);
        if (fresh.length) setEvents((e) => [...fresh, ...e].slice(0, 80));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [crop, teams]);

  useEffect(() => {
    if (!watching) return;
    stop.current = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (stop.current) return;
      await tick();
      if (!stop.current) timer = setTimeout(() => void loop(), 1000);
    };
    void loop();
    return () => { stop.current = true; clearTimeout(timer!); };
  }, [watching, tick]);

  const findBar = useCallback(async () => {
    setCalibrating(true);
    setErr(null);
    try {
      const words = await calibrate();
      const found = guessCrop(words);
      if (!found) {
        setErr("Couldn't find the score bar. Get into a live play — the bar isn't on screen during play calls or replays — and try again.");
        return;
      }
      await updateSettings({ liveCrop: found });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCalibrating(false);
    }
  }, [updateSettings]);

  const scores = state?.scores ?? [];

  return (
    <div>
      <SectionHeader title="THE BOOTH" subtitle="What's happening, while it happens" />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded border px-2.5 py-1 font-sans text-[10px] uppercase tracking-widest",
            running ? "border-dw-green/50 text-dw-green" : "border-dw-border text-ink3"
          )}
        >
          <Radio className="h-3 w-3" />
          {running === null ? "checking" : running ? "game running" : "game not running"}
        </span>

        <button
          type="button"
          onClick={() => setWatching((w) => !w)}
          disabled={!running}
          className={cn(
            "inline-flex items-center gap-2 rounded border px-4 py-2 font-sans text-xs uppercase tracking-wider disabled:opacity-40",
            watching
              ? "border-dw-border text-ink2 hover:text-ink"
              : "border-dw-crimson bg-dw-crimson text-paper hover:opacity-90"
          )}
        >
          {watching ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {watching ? "Stop watching" : "Watch the game"}
        </button>

        <button
          type="button"
          onClick={() => void findBar()}
          disabled={!running || calibrating}
          className="inline-flex items-center gap-2 rounded border border-dw-border px-3 py-2 font-sans text-xs uppercase tracking-wider text-ink3 hover:text-ink disabled:opacity-40"
        >
          {calibrating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
          Find the score bar
        </button>
      </div>

      {err && (
        <p className="mt-4 rounded border border-dw-red/30 bg-dw-red/10 px-4 py-3 font-serif text-sm text-dw-red">
          {err}
        </p>
      )}

      {/* The scoreboard */}
      <div className="mt-6 rounded border border-dw-border bg-paper2 px-6 py-5">
        {state ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex gap-8">
                {scores.map(([team, score]) => (
                  <div key={team}>
                    <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">{team}</p>
                    <p className="font-headline text-4xl text-ink">{score}</p>
                  </div>
                ))}
                {scores.length === 0 && (
                  <p className="font-serif text-sm text-ink3">Score not readable on this frame.</p>
                )}
              </div>
              <div className="text-right">
                <p className="font-headline text-2xl text-ink">{state.clock ?? "--:--"}</p>
                <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">
                  {state.quarter ?? "—"}
                  {state.down ? ` · ${state.down}` : ""}
                </p>
              </div>
            </div>
            {state.situation && (
              <p className="mt-3 font-sans text-[10px] uppercase tracking-widest text-dw-yellow">
                {state.situation}
              </p>
            )}
          </>
        ) : (
          <p className="font-serif text-ink3">
            {watching
              ? "Waiting for the score bar. It only appears during live play — not on play calls, replays or cutscenes."
              : "Start the game, hit Watch, and the booth reads the scoreboard off your screen."}
          </p>
        )}
      </div>

      {/* The feed */}
      <div className="mt-6">
        <p className="mb-2 font-sans text-[10px] uppercase tracking-[0.3em] text-ink3">
          The feed{blind > 0 && <span className="ml-2 normal-case tracking-normal">· {blind} frames between plays</span>}
        </p>
        {events.length === 0 ? (
          <p className="rounded border border-dw-border bg-paper2 px-4 py-6 text-center font-serif text-sm text-ink3">
            Nothing yet. Every event here has been read twice before it is believed, so a
            flickered frame never becomes a touchdown.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {events.map((e, i) => (
              <li
                key={`${e.seen}-${i}`}
                className={cn("rounded border bg-paper2 px-4 py-2", KIND_STYLE[e.kind] ?? "border-dw-border text-ink2")}
              >
                <span className="font-sans text-[10px] uppercase tracking-wider opacity-70">
                  {e.quarter ?? ""} {e.at ?? ""}
                </span>
                <p className="font-serif text-[15px] text-ink">{e.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {state?.raw && (
        <p className="mt-6 font-sans text-[10px] leading-relaxed text-ink3">
          Last read off the screen: <span className="text-ink2">{state.raw}</span>
        </p>
      )}
    </div>
  );
}
