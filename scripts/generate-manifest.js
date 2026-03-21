#!/usr/bin/env node
/**
 * scripts/generate-manifest.js
 *
 * Сканує папку зі знімками та генерує snapshots-manifest.json.
 *
 * Використання:
 *   node scripts/generate-manifest.js
 *   node scripts/generate-manifest.js --dir data/snapshots --out snapshots-manifest.json
 *
 * Аргументи (всі опціональні):
 *   --dir  <шлях>  — папка зі знімками  (за замовчуванням: ./snapshots)
 *   --out  <шлях>  — куди зберегти маніфест (за замовчуванням: ./snapshots-manifest.json)
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, basename }                              from 'node:path';

// ─── Parse CLI args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = key => {
  const idx = args.indexOf(key);
  return idx !== -1 ? args[idx + 1] : null;
};

const SNAPSHOTS_DIR = resolve(getArg('--dir') ?? '../snapshots');
const OUT_FILE      = resolve(getArg('--out') ?? '../data/snapshots-manifest.json');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Українська назва місяця (short) */
const MONTHS_UA = [
  'січ.', 'лют.', 'бер.', 'квіт.', 'трав.', 'черв.',
  'лип.', 'серп.', 'вер.',  'жовт.', 'лист.', 'груд.',
];

function makeLabel(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return `${day} ${MONTHS_UA[month - 1]} ${year}`;
}

/**
 * Намагається прочитати дату зі знімку.
 * Пріоритет: поле `date` всередині JSON → ім'я файлу.
 */
function extractDate(filePath) {
  try {
    const raw  = readFileSync(filePath, 'utf8');
    const json = JSON.parse(raw);
    if (json.date && /^\d{4}-\d{2}-\d{2}$/.test(json.date)) return json.date;
  } catch {
    // ignore parse errors — fallback to filename
  }

  // Спробуємо витягнути дату з імені файлу (підтримує: 2007-08-26.json)
  const match = basename(filePath).match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (!existsSync(SNAPSHOTS_DIR)) {
  console.error(`❌ Папка не існує: ${SNAPSHOTS_DIR}`);
  process.exit(1);
}

const files = readdirSync(SNAPSHOTS_DIR)
  .filter(f => f.endsWith('.json'))
  .toSorted();                          // лексикографічно = хронологічно для YYYY-MM-DD

const entries = [];

for (const file of files) {
  const filePath = join(SNAPSHOTS_DIR, file);
  const date     = extractDate(filePath);

  if (!date) {
    console.warn(`⚠️  Пропускаємо "${file}" — не вдалося визначити дату`);
    continue;
  }

  // Перевірка на порожній знімок
  let animeCount = 0;
  try {
    const json = JSON.parse(readFileSync(filePath, 'utf8'));
    animeCount = Array.isArray(json.anime) ? json.anime.length : 0;
  } catch {
    // якщо не вдалося розпарсити — вже попередили в extractDate, пропускаємо
  }

  if (animeCount === 0) {
    console.warn(`⚠️  Пропускаємо "${file}" — порожній знімок (0 аніме)`);
    continue;
  }

  entries.push({
    date,
    file:  `snapshots/${file}`,
    label: makeLabel(date),
  });
}

// Сортуємо хронологічно на випадок якщо файли були не по порядку
entries.sort((a, b) => new Date(a.date) - new Date(b.date));

writeFileSync(OUT_FILE, JSON.stringify({ snapshots: entries }, null, 2), 'utf8');

console.log(`✅ Маніфест збережено: ${OUT_FILE}`);
console.log(`   Знімків: ${entries.length}`);
if (entries.length) {
  console.log(`   Діапазон: ${entries.at(0).date} → ${entries.at(-1).date}`);
}