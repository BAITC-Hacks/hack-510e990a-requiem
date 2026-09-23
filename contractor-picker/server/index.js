import express from 'express';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadDataset } from './dataset.js';
import { validateQuery, InputError } from './matching.js';
import { createExplainer } from './ai.js';
import { createAssistantParser, applyAssistantPatches, missingFields, clarificationReply, comparisonReply, completeQuery } from './assistant.js';
import { createRecommendationService } from './recommendations.js';

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
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', profiles: dataset.profiles.length, dataset_version: dataset.version, assistant_configured: Boolean(process.env.OPENAI_API_KEY) }));
  app.post('/api/recommend', async (req, res) => {
    const started = performance.now();
    const query = validateQuery(req.body, dataset.meta);
    const result = await recommend(query, { includeSuggestions: true });
    res.set('Cache-Control', 'no-store').json({ ...result, elapsed_ms: Math.round(performance.now() - started) });
  });
  app.post('/api/assistant', async (req, res) => {
    const started = performance.now();
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message || message.length > 1000) throw new InputError({ message: 'Введите сообщение длиной от 1 до 1000 символов' });
    const stateRevision = Number.isSafeInteger(req.body.state_revision) ? req.body.state_revision : 0;
    let intent;
    try {
      intent = await parseAssistant({ message, currentQuery: req.body.current_query || {}, meta: dataset.meta });
    } catch {
      return res.status(503).set('Cache-Control', 'no-store').json({
        error: 'assistant_unavailable',
        message: 'AI-ассистент временно недоступен. Вы по-прежнему можете выполнить подбор через форму.',
        state_revision: stateRevision,
      });
    }

    const { draft, updatedFields, errors } = applyAssistantPatches(req.body.current_query, intent, dataset.meta);
    const missing = missingFields(draft);
    if (intent.action === 'help') {
      return res.set('Cache-Control', 'no-store').json({
        assistant_status: 'explained',
        reply: 'Опишите подрядчика, город, дату, формат мероприятия и бюджет. Я заполню форму; язык и длительность можно добавить по желанию.',
        resolved_query: draft,
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
        reply: clarificationReply(missing, errors),
        resolved_query: draft,
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
        reply: 'Уточните, какое условие изменить. Для бюджета укажите точную максимальную сумму.',
        resolved_query: draft,
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
    const recommendation = await recommend(query, { includeSuggestions: true });
    let reply;
    if (intent.action === 'compare') reply = comparisonReply(recommendation.cards);
    else if (recommendation.status === 'matched') reply = `Нашёл подходящих вариантов: ${recommendation.counts.eligible}. Показываю до трёх по возрастанию начальной цены.`;
    else if (recommendation.status === 'category_absent') reply = 'В выбранном городе этой категории пока нет. Изменение даты или бюджета не поможет.';
    else if (recommendation.suggestions.length) reply = 'Точных совпадений нет. Я проверил изменения даты и бюджета — ниже есть варианты, которые действительно дают результат.';
    else reply = 'Точных совпадений нет, и изменение только даты или бюджета не решает все ограничения. Проверьте формат, язык или длительность.';

    res.set('Cache-Control', 'no-store').json({
      assistant_status: intent.action === 'compare' ? 'explained' : 'results',
      reply,
      resolved_query: query,
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
