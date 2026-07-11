// NIL & transfer-portal market generator. Ported from the old
// src/lib/nil/generators.ts (generateNILOffers + generatePortalDrama) voice.
//
// The old generators produced per-player NIL offers and portal entries, which
// required roster data. The standalone save does NOT expose the roster, so we
// DEGRADE to a general NIL-market column: the program's collective activity and
// transfer-portal climate, grounded strictly in the real season context. No
// invented rostered player identities.
//
// ctx = { systemPrompt, userContext, school, coachName, week, snapshot, delta }
// Returns: { headline, body, marketTemp, tempReason, notes: [{label, text}] }

const { callClaude } = require('./_shared');

const VALID_TEMPS = new Set(['cold', 'warm', 'hot', 'red-hot']);

function fallback(school) {
  return {
    headline: `${school} NIL market holds steady`,
    body: `The collective keeps the lights on and the portal phones charged. Player-level NIL and portal detail will surface here once the roster is read from your save.`,
    marketTemp: 'warm',
    tempReason: 'Program-level read only — roster data is not yet extracted from the save.',
    notes: [
      {
        label: 'Collective',
        text: `${school}'s collective is operating at its baseline. Watch this space as results move the market.`,
      },
    ],
  };
}

async function generate(ctx, apiKey, _extra) {
  const prompt = [
    'You are a college football NIL and transfer-portal insider writing a market column as JSON with this exact schema:',
    JSON.stringify({
      headline: 'string (insider headline)',
      body: 'string (2-3 sentences setting the NIL/portal scene for the program)',
      marketTemp: 'cold|warm|hot|red-hot',
      tempReason: 'string (1 sentence — why the market is this hot/cold)',
      notes: [{ label: 'string (short tag, e.g. Collective, Portal, Boosters)', text: 'string (1-2 sentences)' }],
    }),
    '',
    `Write the NIL & transfer-portal market outlook for ${ctx.school} at Week ${ctx.week}.`,
    'Produce 3-4 notes covering: the collective / donor mood, the transfer-portal climate around the program, and how winning or losing is moving NIL leverage.',
    '',
    'HARD CONSTRAINTS:',
    '- Do NOT invent specific rostered player names, exact dollar offers tied to a named player, or fake commitments. The roster is not available.',
    '- Write about the program NIL market and portal climate in general insider terms, grounded ENTIRELY in the real season context below.',
    '- Set marketTemp from the actual results: winning programs run hot, struggling ones cool off.',
    '',
    'Context:',
    ctx.userContext,
  ].join('\n');

  const parsed = await callClaude(ctx, apiKey, prompt, 1300);
  if (!parsed || typeof parsed.headline !== 'string' || !Array.isArray(parsed.notes)) {
    return fallback(ctx.school);
  }
  if (!VALID_TEMPS.has(parsed.marketTemp)) parsed.marketTemp = 'warm';
  return parsed;
}

module.exports = { generate };
