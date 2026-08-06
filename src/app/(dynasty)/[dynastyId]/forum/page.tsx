"use client";

// The forum: other people's dynasties, read as a spectator.
//
// Two states in one page — the directory, and one dynasty opened. A spectator sees the
// published paper and only that; the allowlist is applied again on arrival (parseBundle) so
// a tampered record cannot get a private section rendered here even if the server served one.
//
// Everything on this page is somebody else's writing. It is rendered as text, never as
// markup, and no field is trusted to be the shape it claims.

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/ui/section-header";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { DEFAULT_FORUM_URL, fetchDynasty, listDynasties, type ForumListing } from "@/lib/share/api";
import type { BundleWeek, DynastyBundle } from "@/lib/share/bundle";
import { Loader2, Search, ArrowLeft, Globe, User } from "lucide-react";

// ── Rendering someone else's sections ─────────────────────────────────────────
// The bundle carries whatever the publisher's version of the app produced, so every read is
// defensive: a missing field renders nothing rather than crashing the page.

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function Paragraphs({ body }: { body: string }) {
  return (
    <>
      {body.split(/\n\n+/).map((p, i) => (
        <p key={i} className="mt-2 font-serif text-[15px] leading-relaxed text-ink2 first:mt-0">
          {p}
        </p>
      ))}
    </>
  );
}

function LeadStory({ data }: { data: unknown }) {
  const d = rec(data);
  const headline = str(d.headline);
  if (!headline) return null;
  return (
    <article>
      <h3 className="font-headline text-2xl leading-tight text-ink">{headline}</h3>
      {str(d.byline) && (
        <p className="mt-1 font-sans text-[10px] uppercase tracking-widest text-ink3">
          By {str(d.byline)}
        </p>
      )}
      {str(d.body) && <div className="mt-3"><Paragraphs body={str(d.body)!} /></div>}
    </article>
  );
}

function SocialWall({ data }: { data: unknown }) {
  const posts = arr(rec(data).posts).map(rec).filter((p) => str(p.body));
  if (posts.length === 0) return null;
  return (
    <div className="space-y-2">
      {posts.slice(0, 12).map((p, i) => (
        <div key={i} className="rounded border border-dw-border bg-paper2 px-3 py-2">
          <p className="font-sans text-[11px] text-ink3">
            <span className="text-ink">{str(p.displayName) ?? "someone"}</span>{" "}
            {str(p.handle) ?? ""}
          </p>
          <p className="font-serif text-sm text-ink2">{str(p.body)}</p>
        </div>
      ))}
    </div>
  );
}

function WireItems({ data }: { data: unknown }) {
  const items = arr(rec(data).items).map(rec).filter((i) => str(i.headline));
  if (items.length === 0) return null;
  return (
    <ul className="space-y-2">
      {items.slice(0, 10).map((it, i) => (
        <li key={i} className="border-b border-dw-border/50 pb-2 last:border-0">
          <p className="font-sans text-[9px] uppercase tracking-widest text-dw-accent2">
            {str(it.category) ?? "wire"} · {str(it.school) ?? ""}
          </p>
          <p className="font-serif text-sm text-ink">{str(it.headline)}</p>
          {str(it.blurb) && <p className="font-serif text-[13px] text-ink3">{str(it.blurb)}</p>}
        </li>
      ))}
    </ul>
  );
}

function ShowTranscript({ data }: { data: unknown }) {
  const d = rec(data);
  const lines = arr(d.dialogue).map(rec).filter((l) => str(l.text));
  if (lines.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {str(d.title) && <p className="font-headline text-lg text-ink">{str(d.title)}</p>}
      {lines.slice(0, 24).map((l, i) => (
        <p key={i} className="font-serif text-sm text-ink2">
          {str(l.speaker) && <span className="font-sans text-[11px] uppercase tracking-wider text-dw-accent2">{str(l.speaker)} </span>}
          {str(l.text)}
        </p>
      ))}
    </div>
  );
}

