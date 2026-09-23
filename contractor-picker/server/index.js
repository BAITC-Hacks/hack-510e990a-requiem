import express from 'express';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadDataset } from './dataset.js';
import { validateQuery, matchProfiles, InputError } from './matching.js';
import { createExplainer } from './ai.js';

export function createApp({ dataset = loadDataset(), explain = createExplainer({
  apiKey: process.env.OPENAI_API_KEY || '', model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  timeoutMs: Math.min(7000, Math.max(500, Number(process.env.AI_TIMEOUT_MS) || 5000)),
}) } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  app.get('/api/meta', (_req, res) => res.json({ ...dataset.meta, dataset_version: dataset.version }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', profiles: dataset.profiles.length, dataset_version: dataset.version }));
  app.post('/api/recommend', async (req, res) => {
    const started = performance.now();
    const query = validateQuery(req.body, dataset.meta);
    const result = matchProfiles(dataset.profiles, query);
    const { selected, ...summary } = result;
    const explanations = await explain(selected, query, dataset.version);
    res.set('Cache-Control', 'no-store').json({ ...summary, ...explanations, query, dataset_version: dataset.version, elapsed_ms: Math.round(performance.now() - started) });
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
  createApp().listen(port, host, () => console.log(`EventMatch: http://${host}:${port}`));
}
