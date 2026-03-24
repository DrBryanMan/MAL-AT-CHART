/**
 * config.js — Centralized configuration for MAL Charts
 *
 * Знімки більше не перелічуються тут вручну.
 * Вони автоматично беруться з snapshots-manifest.json,
 * який генерується командою:
 *
 *   node scripts/generate-manifest.js
 *
 * Запускай скрипт після додавання нових файлів до папки snapshots/.
 */

export const CONFIG = {
  dataDir:             'data/',
  
  // MAL
  snapshotsDir:        'snapshots/anime-mal/',
  enrichedFile:        'anime_enriched.json',
  analyticsFile:       'analytics.json',
  snapshotsIndexFile:  'snapshots-index.json',
  chartLimit:          50,
  currentMode:         'mal',

  modes: {
    mal: {
      snapshotsDir:       'snapshots/anime-mal/',
      analyticsFile:      'analytics.json',
      snapshotsIndexFile: 'snapshots-index.json',
      chartLimit:         50,
    },
    hikka: {
      snapshotsDir:       'snapshots/anime-hikka/',
      analyticsFile:      'analytics-hikka.json',
      snapshotsIndexFile: 'snapshots-index-hikka.json',
      chartLimit:         50,
    },
  },

  thresholds: {
    topRated: 9.0,
    notable:  9.0,
  },

  // Hikka
  hikkaSnapshotsDir:        'snapshots/anime-hikka/',
  hikkaAnalyticsFile:       'analytics-hikka.json',
  hikkaSnapshotsIndexFile:  'snapshots-index-hikka.json',

  hikkaThresholds: {
    topRated: 8.0,
    notable:  8.0,
  },

  // Manga — TODO: додати після появи скрапера

  stableTopN: 10,

  categoryLabels: {
    tv:      'TV Серіал',
    movie:   'Фільм',
    ova:     'OVA',
    ona:     'ONA',
    special: 'Спешл',
    music:   'Музика',
    unknown: 'Невідомо',
  },

  categoryIcons: {
      tv:      'tv',
      movie:   'film',
      ova:     'video',
      ona:     'globe',
      special: 'zap',
      music:   'music',
      unknown: 'help-circle',
  },

  categoryOrder: ['tv', 'movie', 'ova', 'ona', 'special', 'music', 'unknown'],

  infoTexts: {
    chart:
      'Повний рейтинґ MAL на обрану дату. Переключайтесь кнопками ‹ › або клавішами ←→. Зміни показані відносно попереднього знімку. Дата-посилання відкриває архів MAL на web.archive.org.',
    categories:
      'Послідовність аніме, що утримували ТОП-1 у своїй категорії (з оцінкою ≥ 9.0). Формат: Назва / перша оцінка (максимальна) / дата першої появи та останньої. [N] — скільки разів аніме поверталося до вершини. Таб "Усі" — загальний ТОП-1 незалежно від категорії.',
    events:
      'Три картки з рекордними досягненнями та чотири таби з детальними списками на основі всієї доступної архівної історії. Якщо аніме за форматом повторює переможця — воно не показується.',
    highestEver:
      'Аніме, яке отримало абсолютно найвищу оцінку за всю наявну архівну історію. Нижче — призери та переможці категорій.',
    lowestEver:
      'Аніме, яке отримало найнижчу оцінку за всю наявну архівну історію серед оцінених тайтлів.',
    mostMembers:
      'Аніме, яце оцінили найбільша кількість людей.',
    stableScore:
      'Аніме, у якого оцінка не змінювалася найдовший час. Показує точний діапазон дат і кількість днів. Нижче — призери та переможці категорій.',
    longestTop1:
      'Аніме, що провело найбільше календарних днів на першому місці і його ніхто не посунув. Нижче — призери та переможці категорій.',
    allAbove9:
      'Усі тайтли, що хоч раз мали оцінку ≥ 9.0. Відсортовано за максимальною досягнутою оцінкою. Дата — коли було досягнуто такої оцінки.',
    top1History:
      'Кожен аніме-тайтл, що хоч раз був на першому місці рейтинґу. [N] — кількість окремих "заходів" на вершину (не знімків). В дужках — максимальна оцінка під час перебування на #1.',
    stableTop:
      'Найдовший безперервний проміжок, протягом якого перші N позицій рейтинґу не змінювали порядку (оцінки могли змінюватись). Показується найбільше N, при якому досягнуто максимальна стабільність.',
    mostAtOnce:
      'Момент, у якому одночасно найбільша кількість аніме мала оцінку ≥ 9.0.',
  },
};

export function applyMode(mode) {
  const m = CONFIG.modes[mode] ?? CONFIG.modes.mal;
  CONFIG.snapshotsDir       = m.snapshotsDir;
  CONFIG.analyticsFile      = m.analyticsFile;
  CONFIG.snapshotsIndexFile = m.snapshotsIndexFile;
  CONFIG.chartLimit         = m.chartLimit;
  CONFIG.currentMode        = mode;
}