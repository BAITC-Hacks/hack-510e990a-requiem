import { getLocale, initI18n, localizeValue, t } from './i18n.js';

initI18n();
const $ = id => document.getElementById(id);
const form = $('search');
const intlLocale = () => ({ kk: 'kk-KZ', en: 'en-US' })[getLocale()] || 'ru-RU';
const money = amount => new Intl.NumberFormat(intlLocale()).format(amount) + ' ₸';
const dateText = value => new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z'));
const base = { city: 'Алматы', date: '2026-10-10', event_format: 'корпоратив', category: 'Ведущий', budget: 1500000, language: '', duration_hours: '' };
const presets = {
  hosts: base,
  florist: { ...base, category: 'Флорист', event_format: 'свадьба', budget: 500000 },
  venue: { ...base, category: 'Банкетный зал', event_format: 'свадьба', date: '2026-11-14', budget: 5000000 },
  absent: { ...base, city: 'Астана', category: 'Декоратор' },
  budget: { ...base, budget: 100000 },
};
let meta;
let requestController;
let requestNumber = 0;
let previousResult;
let currentResult;
let assistantController;
let assistantRequestNumber = 0;
let stateRevision = 0;
let currentKeywords = [];

const fieldLabel = field => t(`field_${field}`);

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
  if (field === 'duration_hours') return `${value} ${t('hours_unit')}`;
  return localizeValue(String(value));
}

function renderAssistantSuggestions(suggestions = []) {
  const container = $('assistant-suggestions');
  container.replaceChildren();
  for (const suggestion of suggestions) {
    const button = element('button', 'assistant-suggestion');
    button.type = 'button';
    const change = Object.entries(suggestion.changes)[0];
    const description = change ? `${fieldLabel(change[0])}: ${formatAssistantValue(change[0], change[1])}` : suggestion.label;
    button.textContent = `${description} · ${t('suggestion_count', { count: suggestion.eligible })}`;
    button.addEventListener('click', () => {
      for (const [field, value] of Object.entries(suggestion.changes)) $(field).value = value;
      stateRevision++;
      recommend(true);
    });
    container.append(button);
  }
}

function showAssistantResponse(reply, _updatedFields = [], query = {}, suggestions = [], keywords = currentKeywords) {
  $('assistant-response').hidden = false;
  $('assistant-reply').textContent = reply;
  const updates = $('assistant-updates');
  updates.replaceChildren();
  const conditionFields = ['city', 'date', 'event_format', 'category', 'budget', 'language', 'duration_hours'];
  const presentFields = conditionFields.filter(field => query[field] !== undefined && query[field] !== null && query[field] !== '');
  if (presentFields.length) updates.append(element('span', 'assistant-preferences-label', t('recognized_conditions')));
  for (const field of presentFields) {
    updates.append(element('span', 'assistant-chip', `${fieldLabel(field)}: ${formatAssistantValue(field, query[field])}`));
  }
  const preferenceList = $('assistant-preferences');
  preferenceList.replaceChildren();
  if (keywords.length) {
    preferenceList.append(element('span', 'assistant-preferences-label', t('keyword_preferences')));
    for (const keyword of keywords) preferenceList.append(element('span', 'assistant-chip', keyword));
  }
  renderAssistantSuggestions(suggestions);
}

