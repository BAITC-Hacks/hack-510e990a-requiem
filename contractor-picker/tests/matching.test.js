import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDataset, validDate } from '../server/dataset.js';
import { validateQuery, matchProfiles, InputError } from '../server/matching.js';
import { createExplainer } from '../server/ai.js';
import { evidenceFor, fallbackEvidence } from '../server/explanations.js';
import { createApp } from '../server/index.js';

const dataset = loadDataset();
const base = { city: 'Алматы', date: '2026-10-10', event_format: 'корпоратив', category: 'Ведущий', budget: 1500000 };
const query = patch => validateQuery({ ...base, ...patch }, dataset.meta);
const match = patch => matchProfiles(dataset.profiles, query(patch));

test('Исходный CSV: 66 уникальных профилей, 17 категорий и правильные типы', () => {
  assert.equal(dataset.profiles.length, 66);
  assert.equal(new Set(dataset.profiles.map(p => p.id)).size, 66);
  assert.equal(dataset.meta.categories.length, 17);
  assert.equal(dataset.meta.synthetic_count, 13);
  assert.equal(dataset.profiles.filter(p => p.max_hours === null).length, 9);
  assert.equal(dataset.profiles.filter(p => p.price_imputed).length, 18);
  assert.equal(dataset.profiles.filter(p => p.city_imputed).length, 8);
});

test('Плотная категория: пять допустимых, три карточки и стабильный порядок', () => {
  const result = match();
  assert.equal(result.status, 'matched');
  assert.deepEqual(result.selected.map(p => p.id), ['HK-88430', 'HK-29829', 'HK-27222']);
  assert.equal(result.counts.eligible, 5);
  assert.deepEqual(result.counts.excluded, { busy: 4, budget: 1, format: 0, language: 0, duration: 0 });
  assert.deepEqual(match(), result);
  assert.deepEqual(matchProfiles([...dataset.profiles].reverse(), query()).selected, result.selected);
});

test('Смена даты исключает ранее выбранных именно по занятости', () => {
  const result = match({ date: '2026-10-11' });
  assert.equal(result.counts.eligible, 4);
  assert.deepEqual(result.selected.map(p => p.id), ['HK-44923', 'HK-27222', 'HK-44733']);
  assert.ok(result.busy_contractors.some(p => p.id === 'HK-88430'));
  assert.ok(result.busy_contractors.some(p => p.id === 'HK-29829'));
});

test('Редкая категория: один флорист и причина отсутствия второго', () => {
  const result = match({ category: 'Флорист', event_format: 'свадьба', budget: 500000 });
  assert.deepEqual(result.selected.map(p => p.id), ['HK-39372']);
  assert.equal(result.counts.in_category, 2);
  assert.equal(result.counts.excluded.busy, 1);
});

test('Нет категории и нет совпадений — разные бизнес-исходы', () => {
  assert.equal(match({ city: 'Астана', category: 'Декоратор' }).status, 'category_absent');
  const none = match({ budget: 100000 });
  assert.equal(none.status, 'no_matches');
  assert.equal(none.minimum_price, 500000);
  assert.equal(none.selected.length, 0);
});

test('Площадки: общие фильтры и поддержка нескольких категорий', () => {
  const result = match({ category: 'Банкетный зал', event_format: 'свадьба', budget: 5000000, date: '2026-11-14' });
  assert.deepEqual(result.selected.map(p => p.id), ['HK-64395', 'HK-90011']);
  assert.ok(match({ category: 'Отель', event_format: 'свадьба', budget: 5000000, date: '2026-11-14' }).selected.some(p => p.id === 'HK-90011'));
});

test('Цена на границе бюджета допускается, ниже границы — нет', () => {
  assert.ok(match({ budget: 500000 }).selected.some(p => p.id === 'HK-88430'));
  assert.equal(match({ budget: 499999 }).selected.length, 0);
});

test('Язык и часы проверяются; null не означает ноль часов', () => {
  const result = match({ language: 'английский', duration_hours: 6 });
  assert.deepEqual(result.selected.map(p => p.id), ['HK-75012']);
  assert.equal(match({ language: 'английский', duration_hours: 6.5 }).selected.length, 0);
  const florist = match({ category: 'Флорист', event_format: 'свадьба', budget: 500000, duration_hours: 24 });
  assert.equal(florist.selected.length, 1);
  assert.equal(florist.selected[0].max_hours, null);
});

test('Неверные даты и даты вне окна не считаются свободными', () => {
  for (const date of ['2026-02-30', '2026-11-31', '2026-09-22', '2027-01-01', '10.10.2026', null]) {
    assert.throws(() => query({ date }), InputError);
  }
  assert.equal(validDate('2026-02-30'), false);
  assert.doesNotThrow(() => query({ date: '2026-09-23' }));
  assert.doesNotThrow(() => query({ date: '2026-12-31' }));
});

test('API-ввод отклоняет строки вместо чисел, неизвестные справочники и плохую длительность', () => {
  for (const patch of [{ budget: 0 }, { budget: -1 }, { budget: '500000' }, { budget: true }, { budget: 1.5 }, { city: 'Москва' }, { category: '<script>' }, { language: 'французский' }, { duration_hours: '6' }, { duration_hours: 0 }, { duration_hours: 25 }]) assert.throws(() => query(patch), InputError);
  assert.throws(() => validateQuery(null, dataset.meta), InputError);
  assert.throws(() => validateQuery([], dataset.meta), InputError);
});

