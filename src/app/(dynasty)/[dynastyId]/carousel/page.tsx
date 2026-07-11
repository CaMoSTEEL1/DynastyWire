"use client";

// Coaching carousel: generate the staff + rumor mill from the real program state
// (ingest/gen/carousel.js). Rumors are read-only narrative (resolution was server-bound).

import { useCallback, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { SectionHeader } from "@/components/ui/section-header";
import { StaffCard } from "@/components/carousel/staff-card";
import { RumorCard } from "@/components/carousel/rumor-card";
import type { StaffMember, CoachingRumor } from "@/lib/carousel/types";

interface CarouselResult {
  staff?: StaffMember[];
  rumors?: CoachingRumor[];
  error?: boolean;
}

export default function CarouselPage() {
  const { needsOnboarding, generate } = useDynasty();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [rumors, setRumors] = useState<CoachingRumor[]>([]);
  const [generating, setGenerating] = useState(false);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const data = await generate<CarouselResult>("carousel", {});
      if (!data || data.error) {
        setError("The carousel didn't spin up. Try again.");
      } else {
        setStaff(Array.isArray(data.staff) ? data.staff : []);
        setRumors(Array.isArray(data.rumors) ? data.rumors : []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the generator. Check your save + API key.");
    } finally {
      setGenerating(false);
      setTried(true);
    }
  }, [generate]);

  return (
    <div>
      <SectionHeader title="THE CAROUSEL" subtitle="Staff, rumors, and the hot seat" variant="carousel" />

      {needsOnboarding ? (
        <div className="mt-6 rounded border border-dw-border bg-paper2 px-6 py-12 text-center font-serif text-ink2">
          Set up your save + API key in settings to see who&apos;s hot and who&apos;s gone.
        </div>
      ) : (
        <>
          <div className="mt-4 mb-6">
            <button
              type="button"
              onClick={() => void run()}
              disabled={generating}
              className="rounded border border-dw-accent bg-dw-accent px-5 py-2.5 font-sans text-xs uppercase tracking-wider text-paper hover:bg-dw-accent2 disabled:opacity-50"
            >
              {generating ? "Working the phones…" : staff.length || rumors.length ? "Refresh Carousel" : "Spin the Carousel"}
            </button>
          </div>

          {error && !generating && <div className="rounded border border-dw-red/30 bg-dw-red/10 px-6 py-6 text-center font-serif text-dw-red">{error}</div>}
          {!generating && !error && !tried && (
            <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center font-serif text-ink2">See your staff and the latest coaching rumors swirling around the program.</div>
          )}

          {staff.length > 0 && (
            <div className="mb-8">
              <h3 className="mb-3 font-headline text-xs uppercase tracking-wider text-ink3">Your Staff</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {staff.map((s) => <StaffCard key={s.id} staff={s} />)}
              </div>
            </div>
          )}
          {rumors.length > 0 && (
            <div>
              <h3 className="mb-3 font-headline text-xs uppercase tracking-wider text-ink3">The Rumor Mill</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {rumors.map((r) => <RumorCard key={r.id} rumor={r} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