function cardView(card, index) {
  const article = element('article', 'card');
  const rank = element('span', 'card-rank');
  rank.append(element('strong', '', String(index + 1)), document.createTextNode(t('variant')));
  article.append(rank);
  const top = element('div', 'card-top');
  const initials = card.name.split(' ').slice(0, 2).map(word => word[0]).join('');
  const avatar = element('span', 'avatar', initials);
  avatar.setAttribute('aria-hidden', 'true');
  const person = element('div', 'person');
  const name = element('h3', '', card.name);
  name.id = `contractor-${index}`;
  article.setAttribute('aria-labelledby', name.id);
  person.append(name, element('p', 'card-category', `${localizeValue(card.category)} · ${localizeValue(card.city)}`));
  top.append(avatar, person);
  const priceRow = element('div', 'price-row');
  const price = element('div', 'price');
  price.append(element('span', 'price-prefix', t('from')), document.createTextNode(money(card.price_from_kzt)));
  priceRow.append(price, element('span', 'availability', t('free_date')));
  const hours = card.max_hours === null ? t('hours_na') : t('hours_max', { hours: card.max_hours });
  const attrs = element('p', 'attributes', `${card.languages.map(value => localizeValue(value)).join(', ')} · ${hours}`);
  const box = element('div', 'reason-box');
  box.append(element('p', 'reason-label', t('why')), element('p', 'explanation', card.explanation));
  const quote = element('blockquote', 'evidence', `«${card.evidence.text}${card.evidence.truncated ? '…' : ''}»`);
  quote.append(element('span', 'evidence-source', t('from_description')));
  box.append(quote);
  article.append(top, priceRow, attrs, box);
  const flags = element('div', 'flags');
  if (card.synthetic) flags.append(element('span', 'flag synthetic', t('synthetic')));
  if (card.price_imputed) flags.append(element('span', 'flag', t('price_imputed')));
  if (card.city_imputed) flags.append(element('span', 'flag', t('city_imputed')));
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
  const statusLabels = { matched: t('status_matched'), category_absent: t('status_absent'), no_matches: t('status_none') };
  const resultStatus = $('result-status');
  resultStatus.textContent = statusLabels[status] || t('status_checked');
  resultStatus.hidden = false;
  resultStatus.className = `result-status ${status}`;
  $('result-meta').textContent = status === 'matched'
    ? result.ranking === 'keyword_relevance' ? t('order_keywords') : t('order_price')
    : t('checked_catalog');
  $('query-summary').textContent = `${localizeValue(query.city)} · ${dateText(query.date)} · ${localizeValue(query.category)} · ${localizeValue(query.event_format)} · ${t('budget_limit')} ${money(query.budget)}${query.language ? ' · ' + localizeValue(query.language) : ''}${query.duration_hours ? ' · ' + query.duration_hours + ' ' + t('hours_unit') : ''}`;
  const keywords = result.preference_keywords || currentKeywords;
  const preferenceSummary = $('preference-summary');
  preferenceSummary.hidden = !keywords.length;
  preferenceSummary.textContent = keywords.length ? `${t('keyword_preferences')} ${keywords.join(' · ')}` : '';
  const filter = $('filter-summary');
  filter.replaceChildren();
  filter.hidden = counts.in_category === 0;
  const total = element('span');
  total.append(element('strong', '', String(counts.in_category)), document.createTextNode(' ' + t('filters_count')));
  filter.append(total);
  for (const [key, value] of Object.entries(counts.excluded)) {
    if (!value) continue;
    const reason = element('span');
    reason.append(element('strong', '', String(value)), document.createTextNode(' — ' + t(`excluded_${key}`)));
    filter.append(reason);
  }
  filter.append(element('span', '', t('passes', { count: counts.eligible })));
  if (result.busy_contractors.length) {
    const details = element('details', 'busy-details');
    details.append(element('summary', '', t('busy_people')), element('p', '', result.busy_contractors.map(p => p.name).join(', ')));
    filter.append(details);
  }
  if (status === 'matched') {
    $('result-summary').textContent = counts.eligible >= 3
      ? t('shown_results', { shown: counts.shown, eligible: counts.eligible })
      : `${t('found_results', { eligible: counts.eligible })} ${counts.in_category < 3 ? t('in_city_count', { count: counts.in_category }) : t('other_excluded')}`;
  } else if (status === 'category_absent') {
    $('result-summary').textContent = t('absent_summary');
    $('empty-title').textContent = t('absent_title');
    $('empty-message').textContent = t('absent_message', { city: localizeValue(query.city), category: localizeValue(query.category) });
  } else {
    $('result-summary').textContent = t('no_match_summary');
    $('empty-title').textContent = t('no_match_title');
    const advice = [];
    if (counts.excluded.busy) advice.push(t('advice_date'));
    if (query.budget < result.minimum_price) advice.push(t('advice_prices', { price: money(result.minimum_price) }));
    else if (counts.excluded.budget) advice.push(t('advice_budget'));
    if (counts.excluded.format) advice.push(t('advice_format'));
    if (counts.excluded.language || counts.excluded.duration) advice.push(t('advice_language'));
    const hint = advice.length ? advice.join('; ') : t('advice_generic');
    $('empty-message').textContent = t('no_match_message', { count: counts.in_category, advice: hint });
  }
  const modes = {
    ai: t('mode_ai'),
    catalog: t('mode_catalog'),
    fast_local: t('mode_fast_local'),
    keyword_fallback: t('mode_fallback'),
    fallback: t('mode_fallback'),
    not_needed: '',
  };
  $('mode-note').textContent = modes[result.explanation_mode] || '';
  if (status === 'no_matches' && result.suggestions?.length) {
    showAssistantResponse(t('suggestions_intro'), [], query, result.suggestions, keywords);
  }
  if (previousResult && previousResult.query.date !== query.date) {
    const { date: oldDate, ...oldConditions } = previousResult.query;
    const { date: newDate, ...newConditions } = query;
    if (JSON.stringify(oldConditions) === JSON.stringify(newConditions)) {
      const nowBusy = previousResult.cards.filter(card => result.busy_contractors.some(p => p.id === card.id));
      if (nowBusy.length) $('result-summary').textContent += ` ${t('previous_busy', { date: dateText(newDate), names: nowBusy.map(p => p.name).join(', ') })}`;
    }
  }
  previousResult = result;
}

