"use client";

// HIS FEED — the RTG social surface, and the one place he speaks for himself.
//
// The premise the whole screen rests on: the internet does not know him yet. Engagement here
// is scaled to a follower count DynastyWire computes from what actually happened on the field,
// so a 380-follower freshman never gets 2,000 likes. When he posts, the model judges only how
// it LANDED — reach, and whether it drew backlash — and code turns that into the number.

import { useCallback, useEffect, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useIssueTab } from "@/components/dynasty/use-issue-tab";
import { SectionHeader } from "@/components/ui/section-header";
import { RtgGate } from "@/components/rtg/rtg-gate";
import { BrandPanel } from "@/components/rtg/brand-panel";
import { useBrand } from "@/components/rtg/use-brand";
import { useCharacter } from "@/components/rtg/use-character";
import { fmtFollowers } from "@/lib/dynasty/brand";
import { cn } from "@/lib/utils";

interface Post {
  handle: string;
  displayName: string;
  type: "fan" | "rival" | "analyst" | "insider" | "reddit";
  body: string;
  likes?: number;
  reposts?: number;
}
interface Feed { posts: Post[]; error?: boolean }
interface PostResult {
  reach: "ignored" | "local" | "viral";
  backlash: boolean;
  verdict: string;
  replies: Post[];
  error?: boolean;
}

const TYPE_STYLE: Record<Post["type"], string> = {
  fan: "border-dw-border text-ink3",
  rival: "border-dw-red/50 text-dw-red",
  analyst: "border-dw-accent2/50 text-dw-accent2",
  insider: "border-dw-green/40 text-dw-green",
  reddit: "border-paper4 text-ink3",
};

function PostCard({ p }: { p: Post }) {
  return (
    <div className="rounded border border-paper4 bg-paper2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-sans text-[12px] font-semibold text-ink">{p.displayName}</span>
        <span className="font-sans text-[11px] text-ink3">{p.handle}</span>
        <span
          className={cn(
            "ml-auto rounded border px-1.5 py-0.5 font-sans text-[9px] uppercase tracking-wider",
            TYPE_STYLE[p.type] ?? TYPE_STYLE.fan
          )}
        >
          {p.type}
        </span>
      </div>
      <p className="mt-1.5 font-serif text-[15px] leading-snug text-ink2">{p.body}</p>
      {(p.likes != null || p.reposts != null) && (
        <p className="mt-1.5 font-sans text-[10px] text-ink3">
          {p.likes != null && <>{p.likes.toLocaleString("en-US")} likes</>}
          {p.reposts != null && <> · {p.reposts.toLocaleString("en-US")} reposts</>}
        </p>
      )}
    </div>
  );
}

