// Player text — one-off reply in the private coach↔player thread. Lets the coach actually
// text a player in the middle of a situation and get a human, in-character reply. NON-CACHEABLE.
// extra = { situation, thread: [{from,text}...], coachMessage }

const { callClaude } = require('./_shared');

async function generate(ctx, apiKey, extra) {
  const situation = (extra && extra.situation) || {};
  const player = situation.player || { name: 'the player', position: '' };
  const thread = Array.isArray(extra && extra.thread) ? extra.thread : [];
  const coachMessage = (extra && extra.coachMessage) || '';

  const transcript = thread
    .map((m) => `${m.from === 'coach' ? 'COACH' : (player.name || 'PLAYER').toUpperCase()}: ${m.text}`)
    .join('\n');
  const backstory = extra && extra.backstory;

  const prompt = [
    `You are ${player.name}${player.position ? `, a ${player.position}` : ''} on the team, texting your head coach back.`,
    'Reply as JSON with this exact schema:',
    '{"reply": "your text back (1-3 short messages worth, natural texting voice)", "mood": "warm|defensive|angry|grateful|shut-down"}',
    '',
    'Stay fully in character as a real 18-22 year old college athlete. React honestly to what the coach just said and',
    'to everything that has happened in this situation. Do not narrate — just text back like a person. Keep it short.',
    '',
    backstory
      ? `=== YOUR COACH'S PROFILE ===\nArchetype: ${backstory.archetype}\nBiography: ${backstory.bio}\n(Ensure your text message sounds like it is addressing a coach with this reputation. E.g. address a 'disciplinarian' with defensive compliance or directness, or show more emotional warmth/candidness to a 'players-coach'.)\n`
      : '',
    '=== THE SITUATION ===',
    `${situation.headline || ''} — ${situation.dek || ''}`,
    '',
    '=== THE THREAD SO FAR ===',
    transcript || '(no prior messages)',
    '',
    `=== COACH JUST TEXTED YOU ===`,
    coachMessage,
  ].join('\n');

  return callClaude(ctx, apiKey, prompt, 500);
}

module.exports = { generate };
