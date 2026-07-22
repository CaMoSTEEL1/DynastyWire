// Podcast audio — ElevenLabs TTS for shows (opt-in). Each show persona gets a random but
// gender-matched American voice, re-rolled each week (seeded by week) so it stays consistent
// within a week and rotates across weeks — "random voices each week" without chaos mid-show.

import { invoke } from "@tauri-apps/api/core";

// ElevenLabs premade (stable) American voices, split by gender.
const VOICES_MALE = [
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold" },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam" },
];
const VOICES_FEMALE = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi" },
];

// Small first-name → gender heuristic (defaults to male, the majority of CFB-media personas).
const FEMALE_NAMES = new Set([
  "diana", "lisa", "bella", "rachel", "sarah", "emily", "jessica", "ashley", "amanda",
  "michelle", "nicole", "elena", "maria", "karen", "susan", "linda", "donna", "angela",
]);
function guessGender(personaName: string): "m" | "f" {
  const first = personaName.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return FEMALE_NAMES.has(first) ? "f" : "m";
}

// Deterministic string hash so a persona's voice is stable within a week.
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Pick a gender-matched voice id for a persona, rotating by week. */
export function voiceForPersona(personaName: string, weekSeed: number): string {
  const pool = guessGender(personaName) === "f" ? VOICES_FEMALE : VOICES_MALE;
  const idx = (hash(personaName) + weekSeed) % pool.length;
  return pool[idx].id;
}

/** One spoken line → an <audio>-playable object URL (MP3).
 * `previousText`/`nextText` are the surrounding dialogue lines — ElevenLabs request
 * stitching uses them so each line's delivery flows into the next like one continuous
 * podcast recording instead of isolated clips. */
export async function synthLine(
  apiKey: string,
  voiceId: string,
  text: string,
  stitch?: { previousText?: string; nextText?: string }
): Promise<string> {
  const b64 = await invoke<string>("tts_elevenlabs", {
    apiKey,
    voiceId,
    text,
    previousText: stitch?.previousText ?? null,
    nextText: stitch?.nextText ?? null,
  });
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "audio/mpeg" });
  return URL.createObjectURL(blob);
}
