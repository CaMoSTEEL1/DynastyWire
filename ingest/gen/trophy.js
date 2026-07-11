// Season retrospective generator for the Trophy Room screen.
// Copied from the press-conference template shape: export
// generate(ctx, apiKey, extra) returning a JSON-serializable object.
//
// The old multi-season dynasty retrospective (see git HEAD
// src/lib/trophy/generators.ts + src/app/api/trophy/retrospective/route.ts)
// leaned on an archive of many seasons with awards/highlights/legacy scores.
// The standalone save only exposes the CURRENT season snapshot, so this ports
// the literary "longform feature" voice but grounds it in this season's real
// record/ranking/results instead of a full tenure. Same output schema
// (DynastyRetrospective: { headline, body, chapters[] }) so the existing
// component renders it unchanged.

const { callClaude } = require('./_shared');

async function generate(ctx, apiKey, _extra) {
  const u = ctx.snapshot && ctx.snapshot.userTeam;
  const school = ctx.school || (u && u.name) || 'the program';
  const coachName = ctx.coachName || 'the head coach';

  // Literary retrospective voice, ported from the old generators.ts system prompt.
  const systemPrompt = [
    'You are a prestigious sports journalist writing a long-form retrospective on a',
    'college football program mid-season. Your style is literary, sweeping, and',
    'authoritative — think Wright Thompson or Dan Jenkins. Ground every claim in the',
    'real data provided; never invent scores, rankings, or awards. Return valid JSON',
    'matching the exact schema provided. No markdown, no code fences.',
  ].join(' ');

  const prompt = [
    `Write a retrospective on the ${school} season so far under Coach ${coachName}.`,
    'Treat the campaign to date as a story with a narrative arc — the identity of the',
    'team, its signature moments, and what is at stake down the stretch.',
    '',
    'Return JSON with this EXACT schema:',
    '{',
    '  "headline": "A sweeping, memorable longform headline (newspaper feature style)",',
    '  "body": "A 90-140 word introduction setting the scene for the season so far",',
    '  "chapters": [',
    '    { "title": "Chapter title referencing a real beat of the season", "body": "120-180 words", "year": 0 }',
    '  ]',
    '}',
    '',
    'Include 2 or 3 chapters covering the arc so far (the start, the defining game, and',
    'where the season stands now). Leave "year" as 0 in every chapter. Reference the',
    'actual record, ranking, and results below. Do not fabricate a national title or',
    'awards that are not in the data.',
    '',
    'Context (source of truth — never contradict it):',
    ctx.userContext,
  ].join('\n');

  const fallback = {
    headline: `The ${coachName} Chapter at ${school}`,
    body: u
      ? `Through the season so far, ${school} sits at ${u.wins}-${u.losses}${
          u.rankMedia ? `, ranked #${u.rankMedia} in the media poll` : ', unranked in the media poll'
        }. Coach ${coachName} is still writing the story of this campaign — every week another paragraph in a season that is far from finished.`
      : `Coach ${coachName} is still writing the story of this ${school} campaign. The full retrospective is waiting on this week's results to take shape.`,
    chapters: [
      {
        title: 'The Season So Far',
        body: u
          ? `${school} has built a ${u.wins}-${u.losses} record to this point. ${
              u.rankMedia
                ? `A #${u.rankMedia} media ranking says the rest of the country is paying attention.`
                : 'The polls have yet to take notice, but the season is young.'
            } The chapters ahead are unwritten.`
          : 'The season is underway, and the defining moments are still ahead.',
        year: 0,
      },
    ],
  };

  try {
    // callClaude(ctx, apiKey, prompt, maxTokens) reads ctx.systemPrompt only, so pass a
    // minimal ctx carrying our literary system prompt. It returns already-parsed JSON.
    const result = await callClaude({ systemPrompt }, apiKey, prompt, 3000);
    if (
      result &&
      typeof result.headline === 'string' &&
      typeof result.body === 'string' &&
      Array.isArray(result.chapters)
    ) {
      return {
        headline: result.headline,
        body: result.body,
        chapters: result.chapters.map((ch) => ({
          title: typeof ch.title === 'string' ? ch.title : 'Untitled Chapter',
          body: typeof ch.body === 'string' ? ch.body : '',
          year: typeof ch.year === 'number' ? ch.year : 0,
        })),
      };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

module.exports = { generate };
