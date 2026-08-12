// ElevenLabs premade voice IDs — fallback for when named voices can't be resolved
export const VOICE_IDS = {
  // Male broadcast voices
  host_male: "TxGEqnHWrfWFTfGW9XjX",      // Josh — deep, authoritative broadcaster
  analyst_male: "ErXwobaYiN019PkySvjV",    // Antoni — punchy sports analyst
  reporter_male: "bVMeCyTHy58xNoL34h3p",  // Jeremy — clipped reporter cadence
  scout_male: "pNInz6obpgDQGcFmaJgB",      // Adam — measured, evaluative

  // Female broadcast voices
  analyst_female: "21m00Tcm4TlvDq8ikWAM",  // Rachel — sharp, professional
  reporter_female: "XB0fDUnXU5powFXDhCwa", // Charlotte — sophisticated, direct
} as const;

export type VoiceKey = keyof typeof VOICE_IDS;

// Named voice assignments for specific broadcast personas
export const PERSONA_VOICE_NAMES: Record<string, string> = {
  "Marcus Cole": "Andrew",
  "Diana Reeves": "Alexandra",
  // The skeptic. A drier, older voice than the hot-take chair it replaced — the delivery has
  // to match a man who is arguing rather than performing.
  "Adrian Voss": "Brian",
  // The local: a former player, so warmer and less clipped than the national voice he sits
  // opposite. Farr is the distance; Ward is the room.
  "Hollis Ward": "Chris",
  "Dominic Farr": "Roger",
  "Jake Morrison": "Daniel",
  "Lisa Chen": "Lily",
  "Pete Nakamura": "George",
};

// Named voice fallbacks for role-based assignment
const ROLE_VOICE_NAMES = {
  host_male: "Andrew",
  analyst_male: "Bill",
  analyst_female: "Alexandra",
  reporter_male: "Daniel",
  reporter_female: "Lily",
  scout_male: "George",
};

// Reporter voice name pool for press conference reporters
export const REPORTER_VOICE_NAMES = ["Daniel", "Lily", "George", "Aria", "Bill", "Charlotte"];

// Voice settings tuned for sports broadcast energy
export const BROADCAST_SETTINGS = {
  stability: 0.35,       // More variation = more natural & expressive
  similarityBoost: 0.75,
  style: 0.4,            // Some expressiveness
  useSpeakerBoost: true,
};

export const BROADCAST_MODEL = "eleven_turbo_v2_5"; // Fastest + most cost-effective

// Module-level voice cache: maps voice name → voice ID
let voiceCache: Map<string, string> | null = null;

// Simple female name heuristics for voice assignment
const LIKELY_FEMALE_ENDINGS = ["a", "e", "i", "y"];
const LIKELY_FEMALE_NAMES = new Set([
  "diana", "sarah", "ashley", "jessica", "emily", "amanda", "brittany",
  "stephanie", "morgan", "taylor", "alexis", "tanya", "lisa", "jennifer",
  "michelle", "samantha", "kate", "katie", "kim", "kimberly", "shannon",
  "brittney", "amber", "megan", "lauren", "natalie", "vanessa", "christina",
  "rachel", "charlotte", "olivia", "sophia", "grace", "emma", "avery",
  "brooke", "cassidy", "courtney", "hailey", "haley", "jade", "jasmine",
  "kayla", "kelsey", "kylie", "lacey", "leah", "leigh", "linda", "lucy",
  "madison", "mary", "mia", "natasha", "nina", "paige", "patricia", "penny",
  "lily", "aria", "alexandra",
]);

function isLikelyFemale(name: string): boolean {
  const lower = name.toLowerCase().split(" ")[0];
  if (LIKELY_FEMALE_NAMES.has(lower)) return true;
  if (lower.endsWith("ia") || lower.endsWith("ina") || lower.endsWith("ita")) return true;
  // Last resort: name ends in a vowel that suggests feminine
  const lastChar = lower.slice(-1);
  return LIKELY_FEMALE_ENDINGS.includes(lastChar) && lower.length > 4;
}

export interface PersonaVoiceAssignment {
  name: string;
  voiceId: string;
}

// Fetch and cache the ElevenLabs voice list once per process lifetime
async function getVoiceCache(apiKey: string): Promise<Map<string, string>> {
  if (voiceCache) return voiceCache;
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
    });
    if (!response.ok) {
      voiceCache = new Map();
      return voiceCache;
    }
    const data = await response.json() as { voices: Array<{ name: string; voice_id: string }> };
    voiceCache = new Map(data.voices.map((v) => [v.name, v.voice_id]));
  } catch {
    voiceCache = new Map();
  }
  return voiceCache;
}

export async function resolveVoiceIdByName(name: string, apiKey: string): Promise<string | null> {
  const cache = await getVoiceCache(apiKey);
  return cache.get(name) ?? null;
}

