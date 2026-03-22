/**
 * renderer.js — DOM rendering functions for MAL Charts
 */

import { icon } from './icons.js';
import { CONFIG } from './config.js';
import { computeChartData, formatDate, formatDateShort, daysBetween, archiveUrl } from './analytics.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const fmtNum   = n => (n ?? 0).toLocaleString('uk-UA');
const fmtScore = s => (s ?? 0).toFixed(2);

function fmtDelta(val, decimals = 0) {
  if (val === null || val === undefined || val === 0) return val === 0 ? '±0' : '';
  return (val > 0 ? '+' : '−') + Math.abs(val).toFixed(decimals);
}

function deltaClass(val) {
  if (!val || val === 0) return 'neutral';
  return val > 0 ? 'positive' : 'negative';
}

function escAttr(str) {
  return String(str ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Посилання на Hikka якщо є slug, інакше просто текст */
function animeTitleHTML(a, cls = '') {
  const name = escHtml(a.title_ua ?? a.title);
  const slug = a.hikka_slug ?? null;
  if (!slug) return `<span class="${cls}">${name}</span>`;
  return `<a class="${cls} anime-link" href="https://hikka.io/anime/${escAttr(slug)}" target="_blank" rel="noopener">${name}</a>`;
}

function rankBadgeHTML(delta, isNew) {
  if (isNew)          return `<span class="rank-badge rank-new">New</span>`;
  if (delta === null) return `<span class="rank-badge rank-same">—</span>`;
  if (delta === 0)    return `<span class="rank-badge rank-same">${icon('minus', 9)}</span>`;
  if (delta > 0)      return `<span class="rank-badge rank-up">${icon('arrow-up', 9)} ${delta}</span>`;
  return `<span class="rank-badge rank-down">${icon('arrow-down', 9)} ${Math.abs(delta)}</span>`;
}

function thumbHTML(src, alt, cls = '') {
  if (!src) return `<div class="anime-thumb placeholder ${cls}"></div>`;
  return `<img class="anime-thumb ${cls}" src="${escAttr(src)}" alt="${escAttr(alt)}" loading="lazy">`;
}

function mediaBadgeHTML(type) {
  const label    = CONFIG.categoryLabels[type] ?? (type?.toUpperCase() ?? '?');
  const iconName = CONFIG.categoryIcons[type]  ?? 'help-circle';
  return `<span class="badge badge-${type ?? 'unknown'}">${icon(iconName, 10)} ${label}</span>`;
}

function archiveLink(dateStr, label) {
  return `<a class="archive-link" href="${archiveUrl(dateStr)}" target="_blank" rel="noopener" title="Архів MAL">${label}</a>`;
}

/** Список з кнопкою "Показати ще" якщо > limit */
function collapsibleList(rows, limit = 10) {
  if (rows.length <= limit) return rows.join('');
  const visible = rows.slice(0, limit).join('');
  const hidden  = rows.slice(limit).join('');
  return `${visible}
    <div class="collapsed-rows hidden">${hidden}</div>
    <button class="show-more-btn" data-show-more>Показати ще ${rows.length - limit} →</button>`;
}

function pluralUk(n, genPlural, genSingularFew, nominativeSingular) {
  const abs = Math.abs(n) % 100, rem = abs % 10;
  if (abs >= 11 && abs <= 14) return genPlural;
  if (rem === 1)              return nominativeSingular;
  if (rem >= 2 && rem <= 4)  return genSingularFew;
  return genPlural;
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

let _activeAnchor = null;

export function showTooltip(anchor, text) {
  const tip = $('tooltip-popup');
  if (!tip) return;
  if (_activeAnchor === anchor) { hideTooltip(); return; }
  tip.textContent = text;
  tip.classList.add('visible');
  tip.setAttribute('aria-hidden', 'false');
  _activeAnchor = anchor;
  const rect = anchor.getBoundingClientRect();
  let top  = rect.bottom + window.scrollY + 8;
  let left = rect.left   + window.scrollX;
  if (left + 300 > window.innerWidth - 12) left = window.innerWidth - 312;
  tip.style.top  = `${top}px`;
  tip.style.left = `${left}px`;
}

export function hideTooltip() {
  const tip = $('tooltip-popup');
  if (tip) { tip.classList.remove('visible'); tip.setAttribute('aria-hidden', 'true'); }
  _activeAnchor = null;
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function setupTabs(container) {
  container.querySelectorAll('.tab-list .tab-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      // Не реагуємо на кліки по info-btn всередині таба
      if (e.target.closest('.tab-info-btn')) return;
      const key   = btn.dataset.tab;
      const scope = btn.closest('.tabs');
      scope.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      scope.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      scope.querySelector(`.tab-panel[data-panel="${key}"]`)?.classList.add('active');
    });
  });
}

// ─── Show More ────────────────────────────────────────────────────────────────

export function setupShowMore(container) {
  container.querySelectorAll('[data-show-more]').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.previousElementSibling?.classList.remove('hidden');
      btn.remove();
    });
  });
}

