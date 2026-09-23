const key = process.env.OPENAI_API_KEY?.trim();
const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';

if (!key) {
  console.error('OPENAI_API_KEY_MISSING');
  process.exit(2);
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 15000);

try {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      input: 'Reply with exactly: EVENTMATCH_OK',
      max_output_tokens: 16,
      store: false
    }),
    signal: controller.signal
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(JSON.stringify({
      ok: false,
      status: response.status,
      type: payload?.error?.type || null,
      code: payload?.error?.code || null,
      message: payload?.error?.message || 'OpenAI API request failed'
    }));
    process.exit(1);
  }

  const text = (payload.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text')
    .map(item => item.text)
    .join('')
    .trim();

  console.log(JSON.stringify({ ok: true, status: response.status, model: payload.model || model, output: text }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, type: error.name, message: error.message }));
  process.exit(1);
} finally {
  clearTimeout(timer);
}
