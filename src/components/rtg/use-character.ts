"use client";

// The character, loaded once per dynasty and passed into every RTG generation.
//
// Kept separate from useBrand so a page that only needs one doesn't pull the other's stores.

import { useEffect, useState } from "react";
import { useDynasty } from "@/components/dynasty/dynasty-context";
import { loadCharacter, type RtgCharacter } from "@/lib/dynasty/rtg-character";

export function useCharacter(): RtgCharacter | null {
  const { dynastyId } = useDynasty();
  const [character, setCharacter] = useState<RtgCharacter | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadCharacter(dynastyId).then((c) => {
      if (!cancelled) setCharacter(c);
    });
    return () => {
      cancelled = true;
    };
  }, [dynastyId]);
  return character;
}
