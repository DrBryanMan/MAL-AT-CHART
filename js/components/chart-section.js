import { computeChartData, archiveUrl, formatDateShort } from '../analytics.js';
import { icon } from '../icons.js';
import {
  $,
  fmtNum,
  fmtScore,
  fmtDelta,
  deltaClass,
  escAttr,
  escHtml,
  animeTitleHTML,
  rankBadgeHTML,
  thumbHTML,
  mediaBadgeHTML,
  bannerStyle,
} from './render-shared.js';

const snapshotDatesCache = new WeakMap();
const snapshotDateIndexCache = new WeakMap();

function animateChartFlip(contentEl) {
  const prevPositions = new Map();
  contentEl.querySelectorAll('.chart-row[data-id]').forEach(el => {
    prevPositions.set(el.dataset.id, el.getBoundingClientRect().top);
  });
  return prevPositions;
}

function playChartFlip(contentEl, prevPositions) {
  if (!prevPositions.size) return;
  contentEl.querySelectorAll('.chart-row[data-id]').forEach(el => {
    const prev = prevPositions.get(el.dataset.id);
    if (prev === undefined) {
      el.classList.add('row-enter');
      return;
    }
    const delta = prev - el.getBoundingClientRect().top;
    if (delta === 0) return;
    el.style.transform = `translateY(${delta}px)`;
    el.style.transition = 'none';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = 'transform 320ms cubic-bezier(.25,.46,.45,.94)';
        el.style.transform = '';
      });
    });
  });
}

function getHistoricalRecord(scoreRecords, date) {
  let historicalRecord = null;
  for (const record of scoreRecords) {
    if (record.date > date) break;
    historicalRecord = record;
  }
  return historicalRecord;
}

