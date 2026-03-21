/**
 * renderer.js — DOM rendering functions for MAL Charts
 *
 * Усі функції маніпулюють DOM безпосередньо через innerHTML / createElement.
 * Ніяких зовнішніх залежностей.
 */

import { CONFIG }         from './config.js';
import { computeChartData, formatDate } from './analytics.js';

// ─── Private Helpers ──────────────────────────────────────────────────────────

const $  = id => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);

/** Форматує число з пробілами як тисячний роздільник (uk-UA) */
const fmtNum = n => n.toLocaleString('uk-UA');

/** Текстове представлення дельти зі знаком */
function fmtDelta(val, decimals = 0) {
  if (val === null || val === undefined) return '';
  if (val === 0) return '±0';
  const abs  = Math.abs(val).toFixed(decimals);
  const sign = val > 0 ? '+' : '−';
  return `${sign}${abs}`;
}

/** CSS клас для позитивного/негативного значення */
function deltaClass(val) {
  if (!val || val === 0) return 'neutral';
  return val > 0 ? 'positive' : 'negative';
}

/** HTML для бейджа зміни позиції */
function rankBadgeHTML(delta, isNew) {
  if (isNew)
    return `<span class="rank-badge rank-new">New</span>`;
  if (delta === null)
    return `<span class="rank-badge rank-same">—</span>`;
  if (delta === 0)
    return `<span class="rank-badge rank-same">─</span>`;
  if (delta > 0)
    return `<span class="rank-badge rank-up">▲${delta}</span>`;
  return `<span class="rank-badge rank-down">▼${Math.abs(delta)}</span>`;
}

/** HTML для постеру аніме */
function thumbHTML(src, alt, cls = '') {
  if (!src) return `<div class="anime-thumb placeholder ${cls}"></div>`;
  return `<img class="anime-thumb ${cls}" src="${src}" alt="${escAttr(alt)}" loading="lazy">`;
}

/** HTML для бейджа типу медіа */
function mediaBadgeHTML(type) {
  const label = CONFIG.categoryLabels[type] ?? type?.toUpperCase() ?? '?';
  return `<span class="badge badge-${type ?? 'unknown'}">${label}</span>`;
}

/** Екранування HTML-атрибутів */
function escAttr(str) {
  return String(str ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Екранування HTML-вмісту */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

let _activeAnchor = null;

export function showTooltip(anchor, text) {
  const tip = $('tooltip-popup');
  if (!tip) return;

  // Якщо вже відкритий для цього елементу — закрити
  if (_activeAnchor === anchor) {
    hideTooltip();
    return;
  }

  tip.textContent = text;
  tip.classList.add('visible');
  tip.setAttribute('aria-hidden', 'false');
  _activeAnchor = anchor;

  // Позиціонування
  const rect = anchor.getBoundingClientRect();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  let top  = rect.bottom + scrollY + 8;
  let left = rect.left   + scrollX;

  // Не виходити за правий край вікна
  const tipW = 300;
  if (left + tipW > window.innerWidth - 12) {
    left = window.innerWidth - tipW - 12;
  }

  tip.style.top  = `${top}px`;
  tip.style.left = `${left}px`;
}

export function hideTooltip() {
  const tip = $('tooltip-popup');
  if (tip) {
    tip.classList.remove('visible');
    tip.setAttribute('aria-hidden', 'true');
  }
  _activeAnchor = null;
}

// ─── Generic Tab Setup ────────────────────────────────────────────────────────

function setupTabs(container) {
  container.querySelectorAll('.tab-list .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key   = btn.dataset.tab;
      const scope = btn.closest('.tabs');

      scope.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      scope.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      scope.querySelector(`.tab-panel[data-panel="${key}"]`)?.classList.add('active');
    });
  });
}

// ═══════════════════════════════════════════════════════
// SECTION 1: Top by Category
// ═══════════════════════════════════════════════════════

