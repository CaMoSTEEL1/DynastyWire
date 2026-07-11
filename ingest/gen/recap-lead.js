// Lead-story recap generator for the front page. Copied from press-conference.js
// shape; voice ported faithfully from src/lib/ai/generators.ts (generateRecap) and
// ingest/generate.js. Returns { headline, byline, body, pullQuote } grounded in
// ctx.userContext (the sole source of truth — never invent scores/ranks/records).
//
// ctx = { systemPrompt, userContext, school, coachName, week, snapshot, delta }

const { callClaude } = require('./_shared');

async function generate(ctx, apiKey, _extra) {
  const prompt = [
    'Write a 150-word beat reporter game recap as JSON with this exact schema:',
    '{"headline": "string", "byline": "string", "body": "string", "pullQuote": "string"}',
    '',
    `The byline is a fictional beat reporter covering ${ctx.school}.`,
    "The body reads like a professional newspaper recap of THIS WEEK'S GAME.",
    `The pullQuote is a compelling quote attributed to Coach ${ctx.coachName} or a player. Provide the quote text only, without surrounding quotation marks.`,
    'Ground every detail in the actual result, score, and season context — never invent numbers.',
    '',
    'Context:',
    ctx.userContext,
  ].join('\n');

  const parsed = await callClaude(ctx, apiKey, prompt, 1200);

  if (
    parsed &&
    typeof parsed.headline === 'string' &&
    typeof parsed.byline === 'string' &&
    typeof parsed.body === 'string' &&
    typeof parsed.pullQuote === 'string'
  ) {
    return parsed;
  }

  return {
    headline: `Week ${ctx.week} Recap`,
    byline: 'DynastyWire Staff',
    body: 'Content generation encountered a formatting issue. Please try again.',
    pullQuote: 'We just have to keep working.',
    error: true,
  };
}

module.exports = { generate };