// ═══════════════════════════════════════════════════════
// SECTION 1: Snapshot Chart
// ═══════════════════════════════════════════════════════

export function renderChartSection(snap, prevSnap, enrichedMap, index, currentIndex) {
  const navEl     = $('snapshot-nav');
  const contentEl = $('top-rated-content');
  if (!navEl || !contentEl) return;

  const total = index.length;
  const label = snap?.config?.label ?? snap?.date ?? '—';

  navEl.innerHTML = `
    <button class="nav-btn" id="snap-prev" ${currentIndex === 0 ? 'style="cursor: default;" disabled' : ''} aria-label="Попередній">${icon('chevron-left', 18)}</button>
    <span class="snap-label">
      <input class="snap-date-input" id="snap-date-input" type="date"
        value="${snap.date}"
        min="${index[0].date}"
        max="${index[total - 1].date}"
        aria-label="Дата знімку">
      <a class="nav-btn nav-btn-archive" href="${archiveUrl(snap.date)}" target="_blank" rel="noopener" title="Відкрити архів MAL">${icon('globe', 16)}</a>
    </span>
    <button class="nav-btn" id="snap-next" ${currentIndex === total - 1 ? 'style="cursor: default;" disabled' : ''} aria-label="Наступний">${icon('chevron-right', 18)}</button>
    <span class="snap-counter">
      <input class="snap-page-input" id="snap-page-input" type="number" min="1" max="${total}"
        value="${currentIndex + 1}" aria-label="Номер знімку">
      <span>/ ${total}</span>
    </span>`;

  const dateInput = $('snap-date-input');
    if (dateInput) {
      dateInput.addEventListener('change', () => {
        const target = new Date(dateInput.value).getTime();
        const closest = allSnapshots.reduce((best, s, i) => {
          const diff = Math.abs(new Date(s.date).getTime() - target);
          return diff < best.diff ? { i, diff } : best;
        }, { i: 0, diff: Infinity }).i;
        dateInput.dispatchEvent(new CustomEvent('snap-jump', { bubbles: true, detail: closest }));
      });
    }

  const input = $('snap-page-input');
  if (input) {
    input.addEventListener('change', () => {
      const v = Math.max(1, Math.min(total, Number(input.value) || 1)) - 1;
      input.dispatchEvent(new CustomEvent('snap-jump', { bubbles: true, detail: v }));
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.dispatchEvent(new Event('change')); });
  }

  const { rows } = computeChartData(snap, prevSnap, enrichedMap);

  const rowsHTML = rows.map(a => {
    const origTitle    = a.title_ua ? `<div class="chart-title-orig">${escHtml(a.title)}</div>` : '';
    const scoreDelta   = a.scoreDelta !== null
      ? `<span class="delta ${deltaClass(a.scoreDelta)}">${fmtDelta(a.scoreDelta, 2)}</span>` : '';
    const membersDelta = a.membersDelta !== null
      ? `<span class="delta ${deltaClass(a.membersDelta)}">${fmtDelta(a.membersDelta)}</span>` : '';
    const borderClass  = a.rank <= 3 ? ` rank-top-${a.rank}` : '';

    return `<div class="chart-row${borderClass}">
      <div class="chart-rank">
        <span class="rank-num">#${a.rank}</span>
        ${rankBadgeHTML(a.rankDelta, a.isNew)}
      </div>
      ${thumbHTML(a.image, a.title_ua ?? a.title)}
      <div class="chart-info">
        <div class="chart-title" title="${escAttr(a.title_ua ?? a.title)}">
          ${animeTitleHTML(a, 'chart-title-text')}
        </div>
        ${origTitle}
        <div class="chart-meta">${mediaBadgeHTML(a.media_type)}</div>
      </div>
      <div class="chart-stats">
        <div class="stat-score">
          <span class="score-val large">${icon('star', 18)} ${fmtScore(a.score)}</span>
          ${scoreDelta}
        </div>
        <div class="stat-members">
          <span class="members-label">${icon('users', 14)}</span>
          <span>${fmtNum(a.members)}</span>
          ${membersDelta}
        </div>
      </div>
    </div>`;
  });

  // Flatten: рядки — прямі діти .chart-list щоб rank-class коректно фарбував
  let chartInner = '';
  if (rows.length <= 10) {
    chartInner = rowsHTML.join('');
  } else {
    const visRows   = rowsHTML.slice(0, 10).join('');
    const hiddenRows = rowsHTML.slice(10).join('');
    chartInner = `${visRows}
      <template id="chart-hidden">${hiddenRows}</template>
      <button class="show-more-btn" data-chart-more>Показати ще ${rowsHTML.length - 10} →</button>`;
  }

  contentEl.innerHTML = rows.length
    ? `<div class="chart-list" id="chart-list">${chartInner}</div>`
    : `<div class="empty-state"><p>Знімок не містить даних.</p></div>`;

  // Спеціальний show-more для чарту — вставляємо рядки напряму в chart-list
  contentEl.querySelector('[data-chart-more]')?.addEventListener('click', function() {
    const tmpl = document.getElementById('chart-hidden');
    if (tmpl) {
      document.getElementById('chart-list').insertAdjacentHTML('beforeend', tmpl.innerHTML);
      tmpl.remove();
    }
    this.remove();
  });
}

