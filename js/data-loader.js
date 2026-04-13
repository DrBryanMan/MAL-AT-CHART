// data-loader.js
import { CONFIG } from './config.js';

const _cache = new Map();

async function fetchJSON(path) {
  if (_cache.has(path)) return _cache.get(path);
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} при завантаженні "${path}"`);
  const data = await resp.json();
  _cache.set(path, data);
  return data;
}

function getSourcePaths(source) {
  if (source === 'hikka') return {
    indexUrl:     `${CONFIG.dataDir}${CONFIG.hikkaSnapshotsIndexFile}`,
    analyticsUrl: `${CONFIG.dataDir}${CONFIG.hikkaAnalyticsFile}`,
    snapshotsDir: CONFIG.hikkaSnapshotsDir,
    fullSnapshotsDir: CONFIG.hikkaFullSnapshotsDir,
  };
  return {
    indexUrl:     `${CONFIG.dataDir}${CONFIG.snapshotsIndexFile}`,
    analyticsUrl: `${CONFIG.dataDir}${CONFIG.analyticsFile}`,
    snapshotsDir: CONFIG.snapshotsDir,
  };
}

/** Нормалізує MAL-знімок + fallback members → scored_by (для рендеру та всіх розрахунків) */
function normalizeMALSnapshot(snap) {
  return {
    ...snap,
    date: snap.date ?? snap.date_scraped ?? null,
    anime: (snap.anime ?? []).map(a => ({
      id:       a.id,
      title:    a.title ?? '',
      title_ua: a.title_ua ?? null,
      score:    a.score,
      scored_by:a.scored_by ?? 0,
      members:  a.members ?? 0,
    })),
  };
}

/** Нормалізує Hikka-знімок: score = сира оцінка, weightedScore = нативна оцінка Hikka */
function normalizeHikkaSnapshot(snap) {
  return {
    ...snap,
    date: snap.date ?? snap.date_scraped ?? null,
    anime: (snap.anime ?? []).map(a => ({
      id:       a.id,
      slug:     a.slug,
      title:    a.title_en ?? a.title ?? a.title_ja ?? '',
      title_ua: a.title_ua ?? null,
      score:    a.score ?? a.weighted_score ?? null,
      weightedScore: a.weighted_score ?? null,
      scored_by:a.scored_by ?? 0,
      members:  a.members ?? 0,
    })),
  };
}

// ── Публічне API ──────────────────────────────────────────────────────────────

export async function loadSnapshotsIndex(source = 'mal') {
  const { indexUrl } = getSourcePaths(source);
  const { snapshots } = await fetchJSON(indexUrl);
  return snapshots;
}

export async function loadSnapshot(date, source = 'mal') {
  const { snapshotsDir } = getSourcePaths(source);
  
  if (source === 'hikka') {
    const snap = await fetchJSON(`${snapshotsDir}${date}.json`);
    return normalizeHikkaSnapshot(snap);
  }
  const snap = await fetchJSON(`${snapshotsDir}${date}.json`);
  return normalizeMALSnapshot(snap);   // MAL тепер завжди нормалізується з fallback
}

export async function loadSnapshotPair(dates, index, source = 'mal') {
  const [current, prev] = await Promise.all([
    loadSnapshot(dates[index], source),
    index > 0 ? loadSnapshot(dates[index - 1], source) : Promise.resolve(null),
  ]);
  return { current, prev };
}

export async function loadEnrichedData() {
  return fetchJSON(`${CONFIG.dataDir}${CONFIG.enrichedFile}`);
}

export async function loadAnalytics(source = 'mal') {
  const { analyticsUrl } = getSourcePaths(source);
  return fetchJSON(analyticsUrl);
}

export async function loadAll(source = 'mal') {
  const [indexResult, analyticsResult, enrichedResult] = await Promise.allSettled([
    loadSnapshotsIndex(source),
    loadAnalytics(source),
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
