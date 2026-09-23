import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDataset } from '../server/dataset.js';
import { validateQuery, matchProfiles } from '../server/matching.js';
import { createExplainer } from '../server/ai.js';
import { createAssistantParser, applyAssistantPatches, completeQuery, missingFields, enrichIntent } from '../server/assistant.js';
import { verifiedSuggestions } from '../server/recommendations.js';
import { createApp } from '../server/index.js';

const dataset = loadDataset();
const base = { city: 'Алматы', date: '2026-10-11', event_format: 'корпоратив', category: 'Ведущий', budget: 500000, language: null, duration_hours: null };

function modelResponse(intent) {
  return new Response(JSON.stringify({
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(intent) }] }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('AI-парсер использует строгую схему и не получает каталог профилей', async () => {
  let requestBody;
  const parse = createAssistantParser({ apiKey: 'test-only', fetchImpl: async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return modelResponse({ action: 'update', patches: [{ field: 'date', op: 'set', value: '2026-10-12' }] });
  } });
  const result = await parse({ message: 'А на 12 октября?', currentQuery: base, meta: dataset.meta });
  assert.equal(requestBody.text.format.strict, true);
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.input[1].content.includes('HK-'), false);
  assert.deepEqual(result.patches, [{ field: 'date', op: 'set', value: '2026-10-12' }]);
});

test('Новый AI-запрос не наследует прежние условия и сообщает недостающие поля', () => {
  const intent = { action: 'search', patches: [
    { field: 'category', op: 'set', value: 'Флорист' },
    { field: 'event_format', op: 'set', value: 'свадьба' },
  ] };
  const { draft } = applyAssistantPatches(base, intent, dataset.meta);
  assert.equal(draft.category, 'Флорист');
  assert.equal(draft.event_format, 'свадьба');
  assert.equal(draft.city, undefined);
  assert.deepEqual(missingFields(draft), ['city', 'date', 'budget']);
  assert.equal(completeQuery(draft, dataset.meta), null);
});

test('Явные значения страхуют пропуск модели, а новая категория сбрасывает старый поиск', () => {
  const full = enrichIntent('Нужен ведущий в Алматы на корпоратив', {}, { action: 'search', patches: [
    { field: 'city', op: 'set', value: 'Алматы' },
    { field: 'category', op: 'set', value: 'Ведущий' },
  ] }, dataset.meta);
  assert.ok(full.patches.some(patch => patch.field === 'event_format' && patch.value === 'корпоратив'));

  const partial = enrichIntent('Нужен флорист на свадьбу', base, { action: 'update', patches: [
    { field: 'category', op: 'set', value: 'Флорист' },
    { field: 'event_format', op: 'set', value: 'свадьба' },
  ] }, dataset.meta);
  assert.equal(partial.action, 'search');
  const { draft } = applyAssistantPatches(base, partial, dataset.meta);
  assert.equal(draft.city, undefined);
  assert.deepEqual(missingFields(draft), ['city', 'date', 'budget']);
});

test('Изменение одного поля сохраняет остальные и допускает явную очистку', () => {
  const intent = { action: 'update', patches: [
    { field: 'date', op: 'set', value: '2026-10-12' },
    { field: 'language', op: 'clear', value: '' },
  ] };
  const current = { ...base, language: 'русский' };
  const { draft, errors } = applyAssistantPatches(current, intent, dataset.meta);
  assert.deepEqual(errors, {});
  assert.equal(draft.date, '2026-10-12');
  assert.equal(draft.language, null);
  assert.equal(draft.city, base.city);
  assert.ok(completeQuery(draft, dataset.meta));
});

test('Альтернативы даты и бюджета повторно проверены на каталоге', () => {
  const query = validateQuery(base, dataset.meta);
  const result = matchProfiles(dataset.profiles, query);
  const suggestions = verifiedSuggestions(dataset.profiles, query, result, dataset.meta);
  assert.deepEqual(suggestions.map(item => item.type), ['date', 'budget']);
  assert.equal(suggestions[0].changes.date, '2026-10-12');
  assert.equal(suggestions[1].changes.budget, 650000);
  for (const suggestion of suggestions) {
    const changed = validateQuery({ ...query, ...suggestion.changes }, dataset.meta);
    assert.equal(matchProfiles(dataset.profiles, changed).status, 'matched');
  }
});

test('POST /api/assistant заполняет форму, возвращает подбор и версию состояния', async t => {
  const parseAssistant = async () => ({ action: 'search', patches: [
    { field: 'city', op: 'set', value: 'Алматы' },
    { field: 'date', op: 'set', value: '2026-10-10' },
    { field: 'event_format', op: 'set', value: 'корпоратив' },
    { field: 'category', op: 'set', value: 'Ведущий' },
    { field: 'budget', op: 'set', value: '1500000' },
  ] });
  const server = createApp({ parseAssistant, explain: createExplainer() }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Нужен ведущий', current_query: {}, state_revision: 7 }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.assistant_status, 'results');
  assert.equal(body.state_revision, 7);
  assert.equal(body.recommendation.cards.length, 3);
  assert.equal(body.resolved_query.budget, 1500000);
});

test('POST /api/assistant не маскирует отказ провайдера под пустую выдачу', async t => {
  const server = createApp({ parseAssistant: async () => { throw new Error('offline'); }, explain: createExplainer() }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Нужен ведущий', current_query: {}, state_revision: 1 }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'assistant_unavailable');
});
