"use client";

// Podcast playback that outlives the page that started it.
//
// The player used to own everything — the <audio> element, the clip cache, the position —
// inside the component that rendered the Listen bar. React unmounts that component the
// moment you navigate, and its cleanup paused the audio AND revoked every object URL. So
// leaving the Shows tab did not merely stop the show: it threw away audio the user had
// already paid ElevenLabs to generate, and coming back re-synthesized it from scratch.
//
// Everything stateful therefore lives here, in a provider mounted once by the dynasty shell,
// above the router. Route changes cannot reach it. The Listen bar becomes a control surface
// that asks this to play and reads back what it is doing, and a Now Playing bar rides along
// at the bottom of every other tab so a show in progress is never invisible.
//
// The clip cache is only released when the QUEUE is replaced, never on navigation, because
// synthesis costs the user money and the old behaviour spent it twice.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { voiceForPersonaAsync, synthLine } from "@/lib/dynasty/tts";
import { spokenText } from "@/lib/shows/dialogue";

export interface SpokenLine {
  speaker: string;
  text: string;
}

export interface PodcastQueue {
  /** Identity of the thing being played. Re-starting the same key resumes rather than reloads. */
  key: string;
  /** What the user would call it — shown in the Now Playing bar. */
  title: string;
  lines: SpokenLine[];
  /** Seeds the weekly voice rotation so a persona keeps one voice within a week. */
  weekSeed: number;
  /** Where it came from, so Now Playing can offer a way back. */
  href?: string | null;
}

interface PodcastAudio {
  /** The queue currently loaded, playing or paused. */
  queue: PodcastQueue | null;
  /** Index of the line on air, or -1 before playback starts. */
  idx: number;
  playing: boolean;
  loading: boolean;
  error: string | null;
  /** True when a key is set — playback is impossible without one. */
  hasKey: boolean;
  /** Load a queue and start it. Same key + already loaded = resume, no re-synthesis. */
  play: (q: PodcastQueue) => void;
  /** Pause if playing, resume or start if not. */
  toggle: () => void;
  /** Stop, clear the position, and release the queue. */
  stop: () => void;
}

const Ctx = createContext<PodcastAudio | null>(null);

/** Stage directions are cues for the reader, not words — ElevenLabs reads them aloud. */
function speakable(lines: SpokenLine[]): SpokenLine[] {
  return lines
    .map((l) => ({ ...l, text: spokenText(l.text) }))
    .filter((l) => l.text.trim())
    .slice(0, 32);
}