test('На всех 100 датах: занятые не проходят, условия соблюдены, счётчики сходятся', () => {
  const start = Date.parse('2026-09-23T00:00:00Z');
  for (let day = 0; day < 100; day++) for (const category of ['Ведущий', 'Банкетный зал', 'Флорист']) {
    const q = query({ date: new Date(start + day * 86400000).toISOString().slice(0, 10), category, language: 'русский', duration_hours: 6 });
    const r = matchProfiles(dataset.profiles, q);
    assert.equal(r.counts.in_category, r.counts.eligible + Object.values(r.counts.excluded).reduce((a, b) => a + b, 0));
    assert.ok(r.selected.length <= 3);
    for (const p of r.selected) {
      assert.equal(p.busyDates.has(q.date), false);
      assert.equal(p.city, q.city);
      assert.ok(p.categories.includes(q.category));
      assert.ok(p.price_from_kzt <= q.budget);
      assert.ok(p.event_formats.includes(q.event_format));
      assert.ok(p.languages.includes(q.language));
      assert.ok(p.max_hours === null || p.max_hours >= q.duration_hours);
    }
  }
});

test('Все доказательные фрагменты буквально присутствуют в исходных описаниях', () => {
  for (const profile of dataset.profiles) {
    const fragments = evidenceFor(profile);
    assert.ok(fragments.length > 0);
    for (const e of fragments) assert.ok(profile.description.includes(e.text));
    assert.ok(profile.description.includes(fallbackEvidence(profile, query()).text));
  }
});

test('Без ключа объяснения различимы, AI не имитируется', async () => {
  const result = await createExplainer() (match().selected, query(), dataset.version);
  assert.equal(result.explanation_mode, 'catalog');
  assert.equal(new Set(result.cards.map(c => c.evidence.text)).size, 3);
  assert.ok(result.cards.every(c => c.explanation.includes('свободен по календарю')));
});

function aiResponse(selections) {
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ selections }) }] }] }), { status: 200 });
}

test('AI выбирает существующие фрагменты, не меняет порядок; повтор использует кеш', async () => {
  const selected = match().selected;
  let calls = 0;
  const explain = createExplainer({ apiKey: 'test-only', fetchImpl: async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.equal(body.text.format.strict, true);
    assert.equal(body.store, false);
    assert.equal(body.input.length, 2);
    return aiResponse([...selected].reverse().map(p => ({ contractor_id: p.id, evidence_id: evidenceFor(p)[0].id })));
  } });
  const result = await explain(selected, query(), dataset.version);
  assert.equal(result.explanation_mode, 'ai');
  assert.deepEqual(result.cards.map(p => p.id), selected.map(p => p.id));
  assert.deepEqual(await explain(selected, query(), dataset.version), result);
  assert.equal(calls, 1);
});

test('Выдуманный ID, повтор ID, отказ и ошибка AI включают честный fallback', async () => {
  const selected = match().selected;
  const valid = selected.map(p => ({ contractor_id: p.id, evidence_id: 'e1' }));
  const responders = [
    async () => aiResponse(valid.map(s => ({ ...s, evidence_id: 'invented' }))),
    async () => aiResponse([valid[0], valid[0], valid[0]]),
    async () => new Response('invalid', { status: 429 }),
    async () => new Response(JSON.stringify({ status: 'incomplete', output: [] })),
    async () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] })),
    async () => { throw new Error('network'); },
  ];
  for (const fetchImpl of responders) {
    const r = await createExplainer({ apiKey: 'test-only', fetchImpl })(selected, query(), dataset.version);
    assert.equal(r.explanation_mode, 'fallback');
    assert.deepEqual(r.cards.map(p => p.id), selected.map(p => p.id));
  }
});

test('Зависший AI прерывается по таймауту', async () => {
  const explain = createExplainer({ apiKey: 'test-only', timeoutMs: 30, fetchImpl: (_url, options) => new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 1000);
    options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
  }) });
  assert.equal((await explain(match().selected, query(), dataset.version)).explanation_mode, 'fallback');
});

test('Для пустого результата нет вызова AI', async () => {
  const explain = createExplainer({ apiKey: 'test-only', fetchImpl: () => { throw new Error('must not be called'); } });
  assert.deepEqual(await explain([], query(), dataset.version), { cards: [], explanation_mode: 'not_needed' });
});

test('HTTP: страница, справочники, подбор, ошибки и отсутствие доступа к исходникам/ключам', async t => {
  const server = createApp({ explain: createExplainer() }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Подберите подрядчика/);
  assert.ok(page.headers.get('Content-Security-Policy').includes("script-src 'self'"));
  assert.equal((await (await fetch(url + '/api/meta')).json()).total, 66);
  const post = body => fetch(url + '/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const success = await post(base);
  assert.equal(success.status, 200);
  assert.equal((await success.json()).cards.length, 3);
  assert.equal((await post({ ...base, budget: -1 })).status, 400);
  assert.equal((await post({ ...base, city: 'Астана', category: 'Декоратор' })).status, 200);
  assert.equal((await fetch(url + '/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  for (const path of ['/.env', '/server/index.js', '/data/contractors.csv', '/api/unknown']) assert.equal((await fetch(url + path)).status, 404);
});