export function renderChartSection(
  snap,
  prevSnap,
  enrichedMap,
  index,
  currentIndex,
  scoreStreaks = {},
  scoreRecordMap = new Map(),
  membersThreshold = 0,
  displayLimit = 50,
) {
  const navEl = $('snapshot-nav');
  const contentEl = $('top-rated-content');
  if (!navEl || !contentEl) return;

  const total = index.length;

  navEl.innerHTML = `
    <span class="filter-label" title="Мінімум учасників">${icon('users', 13)}</span>
    <input class="filter-input filter-input--wide" id="chart-members-min" type="number"
      min="0" step="100" value="${membersThreshold || 10}" placeholder="10"
      aria-label="Мінімум учасників">
    <span class="filter-label" title="Кількість рядків">${icon('list', 13)}</span>
    <input class="filter-input" id="chart-display-limit" type="number"
      min="5" max="500" step="5" value="${displayLimit}"
      aria-label="Кількість результатів">
    <span class="nav-divider"></span>
    <span class="snap-counter">
      <input class="snap-page-input" id="snap-page-input" type="number" min="1" max="${total}"
        value="${currentIndex + 1}" aria-label="Номер знімку">
      <span>/ ${total}</span>
    </span>
    <button class="nav-btn" id="snap-prev" ${currentIndex === 0 ? 'style="cursor: default;" disabled' : ''} aria-label="Попередній">${icon('chevron-left', 18)}</button>
    <span class="snap-label">
      <input class="snap-date-input" id="snap-date-input" type="date"
        value="${snap.date}"
        min="${index[0].date}"
        max="${index[total - 1].date}"
        aria-label="Дата знімку">
    </span>
    <button class="nav-btn" id="snap-next" ${currentIndex === total - 1 ? 'style="cursor: default;" disabled' : ''} aria-label="Наступний">${icon('chevron-right', 18)}</button>
    ${document.documentElement.dataset.mode === 'mal'
      ? `<a class="nav-btn nav-btn-archive" href="${archiveUrl(snap.date)}" target="_blank" rel="noopener" title="Відкрити архів MAL">${icon('globe', 16)}</a>`
      : ''}
    <button class="nav-btn nav-btn-latest" id="snap-latest" ${currentIndex === total - 1 ? 'hidden' : ''} aria-label="Актуальна дата" title="До актуальної дати">${icon('chevron-right', 14)}${icon('chevron-right', 14)}</button>
  `;

  const membersInput = $('chart-members-min');
  if (membersInput) {
    const fire = () => {
      const v = Math.max(0, Number(membersInput.value) || 0);
      membersInput.dispatchEvent(new CustomEvent('chart-filter', { bubbles: true, detail: { type: 'members', value: v } }));
    };
    membersInput.addEventListener('change', fire);
    membersInput.addEventListener('keydown', e => { if (e.key === 'Enter') fire(); });
  }

  const limitInput = $('chart-display-limit');
  if (limitInput) {
    const fire = () => {
      const v = Math.max(5, Math.min(500, Number(limitInput.value) || 50));
      limitInput.dispatchEvent(new CustomEvent('chart-filter', { bubbles: true, detail: { type: 'limit', value: v } }));
    };
    limitInput.addEventListener('change', fire);
    limitInput.addEventListener('keydown', e => { if (e.key === 'Enter') fire(); });
  }

  const dateInput = $('snap-date-input');
  if (dateInput) {
    const jumpToDate = () => {
      if (!dateInput.value) return;
      const target = new Date(dateInput.value).getTime();
      const closest = index.reduce((best, s, i) => {
        const diff = Math.abs(new Date(s.date).getTime() - target);
        return diff < best.diff ? { i, diff } : best;
      }, { i: 0, diff: Infinity }).i;
      dateInput.dispatchEvent(new CustomEvent('snap-jump', { bubbles: true, detail: closest }));
    };
    dateInput.addEventListener('keydown', e => { if (e.key === 'Enter') jumpToDate(); });
    dateInput.addEventListener('blur', jumpToDate);
  }

  const input = $('snap-page-input');
  if (input) {
    input.addEventListener('change', () => {
      const v = Math.max(1, Math.min(total, Number(input.value) || 1)) - 1;
      input.dispatchEvent(new CustomEvent('snap-jump', { bubbles: true, detail: v }));
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.dispatchEvent(new Event('change')); });
  }

  let snapshotDates = snapshotDatesCache.get(index);
  if (!snapshotDates) {
    snapshotDates = index.map(s => s.date);
    snapshotDatesCache.set(index, snapshotDates);
  }

  let snapshotDateIndex = snapshotDateIndexCache.get(index);
  if (!snapshotDateIndex) {
    snapshotDateIndex = new Map(snapshotDates.map((d, i) => [d, i]));
    snapshotDateIndexCache.set(index, snapshotDateIndex);
  }

  const { rows: allRows } = computeChartData(snap, prevSnap, enrichedMap, scoreStreaks, snapshotDateIndex);
  const filtered = membersThreshold > 0 ? allRows.filter(r => (r.members ?? 0) >= membersThreshold) : allRows;
  const rows = filtered.slice(0, displayLimit);

  const rowsHTML = rows.map(row => {
    const scoreRecords = scoreRecordMap.get(row.id) ?? [];
    const historicalRecord = getHistoricalRecord(scoreRecords, snap.date);
    const origTitle = row.title_ua ? `<div class="chart-title-orig">${escHtml(row.title)}</div>` : '';
    const streakHTML = row.scoreStreak && row.scoreStreak.count > 1
      ? `<span class="score-streak" title="Оцінка незмінна з ${formatDateShort(row.scoreStreak.startDate)}">
          ${icon('lock', 11)} ${row.scoreStreak.count}
        </span>`
      : '';
    const scoreDelta = row.scoreDelta !== null
      ? `<span class="delta ${deltaClass(row.scoreDelta)}">${fmtDelta(row.scoreDelta, 2)}</span>`
      : '';
    const scoredByDelta = row.scoredByDelta !== null
      ? `<span class="delta ${deltaClass(row.scoredByDelta)}">${fmtDelta(row.scoredByDelta)}</span>`
      : '';
    const membersDelta = row.membersDelta !== null
      ? `<span class="delta ${deltaClass(row.membersDelta)}">${fmtDelta(row.membersDelta)}</span>`
      : '';
    const borderClass = row.rank <= 3 ? ` rank-top-${row.rank}` : '';
    const mainScoreTooltipAttr = document.documentElement.dataset.mode === 'hikka' && row.rawScore != null
      ? `data-score-tooltip="Сира оцінка: ${fmtScore(row.rawScore)}"`
      : '';
    const maxScoreHTML = historicalRecord
      ? `<span class="score-badge score-badge--record" data-score-tooltip="Максимум уперше досягнуто ${formatDateShort(historicalRecord.date)}">
          ${icon('star', 14)}${fmtScore(historicalRecord.score)}
        </span>`
      : '';

    return `<div class="chart-row${borderClass}${row.banner_image ? ' has-banner' : ''}" data-id="${row.id}" ${bannerStyle(row.banner_image)}>
      <div class="chart-rank">
        <span class="rank-num">#${row.rank}</span>
        ${rankBadgeHTML(row.rankDelta, row.isNew)}
      </div>
      ${thumbHTML(row.image, row.title_ua ?? row.title)}
      <div class="chart-info">
        <div class="chart-title" title="${escAttr(row.title_ua ?? row.title)}">
          ${animeTitleHTML(row, 'chart-title-text')}
        </div>
        ${origTitle}
        <div class="chart-meta">${mediaBadgeHTML(row.media_type)}</div>
      </div>
      <div class="chart-stats">
        <div class="stat-score">
          ${streakHTML}
          <span class="score-badge large score-badge--current${mainScoreTooltipAttr ? ' score-badge--hint' : ''}" ${mainScoreTooltipAttr}>
            ${icon('scored-by', 12)}${fmtScore(row.score)}
          </span>
          ${maxScoreHTML}
          ${scoreDelta}
        </div>
        <div class="stat-scored-by" style="color: var(--text-muted);" title="Кількість оцінок">
          <span class="scored-label">${icon('scored-by', 13)}</span>
          <span>${fmtNum(row.scored_by)}</span>
          ${scoredByDelta}
        </div>
        <div class="stat-members" title="В списках у глядачів">
          <span class="members-label">${icon('users', 14)}</span>
          <span>${fmtNum(row.members)}</span>
          ${membersDelta}
        </div>
      </div>
    </div>`;
  });

  let chartInner = '';
  if (rows.length <= 10) {
    chartInner = rowsHTML.join('');
  } else {
    const visRows = rowsHTML.slice(0, 10).join('');
    const hiddenRows = rowsHTML.slice(10).join('');
    chartInner = `${visRows}
      <template id="chart-hidden">${hiddenRows}</template>
      <button class="show-more-btn" data-chart-more>Показати ще ${rowsHTML.length - 10} →</button>`;
  }

  const filterInfo = membersThreshold > 0 && filtered.length < allRows.length
    ? `<div class="chart-filter-info">${icon('users', 13)} ≥ ${fmtNum(membersThreshold)} · знайдено <strong>${filtered.length}</strong> з ${allRows.length}</div>`
    : '';

  const prevPositions = animateChartFlip(contentEl);
  contentEl.innerHTML = rows.length
    ? `${filterInfo}<div class="chart-list" id="chart-list">${chartInner}</div>`
    : `${filterInfo}<div class="empty-state"><p>Немає аніме з ≥ ${fmtNum(membersThreshold)} учасників у цьому знімку.</p></div>`;
  playChartFlip(contentEl, prevPositions);

  contentEl.querySelector('[data-chart-more]')?.addEventListener('click', function () {
    const tmpl = document.getElementById('chart-hidden');
    if (tmpl) {
      document.getElementById('chart-list').insertAdjacentHTML('beforeend', tmpl.innerHTML);
      tmpl.remove();
    }
    this.remove();
  });
}
