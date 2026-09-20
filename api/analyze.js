// POST /api/analyze  { text: string }  ->  assertion breakdown as JSON
//
// Runs on Vercel's Node runtime. The API key never reaches the browser:
// set ANTHROPIC_API_KEY in Vercel -> Project -> Settings -> Environment Variables.

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_CHARS = 6000;

const SYSTEM = [
  'You are a claims analyst. You break a passage into the separate assertions it actually makes',
  'and judge each one on its own merits. You are fair: sound claims are marked sound, and you',
  'never manufacture doubt to seem rigorous. You reply with JSON only — no preamble, no code fence.'
].join(' ');

function buildPrompt(text) {
  return [
    'Break the passage below into the separate assertions it makes.',
    '',
    'Rules:',
    '- "text" MUST be an exact verbatim substring of the passage, copied character for character.',
    '  Do not paraphrase, re-punctuate, or fix typos. It is used to highlight the original.',
    '- Cover the whole passage: every clause that asserts something appears exactly once. Spans must not overlap.',
    '- "verdict" is one of: checkable, unverifiable, disputed, misleading, false, rhetoric, opinion.',
    '    checkable    - a concrete factual claim a reader could go and verify',
    '    unverifiable - could be true, but nothing in the text lets a reader trace it',
    '    disputed     - contested by credible sources',
    '    misleading   - technically defensible but framed to mislead',
    '    false        - contradicted by well-established fact, or defeated by one counterexample',
    '    rhetoric     - asserts nothing testable (dismissals, appeals, loaded framing)',
    '    opinion      - a value judgement, not a factual claim',
    '- "load_bearing" is true when the passage\'s overall point collapses if this assertion fails.',
    '- "label" is a 2-4 word chip for the UI, e.g. "Unverifiable as written", "Rhetoric, not evidence".',
    '- "note" is one or two sentences SPECIFIC to this assertion: name the exact weasel word,',
    '  the missing baseline, the unstated comparison, or the logical leap. Never generic filler.',
    '- "check" is the single most efficient thing a reader could do to settle it.',
    '  For rhetoric, say plainly that there is nothing to test.',
    '- "devices" lists rhetorical moves in the passage, each with a verbatim quote. Omit if there are none.',
    '- "to_check" is 2-4 concrete actions a reader could take.',
    '',
    'Reply with only a JSON object of this shape:',
    '{"verdict_line":"one sentence under 20 words naming what the passage is actually doing",',
    '"confidence":"high|medium|low",',
    '"assertions":[{"text":"verbatim span","verdict":"checkable","load_bearing":true,',
    '"label":"Unverifiable as written","note":"...","check":"..."}],',
    '"devices":[{"name":"Causal slide","quote":"verbatim phrase","effect":"one sentence"}],',
    '"to_check":["one action","another"]}',
    '',
    'PASSAGE:',
    text
  ].join('\n');
}

// Tolerant JSON extraction: whole reply, else a fenced block, else first { to last }.
function parseLoose(raw) {
  const tries = [];
  tries.push(raw);
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) tries.push(fence[1]);
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last > first) tries.push(raw.slice(first, last + 1));
  for (const candidate of tries) {
    try { return JSON.parse(candidate.trim()); } catch (_) { /* next */ }
  }
  return null;
}

function fail(res, status, code, error) {
  return res.status(status).json({ code, error });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'method', 'Use POST.');
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return fail(res, 500, 'no_key', 'ANTHROPIC_API_KEY is not set on the server.');
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = null; }
  }
  const text = body && typeof body.text === 'string' ? body.text.trim() : '';

  if (!text) return fail(res, 400, 'empty', 'Send { "text": "..." }.');
  if (text.length > MAX_CHARS) {
    return fail(res, 413, 'too_long', `Passage is ${text.length} characters; the limit is ${MAX_CHARS}.`);
  }

  let upstream;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2400,
        temperature: 0.2,
        system: SYSTEM,
        messages: [{ role: 'user', content: buildPrompt(text) }]
      })
    });
  } catch (e) {
    return fail(res, 502, 'upstream', 'Could not reach the analysis service.');
  }

  if (upstream.status === 429) {
    return fail(res, 429, 'rate_limited', 'Rate limited upstream. Wait a moment and retry.');
  }
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    console.error('anthropic error', upstream.status, detail.slice(0, 800));
    let reason = '';
    try {
      const parsed = JSON.parse(detail);
      reason = (parsed && parsed.error && parsed.error.message) || '';
    } catch (_) {
      reason = detail.slice(0, 200);
    }
    return fail(
      res,
      502,
      'upstream',
      `Anthropic API returned ${upstream.status}${reason ? ': ' + reason : '.'}`
    );
  }

  const payload = await upstream.json().catch(() => null);
  const raw = payload && Array.isArray(payload.content)
    ? payload.content.filter(b => b.type === 'text').map(b => b.text).join('')
    : '';

  if (!raw.trim()) return fail(res, 502, 'upstream', 'Empty response from the analysis service.');

  const data = parseLoose(raw);
  if (!data || !Array.isArray(data.assertions)) {
    console.error('unparseable reply', raw.slice(0, 500));
    return fail(res, 502, 'bad_json', 'The analysis came back malformed.');
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(data);
}