// Async version that resolves named voices from ElevenLabs API
export async function buildPersonaVoiceMapAsync(
  personas: Array<{ name: string; role: string }>,
  apiKey: string
): Promise<Map<string, string>> {
  const cache = await getVoiceCache(apiKey);
  const map = new Map<string, string>();

  for (let index = 0; index < personas.length; index++) {
    const persona = personas[index];
    const role = persona.role.toLowerCase();
    const female = isLikelyFemale(persona.name);

    // Check for explicit persona name assignment first
    const namedVoice = PERSONA_VOICE_NAMES[persona.name];
    if (namedVoice) {
      const voiceId = cache.get(namedVoice);
      if (voiceId) {
        map.set(persona.name, voiceId);
        continue;
      }
    }

    // Fall back to role-based named voice
    let voiceName: string;
    if (role.includes("host") || index === 0) {
      voiceName = ROLE_VOICE_NAMES.host_male;
    } else if (role.includes("scout") || role.includes("insider")) {
      voiceName = female ? ROLE_VOICE_NAMES.analyst_female : ROLE_VOICE_NAMES.scout_male;
    } else if (role.includes("reporter") || role.includes("correspondent")) {
      voiceName = female ? ROLE_VOICE_NAMES.reporter_female : ROLE_VOICE_NAMES.reporter_male;
    } else {
      voiceName = female
        ? ROLE_VOICE_NAMES.analyst_female
        : index % 2 === 1
          ? ROLE_VOICE_NAMES.analyst_male
          : ROLE_VOICE_NAMES.scout_male;
    }

    const voiceId = cache.get(voiceName);
    if (voiceId) {
      map.set(persona.name, voiceId);
    } else {
      // Fallback to hardcoded IDs — must preserve `index` to avoid everyone landing on host_male
      let fallbackId: string;
      if (role.includes("host") || index === 0) {
        fallbackId = VOICE_IDS.host_male;
      } else if (role.includes("scout") || role.includes("insider")) {
        fallbackId = female ? VOICE_IDS.analyst_female : VOICE_IDS.scout_male;
      } else if (role.includes("reporter") || role.includes("correspondent")) {
        fallbackId = female ? VOICE_IDS.reporter_female : VOICE_IDS.reporter_male;
      } else {
        fallbackId = female
          ? VOICE_IDS.analyst_female
          : index % 2 === 1
            ? VOICE_IDS.analyst_male
            : VOICE_IDS.scout_male;
      }
      map.set(persona.name, fallbackId);
    }
  }

  return map;
}

export async function getReporterVoiceIdAsync(reporterName: string, apiKey: string): Promise<string> {
  let hash = 0;
  for (const char of reporterName) {
    hash = (hash * 31 + char.charCodeAt(0)) & 0xffffffff;
  }
  const voiceName = isLikelyFemale(reporterName)
    ? "Lily"
    : REPORTER_VOICE_NAMES[Math.abs(hash) % REPORTER_VOICE_NAMES.length];

  const voiceId = await resolveVoiceIdByName(voiceName, apiKey);
  return voiceId ?? getReporterVoiceId(reporterName);
}

// Legacy sync functions kept for fallback compatibility
export function buildPersonaVoiceMap(
  personas: Array<{ name: string; role: string }>
): Map<string, string> {
  const map = new Map<string, string>();

  personas.forEach((persona, index) => {
    const role = persona.role.toLowerCase();
    const female = isLikelyFemale(persona.name);

    let voiceId: string;

    if (role.includes("host") || index === 0) {
      voiceId = VOICE_IDS.host_male;
    } else if (role.includes("scout") || role.includes("insider")) {
      voiceId = female ? VOICE_IDS.analyst_female : VOICE_IDS.scout_male;
    } else if (role.includes("reporter") || role.includes("correspondent")) {
      voiceId = female ? VOICE_IDS.reporter_female : VOICE_IDS.reporter_male;
    } else {
      voiceId = female
        ? VOICE_IDS.analyst_female
        : index % 2 === 1
          ? VOICE_IDS.analyst_male
          : VOICE_IDS.scout_male;
    }

    map.set(persona.name, voiceId);
  });

  return map;
}

// For press conference reporters — cycle through reporter voices for variety
const REPORTER_VOICE_POOL = [
  VOICE_IDS.reporter_male,
  VOICE_IDS.reporter_female,
  VOICE_IDS.analyst_male,
];

export function getReporterVoiceId(reporterName: string): string {
  let hash = 0;
  for (const char of reporterName) {
    hash = (hash * 31 + char.charCodeAt(0)) & 0xffffffff;
  }
  if (isLikelyFemale(reporterName)) return VOICE_IDS.reporter_female;
  return REPORTER_VOICE_POOL[Math.abs(hash) % REPORTER_VOICE_POOL.length];
}
