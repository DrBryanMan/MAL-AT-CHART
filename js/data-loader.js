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

/**
 * Головна функція: завантажує маніфест, потім паралельно всі знімки
 * та збагачені дані. Невдалі знімки пропускаються з попередженням.
 *
 * @returns {Promise<{ snapshots: object[], enriched: object[] }>}
 */
export async function loadAll() {
  // Спочатку маніфест (без нього нема сенсу продовжувати)
  const manifestEntries = await loadManifest();

  const [enrichedResult, ...snapshotResults] = await Promise.allSettled([
    loadEnrichedData(),
    ...manifestEntries.map(loadSnapshot),
  ]);

  // Збагачені дані (не критично якщо відсутні)
  const enriched =
    enrichedResult.status === 'fulfilled'
      ? enrichedResult.value
      : (console.warn('⚠️ Збагачені дані недоступні:', enrichedResult.reason), []);

  // Знімки — пропускаємо невдалі, зберігаємо мета-дані з маніфесту
  const snapshots = snapshotResults
    .map((result, i) => {
      const entry = manifestEntries[i];
      if (result.status === 'fulfilled') {
        // Гарантуємо наявність поля date навіть якщо у файлі його немає
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