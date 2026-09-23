import { initI18n, getLocale, localizeValue, t } from './i18n.js';

initI18n();
const $ = id => document.getElementById(id);
const money = amount => `${new Intl.NumberFormat(({ kk: 'kk-KZ', en: 'en-US' })[getLocale()] || 'ru-RU').format(amount)} ₸`;
let catalog;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function populateFilter(select, values) {
  const selected = select.value;
  for (const option of [...select.options]) {
    if (option.value !== '') option.remove();
  }
  for (const value of values) {
    const option = element('option', '', localizeValue(value));
    option.value = value;
    option.dataset.canonical = value;
    select.append(option);
  }
  select.value = selected;
}

function catalogCardView(item) {
  const article = element('article', 'card catalog-card');
  const top = element('div', 'card-top');
  const initials = item.name.split(' ').slice(0, 2).map(word => word[0]).join('');
  const avatar = element('span', 'avatar', initials);
  avatar.setAttribute('aria-hidden', 'true');
  const person = element('div', 'person');
  person.append(element('h3', '', item.name), element('p', 'card-category', `${item.categories.map(value => localizeValue(value)).join(' · ')} · ${localizeValue(item.city)}`));
  top.append(avatar, person);

  const priceRow = element('div', 'price-row');
  const price = element('div', 'price');
  price.append(element('span', 'price-prefix', t('from')), document.createTextNode(money(item.price_from_kzt)));
  priceRow.append(price);

  const formats = element('p', 'catalog-attributes', `${t('formats')}: ${item.event_formats.map(value => localizeValue(value)).join(', ')}`);
  const languages = element('p', 'catalog-attributes', `${t('languages')}: ${item.languages.map(value => localizeValue(value)).join(', ')}`);
  const hours = item.max_hours === null ? t('max_duration_unknown') : t('hours_max', { hours: item.max_hours });
  const description = element('p', 'catalog-description');
  const excerptEnd = item.description.length > 300 ? item.description.lastIndexOf(' ', 300) : item.description.length;
  description.textContent = item.description.length > 300 ? `${item.description.slice(0, excerptEnd > 180 ? excerptEnd : 300)}…` : item.description;

  const details = element('details', 'catalog-full-description');
  details.append(element('summary', '', t('full_description')), element('p', '', item.description));
  article.append(top, priceRow, formats, languages, element('p', 'catalog-attributes', hours), description, details);

  const flags = element('div', 'flags');
  if (item.synthetic) flags.append(element('span', 'flag synthetic', t('synthetic')));
  if (item.price_imputed) flags.append(element('span', 'flag', t('price_refined')));
  if (item.city_imputed) flags.append(element('span', 'flag', t('city_refined')));
  if (flags.childNodes.length) article.append(flags);
  article.append(element('p', 'card-id', item.id));
  return article;
}

function renderCatalog() {
  if (!catalog) return;
  const search = $('catalog-search').value.trim().toLocaleLowerCase();
  const category = $('catalog-category').value;
  const city = $('catalog-city').value;
  const visible = catalog.items.filter(item => {
    if (category && !item.categories.includes(category)) return false;
    if (city && item.city !== city) return false;
    if (!search) return true;
    return [item.name, item.city, ...item.categories, ...item.event_formats, ...item.languages, item.description]
      .join(' ').toLocaleLowerCase().includes(search);
  });
  $('catalog-cards').replaceChildren(...visible.map(catalogCardView));
  $('catalog-status').textContent = t('catalog_shown', {
    shown: new Intl.NumberFormat(({ kk: 'kk-KZ', en: 'en-US' })[getLocale()] || 'ru-RU').format(visible.length),
    total: new Intl.NumberFormat(({ kk: 'kk-KZ', en: 'en-US' })[getLocale()] || 'ru-RU').format(catalog.total),
  });
  $('catalog-empty').hidden = visible.length > 0;
}

async function init() {
  try {
    const response = await fetch('/api/catalog', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Catalog unavailable');
    catalog = await response.json();
    const categories = [...new Set(catalog.items.flatMap(item => item.categories))].sort((a, b) => a.localeCompare(b, 'ru'));
    const cities = [...new Set(catalog.items.map(item => item.city))].sort((a, b) => a.localeCompare(b, 'ru'));
    populateFilter($('catalog-category'), categories);
    populateFilter($('catalog-city'), cities);
    renderCatalog();
  } catch {
    $('catalog-status').textContent = t('catalog_failure');
  }
}

$('catalog-search').addEventListener('input', renderCatalog);
$('catalog-category').addEventListener('change', renderCatalog);
$('catalog-city').addEventListener('change', renderCatalog);
document.addEventListener('localechange', () => {
  if (catalog) {
    populateFilter($('catalog-category'), [...new Set(catalog.items.flatMap(item => item.categories))].sort((a, b) => a.localeCompare(b, 'ru')));
    populateFilter($('catalog-city'), [...new Set(catalog.items.map(item => item.city))].sort((a, b) => a.localeCompare(b, 'ru')));
  }
  renderCatalog();
});

init();
