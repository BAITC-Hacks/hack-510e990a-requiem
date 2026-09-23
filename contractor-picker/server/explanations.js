const intlLocale = locale => ({ kk: 'kk-KZ', en: 'en-US' })[locale] || 'ru-RU';
export const money = (amount, locale = 'ru') => `${new Intl.NumberFormat(intlLocale(locale)).format(amount)} ₸`;
export const displayDate = (date, locale = 'ru') => new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'));

function displayFormat(value, locale) {
  if (locale === 'en') return ({ корпоратив: 'corporate', свадьба: 'wedding', 'день рождения': 'birthday', конференция: 'conference', той: 'toi', юбилей: 'anniversary' })[value] || value;
  if (locale === 'kk') return ({ корпоратив: 'корпоратив', свадьба: 'үйлену тойы', 'день рождения': 'туған күн', конференция: 'конференция', той: 'той', юбилей: 'мерейтой' })[value] || value;
  return value;
}

function displayLanguage(value, locale) {
  if (locale === 'en') return ({ русский: 'Russian', казахский: 'Kazakh', английский: 'English', Русский: 'Russian', Казахский: 'Kazakh', Английский: 'English' })[value] || value;
  if (locale === 'kk') return ({ русский: 'орыс тілі', казахский: 'қазақ тілі', английский: 'ағылшын тілі', Русский: 'орыс тілі', Казахский: 'қазақ тілі', Английский: 'ағылшын тілі' })[value] || value;
  return value;
}

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

export function makeCard(profile, query, evidence, locale = 'ru') {
  const factsByLocale = {
    ru: [`${displayDate(query.date, locale)} свободен по календарю`, `работает с форматом «${displayFormat(query.event_format, locale)}»`, `начальная цена ${money(profile.price_from_kzt, locale)} при бюджете ${money(query.budget, locale)}`],
    kk: [`${displayDate(query.date, locale)} күнтізбе бойынша бос`, `«${displayFormat(query.event_format, locale)}» форматында жұмыс істейді`, `бастапқы бағасы ${money(profile.price_from_kzt, locale)}, бюджет ${money(query.budget, locale)}`],
    en: [`Available on ${displayDate(query.date, locale)}`, `supports ${displayFormat(query.event_format, locale)} events`, `starting price ${money(profile.price_from_kzt, locale)} within the ${money(query.budget, locale)} budget`],
  };
  const facts = [...(factsByLocale[locale] || factsByLocale.ru)];
  if (query.language) facts.push(locale === 'en' ? `language — ${displayLanguage(query.language, locale)}` : locale === 'kk' ? `тілі — ${displayLanguage(query.language, locale)}` : `язык — ${displayLanguage(query.language, locale)}`);
  if (query.duration_hours !== null) {
    const hoursFact = profile.max_hours === null
      ? ({ ru: 'ограничение часов присутствия неприменимо', kk: 'болу уақытына шектеу қолданылмайды', en: 'duration limit does not apply' })[locale]
      : ({ ru: `${query.duration_hours} ч укладываются в максимум ${profile.max_hours} ч`, kk: `${query.duration_hours} сағат ${profile.max_hours} сағаттық шекке сәйкес келеді`, en: `${query.duration_hours} hours fit within the ${profile.max_hours}-hour limit` })[locale];
    facts.push(hoursFact);
  }
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
