// Press-conference grader. Grades the coach's completed press-conference transcript.
// Schema: { overall, composure, authenticity, deflectionSkill, headlineManagement,
//           summary, bestMoment, worstMoment }
// Prompt ported faithfully from HEAD:src/app/api/press-conference/grade/route.ts.
//
// ctx   = { systemPrompt, userContext, school, coachName, week, ... }
// extra = { exchanges: PressConfExchange[] } passed from the UI.

const { callClaude } = require('./_shared');

async function generate(ctx, apiKey, extra) {
  const exchanges = (extra && Array.isArray(extra.exchanges) ? extra.exchanges : []) || [];

  if (exchanges.length === 0) {
    return { error: true };
  }

  const transcript = exchanges
    .map((ex, i) => {
      const q = ex.question || {};
      let text = `Q${i + 1} (${q.reporterName ?? 'Reporter'}, ${q.outlet ?? ''} — ${q.tone ?? 'neutral'} tone): "${q.question ?? ''}"`;
      text += `\nCoach's answer (${ex.selectedTone ?? 'honest'} tone, ${ex.responseMode ?? 'choice'} mode): "${ex.userAnswer ?? ''}"`;
      if (ex.followUp) {
        text += `\nFollow-up: "${ex.followUp}"`;
        text += `\nCoach's follow-up answer: "${ex.followUpAnswer ?? '(no answer)'}"`;
      }
      return text;
    })
    .join('\n\n');

  const prompt = [
    `You are a college football media analyst grading Coach ${ctx.coachName} of ${ctx.school} after their Week ${ctx.week} press conference. You are fair but critical, like a real sports media evaluator.`,
    '',
    'Grade this press conference transcript:',
    '',
    transcript,
    '',
    'Evaluate the coach across these categories (0-100 each):',
    '- composure: How well did the coach stay calm and collected?',
    '- authenticity: Did the coach sound genuine or robotic?',
    '- deflectionSkill: How well did the coach handle tough/gotcha questions?',
    '- headlineManagement: Will the answers create good or bad headlines?',
    '',
    'Also provide:',
    '- overall: A letter grade (A+, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F)',
    '- summary: 2-3 sentence overall evaluation in a sports columnist style',
    '- bestMoment: Quote or describe the coach\'s best answer',
    '- worstMoment: Quote or describe the coach\'s worst answer (or "N/A" if all were solid)',
    '',
    'Respond with valid JSON only, no markdown fences, matching this exact structure:',
    '{"overall": "B+", "composure": 78, "authenticity": 82, "deflectionSkill": 65, "headlineManagement": 71, "summary": "...", "bestMoment": "...", "worstMoment": "..."}',
  ].join('\n');

  return callClaude(ctx, apiKey, prompt, 1024);
}

module.exports = { generate };