function Generic({ data }: { data: unknown }) {
  const d = rec(data);
  const headline = str(d.headline);
  const body = str(d.body);
  if (!headline && !body) return null;
  return (
    <div>
      {headline && <h4 className="font-headline text-lg text-ink">{headline}</h4>}
      {body && <div className="mt-1"><Paragraphs body={body} /></div>}
    </div>
  );
}

const SECTION_LABEL: Record<string, string> = {
  "recap-lead": "Front Page",
  "national-wire": "Around the League",
  "national-desk": "National Desk",
  social: "Social",
  rankings: "Rankings",
  shows: "Shows",
  trophy: "Trophy Room",
};

// Order the reader meets them, not the order the object happens to be in.
const SECTION_ORDER = ["recap-lead", "national-desk", "national-wire", "social", "rankings", "shows", "trophy"];

function Section({ kind, data }: { kind: string; data: unknown }) {
  const body =
    kind === "recap-lead" ? <LeadStory data={data} /> :
    kind === "social" ? <SocialWall data={data} /> :
    kind === "national-wire" ? <WireItems data={data} /> :
    kind === "shows" ? <ShowTranscript data={data} /> :
    <Generic data={data} />;
  if (!body) return null;
  return (
    <section className="border-t border-dw-border pt-4">
      <p className="mb-2 font-sans text-[10px] uppercase tracking-[0.3em] text-ink3">
        {SECTION_LABEL[kind] ?? kind}
      </p>
      {body}
    </section>
  );
}

function WeekView({ week }: { week: BundleWeek }) {
  const kinds = SECTION_ORDER.filter((k) => week.tabs[k] != null);
  return (
    <div className="space-y-5">
      {kinds.map((k) => (
        <Section key={k} kind={k} data={week.tabs[k]} />
      ))}
    </div>
  );
}

// ── The spectator view ─────────────────────────────────────────────────────────

