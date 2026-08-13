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
  CALLS_PER_GAME,
  CALL_COOLDOWN_MS,
  COMMENTARY_READY,
  DEFAULT_CROP,
  boardLine,
  calibrate,
  confirm,
  deriveEvents,
  freshConfirmer,
  gameRunning,
  guessCrop,
  mergeLog,
  momentLines,
  namesOnScreen,
  readBar,
  scoringPlays,
  screenWords,
  supersedes,
  whoLine,
  worthCalling,
  type Confirmer,
  type CropRegion,
  type LiveCall,
  type LiveEvent,
  type LiveLog,
  type LiveState,
} from "@/lib/dynasty/live";
import { issueKey, readTab, writeTab } from "@/lib/dynasty/issue-cache";
import { Radio, Crosshair, Loader2, Mic, Play, RotateCcw, Square } from "lucide-react";

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
  const { snapshot, settings, updateSettings, dynastyId, year, week, generate, hasApiKey, roster, oppRoster } =
    useDynasty();

  const [running, setRunning] = useState<boolean | null>(null);
  const [watching, setWatching] = useState(false);
  const [state, setState] = useState<LiveState | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [blind, setBlind] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // The gate lives in a ref: it must survive re-renders without causing them, and a stale
  // closure here would mean confirming against a state from two seconds ago.
  const gate = useRef<Confirmer>(freshConfirmer());

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

  // What the newsroom will read. The event feed on screen is capped and newest-first because
  // that is what a person wants to look at; the log is neither, because it is a record.
  const weekKey = useMemo(() => issueKey(dynastyId, year, week), [dynastyId, year, week]);
  const log = useRef<LiveLog | null>(null);
  const [logged, setLogged] = useState(0);

  useEffect(() => {
    let cancelled = false;
    log.current = null;
    setLogged(0);
    void readTab<LiveLog>(weekKey, "live-log").then((rec) => {
      if (cancelled || !rec?.data) return;
      log.current = rec.data;
      setLogged(scoringPlays(rec.data.events).length);
    });
    return () => { cancelled = true; };
  }, [weekKey]);

  // Written on every scoring play rather than at the end of the game, because there is no end
  // of the game to hook: users quit to the menu, alt-tab away, and close the app mid-drive.
  const record = useCallback(
    async (fresh: LiveEvent[], board: [string, number][]) => {
      const next = mergeLog(log.current, fresh, board);
      if (next.events.length === (log.current?.events.length ?? 0) && log.current) return;
      log.current = next;
      setLogged(scoringPlays(next.events).length);
      try {
        await writeTab(
          weekKey,
          "live-log",
          { status: "ready", data: next, error: null, generatedAt: Date.now() },
          { dynastyId, year, week }
        );
      } catch {
        /* the feed on screen is still right; a lost write costs the newsroom, not the user */
      }
    },
    [weekKey, dynastyId, year, week]
  );

  /**
   * Throw this week's record away and start the game again from nothing.
   *
   * Fires automatically when the board says the game on screen cannot be the one the log is
   * about — quit and replayed, or the next fixture started before the save was exported. It
   * is also a button, because "the log looks wrong" is a judgement only the user can make.
   */
  const restart = useCallback(
    async (reason: string) => {
      log.current = null;
      setLogged(0);
      setEvents([]);
      setCalls([]);
      setState(null);
      setBlind(0);
      gate.current = freshConfirmer();
      pending.current = [];
      spokenLines.current = [];
      spoken.current = 0;
      setSpokenCount(0);
      setNote(reason);
      try {
        await writeTab(
          weekKey,
          "live-log",
          { status: "ready", data: { events: [], final: [], updatedAt: Date.now() }, error: null, generatedAt: Date.now() },
          { dynastyId, year, week }
        );
      } catch {
        /* the in-memory log is already clear; a failed write costs the newsroom, not the feed */
      }
    },
    [weekKey, dynastyId, year, week]
  );

  // ── The booth's voice ────────────────────────────────────────────────────────
  // Off unless asked for. Every other surface in the app spends once a week, on a click the
  // user made; this one spends while they are looking at the television.
  // Held back until a drive has been watched with it running — see COMMENTARY_READY.
  const commentaryOn = COMMENTARY_READY && settings.liveCommentary === true;
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [talking, setTalking] = useState(false);
  // Moments that happened during the cooldown, waiting to go in with the next call rather
  // than being lost — a touchdown and its extra point are one thing to talk about.
  const pending = useRef<LiveEvent[]>([]);
  const lastCall = useRef(0);
  const spoken = useRef(0);
  // The night's transcript, for the booth's own memory. Trimmed at the call site rather than
  // here so a long game keeps its history for the feed while the prompt stays short.
  const spokenLines = useRef<string[]>([]);
  const [spokenCount, setSpokenCount] = useState(0);
  // The polling loop closes over `tick`, so anything `tick` reads from STATE rebuilds the
  // loop every time it changes. "Is the booth busy" changes twice per call, which would tear
  // the loop down and stand it back up mid-game — so the loop reads it from a ref and the
  // state copy exists only to move the spinner.
  const talkingRef = useRef(false);

  // Both rosters, so a name read off the screen can be matched to a man who is actually in
  // this game rather than to any name-shaped word.
  const inGame = useMemo(
    () => [...roster, ...oppRoster].map((p) => ({ name: p.name, jersey: p.jersey })),
    [roster, oppRoster]
  );

  const speak = useCallback(
    async (board: string, clock: string) => {
      const moment = momentLines(pending.current);
      pending.current = [];
      if (!moment.length) return;
      // The one question the bar cannot answer. Read ONLY here — a full-screen OCR every
      // tick would cost far more than it is worth, and names only matter when something
      // just happened.
      const who = inGame.length
        ? whoLine(namesOnScreen(await screenWords(), inGame, crop)) ?? ""
        : "";
      talkingRef.current = true;
      setTalking(true);
      try {
        // Everything the booth has already said tonight goes back in. Generated blind, the
        // same question eleven times gets eleven similar answers — which a live feed makes
        // painfully obvious — and a broadcast is supposed to build on itself anyway.
        const said = spokenLines.current.slice(-6);
        const res = await generate<{ exchange?: LiveCall["exchange"]; call?: string; posts?: LiveCall["posts"] }>(
          "live-call",
          { moment, board, clock, said, who },
          { force: true }
        );
        const exchange = Array.isArray(res?.exchange) ? res.exchange.filter((t) => t?.line) : [];
        const call = typeof res?.call === "string" ? res.call.trim() : "";
        const posts = Array.isArray(res?.posts) ? res.posts.filter((p) => p?.body) : [];
        if (!exchange.length && !call && !posts.length) return;
        spoken.current += 1;
        setSpokenCount(spoken.current);
        if (call) spokenLines.current.push(call);
        setCalls((c) => [{ exchange, call, posts, at: clock || null, quarter: null, seen: Date.now() }, ...c].slice(0, 30));
      } catch (e) {
        // A failed call is not a failed game. The feed keeps reading either way.
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        talkingRef.current = false;
        setTalking(false);
      }
    },
    [generate, inGame]
  );

  const tick = useCallback(async () => {
    try {
      const read = await readBar(crop, teams);
      if (!read.onScreen) { setBlind((b) => b + 1); return; }
      const { next, settled } = confirm(gate.current, read);
      const previous = gate.current.confirmed;
      gate.current = next;
      if (!settled) return;
      if (supersedes(log.current, settled.scores)) {
        const fixture = new Set((log.current?.final ?? []).map(([t]) => t));
        const same = settled.scores.every(([t]) => fixture.has(t));
        await restart(
          same
            ? "The game restarted, so the record started over with it — the abandoned attempt has been dropped."
            : "A different game is on screen, so this week's record started over."
        );
        return;
      }
      setState(settled);
      if (previous) {
        const fresh = deriveEvents(previous, settled);
        if (fresh.length) {
          setEvents((e) => [...fresh, ...e].slice(0, 80));
          if (fresh.some((f) => f.total != null)) void record(fresh, settled.scores);
          if (commentaryOn && hasApiKey && worthCalling(fresh)) pending.current.push(...fresh);
        }
      }
      // Checked every tick rather than at the moment of the score, so a burst that lands
      // inside the cooldown still gets covered once the booth is free.
      const now = Date.now();
      if (
        pending.current.length &&
        !talkingRef.current &&
        spoken.current < CALLS_PER_GAME &&
        now - lastCall.current >= CALL_COOLDOWN_MS
      ) {
        lastCall.current = now;
        void speak(boardLine(settled), settled.clock ?? "");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [crop, teams, record, commentaryOn, hasApiKey, speak, restart]);

  useEffect(() => {
    if (!watching) return;
    // Per-run, deliberately not a ref shared across runs. `tick` is rebuilt whenever the crop
    // or the team list changes, and a shared flag gets set true by the cleanup and false again
    // by the next run — so a tick still in flight from the OLD run wakes up, sees "not
    // stopped", and schedules its own timer. Two loops, double the reads, forever.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (cancelled) return;
      await tick();
      if (!cancelled) timer = setTimeout(() => void loop(), 1000);
    };
    void loop();
    return () => { cancelled = true; clearTimeout(timer!); };
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

  // One feed, newest first. The booth's call belongs next to the score it is about, not in a
  // second column the user has to watch separately.
  const feed = useMemo(
    () => [...calls, ...events].sort((a, b) => b.seen - a.seen),
    [calls, events]
  );

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

        {COMMENTARY_READY && <button
          type="button"
          onClick={() => void updateSettings({ liveCommentary: !commentaryOn })}
          disabled={!hasApiKey}
          className={cn(
            "inline-flex items-center gap-2 rounded border px-3 py-2 font-sans text-xs uppercase tracking-wider disabled:opacity-40",
            commentaryOn
              ? "border-dw-accent2/50 text-dw-accent2"
              : "border-dw-border text-ink3 hover:text-ink"
          )}
          title={hasApiKey ? undefined : "Needs an API key — the booth is written, not canned."}
        >
          {talking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
          Commentary {commentaryOn ? "on" : "off"}
          {commentaryOn && spokenCount > 0 && (
            <span className="normal-case tracking-normal opacity-60">· {spokenCount}</span>
          )}
        </button>}

        <button
          type="button"
          onClick={() => void restart("This week's record was cleared. The booth is reading the game from the top.")}
          disabled={logged === 0 && events.length === 0}
          className="inline-flex items-center gap-2 rounded border border-dw-border px-3 py-2 font-sans text-xs uppercase tracking-wider text-ink3 hover:text-ink disabled:opacity-40"
          title="Throw away what the booth has recorded for this week and read the game again from nothing."
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Start over
        </button>
      </div>

      {note && (
        <p className="mt-4 rounded border border-dw-accent2/30 bg-dw-accent2/10 px-4 py-3 font-serif text-sm text-dw-accent2">
          {note}
        </p>
      )}

      {commentaryOn && (
        <p className="mt-3 font-sans text-[11px] leading-relaxed text-ink3">
          The booth talks on scores and quarter changes only — never on downs — and waits{" "}
          {Math.round(CALL_COOLDOWN_MS / 1000)}s between calls, so a touchdown and its extra point
          are one thought. Capped at {CALLS_PER_GAME} a game. It writes from the scoreboard, which
          means it never knows who scored, and is not allowed to guess.
        </p>
      )}

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
        {feed.length === 0 ? (
          <p className="rounded border border-dw-border bg-paper2 px-4 py-6 text-center font-serif text-sm text-ink3">
            Nothing yet. Every event here has been read twice before it is believed, so a
            flickered frame never becomes a touchdown.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {feed.map((item, i) =>
              "call" in item ? (
                <li
                  key={`call-${item.seen}-${i}`}
                  className="rounded border border-dw-accent2/40 bg-paper2 px-4 py-3"
                >
                  <span className="font-sans text-[10px] uppercase tracking-[0.25em] text-dw-accent2">
                    In the booth {item.at ? `· ${item.at}` : ""}
                  </span>
                  {item.exchange?.length ? (
                    <ul className="mt-1.5 space-y-1.5">
                      {item.exchange.map((t, k) => (
                        <li key={k} className="font-serif text-[17px] leading-snug text-ink">
                          <span className="mr-2 font-sans text-[10px] uppercase tracking-wider text-dw-accent2">
                            {t.who}
                          </span>
                          {t.line}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    item.call && <p className="mt-1 font-serif text-[17px] leading-snug text-ink">{item.call}</p>
                  )}
                  {item.posts.length > 0 && (
                    <ul className="mt-3 space-y-2 border-l border-dw-border pl-3">
                      {item.posts.map((p, j) => (
                        <li key={`${p.handle}-${j}`}>
                          <span className="font-sans text-[10px] uppercase tracking-wider text-ink3">
                            {p.displayName} <span className="normal-case tracking-normal">@{p.handle}</span>
                          </span>
                          <p className="font-serif text-[14px] leading-snug text-ink2">{p.body}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ) : (
                <li
                  key={`ev-${item.seen}-${i}`}
                  className={cn("rounded border bg-paper2 px-4 py-2", KIND_STYLE[item.kind] ?? "border-dw-border text-ink2")}
                >
                  <span className="font-sans text-[10px] uppercase tracking-wider opacity-70">
                    {item.quarter ?? ""} {item.at ?? ""}
                  </span>
                  <p className="font-serif text-[15px] text-ink">{item.text}</p>
                </li>
              )
            )}
          </ul>
        )}
      </div>

      <div className="mt-6 rounded border border-dw-border/60 bg-paper2 px-4 py-3">
        <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-ink3">Filed to the newsroom</p>
        <p className="mt-1.5 font-serif text-[15px] text-ink2">
          {logged === 0 ? (
            <>
              Nothing yet. Every score the booth confirms is written to this week&apos;s issue, and
              this week&apos;s coverage is built around it — when it happened, in what order, and what
              the game stood at. The save carries none of that.
            </>
          ) : (
            <>
              <span className="text-ink">{logged}</span> scoring {logged === 1 ? "play" : "plays"} recorded
              for Week {week}. The front page, the social feed and the press conference all write
              around them. Anything the booth did not see is left to the save — it never fills a
              gap with a guess.
            </>
          )}
        </p>
      </div>

      {state?.raw && (
        <p className="mt-6 font-sans text-[10px] leading-relaxed text-ink3">
          Last read off the screen: <span className="text-ink2">{state.raw}</span>
        </p>
      )}
    </div>
  );
}
