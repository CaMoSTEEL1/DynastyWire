"use client";

import { cn } from "@/lib/utils";
import { motion, useReducedMotion } from "framer-motion";
import { Heart, Repeat2, BadgeCheck } from "lucide-react";
import type { SocialPost } from "@/lib/social/types";
import { useEffect, useRef, useState } from "react";
import { AddToLore } from "@/components/dynasty/add-to-lore";

const TYPE_COLORS: Record<SocialPost["type"], { avatar: string; badge: string }> = {
  fan: { avatar: "bg-ink2", badge: "bg-ink2/20 text-ink2" },
  rival: { avatar: "bg-dw-red", badge: "bg-dw-red/20 text-dw-red" },
  analyst: { avatar: "bg-dw-accent2", badge: "bg-dw-accent2/20 text-dw-accent2" },
  insider: { avatar: "bg-dw-accent", badge: "bg-dw-accent/20 text-dw-accent" },
  reddit: { avatar: "bg-dw-yellow", badge: "bg-dw-yellow/20 text-dw-yellow" },
  coach: { avatar: "bg-dw-accent2", badge: "bg-dw-accent2/20 text-dw-accent2" },
  recruit: { avatar: "bg-dw-green", badge: "bg-dw-green/20 text-dw-green" },
};

function StarRating({ count }: { count: number }) {
  return (
    <span className="inline-flex gap-0.5">
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={cn("text-[10px]", i < count ? "text-dw-yellow" : "text-ink3")}>
          ★
        </span>
      ))}
    </span>
  );
}

// rAF-based counter that ticks from 0 → target when enabled
function useCountUp(target: number, enabled: boolean): number {
  const [value, setValue] = useState(enabled ? 0 : target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || target === 0) {
      setValue(target);
      return;
    }

    const duration = 900;
    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setValue(Math.round(eased * target));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [target, enabled]);

  return value;
}

// Entry variant keyed by post type
function getEntryVariant(type: SocialPost["type"]) {
  if (type === "rival") {
    return { initial: { opacity: 0, x: -20 }, animate: { opacity: 1, x: 0 } };
  }
  if (type === "insider") {
    return { initial: { opacity: 0, y: -10 }, animate: { opacity: 1, y: 0 } };
  }
  return { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
}

interface SocialPostCardProps {
  post: SocialPost;
  onClick?: (post: SocialPost) => void;
  delay?: number;
  isNew?: boolean;
}

export function SocialPostCard({ post, onClick, delay = 0, isNew = false }: SocialPostCardProps) {
  const colors = TYPE_COLORS[post.type] ?? TYPE_COLORS.fan;
  const reducedMotion = useReducedMotion();

  const variant = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : getEntryVariant(post.type);

  const liveEffect = isNew && !reducedMotion;
  const likes = useCountUp(post.likes, liveEffect);
  const reposts = useCountUp(post.reposts, liveEffect);

  const showRivalPulse = post.type === "rival" && liveEffect;
  const showInsiderShimmer = post.type === "insider" && liveEffect;

  return (
    <motion.div
      initial={variant.initial}
      animate={variant.animate}
      transition={{ duration: 0.35, delay }}
      className={cn(
        "relative overflow-hidden rounded border border-dw-border bg-paper2 p-4",
        onClick && "cursor-pointer transition-colors hover:bg-paper3"
      )}
      onClick={onClick ? () => onClick(post) : undefined}
    >
      {/* Rival: crimson border pulse on entry */}
      {showRivalPulse && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.7, 0] }}
          transition={{ duration: 1.5, times: [0, 0.25, 1], ease: "easeOut" }}
          className="pointer-events-none absolute inset-0 rounded border-2 border-dw-red"
        />
      )}

      {/* Insider: gold shimmer sweep on entry */}
      {showInsiderShimmer && (
        <motion.div
          initial={{ x: "-100%" }}
          animate={{ x: "250%" }}
          transition={{ duration: 0.85, ease: "easeOut", delay: 0.05 }}
          className="pointer-events-none absolute inset-0 w-1/2 bg-gradient-to-r from-transparent via-dw-accent/25 to-transparent"
        />
      )}

      <div className="flex gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-paper",
            colors.avatar
          )}
        >
          {post.avatarInitial}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-sans text-sm font-bold text-ink">
              {post.displayName}
            </span>
            {post.verified && (
              <BadgeCheck className="h-3.5 w-3.5 text-dw-accent" />
            )}
            <span className="text-xs text-ink3">{post.handle}</span>
            <span className="text-xs text-ink3">&middot;</span>
            <span className="text-xs text-ink3">{post.timestamp}</span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-sans font-semibold uppercase tracking-wide",
                colors.badge
              )}
            >
              {post.type}
            </span>
            {post.type === "recruit" && post.stars !== undefined && (
              <StarRating count={post.stars} />
            )}
            {post.type === "recruit" && post.position && (
              <span className="rounded bg-paper3 px-1.5 py-0.5 font-sans text-[10px] uppercase tracking-wide text-ink3">
                {post.position}
              </span>
            )}
          </div>

          <p className="mt-1.5 font-serif text-sm leading-relaxed text-ink">
            {post.type === "coach" && (
              <span className="mr-1">🏈</span>
            )}
            {post.body}
          </p>

          <div className="mt-2.5 flex items-center gap-5">
            <span className="flex items-center gap-1.5 text-xs text-ink3">
              <Heart className="h-3.5 w-3.5" />
              {likes.toLocaleString()}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-ink3">
              <Repeat2 className="h-3.5 w-3.5" />
              {reposts.toLocaleString()}
            </span>
            {/*
              Kept as a PERSON, not as a quote. A one-off take ages out in a week, but an
              account the user liked is reusable forever — and the lore block tells the
              newsroom to bring named people back rather than invent a replacement.
            */}
            <AddToLore
              kind="person"
              from="The Wire"
              label="Keep"
              text={`${post.displayName} (${post.handle}) is a real ${post.type} voice around this program. They post things like: "${post.body}"`}
              className="ml-auto"
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
