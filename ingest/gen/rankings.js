// Rankings analyst-take generator for the Rankings screen. Copied from
// press-conference.js shape; voice ported faithfully from
// src/lib/ai/generators.ts (generateRankingsTake) and ingest/generate.js.
// Returns { headline, body, movement } grounded in ctx.userContext.
//
// ctx = { systemPrompt, userContext, school, coachName, week, snapshot, delta }

const { callClaude } = require('./_shared');

async function generate(ctx, apiKey, _extra) {
  const prompt = [
    "Write a 100-word CFP analyst take about this team's ranking picture as JSON with this exact schema:",
    '{"headline": "string", "body": "string", "movement": "string"}',
    '',
    `Analyze ${ctx.school}'s playoff/ranking picture after Week ${ctx.week}. If UNRANKED, frame it as trying to break in — never invent a number.`,
    "movement is a short phrase like 'On the bubble', 'Knocking on the door', 'Holds at #8', 'Up 3 spots', 'Drops out'.",
    'Write in the voice of a TV studio analyst breaking down the CFP picture.',
    '',
    'Context:',
    ctx.userContext,
  ].join('\n');

  const parsed = await callClaude(ctx, apiKey, prompt, 1000);

  if (
    parsed &&
    typeof parsed.headline === 'string' &&
    typeof parsed.body === 'string' &&
    typeof parsed.movement === 'string'
  ) {
    return parsed;
  }

  return {
    headline: `Rankings Watch: Week ${ctx.week}`,
    body: 'Content generation encountered a formatting issue.',
    movement: 'TBD',
    error: true,
  };
}

module.exports = { generate };
