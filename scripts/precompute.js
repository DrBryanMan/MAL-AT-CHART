import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildEnrichedMap, computeAll } from '../js/analytics.js';
import { CONFIG } from '../js/config.js';

const __dir    = dirname(fileURLToPath(import.meta.url));
const ROOT     = join(__dir, '..');
const DATA_DIR = join(ROOT, CONFIG.dataDir);

const SOURCES = [
  {
    name:         'MAL',
    snapshotsDir: join(ROOT, CONFIG.snapshotsDir),
    analyticsOut: join(DATA_DIR, CONFIG.analyticsFile),
    indexOut:     join(DATA_DIR, CONFIG.snapshotsIndexFile),
  },
  {
    name:         'Hikka',
    snapshotsDir: join(ROOT, CONFIG.hikkaSnapshotsDir),
    analyticsOut: join(DATA_DIR, CONFIG.hikkaAnalyticsFile),
    indexOut:     join(DATA_DIR, CONFIG.hikkaSnapshotsIndexFile),
  },
];

function loadJSON(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function normalizeAnime(a) {
  return {
    id:      a.id,
    title:   a.title ?? a.title_en ?? a.title_ua ?? '',
    score:   a.score,
    members: a.members,
  };
}

function loadSnapshots(snapshotsDir) {
  if (!existsSync(snapshotsDir)) {
    console.warn(`⚠️  Директорія не існує: ${snapshotsDir}`);
    return [];
  }

  const files = readdirSync(snapshotsDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  const snapshots = [];
  for (const file of files) {
    try {
      const data = loadJSON(join(snapshotsDir, file));
      if (!data.date) data.date = file.replace('.json', '');
      if (Array.isArray(data.anime)) {
        data.anime = data.anime.map(normalizeAnime);
      }
      snapshots.push(data);
    } catch (e) {
      console.warn(`⚠️  Пропущено ${file}: ${e.message}`);
    }
  }

  return snapshots.sort((a, b) => a.date.localeCompare(b.date));
}

function loadEnriched() {
  const path = join(DATA_DIR, CONFIG.enrichedFile);
  try {
    return loadJSON(path);
  } catch {
    console.warn(`⚠️  Збагачені дані не знайдено: ${path}`);
    return [];
  }
}

function processSource(source, enrichedMap) {
  console.log(`\n── ${source.name} ${'─'.repeat(40 - source.name.length)}`);

  console.log('▶  Завантаження снепшотів…');
  const snapshots = loadSnapshots(source.snapshotsDir);
  if (!snapshots.length) {
    console.warn('   ⚠️  Снепшотів не знайдено, пропускаємо.');
    return;
  }
  console.log(`   ✔  ${snapshots.length} снепшотів`);

  console.log('▶  Обрахунки…');
  const analytics = computeAll(snapshots, enrichedMap, CONFIG.thresholds.topRated);
  console.log('   ✔  Готово');

  writeFileSync(source.analyticsOut, JSON.stringify(analytics, null, 2), 'utf-8');
  const analyticsKB = (readFileSync(source.analyticsOut).length / 1024).toFixed(1);
  console.log(`💾  ${source.analyticsOut.split('/').at(-1)} → ${analyticsKB} KB`);

  const index = snapshots.map(s => ({
    date:      s.date,
    timestamp: s.timestamp ?? '',
    label:     s.config?.label ?? s.date,
    total:     s.total ?? s.anime?.length ?? 0,
  }));

  writeFileSync(source.indexOut, JSON.stringify({ snapshots: index }, null, 2), 'utf-8');
  const indexKB = (readFileSync(source.indexOut).length / 1024).toFixed(1);
  console.log(`💾  ${source.indexOut.split('/').at(-1)} → ${indexKB} KB`);

  console.log(`✅  ${source.name}: ${snapshots.length} снепшотів оброблено`);
}

function main() {
  console.log('▶  Завантаження збагачених даних…');
  const enriched    = loadEnriched();
  const enrichedMap = buildEnrichedMap(enriched);
  console.log(`   ✔  ${enriched.length} тайтлів`);

  for (const source of SOURCES) {
    processSource(source, enrichedMap);
  }

  console.log('\n✅  Пайплайн завершено.');
}

main();