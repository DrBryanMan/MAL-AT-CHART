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
  };
  return {
    indexUrl:     `${CONFIG.dataDir}${CONFIG.snapshotsIndexFile}`,
    analyticsUrl: `${CONFIG.dataDir}${CONFIG.analyticsFile}`,
    snapshotsDir: CONFIG.snapshotsDir,
  };
}

/** Нормалізує сирий знімок Хікки до єдиного формату */
function normalizeHikkaSnapshot(snap) {
  return {
    ...snap,
    anime: (snap.anime ?? []).map(a => ({
      id:       a.id,
      slug:     a.slug,
      title:    a.title_en ?? a.title_ja,
      title_ua: a.title_ua ?? null,
      score:    a.score,
      members:  a.members,
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
  const snap = await fetchJSON(`${snapshotsDir}${date}.json`);
  return source === 'hikka' ? normalizeHikkaSnapshot(snap) : snap;
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