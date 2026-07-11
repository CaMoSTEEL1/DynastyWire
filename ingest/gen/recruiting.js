// Recruiting storyline generator. Ported from the old
// src/app/api/recruiting/storyline/[recruitId]/route.ts insider voice, but
// generalized: the standalone save does NOT yet expose the individual recruit
// board (names, stars, commitments), so we do NOT invent specific recruits.
// Instead we generate a grounded recruiting-TRAIL column about the program's
// momentum, tied strictly to the real season context in ctx.userContext.
//
// ctx = { systemPrompt, userContext, school, coachName, week, snapshot, delta }
// Returns: { headline, subhead, trend, trendReason, beats: [{title, text}] }

const { callClaude } = require('./_shared');

const VALID_TRENDS = new Set(['hot', 'warm', 'stable', 'cooling', 'cold']);

function fallback(school) {
  return {
    headline: `${school} works the trail`,
    subhead: 'Reading from your save — recruit-level detail coming soon.',
    trend: 'stable',
    trendReason:
      'The board itself has not been extracted from your dynasty save yet, so this is a program-level read.',
    beats: [
      {
        title: 'On the ground',
        text: `The ${school} staff keeps grinding the trail. Individual commitments will surface here once the recruiting board is read from your save.`,
      },
    ],
  };
}

async function generate(ctx, apiKey, _extra) {
  const prompt = [
    'You are a college football recruiting insider writing a program recruiting-trail column as JSON with this exact schema:',
    JSON.stringify({
      headline: 'string (punchy insider headline)',
      subhead: 'string (one line)',
      trend: 'hot|warm|stable|cooling|cold',
      trendReason: 'string (1 sentence — why the trail is trending this way)',
      beats: [{ title: 'string', text: 'string (2-3 sentences)' }],
    }),
    '',
    `Write the recruiting-trail outlook for ${ctx.school} under Coach ${ctx.coachName} at Week ${ctx.week}.`,
    'Produce 3-4 beats: how on-field results are playing on the trail, position groups the program needs to sell, regional pipeline energy, and the momentum (or pressure) recruits are feeling about this staff.',
    '',
    'HARD CONSTRAINTS:',
    '- Do NOT invent specific named recruits, star ratings, commitment counts, or a class ranking. The individual recruiting board is not available.',
    '- Talk about the program and the trail in general insider terms, grounded ENTIRELY in the real season context below.',
    '- Set trend from the actual results: winning and climbing = hot/warm, losing or sliding = cooling/cold.',
    '',
    'Context:',
    ctx.userContext,
  ].join('\n');

  const parsed = await callClaude(ctx, apiKey, prompt, 1200);
  if (!parsed || typeof parsed.headline !== 'string' || !Array.isArray(parsed.beats)) {
    return fallback(ctx.school);
  }
  if (!VALID_TRENDS.has(parsed.trend)) parsed.trend = 'stable';
  return parsed;
}

module.exports = { generate };