// ═══════════════════════════════════════════════════════
// SECTION 2: Category Top History
// ═══════════════════════════════════════════════════════

export function renderCategorySection(categoryTopHistory) {
  const container = $('categories-content');
  if (!container) return;

  const { sessions, categories } = categoryTopHistory;
  const activeCats = categories.filter(c => sessions[c]?.length > 0);

  if (!activeCats.length) {
    container.innerHTML = `<div class="empty-state"><p>Немає даних. Можливо, жодне аніме не досягало порогу оцінки.</p></div>`;
    return;
  }

  const order  = ['all', ...CONFIG.categoryOrder];
  const sorted = [
    ...order.filter(c => activeCats.includes(c)),
    ...activeCats.filter(c => !order.includes(c)),
  ];

  const tabBtns = sorted.map((cat, i) => {
    const iconName = cat === 'all' ? 'globe' : (CONFIG.categoryIcons[cat] ?? 'help-circle');
    const catIcon  = icon(iconName, 14);
    const label = cat === 'all' ? 'Усі' : (CONFIG.categoryLabels[cat] ?? cat.toUpperCase());
    const count = sessions[cat]?.length ?? 0;
    return `<button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${cat}">
      ${catIcon} ${label}<span class="tab-count">${count}</span>
    </button>`;
  }).join('');

  const tabPanels = sorted.map((cat, i) => {
    // Сортуємо від новішого до старішого
    const list = [...(sessions[cat] ?? [])].reverse();

    const rows = list.map(s => {
      const origTitle = s.title_ua ? `<span class="session-orig">${escHtml(s.title)}</span>` : '';
      const scoreStr  = s.maxScore !== s.firstScore
        ? `${fmtScore(s.firstScore)} (${fmtScore(s.maxScore)})`
        : fmtScore(s.firstScore);
      const sessionBadge = s.sessionNum > 1
        ? `<span class="session-num-badge" title="Потрапив у ТОП-1 вже ${s.sessionNum}-й раз">${s.sessionNum}</span>`
        : '';
      const dateRange = s.startDate === s.endDate
        ? archiveLink(s.startDate, formatDateShort(s.startDate))
        : `${archiveLink(s.startDate, formatDateShort(s.startDate))} → ${archiveLink(s.endDate, formatDateShort(s.endDate))}`;

      return `<div class="session-row">
        ${thumbHTML(s.image, s.title_ua ?? s.title, 'small')}
        <div class="session-info">
          <div class="session-title">
            ${animeTitleHTML(s, 'session-title-text')} ${sessionBadge}${origTitle}
          </div>
          <div class="session-meta">
            <span class="score-val">${icon('star', 14)} ${scoreStr}</span>
            <span class="session-date">${dateRange}</span>
          </div>
        </div>
      </div>`;
    });

    return `<div class="tab-panel${i === 0 ? ' active' : ''}" data-panel="${cat}">
      ${rows.length
        ? `<div class="session-list">${collapsibleList(rows, 15)}</div>`
        : '<div class="empty-state"><p>Немає сесій у цій категорії.</p></div>'}
    </div>`;
  }).join('');

  container.innerHTML = `
    <div class="tabs">
      <div class="tab-list">${tabBtns}</div>
      <div class="tab-panels">${tabPanels}</div>
    </div>`;

  setupTabs(container);
  setupShowMore(container);
}

