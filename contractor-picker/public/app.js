const $ = id => document.getElementById(id);
const form = $('search');
const money = amount => new Intl.NumberFormat('ru-RU').format(amount) + ' ₸';
const dateText = value => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z'));
const base = { city: 'Алматы', date: '2026-10-10', event_format: 'корпоратив', category: 'Ведущий', budget: 1500000, language: '', duration_hours: '' };
const presets = {
  hosts: base,
  florist: { ...base, category: 'Флорист', event_format: 'свадьба', budget: 500000 },
  venue: { ...base, category: 'Банкетный зал', event_format: 'свадьба', date: '2026-11-14', budget: 5000000 },
  absent: { ...base, city: 'Астана', category: 'Декоратор' },
  budget: { ...base, budget: 100000 },
};
const reasons = { busy: 'заняты на дату', budget: 'выше бюджета', format: 'другой формат', language: 'не подходит язык', duration: 'не подходит длительность' };
let meta;
let requestController;
let requestNumber = 0;
let previousResult;
let currentResult;
let assistantController;
let assistantRequestNumber = 0;
let stateRevision = 0;
const fieldLabels = { city: 'город', date: 'дата', event_format: 'формат', category: 'категория', budget: 'бюджет', language: 'язык', duration_hours: 'длительность' };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showError(message, fields = {}) {
  $('form-error').textContent = message;
  $('form-error').hidden = false;
  for (const [key, value] of Object.entries(fields)) {
    if ($(key + '-error')) $(key + '-error').textContent = value;
    if ($(key)) $(key).setAttribute('aria-invalid', 'true');
  }
  const first = Object.keys(fields).find(key => $(key));
  if (first) $(first).focus();
}

