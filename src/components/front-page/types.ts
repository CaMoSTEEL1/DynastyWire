// Content shapes for the front-page feature. Defined locally so the standalone
// (static-export) build has no dependency on the old server-side generators
// module (src/lib/ai/generators.ts, which imports the Anthropic SDK). These mirror
// the JSON returned by the ingest/gen/<kind>.js modules.

export type RecapContent = {
  headline: string;
  byline: string;
  body: string;
  pullQuote: string;
  error?: boolean;
};

export type BeatTakesContent = {
  headline: string;
  takes: Array<{ number: number; title: string; body: string }>;
  error?: boolean;
};

export type RankingsTakeContent = {
  headline: string;
  body: string;
  movement: string;
  error?: boolean;
};

export type RecruitingNoteContent = {
  headline: string;
  body: string;
  targets: string[];
  error?: boolean;
};
