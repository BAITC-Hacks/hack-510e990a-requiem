import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';

export const calendar = Object.freeze({ from: '2026-09-23', to: '2026-12-31' });
const listFields = ['categories', 'event_formats', 'languages', 'busy_dates'];
const boolFields = ['city_imputed', 'synthetic', 'price_imputed'];
const columns = ['id', 'anon_name', 'city', 'price_from_kzt', 'max_hours', 'description', ...listFields, ...boolFields];

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function parseDataset(raw) {
  const records = parse(raw, { columns: true, bom: true, skip_empty_lines: true });
  if (!records.length) throw new Error('Каталог пуст');
  const seen = new Set();
  return records.map((row, index) => {
    const fail = (field) => { throw new Error(`Некорректное поле ${field}, строка ${index + 2}`); };
    for (const field of columns) if (!(field in row)) fail(field);
    if (!row.id || seen.has(row.id)) fail('id');
    seen.add(row.id);
    for (const field of ['anon_name', 'city', 'description']) if (!row[field].trim()) fail(field);
    for (const field of listFields) {
      row[field] = row[field].split('|').map(v => v.trim()).filter(Boolean);
      if (!row[field].length && field !== 'busy_dates') fail(field);
    }
    for (const field of boolFields) {
      if (!['True', 'False'].includes(row[field])) fail(field);
      row[field] = row[field] === 'True';
    }
    if (!/^\d+$/.test(row.price_from_kzt)) fail('price_from_kzt');
    row.price_from_kzt = Number(row.price_from_kzt);
    if (!Number.isSafeInteger(row.price_from_kzt) || row.price_from_kzt <= 0) fail('price_from_kzt');
    row.max_hours = row.max_hours === '' ? null : Number(row.max_hours);
    if (row.max_hours !== null && (!Number.isInteger(row.max_hours) || row.max_hours <= 0)) fail('max_hours');
    if (row.busy_dates.some(d => !validDate(d) || d < calendar.from || d > calendar.to)) fail('busy_dates');
    if (new Set(row.busy_dates).size !== row.busy_dates.length) fail('busy_dates');
    return Object.freeze({ ...row, busyDates: new Set(row.busy_dates) });
  });
}

export function loadDataset(path = new URL('../data/contractors.csv', import.meta.url)) {
  const raw = readFileSync(path, 'utf8');
  const profiles = parseDataset(raw);
  const unique = field => [...new Set(profiles.flatMap(p => p[field]))].sort((a, b) => a.localeCompare(b, 'ru'));
  return {
    profiles,
    version: createHash('sha256').update(raw).digest('hex').slice(0, 12),
    meta: {
      total: profiles.length,
      cities: unique('city'), categories: unique('categories'),
      event_formats: unique('event_formats'), languages: unique('languages'),
      calendar,
      synthetic_count: profiles.filter(p => p.synthetic).length,
    },
  };
}