function clearError() {
  $('form-error').hidden = true;
  form.querySelectorAll('.field-error').forEach(n => { n.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach(n => n.removeAttribute('aria-invalid'));
}

function getQuery() {
  const data = Object.fromEntries(new FormData(form));
  return { ...data, budget: Number(data.budget), duration_hours: data.duration_hours === '' ? null : Number(data.duration_hours), language: data.language || null };
}

function getDraft() {
  const data = Object.fromEntries(new FormData(form));
  return {
    city: data.city || null,
    date: data.date || null,
    event_format: data.event_format || null,
    category: data.category || null,
    budget: data.budget === '' ? null : Number(data.budget),
    language: data.language || null,
    duration_hours: data.duration_hours === '' ? null : Number(data.duration_hours),
  };
}

function setDraft(query = {}) {
  for (const field of ['city', 'date', 'event_format', 'category', 'budget', 'language', 'duration_hours']) {
    $(field).value = query[field] ?? '';
  }
}

function formatAssistantValue(field, value) {
  if (field === 'budget') return money(value);
  if (field === 'date') return dateText(value);
  if (field === 'duration_hours') return `${value} ч`;
  return String(value);
}

function renderAssistantSuggestions(suggestions = []) {
  const container = $('assistant-suggestions');
  container.replaceChildren();
  for (const suggestion of suggestions) {
    const button = element('button', 'assistant-suggestion');
    button.type = 'button';
    const change = Object.entries(suggestion.changes)[0];
    const description = change ? `${fieldLabels[change[0]]}: ${formatAssistantValue(change[0], change[1])}` : suggestion.label;
    button.textContent = `${description} · ${suggestion.eligible} вариант(а)`;
    button.addEventListener('click', () => {
      for (const [field, value] of Object.entries(suggestion.changes)) $(field).value = value;
      stateRevision++;
      recommend(true);
    });
    container.append(button);
  }
}

function showAssistantResponse(reply, updatedFields = [], query = {}, suggestions = []) {
  $('assistant-response').hidden = false;
  $('assistant-reply').textContent = reply;
  const updates = $('assistant-updates');
  updates.replaceChildren();
  for (const field of updatedFields) {
    if (query[field] === undefined || query[field] === null || query[field] === '') continue;
    updates.append(element('span', 'assistant-chip', `${fieldLabels[field]}: ${formatAssistantValue(field, query[field])}`));
  }
  renderAssistantSuggestions(suggestions);
}

function cardView(card, index) {
  const article = element('article', 'card');
  const rank = element('span', 'card-rank');
  rank.append(element('strong', '', String(index + 1)), document.createTextNode('вариант'));
  article.append(rank);
  const top = element('div', 'card-top');
  const initials = card.name.split(' ').slice(0, 2).map(word => word[0]).join('');
  const avatar = element('span', 'avatar', initials);
  avatar.setAttribute('aria-hidden', 'true');
  const person = element('div', 'person');
  const name = element('h3', '', card.name);
  name.id = `contractor-${index}`;
  article.setAttribute('aria-labelledby', name.id);
  person.append(name, element('p', 'card-category', `${card.category} · ${card.city}`));
  top.append(avatar, person);
  const priceRow = element('div', 'price-row');
  const price = element('div', 'price');
  price.append(element('span', 'price-prefix', 'от'), document.createTextNode(money(card.price_from_kzt)));
  priceRow.append(price, element('span', 'availability', 'Свободен на дату'));
  const hours = card.max_hours === null ? 'Часы присутствия неприменимы' : `До ${card.max_hours} ч на площадке`;
  const attrs = element('p', 'attributes', `${card.languages.join(', ')} · ${hours}`);
  const box = element('div', 'reason-box');
  box.append(element('p', 'reason-label', 'Почему подходит'), element('p', 'explanation', card.explanation));
  const quote = element('blockquote', 'evidence', `«${card.evidence.text}${card.evidence.truncated ? '…' : ''}»`);
  quote.append(element('span', 'evidence-source', 'Из описания подрядчика'));
  box.append(quote);
  article.append(top, priceRow, attrs, box);
  const flags = element('div', 'flags');
  if (card.synthetic) flags.append(element('span', 'flag synthetic', 'Синтетический профиль'));
  if (card.price_imputed) flags.append(element('span', 'flag', 'Цена проставлена в датасете'));
  if (card.city_imputed) flags.append(element('span', 'flag', 'Город проставлен в датасете'));
  if (flags.childNodes.length) article.append(flags);
  article.append(element('p', 'card-id', card.id));
  return article;
}

function render(result) {
  const { counts, query, status } = result;
  currentResult = result;
  $('cards').replaceChildren(...result.cards.map(cardView));
  $('result-actions').hidden = result.cards.length < 2;
  $('empty-state').hidden = status === 'matched';
  const statusLabels = { matched: 'Подбор завершён', category_absent: 'Категория не найдена', no_matches: 'Нет совпадений' };
  const resultStatus = $('result-status');
  resultStatus.textContent = statusLabels[status] || 'Проверено';
  resultStatus.hidden = false;
  resultStatus.className = `result-status ${status}`;
  $('result-meta').textContent = status === 'matched' ? 'Порядок: начальная цена ↑, затем ID' : 'Проверено по каталогу';
  $('query-summary').textContent = `${query.city} · ${dateText(query.date)} · ${query.category} · ${query.event_format} · до ${money(query.budget)}${query.language ? ' · ' + query.language : ''}${query.duration_hours ? ' · ' + query.duration_hours + ' ч' : ''}`;
  const filter = $('filter-summary');
  filter.replaceChildren();
  filter.hidden = counts.in_category === 0;
  const total = element('span');
  total.append(element('strong', '', String(counts.in_category)), document.createTextNode(' в городе и категории'));
  filter.append(total);
  for (const [key, value] of Object.entries(counts.excluded)) {
    if (!value) continue;
    const reason = element('span');
    reason.append(element('strong', '', String(value)), document.createTextNode(' — ' + reasons[key]));
    filter.append(reason);
  }
  filter.append(element('span', '', `Проходят все условия: ${counts.eligible}`));
  if (result.busy_contractors.length) {
    const details = element('details', 'busy-details');
    details.append(element('summary', '', 'Кто занят на эту дату'), element('p', '', result.busy_contractors.map(p => p.name).join(', ')));
    filter.append(details);
  }
  if (status === 'matched') {
    $('result-summary').textContent = counts.eligible >= 3
      ? `Показаны ${counts.shown} из ${counts.eligible} подходящих вариантов.`
      : `Подходящих вариантов: ${counts.eligible}. ${counts.in_category < 3 ? 'В этом городе в категории всего ' + counts.in_category + ' профиля.' : 'Остальные не проходят выбранные условия.'}${counts.in_category < 3 && counts.eligible < counts.in_category ? ' Остальные исключены по условиям ниже.' : ''}`;
  } else if (status === 'category_absent') {
    $('result-summary').textContent = 'В городе нет этой категории.';
    $('empty-title').textContent = 'Такой категории пока нет в каталоге города';
    $('empty-message').textContent = `Для сочетания «${query.city} — ${query.category}» нет профилей. Изменение даты или бюджета не поможет: выберите другой город или категорию.`;
  } else {
    $('result-summary').textContent = 'Категория есть, но никто не проходит все условия.';
    $('empty-title').textContent = 'Подходящих вариантов не найдено';
    const advice = [];
    if (counts.excluded.busy) advice.push('попробуйте другую дату');
    if (query.budget < result.minimum_price) advice.push(`начальные цены в этой категории города — от ${money(result.minimum_price)}`);
    else if (counts.excluded.budget) advice.push('проверьте бюджет');
    if (counts.excluded.format) advice.push('проверьте формат мероприятия');
    if (counts.excluded.language || counts.excluded.duration) advice.push('проверьте язык и длительность');
    const hint = advice.join('; ');
    $('empty-message').textContent = `В городе есть ${counts.in_category} профилей этой категории, но каждый исключён по одному из условий выше. ${hint.charAt(0).toUpperCase() + hint.slice(1)}.`;
  }
  const modes = {
    ai: 'AI выбрал особенности из описаний. Даты, цены и порядок карточек проверены по каталогу.',
    catalog: 'Объяснения составлены по данным каталога. AI не подключён.',
    fallback: 'AI временно недоступен. Показываем объяснения по данным каталога; условия подбора не изменились.',
    not_needed: '',
  };
  $('mode-note').textContent = modes[result.explanation_mode] || '';
  if (status === 'no_matches' && result.suggestions?.length) {
    showAssistantResponse('Я проверил изменения, которые действительно дают варианты:', [], query, result.suggestions);
  }
  if (previousResult && previousResult.query.date !== query.date) {
    const { date: oldDate, ...oldConditions } = previousResult.query;
    const { date: newDate, ...newConditions } = query;
    if (JSON.stringify(oldConditions) === JSON.stringify(newConditions)) {
      const nowBusy = previousResult.cards.filter(card => result.busy_contractors.some(p => p.id === card.id));
      if (nowBusy.length) $('result-summary').textContent += ` На ${dateText(newDate)} заняты: ${nowBusy.map(p => p.name).join(', ')} — поэтому они исключены из предыдущей подборки.`;
    }
  }
  previousResult = result;
}

async function sendAssistant(forcedMessage) {
  const input = $('assistant-input');
  const message = (forcedMessage ?? input.value).trim();
  if (!message) {
    showAssistantResponse('Опишите задачу одним сообщением — например, город, дату, категорию и бюджет.');
    input.focus();
    return;
  }
  assistantController?.abort();
  assistantController = new AbortController();
  const controller = assistantController;
  const serial = ++assistantRequestNumber;
  const revision = stateRevision;
  const timeout = setTimeout(() => controller.abort('timeout'), 13000);
  $('assistant-send').disabled = true;
  $('assistant-send-label').textContent = 'Разбираю…';
  showAssistantResponse('Понимаю запрос и сверяю условия с каталогом…');
  try {
    const response = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, current_query: getDraft(), state_revision: revision }),
      signal: controller.signal,
    });
    const result = await response.json();
    if (serial !== assistantRequestNumber || revision !== stateRevision || result.state_revision !== revision) return;
    if (!response.ok) {
      showAssistantResponse(result.message || 'Ассистент временно недоступен. Используйте форму ниже.');
      return;
    }
    setDraft(result.resolved_query);
    stateRevision++;
    showAssistantResponse(result.reply, result.updated_fields, result.resolved_query, result.suggestions);
    if (result.recommendation) {
      render(result.recommendation);
      if (forcedMessage !== undefined) {
        $('comparison-output').textContent = result.reply;
        $('comparison-output').hidden = false;
      } else {
        $('comparison-output').hidden = true;
      }
      $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (result.missing_fields?.length) {
      const first = result.missing_fields.find(field => $(field));
      if (first) $(first).focus({ preventScroll: true });
    }
    if (forcedMessage === undefined) input.value = '';
  } catch {
    if (serial !== assistantRequestNumber) return;
    showAssistantResponse(controller.signal.reason === 'timeout'
      ? 'Ассистент не ответил вовремя. Условия можно заполнить вручную.'
      : 'Не удалось связаться с ассистентом. Проверьте сервер и попробуйте снова.');
  } finally {
    clearTimeout(timeout);
    if (serial === assistantRequestNumber) {
      $('assistant-send').disabled = false;
      $('assistant-send-label').textContent = 'Разобрать запрос';
    }
  }
}

