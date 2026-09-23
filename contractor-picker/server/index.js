import express from 'express';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadDataset } from './dataset.js';
import { validateQuery, InputError } from './matching.js';
import { createExplainer } from './ai.js';
import { createAssistantParser, applyAssistantPatches, missingFields, clarificationReply, comparisonReply, completeQuery } from './assistant.js';
import { createRecommendationService } from './recommendations.js';
import { normalizeLocale, text } from './locales.js';

export function createApp({ dataset = loadDataset(), explain = createExplainer({
  apiKey: process.env.OPENAI_API_KEY || '', model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  timeoutMs: Math.min(7000, Math.max(500, Number(process.env.AI_TIMEOUT_MS) || 5000)),
}), parseAssistant = createAssistantParser({
  apiKey: process.env.OPENAI_API_KEY || '', model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  timeoutMs: Math.min(6000, Math.max(1000, Number(process.env.ASSISTANT_TIMEOUT_MS) || 4500)),
}) } = {}) {
  const app = express();
  const recommend = createRecommendationService({ dataset, explain });
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  app.get('/api/meta', (_req, res) => res.json({ ...dataset.meta, dataset_version: dataset.version }));
  app.get('/api/catalog', (_req, res) => res.set('Cache-Control', 'public, max-age=300').json({
    total: dataset.profiles.length,
    dataset_version: dataset.version,
    items: dataset.profiles.map(({ id, anon_name, categories, city, price_from_kzt, event_formats, languages, max_hours, description, synthetic, city_imputed, price_imputed }) => ({
      id,
      name: anon_name,
      categories,
      city,
      price_from_kzt,
      event_formats,
      languages,
      max_hours,
      description,
      synthetic,
      city_imputed,
      price_imputed,
    })),
  }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', profiles: dataset.profiles.length, dataset_version: dataset.version, assistant_configured: Boolean(process.env.OPENAI_API_KEY) }));
  app.post('/api/recommend', async (req, res) => {
    const started = performance.now();
    const input = { ...(req.body || {}) };
    const locale = normalizeLocale(input.locale);
    delete input.locale;
    const keywords = Array.isArray(input.current_keywords) ? input.current_keywords.slice(0, 12) : [];
    delete input.current_keywords;
    const query = validateQuery(input, dataset.meta);
    const result = await recommend(query, { includeSuggestions: true, keywords, locale });
    res.set('Cache-Control', 'no-store').json({ ...result, elapsed_ms: Math.round(performance.now() - started) });
  });
  app.post('/api/assistant', async (req, res) => {
    const started = performance.now();
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message || message.length > 1000) throw new InputError({ message: 'Введите сообщение длиной от 1 до 1000 символов' });
    const stateRevision = Number.isSafeInteger(req.body?.state_revision) ? req.body.state_revision : 0;
    const locale = normalizeLocale(req.body?.locale);
    const currentKeywords = Array.isArray(req.body?.current_keywords) ? req.body.current_keywords.slice(0, 12) : [];
    let intent;
    try {
      intent = await parseAssistant({ message, currentQuery: req.body?.current_query || {}, currentKeywords, meta: dataset.meta, locale });
    } catch {
      return res.status(503).set('Cache-Control', 'no-store').json({
        error: 'assistant_unavailable',
        message: text(locale, 'unavailable'),
        state_revision: stateRevision,
      });
    }

    const { draft, updatedFields, errors } = applyAssistantPatches(req.body?.current_query, intent, dataset.meta);
    const missing = missingFields(draft);
    if (intent.action === 'help') {
      return res.set('Cache-Control', 'no-store').json({
        assistant_status: 'explained',
        reply: text(locale, 'help'),
        resolved_query: draft,
        criteria: { conditions: draft, preferences: intent.keywords || [] },
        keywords: intent.keywords || [],
        missing_fields: missing,
        updated_fields: updatedFields,
        recommendation: null,
        suggestions: [],
        state_revision: stateRevision,
        elapsed_ms: Math.round(performance.now() - started),
      });
    }
    if (Object.keys(errors).length || missing.length) {
      return res.set('Cache-Control', 'no-store').json({
        assistant_status: 'needs_clarification',
        reply: clarificationReply(missing, errors, locale),
        resolved_query: draft,
        criteria: { conditions: draft, preferences: intent.keywords || [] },
        keywords: intent.keywords || [],
        missing_fields: missing,
        updated_fields: updatedFields,
        recommendation: null,
        suggestions: [],
        state_revision: stateRevision,
        elapsed_ms: Math.round(performance.now() - started),
      });
    }
    if (!updatedFields.length && intent.action === 'update') {
      return res.set('Cache-Control', 'no-store').json({
        assistant_status: 'needs_clarification',
        reply: text(locale, 'update'),
        resolved_query: draft,
        criteria: { conditions: draft, preferences: intent.keywords || [] },
        keywords: intent.keywords || [],
        missing_fields: [],
        updated_fields: [],
        recommendation: null,
        suggestions: [],
        state_revision: stateRevision,
        elapsed_ms: Math.round(performance.now() - started),
      });
    }

    const query = completeQuery(draft, dataset.meta);
    if (!query) throw new InputError({ message: 'Проверьте распознанные условия' });
    const keywords = Array.isArray(intent.keywords) ? intent.keywords.slice(0, 12) : [];
    const recommendation = await recommend(query, { includeSuggestions: true, keywords, locale });
    let reply;
    if (intent.action === 'compare') reply = comparisonReply(recommendation.cards, locale);
    else if (recommendation.status === 'matched') reply = text(locale, 'matched', { count: recommendation.counts.eligible });
    else if (recommendation.status === 'category_absent') reply = text(locale, 'category_absent');
    else if (recommendation.suggestions.length) reply = text(locale, 'suggestions');
    else reply = text(locale, 'no_matches');

    res.set('Cache-Control', 'no-store').json({
      assistant_status: intent.action === 'compare' ? 'explained' : 'results',
      reply,
      resolved_query: query,
      criteria: { conditions: query, preferences: keywords },
      keywords,
      missing_fields: [],
      updated_fields: updatedFields,
      recommendation,
      suggestions: recommendation.suggestions,
      state_revision: stateRevision,
      elapsed_ms: Math.round(performance.now() - started),
    });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found', message: 'Такого API-адреса нет' }));
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
  app.use((error, _req, res, _next) => {
    if (error instanceof InputError) return res.status(400).json({ error: 'invalid_input', message: error.message, fields: error.fields });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json', message: 'Некорректный JSON' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'Слишком большой запрос' });
    console.error('Ошибка обработки запроса');
    res.status(500).json({ error: 'server_error', message: 'Не удалось выполнить подбор. Попробуйте ещё раз.' });
  });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  const server = createApp().listen(port, host);
  server.once('listening', () => console.log(`EventMatch: http://${host}:${port}`));
  server.once('error', error => {
    console.error(`Не удалось запустить EventMatch на ${host}:${port}: ${error.message}`);
    process.exitCode = 1;
  });
  const closeServer = () => server.close(() => process.exit(0));
  process.once('SIGINT', closeServer);
  process.once('SIGTERM', closeServer);
}
