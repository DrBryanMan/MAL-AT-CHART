/**
 * scripts/precompute.js
 *
 * Завантажує всі снепшоти + збагачені дані, запускає всі обрахунки
 * з analytics.js і зберігає результат у data/analytics.json.
 *
 * Запуск: node scripts/precompute.js
 *
 * Генерує:
 *   data/analytics.json   — всі обраховані дані (секції 2 і 3)
 *   data/snapshots-index.json — список дат снепшотів (для навігації)
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildEnrichedMap, computeAll } from '../js/analytics.js';
import { CONFIG } from '../js/config.js';

const __dir     = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dir, '..');
const DATA_DIR  = join(ROOT, CONFIG.dataDir);
const SNAPS_DIR = join(ROOT, CONFIG.snapshotsDir);

// ── Завантаження ──────────────────────────────────────────────────────────────

function loadJSON(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function loadSnapshots() {
  const files = readdirSync(SNAPS_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();

  const snapshots = [];

  for (const file of files) {
    try {
      const data = loadJSON(join(SNAPS_DIR, file));
      if (!data.date) data.date = file.replace('.json', '');
      // Нормалізуємо поля — analytics.js очікує { id, score, members, title }
      if (Array.isArray(data.anime)) {
        data.anime = data.anime.map(a => ({
          id:      a.id,
          title:   a.title ?? '',
          score:   a.score,
          members: a.members,
        }));
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

// ── Головна функція ───────────────────────────────────────────────────────────

function main() {
  console.log('▶  Завантаження снепшотів…');
  const snapshots = loadSnapshots();
  console.log(`   ✔  ${snapshots.length} снепшотів`);

  console.log('▶  Завантаження збагачених даних…');
  const enriched    = loadEnriched();
  const enrichedMap = buildEnrichedMap(enriched);
  console.log(`   ✔  ${enriched.length} тайтлів`);

  console.log('▶  Обрахунки…');
  const analytics = computeAll(snapshots, enrichedMap, CONFIG.thresholds.topRated);
  console.log('   ✔  Готово');

  // ── Зберігаємо analytics.json ──────────────────────────────────────────────
  const analyticsPath = join(DATA_DIR, 'analytics.json');
  writeFileSync(analyticsPath, JSON.stringify(analytics, null, 2), 'utf-8');
  const sizeKB = (readFileSync(analyticsPath).length / 1024).toFixed(1);
  console.log(`\n💾  analytics.json → ${sizeKB} KB`);

  // ── Зберігаємо snapshots-index.json (список дат для навігації) ─────────────
  const index = snapshots.map(s => ({
    date:      s.date,
    timestamp: s.timestamp ?? '',
    label:     s.config?.label ?? s.date,
    total:     s.total ?? s.anime?.length ?? 0,
  }));

  const indexPath = join(DATA_DIR, 'snapshots-index.json');
  writeFileSync(indexPath, JSON.stringify({ snapshots: index }, null, 2), 'utf-8');
  const indexKB = (readFileSync(indexPath).length / 1024).toFixed(1);
  console.log(`💾  snapshots-index.json → ${indexKB} KB`);

  console.log(`\n✅  Готово! Снепшотів: ${snapshots.length}`);
}

main();