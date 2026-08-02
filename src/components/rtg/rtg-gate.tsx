"use client";

// The gate that makes the character mandatory (DESIGN-rtg-mode.md, decision 10).
//
// Wrapping the surfaces rather than redirecting: a redirect fights the hard-navigation routing
// this app uses, and a half-filled form that vanishes on a tab click is worse than no form.
// Every RTG page renders this around itself, so wherever the user lands first, that is where
// they meet him.

import { useCallback, useEffect, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { CharacterSetup } from "@/components/rtg/character-setup";
import { isComplete, loadCharacter, type RtgCharacter } from "@/lib/dynasty/rtg-character";

export function RtgGate({ children }: { children: React.ReactNode }) {
  const { snapshot, dynastyId, loading } = useDynasty();
  const [character, setCharacter] = useState<RtgCharacter | null>(null);
  const [checked, setChecked] = useState(false);

  // Load, then settle — the store is the external system here, so the state lands in the
  // promise callback rather than in the effect body. `cancelled` guards the dynasty being
  // switched mid-read, which the provider does on every profile change.
  const refresh = useCallback(() => {
    let cancelled = false;
    void loadCharacter(dynastyId).then((c) => {
      if (cancelled) return;
      setCharacter(c);
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [dynastyId]);

  useEffect(() => refresh(), [refresh]);

  if (loading || !checked) return <p className="p-6 font-serif text-ink3">Reading the save…</p>;

  // Not an RTG save — the surface itself explains that; the gate stays out of the way.
  if (snapshot?.mode !== "rtg") return <>{children}</>;

  if (!isComplete(character)) return <CharacterSetup onDone={() => void refresh()} />;
  return <>{children}</>;
}
