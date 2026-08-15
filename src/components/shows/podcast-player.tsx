"use client";

// The in-page Listen bar.
//
// It used to BE the player. Now it is a control surface: all the state — the audio element,
// the clip cache, the position — lives in PodcastAudioProvider, mounted above the router, so
// a show keeps playing when you leave the tab that started it and the audio you paid to
// synthesize is not thrown away on navigation. See podcast-audio.tsx.
//
// Podcast feel still comes from the same two things, they just happen a level up: the NEXT
// line is synthesized while the current one plays, so lines run back-to-back with no dead
// air; and each request carries the surrounding dialogue, so delivery flows like one
// continuous recording.

import { useEffect, useMemo } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { usePodcastAudio, type SpokenLine } from "./podcast-audio";
import { Play, Pause, Square, Loader2 } from "lucide-react";

export type { SpokenLine };

export function PodcastPlayer({
  lines: rawLines,
  weekSeed,
  resetKey,
  autoStart = false,
  label = "Listen · Podcast Audio",
  title,
  href,
}: {
  lines: SpokenLine[];
  /** Seeds the weekly voice rotation so a persona keeps one voice within a week. */
  weekSeed: number;
  /** Identity of this show. Changing it loads a different queue. */
  resetKey: string;
  /** Auto-play on mount (broadcast shows do; other surfaces wait for the tap). */
  autoStart?: boolean;
  label?: string;
  /** What to call this in the Now Playing bar. Falls back to the label. */
  title?: string;
  /** Route that owns this player, so Now Playing can link back and hide itself here. */
  href?: string;
}) {
  const { settings } = useDynasty();
  const { queue, idx, playing, loading, error, hasKey, play, toggle, stop } = usePodcastAudio();

  // Is the provider currently loaded with THIS show? Everything on screen keys off that —
  // another tab's show playing must not make this bar look like it is the one running.
  const isMine = queue?.key === resetKey;

  const lines = useMemo(() => rawLines.filter((l) => l.text?.trim()), [rawLines]);

  // Auto-play is opt-in (the podcastAudio toggle); manual play works from just a key.
  useEffect(() => {
    if (!autoStart || settings.podcastAudio !== true || !hasKey || lines.length === 0) return;
    if (queue?.key === resetKey) return; // already loaded — don't restart it on a re-render
    play({ key: resetKey, title: title ?? label, lines, weekSeed, href: href ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, autoStart, hasKey, settings.podcastAudio]);

  // Nothing to read → no player. But whenever there IS dialogue, the Listen bar always
  // renders (even with no key), so there's a visible way to hear the commentary.
  if (lines.length === 0) return null;

  const onToggle = () => {
    if (!hasKey) return;
    if (isMine) {
      toggle();
      return;
    }
    // A different show is loaded (or none). Take the stream.
    play({ key: resetKey, title: title ?? label, lines, weekSeed, href: href ?? null });
  };

  const showLoading = isMine && loading;
  const showPlaying = isMine && playing;
  const at = isMine ? idx : -1;

  return (
    <div className="mt-4 flex items-center gap-3 rounded border border-dw-accent2/30 bg-dw-accent2/5 px-4 py-2.5">
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasKey}
        title={hasKey ? undefined : "Add your ElevenLabs key in Settings — and press Save settings — to hear this as a podcast"}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-dw-accent2 text-paper disabled:opacity-40"
      >
        {showLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : showPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </button>
      {isMine && at >= 0 && (
        <button type="button" onClick={stop} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dw-border text-ink3 hover:text-ink">
          <Square className="h-3 w-3" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">{label}</p>
        <p className="truncate font-serif text-xs text-ink2">
          {!hasKey ? (
            <span className="text-ink3">
              Add your ElevenLabs key in Settings to hear this read aloud —{" "}
              <span className="text-dw-yellow">and press Save settings</span>, or the key never lands.
            </span>
          ) : isMine && error ? (
            <span className="text-dw-red">{error}</span>
          ) : at >= 0 ? (
            `${lines[at]?.speaker ?? ""} — ${at + 1}/${lines.length}`
          ) : (
            "Tap play to hear this read aloud. It keeps playing while you use the rest of the app."
          )}
        </p>
      </div>
    </div>
  );
}
