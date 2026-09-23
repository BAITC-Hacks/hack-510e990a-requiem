import { matchProfiles } from './matching.js';

function datesBetween(from, to) {
  const result = [];
  for (let time = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); time <= end; time += 86_400_000) {
    result.push(new Date(time).toISOString().slice(0, 10));
  }
  return result;
}

function nearestDates(current, calendar) {
  const currentTime = Date.parse(`${current}T00:00:00Z`);
  return datesBetween(calendar.from, calendar.to)
    .filter(date => date !== current)
    .sort((a, b) => {
      const da = Date.parse(`${a}T00:00:00Z`) - currentTime;
      const db = Date.parse(`${b}T00:00:00Z`) - currentTime;
      return Math.abs(da) - Math.abs(db) || (da < 0) - (db < 0) || a.localeCompare(b);
    });
}

export function verifiedSuggestions(profiles, query, result, meta, locale = 'ru') {
  if (result.status !== 'no_matches') return [];
  const suggestions = [];

  for (const date of nearestDates(query.date, meta.calendar)) {
    const changed = { ...query, date };
    const check = matchProfiles(profiles, changed);
    if (check.status === 'matched') {
      suggestions.push({
        type: 'date',
        label: locale === 'en' ? `Try ${date}` : locale === 'kk' ? `${date} күнін тексеру` : `Проверить ${date}`,
        changes: { date },
        eligible: check.counts.eligible,
      });
      break;
    }
  }

  const unlimited = matchProfiles(profiles, { ...query, budget: 1_000_000_000 });
  const minimum = unlimited.selected[0]?.price_from_kzt;
  if (minimum && minimum > query.budget) {
    const changed = { ...query, budget: minimum };
    const check = matchProfiles(profiles, changed);
    if (check.status === 'matched') {
      suggestions.push({
        type: 'budget',
        label: locale === 'en' ? `Raise budget to ₸${minimum}` : locale === 'kk' ? `Бюджетті ${minimum} ₸ дейін көтеру` : `Поднять бюджет до ${minimum} ₸`,
        changes: { budget: minimum },
        eligible: check.counts.eligible,
      });
    }
  }

  return suggestions;
}

export function createRecommendationService({ dataset, explain }) {
  return async function recommend(query, { includeSuggestions = false, keywords = [], locale = 'ru', localOnly = false } = {}) {
    const preferences = Array.isArray(keywords) ? keywords.slice(0, 12) : [];
    const result = matchProfiles(dataset.profiles, query, { includeEligible: preferences.length > 0 });
    const { selected, eligible, ...summary } = result;
    const candidates = preferences.length ? eligible : selected;
    const explanations = await explain(candidates, query, dataset.version, { keywords: preferences, locale, localOnly });
    return {
      ...summary,
      ranking: preferences.length ? 'keyword_relevance' : summary.ranking,
      preference_keywords: preferences,
      ...explanations,
      query,
      dataset_version: dataset.version,
      suggestions: includeSuggestions ? verifiedSuggestions(dataset.profiles, query, result, dataset.meta, locale) : [],
    };
  };
}
