// precompute.js
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
    isHikka:      false,
  },
  {
    name:         'Hikka',
    snapshotsDir: join(ROOT, CONFIG.hikkaSnapshotsDir),
    analyticsOut: join(DATA_DIR, CONFIG.hikkaAnalyticsFile),
    indexOut:     join(DATA_DIR, CONFIG.hikkaSnapshotsIndexFile),
    isHikka:      true,
  },
];

function loadJSON(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function normalizeAnimeForPrecompute(a, isHikka) {
  if (isHikka) {
    return {
      id:        a.id,
      title:     a.title_en ?? a.title ?? a.title_ja ?? '',
      score:     a.weighted_score ?? a.score,
      scored_by: a.scored_by ?? 0,
      members:   a.members ?? 0,
    };
  }

  return {
    id:        a.id,
    title:     a.title ?? '',
    score:     a.score,
    scored_by: a.scored_by ?? 0,
    members:   a.members ?? a.scored_by ?? 0,
  };
}
function loadSnapshots(snapshotsDir, isHikka) {
  if (!existsSync(snapshotsDir)) {
    console.warn(`âš ï¸  Ð”Ð¸Ñ€ÐµÐºÑ‚Ð¾Ñ€Ñ–Ñ Ð½Ðµ Ñ–ÑÐ½ÑƒÑ”: ${snapshotsDir}`);
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
        data.anime = data.anime.map(a => normalizeAnimeForPrecompute(a, isHikka));
      }
      snapshots.push(data);
    } catch (e) {
      console.warn(`âš ï¸  ÐŸÑ€Ð¾Ð¿ÑƒÑ‰ÐµÐ½Ð¾ ${file}: ${e.message}`);
    }
  }

  return snapshots.sort((a, b) => a.date.localeCompare(b.date));
}

function loadEnriched() {
  const path = join(DATA_DIR, CONFIG.enrichedFile);
  try {
    return loadJSON(path);
  } catch {
    console.warn(`âš ï¸  Ð—Ð±Ð°Ð³Ð°Ñ‡ÐµÐ½Ñ– Ð´Ð°Ð½Ñ– Ð½Ðµ Ð·Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾: ${path}`);
    return [];
  }
}

function processSource(source, enrichedMap) {
  console.log(`\nâ”€â”€ ${source.name} ${'â”€'.repeat(40 - source.name.length)}`);

  console.log('â–¶  Ð—Ð°Ð²Ð°Ð½Ñ‚Ð°Ð¶ÐµÐ½Ð½Ñ ÑÐ½ÐµÐ¿ÑˆÐ¾Ñ‚Ñ–Ð²â€¦');
  const snapshots = loadSnapshots(source.snapshotsDir, source.isHikka);
  
  if (!snapshots.length) {
    console.warn('   âš ï¸  Ð¡Ð½ÐµÐ¿ÑˆÐ¾Ñ‚Ñ–Ð² Ð½Ðµ Ð·Ð½Ð°Ð¹Ð´ÐµÐ½Ð¾, Ð¿Ñ€Ð¾Ð¿ÑƒÑÐºÐ°Ñ”Ð¼Ð¾.');
    return;
  }
  console.log(`   âœ”  ${snapshots.length} ÑÐ½ÐµÐ¿ÑˆÐ¾Ñ‚Ñ–Ð²`);

  console.log('â–¶  ÐžÐ±Ñ€Ð°Ñ…ÑƒÐ½ÐºÐ¸ Ð°Ð½Ð°Ð»Ñ–Ñ‚Ð¸ÐºÐ¸â€¦');
  // Ð”Ð»Ñ Hikka Ð¿Ð¾Ñ€Ñ–Ð³ Ð¼Ð¾Ð¶Ð½Ð° Ð·Ñ€Ð¾Ð±Ð¸Ñ‚Ð¸ Ð½Ð¸Ð¶Ñ‡Ð¸Ð¼, ÑÐºÑ‰Ð¾ Ð¿Ð¾Ñ‚Ñ€Ñ–Ð±Ð½Ð¾
  const threshold = source.isHikka 
    ? CONFIG.hikkaThresholds?.topRated ?? 8.0 
    : CONFIG.thresholds.topRated;

  const analytics = computeAll(snapshots, enrichedMap, threshold);
  console.log('   âœ”  ÐÐ½Ð°Ð»Ñ–Ñ‚Ð¸ÐºÐ° Ð³Ð¾Ñ‚Ð¾Ð²Ð°');

  writeFileSync(source.analyticsOut, JSON.stringify(analytics, null, 2), 'utf-8');
  const analyticsKB = (readFileSync(source.analyticsOut).length / 1024).toFixed(1);
  console.log(`ðŸ’¾  ${source.analyticsOut.split(/[/\\]/).at(-1)} â†’ ${analyticsKB} KB`);

  const index = snapshots.map(s => ({
    date:      s.date,
    timestamp: s.timestamp ?? '',
    label:     s.config?.label ?? s.date,
    total:     s.total ?? s.anime?.length ?? 0,
  }));

  writeFileSync(source.indexOut, JSON.stringify({ snapshots: index }, null, 2), 'utf-8');
  const indexKB = (readFileSync(source.indexOut).length / 1024).toFixed(1);
  console.log(`ðŸ’¾  ${source.indexOut.split(/[/\\]/).at(-1)} â†’ ${indexKB} KB`);

  console.log(`âœ…  ${source.name}: ${snapshots.length} ÑÐ½ÐµÐ¿ÑˆÐ¾Ñ‚Ñ–Ð² Ð¾Ð±Ñ€Ð¾Ð±Ð»ÐµÐ½Ð¾`);
}

function main() {
  console.log('â–¶  Ð—Ð°Ð²Ð°Ð½Ñ‚Ð°Ð¶ÐµÐ½Ð½Ñ Ð·Ð±Ð°Ð³Ð°Ñ‡ÐµÐ½Ð¸Ñ… Ð´Ð°Ð½Ð¸Ñ…â€¦');
  const enriched    = loadEnriched();
  const enrichedMap = buildEnrichedMap(enriched);
  console.log(`   âœ”  ${enriched.length} Ñ‚Ð°Ð¹Ñ‚Ð»Ñ–Ð²`);

  for (const source of SOURCES) {
    processSource(source, enrichedMap);
  }

  console.log('\nâœ…  ÐŸÐ°Ð¹Ð¿Ð»Ð°Ð¹Ð½ Ð·Ð°Ð²ÐµÑ€ÑˆÐµÐ½Ð¾.');
}

main();