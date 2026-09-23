export const money = amount => new Intl.NumberFormat('ru-RU').format(amount) + ' ₸';
export const displayDate = date => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'));

export function evidenceFor(profile) {
  const text = profile.description;
  // Every fragment is an exact substring of the source; the model cannot author facts.
  const pieces = [...new Intl.Segmenter('ru', { granularity: 'sentence' }).segment(text)].map(s => s.segment.trim());
  const usable = pieces.filter(s => s.length >= 30 && !/^(привет|всем привет|здравствуйте|меня зовут|с уважением)/i.test(s));
  return (usable.length ? usable : [text.trim()]).slice(0, 18).map((s, i) => {
    const excerpt = s.length <= 260 ? s : s.slice(0, s.lastIndexOf(' ', 260) > 80 ? s.lastIndexOf(' ', 260) : 260);
    return { id: `e${i + 1}`, text: excerpt, truncated: excerpt.length < s.length };
  });
}

export function fallbackEvidence(profile, query) {
  const terms = { корпоратив: ['корпоратив', 'бизнес', 'компан', 'форум'], свадьба: ['свад', 'невест', 'пары', 'церемон'], той: ['той', 'традиц', 'казах'], конференция: ['конференц', 'делов', 'форум', 'презентац'], юбилей: ['юбиле', 'семейн'], 'день рождения': ['рождени', 'развлеч', 'танц'] };
  const features = /стиль|юмор|импровизац|сценари|репертуар|кадр|подач|танц|оформлен|цвет|вместим|гост|оборудован|печать|саксофон/gi;
  return evidenceFor(profile).map((e, i) => ({ e, i, score: (terms[query.event_format] || []).reduce((n, term) => n + (e.text.toLowerCase().includes(term) ? 3 : 0), 0) + (e.text.match(features)?.length || 0) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)[0].e;
}

export function makeCard(profile, query, evidence) {
  const facts = [`${displayDate(query.date)} свободен по календарю`, `работает с форматом «${query.event_format}»`, `начальная цена ${money(profile.price_from_kzt)} при бюджете ${money(query.budget)}`];
  if (query.language) facts.push(`язык — ${query.language}`);
  if (query.duration_hours !== null) facts.push(profile.max_hours === null ? 'ограничение часов присутствия неприменимо' : `${query.duration_hours} ч укладываются в максимум ${profile.max_hours} ч`);
  const reason = facts.join('; ');
  return {
    id: profile.id, name: profile.anon_name, category: query.category, categories: profile.categories,
    city: profile.city, price_from_kzt: profile.price_from_kzt,
    languages: profile.languages, max_hours: profile.max_hours,
    synthetic: profile.synthetic, city_imputed: profile.city_imputed, price_imputed: profile.price_imputed,
    explanation: reason.charAt(0).toUpperCase() + reason.slice(1) + '.',
    evidence: { ...evidence, source: 'description' },
  };
}