function MySocialPageInner() {
  const { snapshot, generate, loading } = useDynasty();
  const { brand, baseline, week, recordPost } = useBrand();
  const character = useCharacter();

  const [feed, setFeed] = useState<Feed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [result, setResult] = useState<PostResult | null>(null);
  const [resultDelta, setResultDelta] = useState<number | null>(null);

  const cached = useIssueTab<Feed>("rtg-social");
  useEffect(() => {
    if (!feed && cached) setFeed(cached);
  }, [cached, feed]);

  const player = snapshot?.player ?? null;

  const runFeed = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await generate<Feed>("rtg-social", { baselinePlayer: baseline, brand, brandWeek: week, character });
      if (data?.error || !data?.posts?.length) setError("Nothing's being said about him right now.");
      else setFeed(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the feed.");
    } finally {
      setBusy(false);
    }
  }, [generate, baseline, brand, week, character]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || posting) return;
    setPosting(true);
    setError(null);
    try {
      const res = await generate<PostResult>("rtg-post", { text, brand, baselinePlayer: baseline, character }, { force: true });
      if (res?.error || !res?.reach) {
        setError("The post didn't go through.");
        return;
      }
      const applied = await recordPost(text, res.reach, !!res.backlash, res);
      setResult(res);
      setResultDelta(applied.delta);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The post didn't go through.");
    } finally {
      setPosting(false);
    }
  }, [draft, posting, generate, brand, baseline, recordPost, character]);

  if (loading) return <p className="p-6 font-serif text-ink3">Reading the save…</p>;
  if (!player) {
    return (
      <div className="p-6">
        <SectionHeader title="His Feed" subtitle="Road to Glory" />
        <p className="font-serif text-ink2">Open a Road to Glory save to use this screen.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6">
      <SectionHeader title="His Feed" subtitle={`${player.name} · ${fmtFollowers(week?.followers ?? brand.followers)} followers`} />

      <div className="grid gap-6 md:grid-cols-[1fr_16rem]">
        <div className="min-w-0 space-y-4">
          {/* The composer. His words go in verbatim — the model never writes his posts for him. */}
          <div className="rounded border border-dw-accent2/40 bg-paper2 p-4">
            <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">Post something</p>
            <textarea
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={280}
              placeholder="Say it in your own words…"
              className="mt-2 w-full resize-none rounded border border-paper4 bg-paper px-3 py-2 font-serif text-[15px] text-ink outline-none placeholder:text-ink3 focus:border-dw-accent2"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void send()}
                disabled={posting || !draft.trim()}
                className="rounded border border-dw-crimson bg-dw-crimson px-5 py-2 font-sans text-[11px] uppercase tracking-wider text-paper hover:opacity-90 disabled:opacity-40"
              >
                {posting ? "Posting…" : "Post"}
              </button>
              <span className="font-sans text-[10px] text-ink3">{draft.length}/280</span>
              <span className="ml-auto font-sans text-[10px] text-ink3">
                Most posts get ignored. That&apos;s normal.
              </span>
            </div>
          </div>

          {/* How it landed. */}
          {result && (
            <div
              className={cn(
                "rounded border-l-[3px] border bg-paper2 px-4 py-3",
                result.backlash
                  ? "border-l-dw-red border-dw-red/40"
                  : result.reach === "viral"
                    ? "border-l-dw-green border-dw-green/40"
                    : "border-l-paper4 border-dw-border"
              )}
            >
              <p className="font-sans text-[10px] uppercase tracking-widest text-ink3">
                {result.reach === "viral" ? "It travelled" : result.reach === "local" ? "Seen locally" : "Barely registered"}
                {result.backlash ? " · backlash" : ""}
              </p>
              <p className="mt-1 font-serif text-[15px] text-ink2">{result.verdict}</p>
              {resultDelta != null && resultDelta !== 0 && (
                <p className={cn("mt-1 font-sans text-xs font-semibold", resultDelta > 0 ? "text-dw-green" : "text-dw-red")}>
                  {resultDelta > 0 ? "+" : ""}
                  {resultDelta.toLocaleString("en-US")} followers
                </p>
              )}
              <div className="mt-3 space-y-2">
                {result.replies?.map((r, i) => (
                  <PostCard key={i} p={r} />
                ))}
              </div>
            </div>
          )}

          {/* The week's feed. */}
          {feed ? (
            <div className="space-y-2">
              {feed.posts.map((p, i) => (
                <PostCard key={i} p={p} />
              ))}
            </div>
          ) : (
            <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center">
              <p className="font-serif text-ink2">Nothing loaded for this week yet.</p>
              {error && <p className="mt-3 font-serif text-sm text-dw-red">{error}</p>}
              <button
                type="button"
                onClick={() => void runFeed()}
                disabled={busy}
                className="mt-5 rounded border border-dw-crimson bg-dw-crimson px-6 py-2.5 font-sans text-sm uppercase tracking-wider text-paper hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Loading…" : "See what they're saying"}
              </button>
            </div>
          )}
          {feed && error && <p className="font-serif text-sm text-dw-red">{error}</p>}
        </div>

        <aside className="space-y-4">
          <BrandPanel state={brand} week={week} />
          {brand.posts.length > 0 && (
            <div className="rounded border border-dw-border bg-paper2 p-4">
              <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-ink3">His posts</p>
              <ul className="mt-2 space-y-2">
                {brand.posts.slice(-5).reverse().map((p, i) => (
                  <li key={i} className="border-t border-dw-border pt-2 first:border-t-0 first:pt-0">
                    <p className="font-serif text-sm leading-snug text-ink2">&ldquo;{p.text}&rdquo;</p>
                    <p className={cn("mt-0.5 font-sans text-[10px]", p.delta >= 0 ? "text-dw-green" : "text-dw-red")}>
                      {p.delta > 0 ? "+" : ""}
                      {p.delta.toLocaleString("en-US")}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

// Every RTG surface is wrapped: the character is mandatory, and whichever page the user opens
// first is where they meet him. See DESIGN-rtg-mode.md decision 10.
export default function MySocialPage() {
  return (
    <RtgGate>
      <MySocialPageInner />
    </RtgGate>
  );
}
