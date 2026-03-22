/**
 * data-loader.js — Fetch + cache snapshot and enriched anime data
 *
 * Знімки беруться з snapshots-manifest.json (генерується скриптом
 * scripts/generate-manifest.js). Файл CONFIG.snapshots більше не
 * потрібно оновлювати вручну.
 */

import { CONFIG } from './config.js';

/** In-memory cache: url → parsed JSON */
const _cache = new Map();

async function fetchJSON(path) {
  if (_cache.has(path)) return _cache.get(path);

  const response = await fetch(path);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} при завантаженні "${path}"`);
  }

  const data = await response.json();
  _cache.set(path, data);
  return data;
}

/**
 * Завантажує маніфест знімків (згенерований скриптом).
 * Маніфест — JSON-файл формату { snapshots: [{ date, file, label }] }.
 *
 * @returns {Promise<{ date: string, file: string, label: string }[]>}
 */
async function loadManifest() {
  const manifest = await fetchJSON(`${CONFIG.dataDir}${CONFIG.manifestFile}`);
  if (!Array.isArray(manifest.snapshots)) {
    throw new Error(`Маніфест "${CONFIG.manifestFile}" не містить масиву snapshots.`);
  }
  return manifest.snapshots;
}

/**
 * Завантажує один знімок за об'єктом з маніфесту.
 * @param {{ file: string, date: string, label: string }} entry
 * @returns {Promise<object>}
 */
async function loadSnapshot(entry) {
  return fetchJSON(`${CONFIG.dataDir}${entry.file}`);
}

/**
 * Завантажує збагачені дані аніме (UA назви, постери, тип).
 * @returns {Promise<object[]>}
 */
export async function loadEnrichedData() {
  return fetchJSON(`${CONFIG.dataDir}${CONFIG.enrichedFile}`);
}

/** Максимум паралельних fetch-запитів за раз */
const BATCH_SIZE = 8;

/**
 * Promise.allSettled пачками по BATCH_SIZE — не вішає браузер
 * при великій кількості знімків.
 */
async function allSettledBatched(items, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = await Promise.allSettled(items.slice(i, i + BATCH_SIZE).map(fn));
    results.push(...chunk);
  }
  return results;
}

/**
 * Головна функція: завантажує маніфест, потім знімки пачками по BATCH_SIZE.
 * Невдалі знімки пропускаються з попередженням у консолі.
 *
 * @returns {Promise<{ snapshots: object[], enriched: object[] }>}
 */
export async function loadAll() {
  const manifestEntries = await loadManifest();

  // Збагачені дані та знімки завантажуємо окремо:
  // allSettledBatched вже повертає SettledResult[] — не можна мішати з Promise.allSettled
  const [enrichedResult]  = await Promise.allSettled([loadEnrichedData()]);
  const snapshotResults   = await allSettledBatched(manifestEntries, loadSnapshot);

  const enriched =
    enrichedResult.status === 'fulfilled'
      ? enrichedResult.value
      : (console.warn('⚠️ Збагачені дані недоступні:', enrichedResult.reason), []);

  const snapshots = snapshotResults
    .map((result, i) => {
      const entry = manifestEntries[i];
      if (result.status === 'fulfilled') {
        const data = result.value;
        if (!data.date) data.date = entry.date;
        return { ...data, config: entry };
      }
      console.warn(`⚠️ Пропущено знімок "${entry.file}":`, result.reason);
      return null;
    })
    .filter(Boolean)
    .toSorted((a, b) => new Date(a.date) - new Date(b.date));

  return { snapshots, enriched };
}