function Spectating({ bundle, onBack }: { bundle: DynastyBundle; onBack: () => void }) {
  const [idx, setIdx] = useState(0);
  const week = bundle.weeks[idx];

  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="mb-5 flex items-center gap-2 font-sans text-sm text-ink2 hover:text-dw-accent"
      >
        <ArrowLeft className="h-4 w-4" /> Back to the forum
      </button>

      <div className="rounded border border-dw-border bg-paper2 px-5 py-4">
        <p className="font-sans text-[10px] uppercase tracking-widest text-dw-accent2">
          {bundle.mode === "rtg" ? "Road to Glory" : "Dynasty"} · published by {bundle.handle}
        </p>
        <h2 className="mt-1 font-headline text-2xl uppercase tracking-wide text-ink">{bundle.title}</h2>
        <p className="mt-0.5 font-serif text-sm text-ink3">
          {[bundle.school, bundle.mode === "rtg" ? bundle.playerName : bundle.coachName]
            .filter(Boolean)
            .join(" · ")}
          {bundle.weeks.length > 0 && ` · ${bundle.weeks.length} weeks`}
        </p>
        <p className="mt-2 font-sans text-[10px] uppercase tracking-wider text-ink3">
          You are reading this as a spectator — the published paper only.
        </p>
      </div>

      {bundle.weeks.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {bundle.weeks.map((w, i) => (
            <button
              key={`${w.year}-${w.week}-${i}`}
              type="button"
              onClick={() => setIdx(i)}
              className={cn(
                "rounded border px-2.5 py-1 font-sans text-[11px] transition-colors",
                i === idx
                  ? "border-dw-crimson bg-dw-crimson/15 text-dw-crimson"
                  : "border-dw-border text-ink3 hover:text-ink"
              )}
            >
              {w.year} · wk {w.week}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 space-y-5">
        {week ? <WeekView week={week} /> : <p className="font-serif text-ink3">Nothing published for this week.</p>}
      </div>
    </div>
  );
}

// ── The directory ──────────────────────────────────────────────────────────────

export default function ForumPage() {
  const { settings } = useDynasty();
  const forumUrl = settings.forumUrl || DEFAULT_FORUM_URL;

  const [items, setItems] = useState<ForumListing[] | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<DynastyBundle | null>(null);

  const load = useCallback(
    async (q?: string) => {
      setLoading(true);
      setErr(null);
      try {
        const res = await listDynasties(forumUrl, q);
        setItems(res.items ?? []);
      } catch (e) {
        setItems(null);
        setErr(e instanceof Error ? e.message : "Couldn't load the forum.");
      } finally {
        setLoading(false);
      }
    },
    [forumUrl]
  );

  useEffect(() => { void load(); }, [load]);

  const openOne = useCallback(
    async (id: string) => {
      setLoading(true);
      setErr(null);
      try {
        setOpen(await fetchDynasty(forumUrl, id));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Couldn't open that dynasty.");
      } finally {
        setLoading(false);
      }
    },
    [forumUrl]
  );

  const grouped = useMemo(() => {
    const list = items ?? [];
    return {
      dynasties: list.filter((i) => i.mode !== "rtg"),
      careers: list.filter((i) => i.mode === "rtg"),
    };
  }, [items]);

  if (open) return <Spectating bundle={open} onBack={() => setOpen(null)} />;

  return (
    <div>
      <SectionHeader title="THE FORUM" subtitle="Other people's dynasties, from the outside" />

      <form
        onSubmit={(e) => { e.preventDefault(); void load(query); }}
        className="mt-6 flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by school, coach, or handle"
            className="w-full rounded border border-dw-border bg-paper2 py-2 pl-9 pr-3 font-sans text-sm text-ink outline-none focus:border-dw-crimson"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="rounded border border-dw-crimson bg-dw-crimson px-4 py-2 font-sans text-xs uppercase tracking-wider text-paper disabled:opacity-50"
        >
          Search
        </button>
      </form>

      {err && (
        <div className="mt-6 rounded border border-dw-red/30 bg-dw-red/10 px-4 py-3">
          <p className="font-serif text-sm text-dw-red">{err}</p>
          <p className="mt-1 font-sans text-[11px] text-ink3">
            The forum is at {forumUrl} — you can point this somewhere else in Settings.
          </p>
        </div>
      )}

      {loading && !items && (
        <p className="mt-8 flex items-center gap-2 font-serif italic text-ink3">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading the wire…
        </p>
      )}

      {items && items.length === 0 && !err && (
        <div className="mt-8 rounded border border-dw-border bg-paper2 px-6 py-10 text-center">
          <p className="font-serif text-ink2">Nobody has published a dynasty yet.</p>
          <p className="mt-1 font-sans text-xs text-ink3">
            Settings → Sharing to put yours up.
          </p>
        </div>
      )}

      {[
        { label: "Dynasties", list: grouped.dynasties, icon: Globe },
        { label: "Road to Glory", list: grouped.careers, icon: User },
      ].map(({ label, list, icon: Icon }) =>
        list.length === 0 ? null : (
          <div key={label} className="mt-8">
            <p className="mb-2 flex items-center gap-1.5 font-sans text-[10px] uppercase tracking-[0.3em] text-ink3">
              <Icon className="h-3 w-3" /> {label}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {list.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => void openOne(it.id)}
                  className="rounded border border-dw-border bg-paper2 px-4 py-3 text-left transition-colors hover:border-dw-crimson"
                >
                  <p className="font-headline text-base uppercase tracking-wide text-ink">{it.title}</p>
                  <p className="font-sans text-[11px] text-ink3">
                    {[it.school, it.mode === "rtg" ? it.playerName : it.coachName, it.record]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="mt-1 font-sans text-[10px] uppercase tracking-wider text-dw-accent2">
                    {it.handle} · {it.weeks} week{it.weeks === 1 ? "" : "s"}
                    {it.latestYear ? ` · through ${it.latestYear} wk ${it.latestWeek}` : ""}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}
