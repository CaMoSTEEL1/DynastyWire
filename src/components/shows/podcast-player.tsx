"use client";

// Shared podcast-audio player (opt-in via settings.podcastAudio + an ElevenLabs key).
// Used by broadcast-show transcripts and the National Desk radio segment. Podcast feel
// comes from two things: (1) the NEXT line is synthesized while the current one plays, so
// lines run back-to-back with no dead air; (2) each request carries the surrounding
// dialogue (ElevenLabs stitching), so delivery flows like one continuous recording.
// Audio is kept for the session, so restarting or replaying spends no extra credits.

import { useCallback, useEffect, useRef, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { voiceForPersonaAsync, synthLine } from "@/lib/dynasty/tts";
import { Play, Pause, Square, Loader2 } from "lucide-react";

export interface SpokenLine {
  speaker: string;
  text: string;
}

export function PodcastPlayer({
  lines: rawLines,
  weekSeed,
  resetKey,
  autoStart = false,
  label = "Listen · Podcast Audio",
}: {
  lines: SpokenLine[];
  /** Seeds the weekly voice rotation so a persona keeps one voice within a week. */
  weekSeed: number;
  /** Changing this resets playback + releases cached audio (e.g. the show title). */
  resetKey: string;
  /** Auto-play on mount (broadcast shows do; other surfaces wait for the tap). */
  autoStart?: boolean;
  label?: string;
}) {
  const { settings } = useDynasty();
  // A key is all that's needed to PLAY on demand; the podcastAudio toggle only controls
  // whether a show auto-plays on open. That split is what keeps a Listen button visible
  // even for users who haven't flipped the auto-play toggle.
  const hasKey = !!settings.elevenLabsKey;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [idx, setIdx] = useState(-1); // -1 = not started
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stopped = useRef(false);
  // Line index → synth promise (object URL). Prefetched ahead of playback, kept for replay.
  const clips = useRef<Map<number, Promise<string>>>(new Map());

  const lines = rawLines.filter((l) => l.text.trim()).slice(0, 32);

  const fetchClip = useCallback((i: number): Promise<string> | null => {
    if (!hasKey || i < 0 || i >= lines.length) return null;
    let p = clips.current.get(i);
    if (!p) {
      const l = lines[i];
      const apiKey = settings.elevenLabsKey as string;
      // Voice comes from the user's own ElevenLabs library when they have one (see
      // voiceForPersonaAsync); the stock premades are the fallback.
      p = voiceForPersonaAsync(apiKey, l.speaker || "Host", weekSeed, {
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
  }, [hasKey, lines, settings.elevenLabsKey, settings.customVoices, weekSeed]);

  const playFrom = useCallback(async (i: number) => {
    if (!hasKey || stopped.current || i >= lines.length) { setPlaying(false); setIdx(-1); return; }
    setIdx(i); setLoading(true); setErr(null);
    try {
      const url = await fetchClip(i)!;
      // Warm the next line NOW, while this one plays — this is what makes the show gapless.
      fetchClip(i + 1);
      if (stopped.current) return;
      setLoading(false); setPlaying(true);
      const a = audioRef.current;
      if (!a) return;
      a.src = url;
      a.onended = () => { void playFrom(i + 1); };
      await a.play().catch(() => setErr("Tap play to start audio."));
    } catch (e) {
      setLoading(false); setPlaying(false);
      setErr(e instanceof Error ? e.message : "Audio failed — check your ElevenLabs key/credits.");
    }
  }, [hasKey, lines.length, fetchClip]);

  // Optional auto-start; release all clips when the content changes or on unmount. Auto-play
  // is opt-in (the podcastAudio toggle) — manual play works from just a key.
  useEffect(() => {
    stopped.current = false;
    const held = clips.current;
    if (autoStart && settings.podcastAudio === true && hasKey && lines.length > 0) void playFrom(0);
    return () => {
      stopped.current = true;
      const a = audioRef.current;
      if (a) { a.pause(); a.onended = null; }
      for (const p of held.values()) p.then((url) => URL.revokeObjectURL(url)).catch(() => {});
      held.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // Nothing to read → no player. But whenever there IS dialogue, the Listen bar always
  // renders (even with no key), so there's a visible way to hear the commentary.
  if (lines.length === 0) return null;

  const stop = () => { stopped.current = true; const a = audioRef.current; if (a) a.pause(); setPlaying(false); setIdx(-1); };
  const toggle = () => {
    if (!hasKey) return;
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else if (idx < 0) { stopped.current = false; void playFrom(0); }
    else { void a.play(); setPlaying(true); }
  };

  return (
    <div className="mt-4 flex items-center gap-3 rounded border border-dw-accent2/30 bg-dw-accent2/5 px-4 py-2.5">
      <button
        type="button"
        onClick={toggle}
        disabled={!hasKey}
        title={hasKey ? undefined : "Add your ElevenLabs key in Settings to hear this as a podcast"}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-dw-accent2 text-paper disabled:opacity-40"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      {idx >= 0 && (
        <button type="button" onClick={stop} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dw-border text-ink3 hover:text-ink">
          <Square className="h-3 w-3" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">{label}</p>
        <p className="truncate font-serif text-xs text-ink2">
          {!hasKey ? (
            <span className="text-ink3">Add your ElevenLabs key in Settings to hear this read aloud.</span>
          ) : err ? (
            <span className="text-dw-red">{err}</span>
          ) : idx >= 0 ? (
            `${lines[idx]?.speaker ?? ""} — ${idx + 1}/${lines.length}`
          ) : (
            "Tap play to hear this read aloud."
          )}
        </p>
      </div>
      <audio ref={audioRef} className="hidden" />
    </div>
  );
}
