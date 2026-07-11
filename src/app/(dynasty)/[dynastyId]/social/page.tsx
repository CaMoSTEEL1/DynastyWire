"use client";

import { useState, useCallback } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { SectionHeader } from "@/components/ui/section-header";
import { SocialFeed } from "@/components/social/social-feed";
import { TrendingPanel } from "@/components/social/trending-panel";
import type { SocialPost } from "@/lib/social/types";

// Shape returned by ingest/gen/social.js
interface SocialGenPost {
  handle: string;
  displayName: string;
  type: SocialPost["type"];
  body: string;
  likes: number;
  reposts: number;
}
interface SocialGenResult {
  posts: SocialGenPost[];
  error?: boolean;
}

const FAN_TIMESTAMPS = [
  "1m ago", "2m ago", "3m ago", "5m ago", "7m ago", "10m ago",
  "14m ago", "18m ago", "22m ago", "28m ago", "34m ago", "40m ago",
];

function hydrate(raw: SocialGenPost, index: number): SocialPost {
  return {
    id: `social_${index}_${raw.handle}`,
    handle: raw.handle,
    displayName: raw.displayName,
    type: raw.type,
    body: raw.body,
    likes: raw.likes,
    reposts: raw.reposts,
    timestamp: FAN_TIMESTAMPS[index] ?? `${45 + index * 5}m ago`,
    verified: raw.type === "analyst" || raw.type === "insider",
    avatarInitial: (raw.displayName.charAt(0) || raw.handle.charAt(1) || "?").toUpperCase(),
  };
}

export default function SocialPage() {
  const { needsOnboarding, generate } = useDynasty();

  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [generating, setGenerating] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const data = await generate<SocialGenResult>("social", {});
      if (data?.error || !Array.isArray(data?.posts) || data.posts.length === 0) {
        setError("The feed didn't come through. Give it another shot.");
        setPosts([]);
      } else {
        setPosts(data.posts.map((p, i) => hydrate(p, i)));
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't reach the generator. Check your save and API key in settings."
      );
      setPosts([]);
    } finally {
      setGenerating(false);
      setHasGenerated(true);
    }
  }, [generate]);

  const generateButton = (
    <button
      type="button"
      onClick={() => void handleGenerate()}
      disabled={generating || needsOnboarding}
      className="rounded border border-dw-accent bg-dw-accent px-5 py-2.5 font-sans text-xs uppercase tracking-wider text-paper transition-colors hover:bg-dw-accent2 hover:border-dw-accent2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {generating
        ? "Reading the room..."
        : posts.length > 0
          ? "Regenerate Feed"
          : "Generate The Wire"}
    </button>
  );

  return (
    <div>
      <SectionHeader
        title="THE WIRE"
        subtitle="What they're saying across the internet"
        variant="social"
      />

      {/* Onboarding gate — degrade gracefully when the save/key aren't set up yet */}
      {needsOnboarding && (
        <div className="mt-6 rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
          <p className="font-serif text-ink2">
            Reading from your save&hellip; Point DynastyWire at your dynasty and add
            your API key in settings, then the beat writers, rivals, and analysts
            will start talking.
          </p>
        </div>
      )}

      {!needsOnboarding && (
        <>
          <div className="mt-4 mb-6 flex flex-wrap items-center gap-3">
            {generateButton}
            {posts.length > 0 && (
              <span className="flex items-center gap-2">
                {visibleCount < posts.length ? (
                  <>
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-dw-red opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-dw-red" />
                    </span>
                    <span className="font-sans text-xs font-semibold uppercase tracking-wider text-dw-red">
                      Live
                    </span>
                    <span className="font-sans text-xs text-ink3">
                      &middot; {visibleCount} of {posts.length}
                    </span>
                  </>
                ) : (
                  <span className="font-sans text-xs text-ink3">{posts.length} posts</span>
                )}
              </span>
            )}
          </div>

          {/* Generating skeleton */}
          {generating && posts.length === 0 && (
            <div className="flex items-center justify-center py-16">
              <div className="flex gap-1.5">
                <span className="h-2 w-2 animate-pulse rounded-full bg-dw-accent" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-dw-accent [animation-delay:200ms]" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-dw-accent [animation-delay:400ms]" />
              </div>
            </div>
          )}

          {/* Error */}
          {error && !generating && (
            <div className="rounded border border-dw-red/30 bg-dw-red/10 px-6 py-10 text-center">
              <p className="font-serif text-dw-red">{error}</p>
            </div>
          )}

          {/* Empty (post-attempt, no error) */}
          {!generating && !error && posts.length === 0 && hasGenerated && (
            <div className="rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
              <p className="font-serif text-ink2">Nothing on the timeline yet. Try generating again.</p>
            </div>
          )}

          {/* Initial idle state */}
          {!generating && !error && posts.length === 0 && !hasGenerated && (
            <div className="rounded border border-dw-border bg-paper2 px-6 py-12 text-center">
              <p className="font-serif text-ink2">
                The social feeds are warming up. Generate The Wire to see what fans,
                rivals, and analysts have to say about your latest result.
              </p>
            </div>
          )}

          {/* Feed */}
          {posts.length > 0 && (
            <div className="flex flex-col gap-6 lg:flex-row">
              <div className="order-2 lg:order-1 min-w-0 flex-1">
                <SocialFeed posts={posts} onVisibleCountChange={setVisibleCount} />
              </div>
              <div className="order-1 lg:order-2 w-full shrink-0 lg:w-64">
                <div className="lg:sticky lg:top-24">
                  <TrendingPanel posts={posts} visibleCount={visibleCount} />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