export function PodcastAudioProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useDynasty();
  const hasKey = !!settings.elevenLabsKey;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [queue, setQueue] = useState<PodcastQueue | null>(null);
  const [idx, setIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopped = useRef(false);
  // Line index → synth promise (object URL). Survives navigation; released only when the
  // queue changes, because every entry here cost the user ElevenLabs credits.
  const clips = useRef<Map<number, Promise<string>>>(new Map());
  // The lines currently loaded, read by the async playback chain. A ref rather than state so
  // a queue swap mid-play cannot leave the chain reading the previous show's script.
  const linesRef = useRef<SpokenLine[]>([]);
  const keyRef = useRef<string | null>(null);
  // Set together with linesRef. Reading the seed off `queue` state instead would lag one
  // render behind the swap, and the first clip of a new show would pick its voice from the
  // previous show's rotation.
  const seedRef = useRef(0);

  const releaseClips = useCallback(() => {
    for (const p of clips.current.values()) {
      p.then((url) => URL.revokeObjectURL(url)).catch(() => {});
    }
    clips.current.clear();
  }, []);

  const fetchClip = useCallback(
    (i: number): Promise<string> | null => {
      const lines = linesRef.current;
      if (!hasKey || i < 0 || i >= lines.length) return null;
      let p = clips.current.get(i);
      if (!p) {
        const l = lines[i];
        const apiKey = settings.elevenLabsKey as string;
        p = voiceForPersonaAsync(apiKey, l.speaker || "Host", seedRef.current, {
          preferCustom: settings.customVoices !== false,
        }).then((voice) =>
          synthLine(apiKey, voice, l.text, {
            previousText: lines[i - 1]?.text,
            nextText: lines[i + 1]?.text,
          })
        );
        // A failed synth must not poison the cache (or fire an unhandled rejection from the
        // prefetch path) — drop it so the next attempt retries.
        p.catch(() => clips.current.delete(i));
        clips.current.set(i, p);
      }
      return p;
    },
    [hasKey, settings.elevenLabsKey, settings.customVoices]
  );

  // playFrom advances the show by calling itself when a clip ends. Naming it inside its own
  // initializer is a temporal-dead-zone hazard, so the recursive hop goes through this ref,
  // which is repointed at the current closure on every render.
  const playFromRef = useRef<(i: number) => Promise<void>>(async () => {});

  const playFrom = useCallback(
    async (i: number) => {
      const lines = linesRef.current;
      if (!hasKey || stopped.current || i >= lines.length) {
        setPlaying(false);
        setIdx(-1);
        return;
      }
      setIdx(i);
      setLoading(true);
      setError(null);
      try {
        const url = await fetchClip(i)!;
        // Warm the next line NOW, while this one plays — this is what makes it gapless.
        fetchClip(i + 1);
        if (stopped.current) return;
        setLoading(false);
        setPlaying(true);
        const a = audioRef.current;
        if (!a) return;
        a.src = url;
        a.onended = () => {
          void playFromRef.current(i + 1);
        };
        await a.play().catch(() => setError("Tap play to start audio."));
      } catch (e) {
        setLoading(false);
        setPlaying(false);
        setError(e instanceof Error ? e.message : "Audio failed — check your ElevenLabs key/credits.");
      }
    },
    [hasKey, fetchClip]
  );

  // Repointed after commit rather than during render. The only reader is the onended hop,
  // which cannot fire until a clip has finished playing — long after the first effect runs.
  useEffect(() => {
    playFromRef.current = playFrom;
  }, [playFrom]);

  const play = useCallback(
    (q: PodcastQueue) => {
      if (!hasKey) return;
      // Same show, already loaded: resume where it was rather than paying to synthesize it
      // again. This is the case that fires when the user walks back onto the Shows tab.
      if (keyRef.current === q.key) {
        stopped.current = false;
        const a = audioRef.current;
        if (a && idx >= 0 && a.src) {
          void a.play();
          setPlaying(true);
          return;
        }
        void playFrom(idx >= 0 ? idx : 0);
        return;
      }
      // A genuinely different show. Now — and only now — the old audio is worthless.
      stopped.current = true;
      const a = audioRef.current;
      if (a) {
        a.pause();
        a.onended = null;
      }
      releaseClips();
      const lines = speakable(q.lines);
      linesRef.current = lines;
      keyRef.current = q.key;
      seedRef.current = q.weekSeed;
      setQueue({ ...q, lines });
      setIdx(-1);
      setError(null);
      if (lines.length === 0) return;
      stopped.current = false;
      void playFrom(0);
    },
    [hasKey, idx, playFrom, releaseClips]
  );

  const toggle = useCallback(() => {
    if (!hasKey || !queue) return;
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else if (idx < 0) {
      stopped.current = false;
      void playFrom(0);
    } else {
      void a.play();
      setPlaying(true);
    }
  }, [hasKey, queue, playing, idx, playFrom]);

  const stop = useCallback(() => {
    stopped.current = true;
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.onended = null;
    }
    releaseClips();
    linesRef.current = [];
    keyRef.current = null;
    setQueue(null);
    setIdx(-1);
    setPlaying(false);
    setLoading(false);
  }, [releaseClips]);

  // Only on real teardown — closing the app, not changing tabs.
  useEffect(() => {
    return () => {
      stopped.current = true;
      releaseClips();
    };
  }, [releaseClips]);

  const value = useMemo<PodcastAudio>(
    () => ({ queue, idx, playing, loading, error, hasKey, play, toggle, stop }),
    [queue, idx, playing, loading, error, hasKey, play, toggle, stop]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* One element for the whole app, mounted above the router so navigation cannot
          unmount it mid-sentence. */}
      <audio ref={audioRef} className="hidden" />
    </Ctx.Provider>
  );
}

export function usePodcastAudio(): PodcastAudio {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("usePodcastAudio must be used inside PodcastAudioProvider");
  }
  return ctx;
}
