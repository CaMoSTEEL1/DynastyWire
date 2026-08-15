"use client";

// The bar that proves a show is still running after you have walked away from it.
//
// Audio playing from a page you can no longer see is disorienting rather than delightful —
// the user needs to know what is talking, and be able to stop it, from wherever they ended
// up. It hides itself on the tab that owns the player, because two sets of transport
// controls for one stream is worse than one.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2, Pause, Play, Radio, Square } from "lucide-react";
import { usePodcastAudio } from "./podcast-audio";

export function NowPlaying() {
  const { queue, idx, playing, loading, error, toggle, stop } = usePodcastAudio();
  const pathname = usePathname();

  if (!queue) return null;
  // The owning page already renders full controls; don't double up.
  if (queue.href && pathname?.startsWith(queue.href.replace(/\/$/, ""))) return null;

  const line = queue.lines[idx];

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-dw-accent2/30 bg-paper2/95 backdrop-blur supports-[backdrop-filter]:bg-paper2/80">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
        <button
          type="button"
          onClick={toggle}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-dw-accent2 text-paper"
          title={playing ? "Pause" : "Play"}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : playing ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 font-sans text-[10px] uppercase tracking-widest text-dw-accent2">
            <Radio className="h-3 w-3" />
            On air
          </p>
          <p className="truncate font-serif text-xs text-ink2">
            {error ? (
              <span className="text-dw-red">{error}</span>
            ) : (
              <>
                <span className="text-ink">{queue.title}</span>
                {line && (
                  <span className="text-ink3">
                    {" — "}
                    {line.speaker} · {idx + 1}/{queue.lines.length}
                  </span>
                )}
              </>
            )}
          </p>
        </div>

        {queue.href && (
          <Link
            href={queue.href}
            className="shrink-0 font-sans text-[10px] uppercase tracking-wider text-ink3 transition-colors hover:text-dw-accent2"
          >
            Open
          </Link>
        )}
        <button
          type="button"
          onClick={stop}
          title="Stop"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dw-border text-ink3 transition-colors hover:text-ink"
        >
          <Square className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