// ═══════════════════════════════════════════════════════
// SECTION 3: Notable Events
// ═══════════════════════════════════════════════════════

export function renderEventsSection(analytics) {
  const container = $('events-content');
  if (!container) return;

  container.innerHTML = `
    <div class="events-grid">
      ${buildHighestEverCard(analytics.highestEver)}
      ${buildStableScoreCard(analytics.mostStableScore)}
      ${buildLongestTop1Card(analytics.longestTop1)}
    </div>
    <div class="events-tabs-section">
      ${buildEventsTabs(analytics)}
    </div>`;

  setupTabs(container);
  setupShowMore(container);
}

// ─── Event Card Template ──────────────────────────────────────────────────────

function eventCard(ico, title, infoKey, body) {
  return `<div class="event-card">
    <div class="event-card-header">
      <span class="event-icon">${ico}</span>
      <h3 class="event-title">${title}</h3>
      <button class="info-btn small" data-info-key="${infoKey}" aria-label="Інформація">${icon('info', 12)}</button>
    </div>
    <div class="event-card-body">${body}</div>
  </div>`;
}

/** Рядки призерів (#2, #3) — без постера, з датою */
function runnerUpRows(top3, scoreField = 'score', dateField = 'date', endDateField = null) {
  const medals = ['2', '3'];
  return top3.slice(1, 3).map((a, i) => {
    const score   = a[scoreField] ?? a.score ?? 0;
    const date    = a[dateField]  ?? a.startDate ?? null;
    const endDate = endDateField  ? (a[endDateField] ?? null) : null;
    const dateHTML = date
      ? (endDate && endDate !== date
          ? `${archiveLink(date, formatDateShort(date))} → ${archiveLink(endDate, formatDateShort(endDate))}`
          : archiveLink(date, formatDateShort(date)))
      : '';
    return `<div class="runner-up-row">
      <span class="runner-medal runner-medal-${i + 2}">${medals[i]}</span>
      ${animeTitleHTML(a, 'runner-title')}
      <span class="runner-score">${icon('star', 12)} ${fmtScore(score)}</span>
      ${dateHTML ? `<span class="runner-date">${dateHTML}</span>` : ''}
    </div>`;
  }).join('');
}

