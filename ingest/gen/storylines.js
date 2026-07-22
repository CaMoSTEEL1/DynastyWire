// Storylines — the "outside forces" engine. Turns the real week/season state into a
// short slate of off-field situations the coach has to actually decide on: a player
// arrest, an academic flag, a portal threat, an NIL dispute, a locker-room rift, a
// booster ultimatum. This is the tape-and-glue narrative layer: every situation carries
// decision options with a distinct stance, and the fallout (ingest/gen/storyline-fallout.js)
// is where the coach owns it in front of the media.
//
// Cacheable per week (design Q3) — generated once when the coach first opens the room
// this week, then read from cache. Grounded in the actual result + coach job security so
// a losing streak breeds crises and a winning program breeds distractions of a different
// kind.

const { callClaude } = require('./_shared');

const CATEGORIES =
  'legal (arrest, citation, off-field incident) | academics (eligibility, missed class) | ' +
  'portal (a starter flirting with the transfer portal) | nil (a collective/endorsement dispute) | ' +
  'locker-room (a rift, a callout, a leadership vacuum) | off-field (family, health, personal) | ' +
  'booster (a donor/AD ultimatum) | social-media (a player post blows up) | ' +
  'recruiting (a commit wavering, a visit gone wrong)';

async function generate(ctx, apiKey, extra) {
  const coach = ctx.snapshot && ctx.snapshot.coach ? ctx.snapshot.coach : null;
  const security = coach && coach.jobSecurity ? coach.jobSecurity : 'unknown';
  const backstory = extra && extra.backstory;

  const backstoryContext = backstory
    ? [
        '=== COACH ARCHETYPE & ENVIRONMENT ===',
        `Archetype: ${backstory.archetype} (disciplinarian = old-school rules; players-coach = high player buy-in/loose reins; nil-merchant = collective & portal focused; hometown-savior = extreme fan/local pressure)`,
        `Bio: ${backstory.bio}`,
        `Environmental Cast:`,
        `  - Athletic Director (AD): ${backstory.adName}`,
        `  - Lead Booster Donor: ${backstory.boosterName}`,
        `  - Principal Beat Writer: ${backstory.reporterName}`,
        `  - Rival Coach: ${backstory.rivalCoachName}`,
        '',
        'Narrative Directions based on Archetype:',
        '- If you are a disciplinarian, generate situations involving player chafing under rules, team captains challenging authority, or academic eligibility standoffs.',
        '- If you are a players-coach, generate situations involving off-field player mishaps where you are pressured by the AD/media to suspend them, but doing so will alienate the locker room.',
        '- If you are a nil-merchant, generate portal blackmail, booster intervention on playing time, or collective payment disputes.',
        '- If you are a hometown-savior, generate stories about heavy fan backlash over small things, booster ultimatums, or local media magnifying drama.',
        `- When writing the "source" or "dek", use the actual names from the cast (e.g. "AD ${backstory.adName} called...", "Billionaire booster ${backstory.boosterName} demanded...", or "Beat writer ${backstory.reporterName} tweeted...").`,
        ''
      ].join('\n')
    : '';

  const prompt = [
    'You are the situation desk for a college-football head coach simulator. Generate the',
    "off-field situations landing on the coach's desk THIS WEEK as JSON with this exact schema:",
    '{"situations": [{',
    '  "category": one of [legal, academics, portal, nil, locker-room, off-field, booster, social-media, recruiting],',
    '  "severity": "brewing" | "developing" | "crisis",',
    '  "headline": "tabloid-sharp but realistic, <= 9 words",',
    '  "dek": "1-2 sentences: what happened, who it involves, why it lands on the coach now",',
    '  "player": {"name": "realistic full name", "position": "QB/RB/WR/LB/etc", "year": "Fr/So/Jr/Sr"} | null,',
    '  "source": "how the coach found out, e.g. \'AD called at 6am\', \'It is already on Twitter\', \'Beat writer texted you\'",',
    '  "stakes": "one line on what is on the line if this is mishandled",',
    '  "options": [{"id": "a|b|c", "label": "<=5 word stance", "approach": "one line on the move you make", "tone": "hardline|measured|protective|pragmatic"}]',
    '}]}',
    '',
    'Rules:',
    '- Generate 2 to 3 situations. At least one MUST involve a specific named player (player != null).',
    '- Give EACH situation exactly 3 options with genuinely different philosophies — there is no clean answer.',
    "  A hardline move (suspend/dismiss) should cost you the locker room or the player; a protective move should",
    '  cost you with boosters/media. Make the trade-offs real, not cosmetic.',
    '- Ground the situations in the actual result and the pressure the coach is under. A loss + a hot seat',
    '  breeds panic, leaks, and portal threats; a win breeds complacency, off-field distractions, and money fights.',
    "- Player names are fictional but realistic for a college roster. Never reference real living athletes.",
    '- Keep it grounded and human. No cartoon villainy — these are 18-22 year olds and real people.',
    '',
    backstoryContext,
    `Coach's current job security: ${security}.`,
    '',
    'Context (source of truth — never contradict the record or result):',
    ctx.userContext,
  ].join('\n');

  return callClaude(ctx, apiKey, prompt, 2000);
}

module.exports = { generate };
