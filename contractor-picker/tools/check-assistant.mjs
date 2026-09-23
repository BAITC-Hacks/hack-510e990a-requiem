import { createApp } from '../server/index.js';

const server = createApp().listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});

try {
  const url = `http://127.0.0.1:${server.address().port}/api/assistant`;
  const complete = { city: 'Алматы', date: '2026-10-10', event_format: 'корпоратив', category: 'Ведущий', budget: 1500000, language: 'русский', duration_hours: null };
  const scenarios = [
    {
      name: 'full_search',
      request: { message: 'Нужен ведущий в Алматы на корпоратив 10 октября 2026 года до 1,5 млн тенге, на русском языке', current_query: {}, state_revision: 1 },
      verify: body => body.assistant_status === 'results' && body.resolved_query?.budget === 1500000 && body.recommendation?.cards?.length === 3,
    },
    {
      name: 'date_update',
      request: { message: 'А на 11 октября?', current_query: complete, state_revision: 2 },
      verify: body => body.assistant_status === 'results' && body.resolved_query?.date === '2026-10-11',
    },
    {
      name: 'new_partial_search',
      request: { message: 'Нужен флорист на свадьбу', current_query: complete, state_revision: 3 },
      verify: body => body.assistant_status === 'needs_clarification' && body.resolved_query?.category === 'Флорист' && body.resolved_query?.city === undefined,
    },
  ];

  for (const scenario of scenarios) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scenario.request) });
    const body = await response.json();
    const passed = response.ok && scenario.verify(body);
    console.log(JSON.stringify({
      scenario: scenario.name,
      passed,
      status: response.status,
      assistant_status: body.assistant_status || body.error,
      resolved_query: body.resolved_query || null,
      cards: body.recommendation?.cards?.length || 0,
      explanation_mode: body.recommendation?.explanation_mode || null,
      reply: body.reply || body.message,
    }));
    if (!passed) process.exitCode = 1;
  }
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