/** Рядки переможців категорій — пропускаємо якщо той самий, що й переможець */
function categoryWinnersHTML(winnerId, tvW, movieW, otherW, scoreField = 'score', dateField = 'date', endDateField = null) {
  const getId = a => a?.animeId ?? a?.id ?? null;
  const rows = [
    tvW    && getId(tvW)    !== winnerId && { label: `${icon('tv',   14)} Серіал`, a: tvW },
    movieW && getId(movieW) !== winnerId && { label: `${icon('film', 14)} Фільм`,  a: movieW },
    otherW && getId(otherW) !== winnerId && {
      label: `${icon(CONFIG.categoryIcons[otherW.media_type] ?? 'help-circle', 14)} Інше`, a: otherW,
    },
  ].filter(Boolean);

  if (!rows.length) return '';
  return `<div class="cat-winners">
    ${rows.map(({ label, a }) => {
      const score   = a[scoreField] ?? a.score ?? 0;
      const date    = a[dateField]  ?? a.startDate ?? null;
      const endDate = endDateField  ? (a[endDateField] ?? null) : null;
      const dateHTML = date
        ? (endDate && endDate !== date
            ? `${archiveLink(date, formatDateShort(date))} → ${archiveLink(endDate, formatDateShort(endDate))}`
            : archiveLink(date, formatDateShort(date)))
        : '';
      return `<div class="cat-winner-row">
        <span class="cat-winner-label">${label}</span>
        ${animeTitleHTML(a, 'cat-winner-title')}
        <span class="cat-winner-score">${icon('star', 12)} ${fmtScore(score)}</span>
        ${dateHTML ? `<span class="cat-winner-date">${dateHTML}</span>` : ''}
      </div>`;
    }).join('')}
  </div>`;
}

// ─── Card: Highest Ever ───────────────────────────────────────────────────────

function buildHighestEverCard(data) {
  if (!data) return eventCard(icon('trophy', 20), 'Найвища оцінка за всю історію', 'highestEver',
    '<div class="empty-state"><p>Недостатньо даних</p></div>');

  const w = data.winner;
  return eventCard(icon('trophy', 20), 'Найвища оцінка за всю історію', 'highestEver', `
    <div class="event-winner">
      ${thumbHTML(w.image, w.title_ua ?? w.title, 'event-poster')}
      <div class="event-highlight">
        <span class="highlight-score">${icon('star', 22)} ${fmtScore(w.score)}</span>
        <div class="highlight-title">${animeTitleHTML(w)}</div>
        ${w.title_ua ? `<div class="highlight-orig">${escHtml(w.title)}</div>` : ''}
        <div class="highlight-date">${archiveLink(w.date, formatDate(w.date))}</div>
      </div>
    </div>
    ${runnerUpRows(data.top3, 'score', 'date')}
    ${categoryWinnersHTML(w.animeId ?? w.id, data.tvWinner, data.movieWinner, data.otherWinner, 'score', 'date')}`);
}

// ─── Card: Stable Score ───────────────────────────────────────────────────────

function buildStableScoreCard(data) {
  if (!data) return eventCard(icon('bar-chart-2', 20), 'Найстабільніша оцінка', 'stableScore',
    '<div class="empty-state"><p>Потрібно ≥ 2 знімки</p></div>');

  const w    = data.winner;
  const days = daysBetween(w.startDate, w.endDate);
  return eventCard(icon('bar-chart-2', 20), 'Найстабільніша оцінка', 'stableScore', `
    <div class="event-winner">
      ${thumbHTML(w.image, w.title_ua ?? w.title, 'event-poster')}
      <div class="event-highlight">
        <span class="highlight-score">${icon('star', 22)} ${fmtScore(w.score)}</span>
        <div class="highlight-title">${animeTitleHTML(w)}</div>
        ${w.title_ua ? `<div class="highlight-orig">${escHtml(w.title)}</div>` : ''}
        <div class="highlight-date">
          ${archiveLink(w.startDate, formatDateShort(w.startDate))} →
          ${archiveLink(w.endDate, formatDateShort(w.endDate))}
        </div>
        <div class="highlight-meta">${days} ${pluralUk(days, 'днів', 'дні', 'день')} незмінно</div>
      </div>
    </div>
    ${runnerUpRows(data.top3.map(s => ({ ...s, score: s.score ?? 0 })), 'score', 'startDate', 'endDate')}
    ${categoryWinnersHTML(w.animeId, data.tvWinner, data.movieWinner, data.otherWinner, 'score', 'startDate', 'endDate')}`);
}

