// Storyline fallout — the consequence engine. The coach picked a decision on a situation;
// this returns what actually happens: the outcome narrative, how the four pressure meters
// move, how the locker room reacts, the private text thread with the player, and the media
// gauntlet the coach now has to stand at the podium and answer for.
//
// NON-CACHEABLE (see issue.ts) — it is answer-specific. The chosen situation + option and
// the coach's current meters arrive via `extra`.

const { callClaude } = require('./_shared');

async function generate(ctx, apiKey, extra) {
  const situation = (extra && extra.situation) || {};
  const option = (extra && extra.option) || {};
  const meters = (extra && extra.meters) || {};
  const player = situation.player || null;
  const backstory = extra && extra.backstory;

  const backstoryContext = backstory
    ? [
        '=== COACH ARCHETYPE & ENVIRONMENT ===',
        `Archetype: ${backstory.archetype}`,
        `Bio: ${backstory.bio}`,
        `Environmental Cast:`,
        `  - Athletic Director (AD): ${backstory.adName}`,
        `  - Lead Booster Donor: ${backstory.boosterName}`,
        `  - Principal Beat Writer: ${backstory.reporterName}`,
        `  - Rival Coach: ${backstory.rivalCoachName}`,
        '',
        'Environmental Rules:',
        `- At least one of the mediaQuestions must be asked by beat writer "${backstory.reporterName}" (outlet could be the local paper or beat website).`,
        `- Incorporate AD "${backstory.adName}" or booster "${backstory.boosterName}" into the "outcome" or press questions where appropriate to reflect their satisfaction or anger based on the decision's tone and deltas.`,
        `- The player's tone in the playerThread (if applicable) must react to your coaching archetype (e.g., a player texting a 'disciplinarian' coach feels the weight of the rules, while texting a 'players-coach' feels protected but accountable).`,
        ''
      ].join('\n')
    : '';

  const prompt = [
    'You are the consequence engine for a college-football head coach simulator.',
    'The coach faced a situation and made a decision. Return the fallout as JSON with this exact schema:',
    '{',
    '  "outcome": "2-3 sentences: what happens next as a direct result of this decision. Concrete, not vague.",',
    '  "meterDeltas": {"boosterConfidence": int, "fanTrust": int, "mediaHeat": int, "lockerRoom": int},',
    '  "lockerRoom": {"reaction": "one line the room feels", "byPlayer": "a teammate/captain name or role"},',
    '  "playerThread": [{"from": "coach"|"player", "text": "a realistic text message"}],',
    '  "mediaQuestions": [{',
    '    "reporter": "name", "outlet": "outlet", "tone": "hostile|gotcha|neutral|friendly",',
    '    "question": "the pointed question about THIS decision",',
    '    "answers": [{"label": "<=4 word posture", "text": "the exact quote you give at the podium",',
    '      "mediaDelta": int, "fanDelta": int, "lockerDelta": int}]',
    '  }]',
    '}',
    '',
    'Meter rules (each meter is 0-100):',
    '- boosterConfidence: donors/AD faith in you. fanTrust: the fanbase. lockerRoom: team morale & buy-in.',
    '- mediaHeat: scrutiny/pressure — HIGHER IS WORSE. A calming, accountable answer should have a NEGATIVE mediaDelta.',
    '- meterDeltas from the decision: integers roughly -20..+20. Make them reflect the trade-off honestly —',
    '  a hardline call can steady boosters while gutting the locker room, and vice versa. Not all four move.',
    '',
    'Media gauntlet rules:',
    '- Exactly 2 questions. At least one hostile or gotcha if the situation is serious.',
    '- Each question gets 3 answer options with different postures (e.g. take accountability, defend the player,',
    '  deflect, go on the offensive). Each answer\'s deltas are integers roughly -10..+10; mediaHeat negative = calms it.',
    '- Answers are real quotes a coach would actually say into a microphone.',
    '',
    'Player thread rules:',
    player
      ? `- Write a private text thread between the coach and ${player.name} (${player.position || 'player'}). ` +
        '3 to 5 messages, starting with the coach, true to the decision that was made. Real texting voice, ' +
        'not a speech. If the coach came down hard, the player reacts like a real person would.'
      : '- No specific player is involved; return playerThread as an empty array [].',
    '',
    backstoryContext,
    '=== THE SITUATION ===',
    `Category: ${situation.category || 'unknown'} · Severity: ${situation.severity || 'developing'}`,
    `Headline: ${situation.headline || ''}`,
    `Details: ${situation.dek || ''}`,
    player ? `Player: ${player.name} (${player.position || '?'}${player.year ? ', ' + player.year : ''})` : 'Player: none',
    `Stakes: ${situation.stakes || ''}`,
    '',
    '=== THE DECISION THE COACH MADE ===',
    `${option.label || ''} — ${option.approach || ''} (tone: ${option.tone || 'measured'})`,
    '',
    '=== COACH STANDING RIGHT NOW (0-100) ===',
    `Boosters/AD: ${meters.boosterConfidence ?? 'n/a'} · Fans: ${meters.fanTrust ?? 'n/a'} · ` +
      `Media heat: ${meters.mediaHeat ?? 'n/a'} · Locker room: ${meters.lockerRoom ?? 'n/a'}`,
    '',
    'Season context (source of truth):',
    ctx.userContext,
  ].join('\n');

  return callClaude(ctx, apiKey, prompt, 2200);
}

module.exports = { generate };
