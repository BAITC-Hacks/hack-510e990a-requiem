const supportedLocales = new Set(['ru', 'kk', 'en']);

const messages = {
  ru: {
    invalid_value: 'Не удалось однозначно распознать значение',
    clarification_invalid: 'Уточните значение: {fields}.',
    clarification_missing: 'Чтобы выполнить подбор, укажите {fields}.',
    compare_none: 'Сначала выполните подбор, чтобы я мог сравнить варианты.',
    compare_one: 'Найден один вариант: {name}, цена от {price} ₸.',
    compare_cheapest: 'По начальной цене выгоднее {name}: от {price} ₸.',
    compare_longest: 'Максимальная указанная длительность у {name}: до {hours} ч.',
    compare_disclaimer: 'Описание помогает увидеть стиль, но не является независимой оценкой качества.',
    help: 'Опишите подрядчика, город, дату, формат мероприятия и бюджет. Я заполню форму; язык и длительность можно добавить по желанию.',
    update: 'Уточните, какое условие изменить. Для бюджета укажите точную максимальную сумму.',
    unavailable: 'AI-ассистент временно недоступен. Вы по-прежнему можете выполнить подбор через форму.',
    matched: 'Нашёл подходящих вариантов: {count}. Сначала показываю совпадения с вашими пожеланиями, затем — по возрастанию начальной цены.',
    category_absent: 'В выбранном городе этой категории пока нет. Изменение даты или бюджета не поможет.',
    suggestions: 'Точных совпадений нет. Я проверил изменения даты и бюджета — ниже есть варианты, которые действительно дают результат.',
    no_matches: 'Точных совпадений нет, и изменение только даты или бюджета не решает все ограничения. Проверьте формат, язык или длительность.',
  },
  kk: {
    invalid_value: 'Мәнді нақты анықтау мүмкін болмады',
    clarification_invalid: 'Мәнді нақтылаңыз: {fields}.',
    clarification_missing: 'Іріктеу үшін {fields} көрсетіңіз.',
    compare_none: 'Нұсқаларды салыстыру үшін алдымен іріктеу жасаңыз.',
    compare_one: 'Бір нұсқа табылды: {name}, бастапқы бағасы {price} ₸.',
    compare_cheapest: 'Бастапқы бағасы тиімдісі — {name}: {price} ₸ бастап.',
    compare_longest: '{name} үшін көрсетілген ең ұзақ уақыт: {hours} сағатқа дейін.',
    compare_disclaimer: 'Сипаттама стильді түсінуге көмектеседі, бірақ сапаны тәуелсіз бағаламайды.',
    help: 'Орындаушыны, қаланы, күнді, іс-шара форматын және бюджетті жазыңыз. Форманы толтырамын; тілді және ұзақтығын қалауыңызша қосуға болады.',
    update: 'Қай шартты өзгертетініңізді нақтылаңыз. Бюджет үшін нақты ең жоғары соманы жазыңыз.',
    unavailable: 'AI-көмекші уақытша қолжетімсіз. Іріктеуді форма арқылы жалғастыра аласыз.',
    matched: 'Сәйкес нұсқалар саны: {count}. Алдымен қалауыңызға жақындары, содан кейін бастапқы бағасы бойынша көрсетілді.',
    category_absent: 'Таңдалған қалада бұл санат әзірге жоқ. Күнді не бюджетті өзгерту көмектеспейді.',
    suggestions: 'Дәл сәйкестік табылмады. Күн мен бюджетті өзгерткенде нәтиже беретін нұсқалар төменде көрсетілген.',
    no_matches: 'Дәл сәйкестік табылмады. Тек күнді не бюджетті өзгерту жеткіліксіз — форматты, тілді немесе ұзақтықты тексеріңіз.',
  },
  en: {
    invalid_value: 'The value could not be identified unambiguously',
    clarification_invalid: 'Please clarify: {fields}.',
    clarification_missing: 'To find a match, provide {fields}.',
    compare_none: 'Run a search first so I can compare the options.',
    compare_one: 'One option found: {name}, starting at ₸{price}.',
    compare_cheapest: '{name} has the lowest starting price: ₸{price}.',
    compare_longest: '{name} has the longest listed duration: up to {hours} hours.',
    compare_disclaimer: 'Descriptions can reveal style, but are not an independent quality rating.',
    help: 'Describe the contractor, city, date, event format, and budget. I’ll fill in the form; language and duration are optional.',
    update: 'Which condition would you like to change? For budget, provide an exact maximum amount.',
    unavailable: 'The AI assistant is temporarily unavailable. You can still search using the form.',
    matched: 'I found {count} eligible options. The closest keyword matches are shown first, then ordered by starting price.',
    category_absent: 'This category is not available in the selected city. Changing the date or budget will not help.',
    suggestions: 'No exact matches. The options below are verified to work with the suggested date or budget changes.',
    no_matches: 'No exact matches, and changing only the date or budget does not resolve all constraints. Check the format, language, or duration.',
  },
};

export function normalizeLocale(value) {
  return supportedLocales.has(value) ? value : 'ru';
}

export function text(locale, key, values = {}) {
  const template = messages[normalizeLocale(locale)][key] || messages.ru[key] || key;
  return template.replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? ''));
}

export function fieldName(locale, field) {
  const fields = {
    ru: { city: 'город', date: 'дату', event_format: 'формат', category: 'категорию подрядчика', budget: 'бюджет' },
    kk: { city: 'қаланы', date: 'күнді', event_format: 'форматты', category: 'орындаушы санатын', budget: 'бюджетті' },
    en: { city: 'a city', date: 'a date', event_format: 'an event format', category: 'a contractor category', budget: 'a budget' },
  };
  return fields[normalizeLocale(locale)][field] || field;
}