export function renderCategorySection(topByCategory) {
  const container = $('categories-content');
  if (!container) return;

  const categories = Object.keys(topByCategory);

  if (!categories.length) {
    container.innerHTML = `<div class="empty-state"><p>Немає даних для відображення.</p></div>`;
    return;
  }

  // Сортуємо категорії за пріоритетом
  const order  = CONFIG.categoryOrder;
  const sorted = [
    ...order.filter(c => categories.includes(c)),
    ...categories.filter(c => !order.includes(c)),
  ];

  const tabBtns = sorted.map((cat, i) => {
    const icon  = CONFIG.categoryIcons[cat]   ?? '🎞';
    const label = CONFIG.categoryLabels[cat]  ?? cat.toUpperCase();
    const count = topByCategory[cat]?.length  ?? 0;
    return `<button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${cat}">
      ${icon} ${label}
      <span class="tab-count">${count}</span>
    </button>`;
  }).join('');

  const tabPanels = sorted.map((cat, i) => {
    const list = topByCategory[cat] ?? [];
    const rows = list.map((a, idx) => {
      const ua = escHtml(a.title_ua ?? a.title);
      const orig = a.title_ua ? `<div class="anime-title-orig">${escHtml(a.title)}</div>` : '';
      return `<div class="anime-row">
        <span class="rank-num">${idx + 1}</span>
        ${thumbHTML(a.image, a.title_ua ?? a.title)}
        <div class="anime-info">
          <div class="anime-title" title="${escAttr(a.title_ua ?? a.title)}">${ua}</div>
          ${orig}
        </div>
        <div class="anime-score">
          <span class="score-val">★ ${a.score.toFixed(2)}</span>
          <span class="members-val">👥 ${fmtNum(a.members)}</span>
        </div>
      </div>`;
    }).join('');

    return `<div class="tab-panel${i === 0 ? ' active' : ''}" data-panel="${cat}">
      ${rows || '<div class="empty-state"><p>Немає аніме в цій категорії.</p></div>'}
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="tabs">
      <div class="tab-list">${tabBtns}</div>
      <div class="tab-panels">${tabPanels}</div>
    </div>`;

  setupTabs(container);
}

// ═══════════════════════════════════════════════════════
// SECTION 2: Top Rated Chart
// ═══════════════════════════════════════════════════════

export function renderChartSection(allSnapshots, currentIndex, enrichedMap, threshold) {
  const navEl     = $('snapshot-nav');
  const contentEl = $('top-rated-content');
  if (!navEl || !contentEl) return;

  const total   = allSnapshots.length;
  const snap    = allSnapshots[currentIndex];
  const label   = snap?.config?.label ?? snap?.date ?? '—';

  // ─ Navigator ─
  navEl.innerHTML = `
    <button class="nav-btn" id="snap-prev" ${currentIndex === 0 ? 'disabled' : ''} aria-label="Попередній знімок">‹</button>
    <span class="snap-label">📅 ${label}</span>
    <button class="nav-btn" id="snap-next" ${currentIndex === total - 1 ? 'disabled' : ''} aria-label="Наступний знімок">›</button>
    <span class="snap-counter">${currentIndex + 1} / ${total}</span>
  `;

  // ─ Chart Data ─
  const { rows } = computeChartData(allSnapshots, currentIndex, threshold, enrichedMap);

  if (!rows.length) {
    const topAnime = snap?.anime?.toSorted?.((a, b) => b.score - a.score)?.[0];
    contentEl.innerHTML = `
      <div class="empty-state">
        <p>🔍 У цьому знімку немає аніме з рейтингом ≥ ${threshold}.</p>
        ${topAnime
          ? `<p class="empty-hint">Найвища оцінка: <strong>★ ${topAnime.score.toFixed(2)}</strong>
             — ${escHtml(topAnime.title)}</p>`
          : ''}
      </div>`;
    return;
  }

  const rowsHTML = rows.map(a => {
    const ua          = escHtml(a.title_ua ?? a.title);
    const origTitle   = a.title_ua
      ? `<div class="chart-title-orig">${escHtml(a.title)}</div>` : '';

    const scoreDelta  = a.scoreDelta !== null
      ? `<span class="delta ${deltaClass(a.scoreDelta)}">${fmtDelta(a.scoreDelta, 2)}</span>` : '';
    const membersDelta = a.membersDelta !== null
      ? `<span class="delta ${deltaClass(a.membersDelta)}">${fmtDelta(a.membersDelta)}</span>` : '';

    return `<div class="chart-row">
      <div class="chart-rank">
        <span class="rank-num">#${a.rank}</span>
        ${rankBadgeHTML(a.rankDelta, a.isNew)}
      </div>
      ${thumbHTML(a.image, a.title_ua ?? a.title)}
      <div class="chart-info">
        <div class="chart-title" title="${escAttr(a.title_ua ?? a.title)}">${ua}</div>
        ${origTitle}
        <div class="chart-meta">${mediaBadgeHTML(a.media_type)}</div>
      </div>
      <div class="chart-stats">
        <div class="stat-score">
          <span class="score-val large">★ ${a.score.toFixed(2)}</span>
          ${scoreDelta}
        </div>
        <div class="stat-members">
          <span class="members-label">👥</span>
          <span>${fmtNum(a.members)}</span>
          ${membersDelta}
        </div>
      </div>
    </div>`;
  }).join('');

  contentEl.innerHTML = `<div class="chart-list">${rowsHTML}</div>`;
}

// ═══════════════════════════════════════════════════════
// SECTION 3: Notable Events
// ═══════════════════════════════════════════════════════

export function renderEventsSection(analytics) {
  const container = $('events-content');
  if (!container) return;

  const {
    highestEver, mostStableScore, longestTop1,
    allAboveThreshold, top1History, mostStableTopN, mostAtOnce,
  } = analytics;

  container.innerHTML = `
    <div class="events-grid">
      ${buildHighestEverCard(highestEver)}
      ${buildStableScoreCard(mostStableScore)}
      ${buildLongestTop1Card(longestTop1)}
    </div>
    <div class="events-tabs-section">
      ${buildEventsTabs({ allAboveThreshold, top1History, mostStableTopN, mostAtOnce })}
    </div>`;

  setupTabs(container);
  setupInfoBtnsIn(container);
}

// ─── Event Card Builder ───────────────────────────────────────────────────────

function eventCard(icon, title, infoKey, body) {
  return `<div class="event-card">
    <div class="event-card-header">
      <span class="event-icon">${icon}</span>
      <h3 class="event-title">${title}</h3>
      <button class="info-btn small" data-info-key="${infoKey}" aria-label="Інформація">ℹ</button>
    </div>
    <div class="event-card-body">${body}</div>
  </div>`;
}

function buildHighestEverCard(data) {
  if (!data) {
    return eventCard('🏆', 'Найвища оцінка за всю історію', 'highestEver',
      '<div class="empty-state"><p>Недостатньо даних</p></div>');
  }

  return eventCard('🏆', 'Найвища оцінка за всю історію', 'highestEver', `
    <div class="event-highlight">
      <span class="highlight-score">★ ${data.score.toFixed(2)}</span>
      <div class="highlight-title">${escHtml(data.title)}</div>
      <div class="highlight-date">📅 ${formatDate(data.date)}</div>
    </div>`);
}

function buildStableScoreCard(data) {
  if (!data) {
    return eventCard('📊', 'Найстабільніша оцінка', 'stableScore',
      '<div class="empty-state"><p>Потрібно ≥ 2 знімки</p></div>');
  }

  const days = Math.round(
    (new Date(data.endDate) - new Date(data.startDate)) / 86_400_000
  );

  return eventCard('📊', 'Найстабільніша оцінка', 'stableScore', `
    <div class="event-highlight">
      <span class="highlight-score">★ ${data.score.toFixed(2)}</span>
      <div class="highlight-title">${escHtml(data.title)}</div>
      <div class="highlight-meta">
        📅 ${formatDate(data.startDate)}&nbsp;→&nbsp;${formatDate(data.endDate)}<br>
        ${data.count} знімк${pluralUk(data.count, 'ів', 'а', '')}
        ${days > 0 ? ` / ~${days} ${pluralUk(days, 'днів', 'дні', 'день')}` : ''}
      </div>
    </div>`);
}

function buildLongestTop1Card(data) {
  if (!data) {
    return eventCard('👑', 'Найдовше утримання топ-1', 'longestTop1',
      '<div class="empty-state"><p>Недостатньо даних</p></div>');
  }

  const days = Math.round(
    (new Date(data.endDate) - new Date(data.startDate)) / 86_400_000
  );

  return eventCard('👑', 'Найдовше утримання топ-1', 'longestTop1', `
    <div class="event-highlight">
      <div class="highlight-title">${escHtml(data.title)}</div>
      <div class="highlight-meta">
        📅 ${formatDate(data.startDate)}&nbsp;→&nbsp;${formatDate(data.endDate)}<br>
        ${data.count} знімк${pluralUk(data.count, 'ів', 'а', '')}
        ${days > 0 ? ` / ~${days} ${pluralUk(days, 'днів', 'дні', 'день')}` : ''}<br>
        ⭐ Макс. оцінка: <strong>${data.maxScore.toFixed(2)}</strong>
      </div>
    </div>`);
}

// ─── Events Tabs ──────────────────────────────────────────────────────────────

function buildEventsTabs({ allAboveThreshold, top1History, mostStableTopN, mostAtOnce }) {
  const tabs = [
    { key: 'above9',    icon: '🎯', label: `Усі з оцінкою ≥ ${CONFIG.thresholds.notable}` },
    { key: 'top1hist',  icon: '👑', label: 'Хто тримав топ-1' },
    { key: 'stabletop', icon: '🔒', label: 'Найстабільніший топ' },
    { key: 'mosthigh',  icon: '📈', label: 'Найбільше топ-тайтлів' },
  ];

  const btns = tabs.map((t, i) =>
    `<button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${t.key}">
      ${t.icon} ${t.label}
    </button>`
  ).join('');

  const infoKeys = ['allAbove9', 'top1History', 'stableTop', 'mostAtOnce'];
  const panels = [
    buildAbove9Panel(allAboveThreshold),
    buildTop1HistoryPanel(top1History),
    buildStableTopPanel(mostStableTopN),
    buildMostAtOncePanel(mostAtOnce),
  ];

  const panelHTML = panels.map((content, i) =>
    `<div class="tab-panel${i === 0 ? ' active' : ''}" data-panel="${tabs[i].key}">
      <div class="tab-panel-header">
        <button class="info-btn small" data-info-key="${infoKeys[i]}" aria-label="Інформація">ℹ</button>
      </div>
      ${content}
    </div>`
  ).join('');

  return `<div class="tabs events-tabs">
    <div class="tab-list">${btns}</div>
    <div class="tab-panels">${panelHTML}</div>
  </div>`;
}

// ─── Panel: All Above 9 ───────────────────────────────────────────────────────

function buildAbove9Panel(list) {
  if (!list?.length) {
    return `<div class="empty-state"><p>Жодне аніме ще не досягало оцінки ≥ ${CONFIG.thresholds.notable}.</p>
      <p class="empty-hint">Додайте більше знімків з пізніших років.</p></div>`;
  }

  const rows = list.map((a, i) => {
    const ua  = escHtml(a.title_ua ?? a.title);
    const cat = CONFIG.categoryLabels[a.media_type] ?? a.media_type;
    return `<div class="list-row">
      <span class="rank-num">${i + 1}</span>
      ${thumbHTML(a.image, a.title_ua ?? a.title, 'small')}
      <div class="list-info">
        <span class="list-title" title="${escAttr(a.title_ua ?? a.title)}">${ua}</span>
        <span class="list-meta">${mediaBadgeHTML(a.media_type)} · ${formatDate(a.firstDate)}</span>
      </div>
      <span class="score-badge">★ ${a.maxScore.toFixed(2)}</span>
    </div>`;
  }).join('');

  return `<div class="ranked-list">${rows}</div>`;
}

// ─── Panel: Top-1 History ─────────────────────────────────────────────────────

function buildTop1HistoryPanel(list) {
  if (!list?.length) {
    return `<div class="empty-state"><p>Немає даних.</p></div>`;
  }

  const rows = list.map((a, i) => {
    const ua = escHtml(a.title_ua ?? a.title);
    // Відображення: firstScore (maxScore) якщо різняться
    const scoreStr = a.maxScore !== a.firstScore
      ? `${a.firstScore.toFixed(2)} (${a.maxScore.toFixed(2)})`
      : a.firstScore.toFixed(2);

    return `<div class="list-row">
      <span class="rank-num">${i + 1}</span>
      ${thumbHTML(a.image, a.title_ua ?? a.title, 'small')}
      <div class="list-info">
        <span class="list-title" title="${escAttr(a.title_ua ?? a.title)}">${ua}</span>
        <span class="list-meta">⭐ ${scoreStr} · 📅 ${formatDate(a.firstDate)}</span>
      </div>
      <span class="count-badge" title="Кількість разів на #1">[${a.count}]</span>
    </div>`;
  }).join('');

  return `<div class="ranked-list">${rows}</div>`;
}

// ─── Panel: Stable Top-N ─────────────────────────────────────────────────────

function buildStableTopPanel(data) {
  if (!data) {
    return `<div class="empty-state"><p>Потрібно ≥ 2 знімки для аналізу.</p></div>`;
  }

  const days = Math.round(
    (new Date(data.endDate) - new Date(data.startDate)) / 86_400_000
  );

  const rows = data.topN.map((a, i) =>
    `<div class="stable-row">
      <span class="rank-num">${i + 1}</span>
      <span class="stable-title">${escHtml(a.title)}</span>
      <span class="stable-score">★ ${a.score.toFixed(2)}</span>
    </div>`
  ).join('');

  return `
    <div class="stable-header">
      <strong>Топ-${data.n} без змін:</strong>&nbsp;
      ${formatDate(data.startDate)}&nbsp;→&nbsp;${formatDate(data.endDate)}&nbsp;
      (${data.count} знімк${pluralUk(data.count, 'ів', 'а', '')}
      ${days > 0 ? `, ~${days} ${pluralUk(days, 'днів', 'дні', 'день')}` : ''})
    </div>
    <div class="stable-list">${rows}</div>`;
}

// ─── Panel: Most High-Rated at Once ──────────────────────────────────────────

function buildMostAtOncePanel(data) {
  if (!data || data.count === 0) {
    return `<div class="empty-state">
      <p>У жодному знімку не знайдено аніме з оцінкою ≥ ${CONFIG.thresholds.notable}.</p>
      <p class="empty-hint">Додайте знімки за 2010-ті роки.</p>
    </div>`;
  }

  const rows = data.anime.map((a, i) =>
    `<div class="list-row small">
      <span class="rank-num">${i + 1}</span>
      <span class="list-title">${escHtml(a.title)}</span>
      <span class="score-badge">★ ${a.score.toFixed(2)}</span>
    </div>`
  ).join('');

  return `
    <div class="most-header">
      <strong>${data.count} аніме одночасно з оцінкою ≥ ${CONFIG.thresholds.notable}</strong>
      <span class="most-date">📅 ${formatDate(data.date)}</span>
    </div>
    <div class="ranked-list">${rows}</div>`;
}

// ─── Info Buttons (in dynamically rendered content) ───────────────────────────

function setupInfoBtnsIn(container) {
  container.querySelectorAll('[data-info-key]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      showTooltip(btn, CONFIG.infoTexts[btn.dataset.infoKey] ?? 'Немає опису.');
    });
  });
}

// ─── Ukrainian plural helper ──────────────────────────────────────────────────

function pluralUk(n, genPlural, genSingularFew, nominativeSingular) {
  const abs = Math.abs(n) % 100;
  const rem = abs % 10;
  if (abs >= 11 && abs <= 14)   return genPlural;
  if (rem === 1)                return nominativeSingular;
  if (rem >= 2 && rem <= 4)     return genSingularFew;
  return genPlural;
}