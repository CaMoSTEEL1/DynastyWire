"use client";

// HIS PHONE — the register dynasty has no equivalent for.
//
// It works because the people in it were named at setup. A text from "Coach Reyes" lands; one
// from "your position coach" does not. Rendered as an actual thread rather than a list, because
// the shape of a conversation is most of what makes it read as one.

import { useCallback, useEffect, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { useIssueTab } from "@/components/dynasty/use-issue-tab";
import { SectionHeader } from "@/components/ui/section-header";
import { RtgGate } from "@/components/rtg/rtg-gate";
import { useBrand } from "@/components/rtg/use-brand";
import { useCharacter } from "@/components/rtg/use-character";
import { cn } from "@/lib/utils";

interface Msg { from: "them" | "him"; text: string }
interface Thread { with: string; relationship: "coach" | "teammate" | "home" | "other"; messages: Msg[] }
interface Texts { threads: Thread[]; error?: boolean }

const REL: Record<Thread["relationship"], string> = {
  coach: "text-dw-crimson",
  teammate: "text-dw-accent2",
  home: "text-dw-green",
  other: "text-ink3",
};

function HisPhoneInner() {
  const { generate, snapshot, loading } = useDynasty();
  const { baseline } = useBrand();
  const character = useCharacter();

  const [texts, setTexts] = useState<Texts | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cached = useIssueTab<Texts>("rtg-texts");
  useEffect(() => {
    if (!texts && cached) setTexts(cached);
  }, [cached, texts]);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await generate<Texts>("rtg-texts", { baselinePlayer: baseline, character });
      if (data?.error || !data?.threads?.length) setError("Quiet week on his phone.");
      else setTexts(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load his phone.");
    } finally {
      setBusy(false);
    }
  }, [generate, baseline, character]);

  if (loading) return <p className="p-6 font-serif text-ink3">Reading the save…</p>;
  if (!snapshot?.player) {
    return (
      <div className="p-6">
        <SectionHeader title="His Phone" subtitle="Road to Glory" />
        <p className="font-serif text-ink2">Open a Road to Glory save to use this screen.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-6">
      <SectionHeader title="His Phone" subtitle="This week's messages" />

      {texts ? (
        <div className="space-y-5">
          {texts.threads.map((t, ti) => (
            <div key={ti} className="rounded border border-paper4 bg-paper2 p-4">
              <p className={cn("font-sans text-[11px] uppercase tracking-wider", REL[t.relationship] ?? REL.other)}>
                {t.with}
              </p>
              <div className="mt-3 space-y-2">
                {t.messages.map((m, mi) => (
                  <div key={mi} className={cn("flex", m.from === "him" ? "justify-end" : "justify-start")}>
                    <p
                      className={cn(
                        "max-w-[80%] rounded-2xl px-3.5 py-2 font-serif text-[15px] leading-snug",
                        m.from === "him"
                          ? "rounded-br-sm bg-dw-crimson/25 text-ink"
                          : "rounded-bl-sm bg-paper4 text-ink2"
                      )}
                    >
                      {m.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded border border-dw-border bg-paper2 px-6 py-10 text-center">
          <p className="font-serif text-ink2">Nothing loaded for this week yet.</p>
          {error && <p className="mt-3 font-serif text-sm text-dw-red">{error}</p>}
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="mt-5 rounded border border-dw-crimson bg-dw-crimson px-6 py-2.5 font-sans text-sm uppercase tracking-wider text-paper hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Loading…" : "Check his phone"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function HisPhonePage() {
  return (
    <RtgGate>
      <HisPhoneInner />
    </RtgGate>
  );
}
