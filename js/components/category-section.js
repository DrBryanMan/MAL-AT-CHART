import { formatDateShort } from '../analytics.js';
import { CONFIG } from '../config.js';
import { icon } from '../icons.js';
import {
  $,
  fmtScore,
  escHtml,
  animeTitleHTML,
  thumbHTML,
  collapsibleList,
  bannerStyle,
  setupTabs,
  setupShowMore,
  getFullAnime,
  dateLink,
} from './render-shared.js';

function groupSessions(list) {
  const result = [];
  let i = 0;
  while (i < list.length) {
    let j = i + 1;
    while (j < list.length && list[j].animeId === list[i].animeId) j++;
    const count = j - i;
    if (count >= 3) {
      result.push({ grouped: true, animeId: list[i].animeId, items: list.slice(i, j) });
    } else {
      for (let k = i; k < j; k++) result.push({ grouped: false, item: list[k] });
    }
    i = j;
  }
  return result;
}

function buildSessionRow(s, enrichedMap) {
  const full = getFullAnime(s, enrichedMap);
  const origTitle = full.title_ua ? `<span class="session-orig">${escHtml(full.title)}</span>` : '';
  const scoreStr = s.maxScore !== s.firstScore
    ? `${fmtScore(s.firstScore)} (${fmtScore(s.maxScore)})`
    : fmtScore(s.firstScore);
  const sessionBadge = s.sessionNum > 1
    ? `<span class="session-num-badge" title="Потрапило у ТОП-1 вже ${s.sessionNum}-й раз">${s.sessionNum}</span>`
    : '';
  const dateRange = s.startDate === s.endDate
    ? dateLink(s.startDate, formatDateShort(s.startDate))
    : `${dateLink(s.startDate, formatDateShort(s.startDate))} → ${dateLink(s.endDate, formatDateShort(s.endDate))}`;

  return `<div class="session-row${full.banner_image ? ' has-banner' : ''}" ${bannerStyle(full.banner_image)}>
    ${thumbHTML(full.image, full.title_ua ?? full.title, 'small')}
    <div class="session-info">
      <div class="session-title">
        ${animeTitleHTML(full, 'session-title-text')} ${sessionBadge}${origTitle}
      </div>
      <div class="session-meta">
        <span class="session-date">${dateRange}</span>
      </div>
    </div>
    <span class="score-badge">${icon('star', 14)} ${scoreStr}</span>
  </div>`;
}

export function renderCategorySection(categoryTopHistory, enrichedMap) {
  const container = $('categories-content');
  if (!container) return;

  const { sessions, categories } = categoryTopHistory;
  const activeCats = categories.filter(c => sessions[c]?.length > 0);

  if (!activeCats.length) {
    container.innerHTML = `<div class="empty-state"><p>Немає даних. Можливо, жодне аніме не досягало порогу оцінки.</p></div>`;
    return;
  }

  const order = ['all', ...CONFIG.categoryOrder];
  const sorted = [
    ...order.filter(c => activeCats.includes(c)),
    ...activeCats.filter(c => !order.includes(c)),
  ];

  const tabBtns = sorted.map((cat, i) => {
    const iconName = cat === 'all' ? 'globe' : (CONFIG.categoryIcons[cat] ?? 'help-circle');
    const catIcon = icon(iconName, 14);
    const label = cat === 'all' ? 'Усі' : (CONFIG.categoryLabels[cat] ?? cat.toUpperCase());
    const count = sessions[cat]?.length ?? 0;
    return `<button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${cat}">
      ${catIcon} ${label}<span class="tab-count">${count}</span>
    </button>`;
  }).join('');

  const tabPanels = sorted.map((cat, i) => {
    const list = [...(sessions[cat] ?? [])].reverse();
    const grouped = groupSessions(list);
    const rows = grouped.map(g => {
      if (!g.grouped) return buildSessionRow(g.item, enrichedMap);

      const s = g.items[0];
      const first = g.items.at(-1);
      const last = g.items[0];
      const scoreStr = s.maxScore !== s.firstScore
        ? `${fmtScore(first.firstScore)} (${fmtScore(s.maxScore)})`
        : fmtScore(s.maxScore);

      const inner = g.items.map(item => buildSessionRow(item, enrichedMap)).join('');
      return `<div class="session-group">
        <div class="session-group-header" data-toggle>
          ${thumbHTML(s.image, s.title_ua ?? s.title, 'small')}
          <div class="session-info">
            <div class="session-title">
              ${animeTitleHTML(s, 'session-title-text')}
              <span class="session-num-badge">${g.items.length}×</span>
              ${s.title_ua ? `<span class="session-orig">${escHtml(s.title)}</span>` : ''}
            </div>
            <div class="session-meta">
              <span class="score-badge">${icon('star', 14)} ${scoreStr}</span>
              <span class="session-date">
                ${dateLink(first.startDate, formatDateShort(first.startDate))} →
                ${dateLink(last.endDate, formatDateShort(last.endDate))}
              </span>
            </div>
          </div>
          <span class="group-chevron">${icon('chevron-right', 16)}</span>
        </div>
        <div class="session-group-body hidden">${inner}</div>
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
