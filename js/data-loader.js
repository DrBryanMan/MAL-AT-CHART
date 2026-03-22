/**
 * data-loader.js — Завантаження даних для MAL Charts
 *
 * Схема:
 *   analytics.json      — всі обраховані дані (секції 2 і 3), генерується precompute.js
 *   snapshots-index.json — список дат снепшотів для навігації
 *   snapshots/YYYY-MM-DD.json — окремі снепшоти, завантажуються ліниво
 *
 * Переваги:
 *   - При завантаженні сторінки тягнемо лише 2 файли (~100-300 KB)
 *   - Снепшоти завантажуються по одному при перемиканні дати (~5-20 KB кожен)
 *   - In-memory кеш: повторне відвідування тієї ж дати без мережевого запиту
 */

import { CONFIG } from './config.js';

/** In-memory кеш: url → parsed JSON */
const _cache = new Map();

async function fetchJSON(path) {
  if (_cache.has(path)) return _cache.get(path);
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} при завантаженні "${path}"`);
  const data = await resp.json();
  _cache.set(path, data);
  return data;
}

// ── Публічне API ──────────────────────────────────────────────────────────────

/**
 * Завантажує індекс снепшотів (список дат).
 * @returns {Promise<{ date, timestamp, label, total }[]>}
 */
export async function loadSnapshotsIndex() {
  const { snapshots } = await fetchJSON(`${CONFIG.dataDir}${CONFIG.snapshotsIndexFile}`);
  return snapshots;
}

/**
 * Завантажує один снепшот за датою.
 * Результат кешується — повторний виклик з тією ж датою не робить мережевого запиту.
 * @param {string} date  YYYY-MM-DD
 * @returns {Promise<object>}
 */
export async function loadSnapshot(date) {
  return fetchJSON(`${CONFIG.dataDir}snapshots/${date}.json`);
}

/**
 * Завантажує пару снепшотів (поточний + попередній) для секції 1.
 * @param {string[]} dates  масив всіх дат відсортованих хронологічно
 * @param {number}   index  індекс поточного снепшота
 * @returns {Promise<{ current: object, prev: object|null }>}
 */
export async function loadSnapshotPair(dates, index) {
  const [current, prev] = await Promise.all([
    loadSnapshot(dates[index]),
    index > 0 ? loadSnapshot(dates[index - 1]) : Promise.resolve(null),
  ]);
  return { current, prev };
}

/**
 * Завантажує збагачені дані аніме (UA назви, постери, тип).
 * @returns {Promise<object[]>}
 */
export async function loadEnrichedData() {
  return fetchJSON(`${CONFIG.dataDir}${CONFIG.enrichedFile}`);
}

/**
 * Завантажує попередньо обраховані аналітичні дані (секції 2 і 3).
 * @returns {Promise<object>}
 */
export async function loadAnalytics() {
  return fetchJSON(`${CONFIG.dataDir}${CONFIG.analyticsFile}`);
}

/**
 * Головна функція ініціалізації.
 * Завантажує лише легкі файли — індекс і аналітику.
 * Окремі снепшоти завантажуються ліниво через loadSnapshot() / loadSnapshotPair().
 *
 * @returns {Promise<{
 *   index:     { date, timestamp, label, total }[],
 *   analytics: object,
 *   enriched:  object[],
 * }>}
 */
export async function loadAll() {
  const [indexResult, analyticsResult, enrichedResult] = await Promise.allSettled([
    loadSnapshotsIndex(),
    loadAnalytics(),
    loadEnrichedData(),
  ]);

  const index = indexResult.status === 'fulfilled'
    ? indexResult.value
    : (console.warn('⚠️  Індекс снепшотів недоступний:', indexResult.reason), []);

  const analytics = analyticsResult.status === 'fulfilled'
    ? analyticsResult.value
    : (console.warn('⚠️  Аналітика недоступна:', analyticsResult.reason), null);

  const enriched = enrichedResult.status === 'fulfilled'
    ? enrichedResult.value
    : (console.warn('⚠️  Збагачені дані недоступні:', enrichedResult.reason), []);

  return { index, analytics, enriched };
}