// ─── Card: Longest Top-1 ─────────────────────────────────────────────────────

function buildLongestTop1Card(data) {
  if (!data) return eventCard(icon('crown', 20), 'Найдовше утримання ТОП-1', 'longestTop1',
    '<div class="empty-state"><p>Недостатньо даних</p></div>');

  const w = data.winner;
  return eventCard(icon('crown', 20), 'Найдовше утримання ТОП-1', 'longestTop1', `
    <div class="event-winner">
      ${thumbHTML(w.image, w.title_ua ?? w.title, 'event-poster')}
      <div class="event-highlight">
        <span class="highlight-score">${icon('star', 22)} ${fmtScore(w.maxScore)}</span>
        <div class="highlight-title">${animeTitleHTML(w)}</div>
        ${w.title_ua ? `<div class="highlight-orig">${escHtml(w.title)}</div>` : ''}
        <div class="highlight-date">
          ${archiveLink(w.startDate, formatDateShort(w.startDate))} →
          ${archiveLink(w.endDate, formatDateShort(w.endDate))}
        </div>
        <div class="highlight-meta">${w.days} ${pluralUk(w.days, 'днів', 'дні', 'день')} на вершині</div>
      </div>
    </div>
    ${runnerUpRows(data.top3, 'maxScore', 'startDate', 'endDate')}
    ${categoryWinnersHTML(w.animeId, data.tvWinner, data.movieWinner, data.otherWinner, 'maxScore', 'startDate', 'endDate')}`);
}

// ─── Events Tabs ──────────────────────────────────────────────────────────────

function buildEventsTabs({ allAboveThreshold, top1History, mostStableTopN, mostAtOnce }) {
  const tabs = [
    { key: 'above9',    ico: icon('target', 14),      label: `Усі з оцінкою ≥ ${CONFIG.thresholds.notable}`, info: 'allAbove9' },
    { key: 'top1hist',  ico: icon('crown', 14),        label: 'Хто тримав топ-1',                             info: 'top1History' },
    { key: 'stabletop', ico: icon('lock', 14),         label: 'Найстабільніший топ',                          info: 'stableTop' },
    { key: 'mosthigh',  ico: icon('trending-up', 14),  label: 'Найбільше топ-тайтлів',                        info: 'mostAtOnce' },
  ];

  const btns = tabs.map((t, i) =>
    `<div class="tab-btn-wrap${i === 0 ? ' active' : ''}">
      <button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${t.key}">${t.ico} ${t.label}</button>
      <button class="info-btn small tab-info-btn" data-info-key="${t.info}" aria-label="Інформація" tabindex="-1">${icon('info', 12)}</button>
    </div>`
  ).join('');

  const panels = [
    buildAbove9Panel(allAboveThreshold),
    buildTop1HistoryPanel(top1History),
    buildStableTopPanel(mostStableTopN),
    buildMostAtOncePanel(mostAtOnce),
  ].map((content, i) =>
    `<div class="tab-panel${i === 0 ? ' active' : ''}" data-panel="${tabs[i].key}">${content}</div>`
  ).join('');

  return `<div class="tabs events-tabs">
    <div class="tab-list">${btns}</div>
    <div class="tab-panels">${panels}</div>
  </div>`;
}

// ─── Panel: All Above 9 ───────────────────────────────────────────────────────

function buildAbove9Panel(list) {
  if (!list?.length) return `<div class="empty-state">
    <p>Жодне аніме ще не досягало оцінки ≥ ${CONFIG.thresholds.notable}.</p></div>`;

  const rows = list.map((a, i) =>
    `<div class="list-row">
      <span class="rank-num">${i + 1}</span>
      ${thumbHTML(a.image, a.title_ua ?? a.title, 'small')}
      <div class="list-info">
        ${animeTitleHTML(a, 'list-title')}
        <span class="list-meta">
          ${mediaBadgeHTML(a.media_type)}
          <span class="list-date">${archiveLink(a.firstDate, formatDateShort(a.firstDate))}</span>
        </span>
      </div>
      <span class="score-badge">${icon('star', 12)} ${fmtScore(a.maxScore)}</span>
    </div>`
  );

  return `<div class="ranked-list">${collapsibleList(rows, 10)}</div>`;
}