async function recommend(shouldRevealResults = false) {
  clearError();
  if (!form.reportValidity()) return;
  requestController?.abort();
  requestController = new AbortController();
  const controller = requestController;
  const serial = ++requestNumber;
  const timeout = setTimeout(() => controller.abort('timeout'), 10000);
  const query = getQuery();
  $('results').setAttribute('aria-busy', 'true');
  $('submit').disabled = true;
  $('submit-label').textContent = 'Подбираем…';
  $('result-summary').textContent = 'Проверяем доступность и условия…';
  try {
    const response = await fetch('/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query), signal: controller.signal });
    const result = await response.json();
    if (serial !== requestNumber) return;
    if (!response.ok) {
      showError(result.message || 'Не удалось выполнить подбор', result.fields);
      $('result-summary').textContent = 'Подбор не выполнен. Проверьте параметры формы.';
      $('cards').replaceChildren(); $('filter-summary').hidden = true; $('empty-state').hidden = true; $('query-summary').textContent = ''; $('mode-note').textContent = ''; $('result-meta').textContent = ''; $('result-status').hidden = true;
      return;
    }
    render(result);
    if (shouldRevealResults) $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    if (serial !== requestNumber) return;
    showError(controller.signal.reason === 'timeout' ? 'Ответ не пришёл за 10 секунд. Попробуйте ещё раз.' : 'Не удалось связаться с сервером. Проверьте подключение и повторите подбор.');
    $('result-summary').textContent = 'Не удалось завершить подбор.';
    $('cards').replaceChildren(); $('filter-summary').hidden = true; $('empty-state').hidden = true; $('query-summary').textContent = ''; $('mode-note').textContent = ''; $('result-meta').textContent = ''; $('result-status').hidden = true;
  } finally {
    clearTimeout(timeout);
    if (serial === requestNumber) {
      $('results').setAttribute('aria-busy', 'false');
      $('submit').disabled = false;
      $('submit-label').textContent = 'Показать подходящие варианты';
    }
  }
}

form.addEventListener('submit', event => { event.preventDefault(); recommend(true); });
form.addEventListener('input', () => {
  stateRevision++;
  requestNumber++;
  assistantRequestNumber++;
  requestController?.abort();
  assistantController?.abort();
  document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
  if (currentResult) {
    $('result-summary').textContent = 'Условия изменены. Обновите подбор, чтобы увидеть актуальные варианты.';
    $('result-actions').hidden = true;
    $('comparison-output').hidden = true;
  }
});
document.querySelectorAll('[data-preset]').forEach(button => {
  button.disabled = true;
  button.addEventListener('click', () => {
    for (const [key, value] of Object.entries(presets[button.dataset.preset])) $(key).value = value;
    stateRevision++;
    document.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('active', b === button));
    recommend(true);
  });
});
$('edit-query').addEventListener('click', () => { $('city').focus(); $('search').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
$('assistant-send').addEventListener('click', () => sendAssistant());
$('assistant-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendAssistant();
  }
});
$('compare-results').addEventListener('click', () => sendAssistant('Сравни показанные варианты'));

async function init() {
  try {
    const response = await fetch('/api/meta', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Catalog unavailable');
    meta = await response.json();
    for (const [id, values] of Object.entries({ city: meta.cities, category: meta.categories, event_format: meta.event_formats, language: meta.languages })) {
      if (id !== 'language') {
        const placeholder = element('option', '', 'Выберите');
        placeholder.value = '';
        placeholder.disabled = true;
        placeholder.selected = true;
        $(id).append(placeholder);
      }
      values.forEach(value => { const option = element('option', '', value); option.value = value; $(id).append(option); });
    }
    $('date').min = meta.calendar.from; $('date').max = meta.calendar.to;
    $('search-fields').disabled = false;
    document.querySelectorAll('[data-preset]').forEach(b => { b.disabled = false; });
    setDraft();
    $('result-summary').textContent = 'Опишите задачу ассистенту, выберите пример или заполните форму.';
    $('assistant-input').focus({ preventScroll: true });
  } catch {
    $('result-summary').textContent = 'Каталог недоступен.';
    showError('Не удалось загрузить каталог. Убедитесь, что сервер запущен, и обновите страницу.');
  }
}
init();
