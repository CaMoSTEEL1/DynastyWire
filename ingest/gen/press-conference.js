// TEMPLATE + real module. Copy this shape for each feature: export
// `generate(ctx, apiKey, extra)` returning a JSON-serializable object.
//
// ctx = { systemPrompt, userContext, school, coachName, week, snapshot, delta }
//   - userContext: the grounded week/season text (source of truth — never invent)
//   - snapshot/delta: richer structured data if a feature needs it
// extra = arbitrary options passed from the UI (e.g. { tone: 'hostile' })
//
// Use callClaude(ctx, apiKey, promptString, maxTokens?) -> parsed JSON.

const { callClaude } = require('./_shared');

async function generate(ctx, apiKey, _extra) {
  const prompt = [
    'Generate a post-game press conference as JSON with this exact schema:',
    '{"questions": [{"reporterName": "string", "outlet": "string", "question": "string", "tone": "friendly"|"neutral"|"hostile"|"gotcha"}]}',
    '',
    `Write 6 questions reporters would ask Coach ${ctx.coachName} of ${ctx.school} after THIS WEEK'S game.`,
    'Mix tones: a couple friendly/neutral, at least one hostile or gotcha if the result warrants it.',
    'Ground every question in the actual result, score, and season context. Reporters reference real details.',
    '',
    'Context:',
    ctx.userContext,
  ].join('\n');
  return callClaude(ctx, apiKey, prompt, 1500);
}

module.exports = { generate };