// ─── Panel: Top-1 History ─────────────────────────────────────────────────────

function buildTop1HistoryPanel(list) {
  if (!list?.length) return `<div class="empty-state"><p>Немає даних.</p></div>`;

  // Сортуємо від новішого до старішого (за датою останньої сесії)
  const sorted = [...list].toSorted((a, b) => {
    const lastA = a.sessions.at(-1)?.startDate ?? a.startDate;
    const lastB = b.sessions.at(-1)?.startDate ?? b.startDate;
    return new Date(lastB) - new Date(lastA);
  });

  const rows = sorted.map(a => {
    const fs = a.firstScore ?? 0;
    const ms = a.maxScore   ?? 0;
    const scoreStr = ms !== fs ? `${fmtScore(fs)} (${fmtScore(ms)})` : fmtScore(fs);

    // Деталі кожної сесії
    const sessionDetails = a.sessions.map((s, si) => {
      const dateStr = s.startDate === s.endDate
        ? archiveLink(s.startDate, formatDateShort(s.startDate))
        : `${archiveLink(s.startDate, formatDateShort(s.startDate))} → ${archiveLink(s.endDate, formatDateShort(s.endDate))}`;
      return `<span class="session-detail">#${si + 1}: ${dateStr}</span>`;
    }).join('');

    return `<div class="list-row top1-row">
      ${thumbHTML(a.image, a.title_ua ?? a.title, 'small')}
      <div class="list-info">
        ${animeTitleHTML(a, 'list-title')}
        <span class="list-meta">
          <span class="score-badge inline">${icon('star', 12)} ${scoreStr}</span>
        </span>
        <div class="session-details">${sessionDetails}</div>
      </div>
      <span class="count-badge large" title="Кількість заходів на вершину">${a.sessionCount}</span>
    </div>`;
  });

  return `<div class="ranked-list">${collapsibleList(rows, 10)}</div>`;
}

// ─── Panel: Stable Top-N ─────────────────────────────────────────────────────

function buildStableTopPanel(data) {
  if (!data) return `<div class="empty-state"><p>Потрібно ≥ 2 знімки для аналізу.</p></div>`;

  const rows = data.topN.map((a, i) =>
    `<div class="stable-row">
      <span class="rank-num">${i + 1}</span>
      ${animeTitleHTML(a, 'stable-title')}
      <span class="stable-score">${icon('star', 12)} ${fmtScore(a.score)}</span>
    </div>`
  );

  return `
    <div class="stable-header">
      <span>ТОП-<strong>${data.n}</strong> без змін позицій:</span>
      <span>
        ${archiveLink(data.startDate, formatDateShort(data.startDate))}
        → ${archiveLink(data.endDate, formatDateShort(data.endDate))}
        · <strong>${data.days}</strong> ${pluralUk(data.days, 'днів', 'дні', 'день')}
      </span>
    </div>
    <div class="stable-list">${collapsibleList(rows, 10)}</div>`;
}

// ─── Panel: Most High-Rated at Once ──────────────────────────────────────────

function buildMostAtOncePanel(data) {
  if (!data || data.count === 0) return `<div class="empty-state">
    <p>У жодному знімку не знайдено аніме з оцінкою ≥ ${CONFIG.thresholds.notable}.</p></div>`;

  const rows = data.anime.map((a, i) =>
    `<div class="list-row">
      <span class="rank-num">${i + 1}</span>
      <div class="list-info">
        ${animeTitleHTML(a, 'list-title')}
      </div>
      <span class="score-badge">${icon('star', 12)} ${fmtScore(a.score)}</span>
    </div>`
  );

  return `
    <div class="most-header">
      <span><strong>${data.count}</strong> аніме з оцінкою ≥ ${CONFIG.thresholds.notable}</span>
      <span class="most-date">${archiveLink(data.date, formatDate(data.date))}</span>
    </div>
    <div class="ranked-list">${collapsibleList(rows, 10)}</div>`;
}