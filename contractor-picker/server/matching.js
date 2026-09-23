import { validDate } from './dataset.js';

export class InputError extends Error {
  constructor(fields) {
    super('Проверьте параметры запроса');
    this.fields = fields;
    this.status = 400;
  }
}

export function validateQuery(input, meta) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError({ form: 'Ожидается объект с параметрами' });
  const errors = {};
  const query = {};
  for (const [field, options, label] of [
    ['city', meta.cities, 'город'], ['category', meta.categories, 'категорию'],
    ['event_format', meta.event_formats, 'формат мероприятия'],
  ]) {
    query[field] = typeof input[field] === 'string' ? input[field].trim() : '';
    if (!options.includes(query[field])) errors[field] = `Выберите ${label} из списка`;
  }
  query.date = input.date;
  if (!validDate(query.date) || query.date < meta.calendar.from || query.date > meta.calendar.to) {
    errors.date = 'Выберите дату с 23 сентября по 31 декабря 2026 года';
  }
  query.budget = input.budget;
  if (typeof query.budget !== 'number' || !Number.isSafeInteger(query.budget) || query.budget <= 0 || query.budget > 1_000_000_000) {
    errors.budget = 'Бюджет должен быть целым числом от 1 до 1 000 000 000 ₸';
  }
  query.language = input.language === undefined || input.language === null || input.language === '' ? null : input.language;
  if (query.language !== null && !meta.languages.includes(query.language)) errors.language = 'Выберите язык из списка';
  query.duration_hours = input.duration_hours === undefined || input.duration_hours === null || input.duration_hours === '' ? null : input.duration_hours;
  if (query.duration_hours !== null && (typeof query.duration_hours !== 'number' || !Number.isFinite(query.duration_hours) || query.duration_hours <= 0 || query.duration_hours > 24)) {
    errors.duration_hours = 'Длительность должна быть больше 0 и не больше 24 часов';
  }
  if (Object.keys(errors).length) throw new InputError(errors);
  return query;
}

export const reasonLabels = {
  busy: 'заняты на дату', budget: 'начальная цена выше бюджета',
  format: 'не работают с этим форматом', language: 'нет выбранного языка',
  duration: 'не подходят по длительности',
};

export function matchProfiles(profiles, query) {
  const pool = profiles.filter(p => p.city === query.city && p.categories.includes(query.category));
  const excluded = Object.fromEntries(Object.keys(reasonLabels).map(k => [k, 0]));
  const available = [];
  for (const p of pool) {
    const reason = p.busyDates.has(query.date) ? 'busy'
      : p.price_from_kzt > query.budget ? 'budget'
      : !p.event_formats.includes(query.event_format) ? 'format'
      : query.language && !p.languages.includes(query.language) ? 'language'
      : query.duration_hours !== null && p.max_hours !== null && p.max_hours < query.duration_hours ? 'duration'
      : null;
    if (reason) excluded[reason]++;
    else available.push(p);
  }
  available.sort((a, b) => a.price_from_kzt - b.price_from_kzt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const status = !pool.length ? 'category_absent' : !available.length ? 'no_matches' : 'matched';
  return {
    status, selected: available.slice(0, 3),
    counts: { in_category: pool.length, eligible: available.length, shown: Math.min(3, available.length), excluded },
    ranking: 'price_asc_then_id',
    busy_contractors: pool.filter(p => p.busyDates.has(query.date)).map(p => ({ id: p.id, name: p.anon_name })),
    minimum_price: pool.length ? Math.min(...pool.map(p => p.price_from_kzt)) : null,
  };
}
