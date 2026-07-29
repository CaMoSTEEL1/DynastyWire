// Podcast audio — ElevenLabs TTS for shows (opt-in). Each show persona gets a random but
// gender-matched American voice, re-rolled each week (seeded by week) so it stays consistent
// within a week and rotates across weeks — "random voices each week" without chaos mid-show.
//
// Voices come from the user's OWN ElevenLabs account first (cloned, designed, or saved from
// the voice library). The premade stock voices below are only a fallback for accounts with
// nothing custom on them — see `voiceForPersonaAsync`.

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

/** Premade-voice fallback: gender-matched stock voice, rotating by week. */
export function voiceForPersona(personaName: string, weekSeed: number): string {
  const pool = guessGender(personaName) === "f" ? VOICES_FEMALE : VOICES_MALE;
  const idx = (hash(personaName) + weekSeed) % pool.length;
  return pool[idx].id;
}

// ---------------------------------------------------------------------------
// Custom voices (the user's own ElevenLabs library)
// ---------------------------------------------------------------------------

export interface ElevenVoice {
  voice_id: string;
  name: string;
  /** "cloned" | "generated" | "professional" | "famous" | "high_quality" — never "premade". */
  category: string;
  /** "male" | "female" | "" (only set when the voice carries a gender label). */
  gender: string;
  description: string;
}

// One fetch per key per session. A failed fetch caches [] so a dead key doesn't re-request
// on every single line of a show — `refreshCustomVoices` is the way back.
let voiceCache: Promise<ElevenVoice[]> | null = null;
let voiceCacheKey: string | null = null;

/** The user's own ElevenLabs voices (cached). Empty = account has none, use premades. */
export function loadCustomVoices(apiKey: string): Promise<ElevenVoice[]> {
  if (!voiceCache || voiceCacheKey !== apiKey) {
    voiceCacheKey = apiKey;
    voiceCache = invoke<ElevenVoice[]>("elevenlabs_list_voices", { apiKey }).catch(() => []);
  }
  return voiceCache;
}

/** Re-fetch the library — for after the user adds voices on elevenlabs.io. Throws on failure
 * so Settings can show the real error instead of silently reporting zero voices. */
export async function refreshCustomVoices(apiKey: string): Promise<ElevenVoice[]> {
  const fresh = await invoke<ElevenVoice[]>("elevenlabs_list_voices", { apiKey });
  voiceCacheKey = apiKey;
  voiceCache = Promise.resolve(fresh);
  return fresh;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, "").trim();

/** A voice the user deliberately named after this persona wins over any auto-assignment —
 * name an ElevenLabs voice "Marcus Cole" and Marcus Cole speaks with it. */
function nameMatch(voices: ElevenVoice[], personaName: string): ElevenVoice | null {
  const persona = normalize(personaName);
  if (!persona) return null;
  const exact = voices.find((v) => normalize(v.name) === persona);
  if (exact) return exact;
  // Looser: the voice is named for part of the persona ("Cole") or carries it ("Marcus Cole —
  // Host"). Guarded at 4+ chars so short tokens can't collide with unrelated voice names.
  const parts = persona.split(" ").filter((p) => p.length >= 4);
  return (
    voices.find((v) => {
      const name = normalize(v.name);
      if (name.length < 4) return false;
      return name.includes(persona) || parts.some((p) => name === p || name.includes(p));
    }) ?? null
  );
}

/** Voice's own gender: its label if it has one, else a guess from the voice's name. */
function voiceGender(v: ElevenVoice): "m" | "f" {
  if (v.gender.startsWith("f")) return "f";
  if (v.gender.startsWith("m")) return "m";
  return guessGender(v.name);
}

/** Pick a voice id for a persona, preferring the user's own ElevenLabs voices.
 *
 * Order: a voice named after the persona → a gender-matched custom voice (rotating by week)
 * → any custom voice → the premade stock pool. Set `preferCustom: false` to force premades. */
export async function voiceForPersonaAsync(
  apiKey: string,
  personaName: string,
  weekSeed: number,
  opts?: { preferCustom?: boolean }
): Promise<string> {
  if (opts?.preferCustom === false) return voiceForPersona(personaName, weekSeed);

  const voices = await loadCustomVoices(apiKey);
  if (voices.length === 0) return voiceForPersona(personaName, weekSeed);

  const named = nameMatch(voices, personaName);
  if (named) return named.voice_id;

  const want = guessGender(personaName);
  const matched = voices.filter((v) => voiceGender(v) === want);
  // Sorted by id so a persona keeps the same voice across restarts — the API's own ordering
  // isn't guaranteed stable, and an unsorted pool would re-roll voices mid-week.
  const pool = (matched.length > 0 ? matched : voices)
    .slice()
    .sort((a, b) => a.voice_id.localeCompare(b.voice_id));
  return pool[(hash(personaName) + weekSeed) % pool.length].voice_id;
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