async function sendAssistant(forcedMessage) {
  const input = $('assistant-input');
  const message = (forcedMessage ?? input.value).trim();
  if (!message) {
    showAssistantResponse(t('assistant_empty'));
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
  $('assistant-send-label').textContent = t('assistant_loading');
  showAssistantResponse(t('assistant_wait'));
  try {
    const response = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, current_query: getDraft(), current_keywords: currentKeywords, locale: getLocale(), state_revision: revision }),
      signal: controller.signal,
    });
    const result = await response.json();
    if (serial !== assistantRequestNumber || revision !== stateRevision || result.state_revision !== revision) return;
    if (!response.ok) {
      showAssistantResponse(result.message || t('assistant_offline'));
      return;
    }
    currentKeywords = Array.isArray(result.keywords) ? result.keywords : currentKeywords;
    setDraft(result.resolved_query);
    stateRevision++;
    showAssistantResponse(result.reply, result.updated_fields, result.criteria?.conditions || result.resolved_query, result.suggestions, result.criteria?.preferences || currentKeywords);
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
      ? t('assistant_timeout')
      : t('assistant_connection'));
  } finally {
    clearTimeout(timeout);
    if (serial === assistantRequestNumber) {
      $('assistant-send').disabled = false;
      $('assistant-send-label').textContent = t('assistant_send');
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
  $('submit-label').textContent = t('submit_loading');
  $('result-summary').textContent = t('assistant_wait');
  try {
    const response = await fetch('/api/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...query, locale: getLocale(), current_keywords: currentKeywords }), signal: controller.signal });
    const result = await response.json();
    if (serial !== requestNumber) return;
    if (!response.ok) {
      showError(result.message || t('request_error'), result.fields);
      $('result-summary').textContent = t('request_error_state');
      $('cards').replaceChildren(); $('filter-summary').hidden = true; $('empty-state').hidden = true; $('query-summary').textContent = ''; $('mode-note').textContent = ''; $('result-meta').textContent = ''; $('result-status').hidden = true;
      return;
    }
    currentKeywords = Array.isArray(result.preference_keywords) ? result.preference_keywords : currentKeywords;
    render(result);
    if (shouldRevealResults) $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    if (serial !== requestNumber) return;
    showError(controller.signal.reason === 'timeout' ? t('request_timeout') : t('connection_error'));
    $('result-summary').textContent = t('failed');
    $('cards').replaceChildren(); $('filter-summary').hidden = true; $('empty-state').hidden = true; $('query-summary').textContent = ''; $('mode-note').textContent = ''; $('result-meta').textContent = ''; $('result-status').hidden = true;
  } finally {
    clearTimeout(timeout);
    if (serial === requestNumber) {
      $('results').setAttribute('aria-busy', 'false');
      $('submit').disabled = false;
      $('submit-label').textContent = t('submit');
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
    $('result-summary').textContent = t('manual_update');
    $('result-actions').hidden = true;
    $('comparison-output').hidden = true;
  }
});
document.querySelectorAll('[data-preset]').forEach(button => {
  button.disabled = true;
  button.addEventListener('click', () => {
    $('manual-filters').open = true;
    for (const [key, value] of Object.entries(presets[button.dataset.preset])) $(key).value = value;
    stateRevision++;
    document.querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('active', b === button));
    recommend(true);
  });
});
$('edit-query').addEventListener('click', () => { $('manual-filters').open = true; $('city').focus(); $('search').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
$('assistant-send').addEventListener('click', () => sendAssistant());
$('assistant-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendAssistant();
  }
});
$('compare-results').addEventListener('click', () => sendAssistant(t('compare_prompt')));

document.addEventListener('localechange', () => {
  for (const id of ['city', 'category', 'event_format', 'language']) {
    const select = $(id);
    if (!select) continue;
    for (const option of select.options) {
      if (option.value) option.textContent = localizeValue(option.value);
      else if (id !== 'language') option.textContent = t('select');
    }
  }
  if (!$('assistant-response').hidden) showAssistantResponse(t('locale_changed'), [], getDraft(), [], currentKeywords);
  if ($('assistant-send').disabled) $('assistant-send-label').textContent = t('assistant_loading');
  if ($('submit').disabled) $('submit-label').textContent = t('submit_loading');
  if (currentResult) recommend(false);
  else $('result-summary').textContent = meta ? t('assistant_empty') : t('loading_catalog');
});

async function init() {
  try {
    const response = await fetch('/api/meta', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Catalog unavailable');
    meta = await response.json();
    for (const [id, values] of Object.entries({ city: meta.cities, category: meta.categories, event_format: meta.event_formats, language: meta.languages })) {
      if (id !== 'language') {
        const placeholder = element('option', '', t('select'));
        placeholder.value = '';
        placeholder.disabled = true;
        placeholder.selected = true;
        $(id).append(placeholder);
      }
      values.forEach(value => { const option = element('option', '', localizeValue(value)); option.value = value; $(id).append(option); });
    }
    $('date').min = meta.calendar.from; $('date').max = meta.calendar.to;
    $('search-fields').disabled = false;
    document.querySelectorAll('[data-preset]').forEach(b => { b.disabled = false; });
    setDraft();
    $('result-summary').textContent = t('assistant_empty');
    $('assistant-input').focus({ preventScroll: true });
  } catch {
    $('result-summary').textContent = t('catalog_error');
    showError(t('catalog_load_error'));
  }
}
init();
