"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import type { SocialPost } from "@/lib/social/types";
import { SocialPostCard } from "./social-post-card";

const TYPE_PRIORITY: Record<SocialPost["type"], number> = {
  fan: 0,
  rival: 1,
  analyst: 2,
  insider: 3,
  reddit: 4,
  coach: 5,
  recruit: 6,
};

// Organic timing: burst → ramp → settle
function getDelay(index: number): number {
  if (index === 0) return 300;
  if (index <= 2) return 120 + Math.random() * 80;   // 120–200ms burst
  if (index <= 6) return 280 + Math.random() * 120;  // 280–400ms ramp
  return 600 + Math.random() * 300;                  // 600–900ms settle
}

interface SocialFeedProps {
  posts: SocialPost[];
  onPostClick?: (post: SocialPost) => void;
  onVisibleCountChange?: (count: number) => void;
}

export function SocialFeed({ posts, onPostClick, onVisibleCountChange }: SocialFeedProps) {
  const [visibleCount, setVisibleCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sortedPosts = useMemo(
    () => [...posts].sort((a, b) => TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type]),
    [posts]
  );

  useEffect(() => {
    if (sortedPosts.length === 0) return;

    let current = 0;

    function revealNext() {
      current += 1;
      setVisibleCount(current);
      if (current < sortedPosts.length) {
        timerRef.current = setTimeout(revealNext, getDelay(current));
      }
    }

    timerRef.current = setTimeout(revealNext, getDelay(0));

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [sortedPosts.length]);

  useEffect(() => {
    onVisibleCountChange?.(visibleCount);
  }, [visibleCount, onVisibleCountChange]);

  const visiblePosts = sortedPosts.slice(0, visibleCount);

  return (
    <div className="flex flex-col gap-3">
      {visiblePosts.map((post, i) => (
        <SocialPostCard
          key={post.id}
          post={post}
          onClick={onPostClick}
          isNew={i === visibleCount - 1}
        />
      ))}
      {visibleCount < sortedPosts.length && (
        <div className="flex items-center justify-center py-4">
          <div className="flex gap-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-dw-accent" />
            <span className="h-2 w-2 animate-pulse rounded-full bg-dw-accent [animation-delay:200ms]" />
            <span className="h-2 w-2 animate-pulse rounded-full bg-dw-accent [animation-delay:400ms]" />
          </div>
        </div>
      )}
    </div>
  );
}
