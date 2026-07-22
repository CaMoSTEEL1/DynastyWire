// Coach Backstory Generator. Runs on-demand when the coach first initializes or resets
// their story. Generates an evocative, editorial-style biography and sets names for the
// athletic director, lead booster, chief beat writer, and rival coach.

const { callClaude } = require('./_shared');

async function generate(ctx, apiKey, extra) {
  const archetype = extra.archetype || 'players-coach';
  const customPath = extra.customPath || '';
  const coachName = ctx.coachName || 'the head coach';
  const school = ctx.school || 'the university';

  const prompt = [
    'You are a premier sports biographer and narrative designer for a college-football simulator.',
    'Write a rich, detailed, and highly immersive backstory and ecosystem for a head coach.',
    'Respond with a JSON object matching this exact schema:',
    '{',
    '  "archetype": "disciplinarian"|"players-coach"|"nil-merchant"|"hometown-savior",',
    '  "customPath": "the custom path input saved back",',
    '  "bio": "2-3 paragraphs (150-220 words) detailing the coach\'s origin story, coaching style, and reputation. Use a prestige sports journalism tone (like The Athletic). Be vivid and specific, not generic.",',
    '  "adName": "fictional realistic Athletic Director name",',
    '  "boosterName": "fictional realistic chief billionaire booster name",',
    '  "reporterName": "fictional realistic lead beat writer name",',
    '  "rivalCoachName": "fictional realistic rival head coach name"',
    '}',
    '',
    'Rules:',
    '- The bio must feel lived-in, textured, and dramatic. Address the pressure they face coming into this job.',
    '- Archetypes profile:',
    '  1. disciplinarian: Old-school, focused on integrity, rules, and academics. They run a tight ship but can ruffle player feathers.',
    '  2. players-coach: High empathy, shields players, built on loyalty and culture. The room loves them, but media/AD watch for discipline cracks.',
    '  3. nil-merchant: Modern, resource-focused, leverages NIL and the transfer portal to win. Hyper-transactional, high booster backing, but culture is volatile.',
    '  4. hometown-savior: Former school legend or local hero returning to bring glory. Fan expectations are massive; every loss is a public event.',
    '- Incorporate the custom career path info if provided: "' + customPath + '".',
    `- Coach Name: ${coachName}`,
    `- School: ${school}`,
    '- Do not mention any real living people or actual active college coaches.',
    '- Fictional names must sound authentic to college sports (e.g. Vince Sterling, Tex McAllister, Marcus Vance).',
  ].join('\n');

  return callClaude(ctx, apiKey, prompt, 1500);
}

module.exports = { generate };
