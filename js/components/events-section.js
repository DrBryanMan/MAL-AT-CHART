import { CONFIG } from '../config.js';
import { formatDate, formatDateShort, daysBetween } from '../analytics.js';
import { icon } from '../icons.js';
import {
  $,
  fmtNum,
  fmtScore,
  escAttr,
  escHtml,
  animeTitleHTML,
  thumbHTML,
  mediaBadgeHTML,
  collapsibleList,
  pluralUk,
  bannerStyle,
  setupTabs,
  setupShowMore,
  getFullAnime,
  hasPositiveWinnerValue,
  dateLink,
} from './render-shared.js';

function eventCard(ico, title, infoKey, body, bgImage = null) {
  const bg = bgImage ? `style="--card-bg:url('${escAttr(bgImage)}')"` : '';
  return `<div class="event-card${bgImage ? ' has-card-bg' : ''}" ${bg}>
      <div class="event-card-header">
      <span class="event-icon">${ico}</span>
      <h3 class="event-title">${title}</h3>
      <button class="info-btn small" data-info-key="${infoKey}" aria-label="Інформація">${icon('info', 12)}</button>
    </div>
    <div class="event-card-body">${body}</div>
  </div>`;
}

function runnerUpRows(top3, enrichedMap, scoreField = 'score', dateField = 'date', endDateField = null) {
  const medals = ['2', '3'];
  return top3.slice(1, 3).map((minimal, i) => {
    const a = getFullAnime(minimal, enrichedMap);
    const score = a[scoreField] ?? a.score ?? 0;
    const date = a[dateField] ?? a.startDate ?? null;
    const endDate = endDateField ? (a[endDateField] ?? null) : null;
    const hasRange = endDate && endDate !== date;
    const days = hasRange ? daysBetween(date, endDate) : null;
    const dateHTML = date
      ? (hasRange
        ? `${dateLink(date, formatDateShort(date))} → ${dateLink(endDate, formatDateShort(endDate))}`
        : dateLink(date, formatDateShort(date)))
      : '';
    return `<div class="runner-up-row">
      <span class="runner-medal runner-medal-${i + 2}">${medals[i]}</span>
      ${animeTitleHTML(a, 'runner-title')}
      <span class="runner-score">${icon('star', 14)} ${fmtScore(score)}</span>
      ${a.scored_by ? `<div class="highlight-meta">${icon('scored_by', 13)} ${fmtNum(a.scored_by)} голосів</div>` : ''}
      <span class="runner-date">${dateHTML || ''} <span class="runner-days">${days !== null ? ` ( ${days} ${pluralUk(days, 'днів', 'дні', 'день')} )` : ''}</span></span>
    </div>`;
  }).join('');
}

function categoryWinnersHTML(winnerId, tvW, movieW, otherW, enrichedMap, scoreField = 'score', dateField = 'date', endDateField = null) {
  const getId = a => a?.animeId ?? a?.id ?? null;
  const rows = [
    tvW && getId(tvW) !== winnerId && { label: `${icon('tv', 14)} Серіал`, a: tvW },
    movieW && getId(movieW) !== winnerId && { label: `${icon('film', 14)} Фільм`, a: movieW },
    otherW && getId(otherW) !== winnerId && {
      label: `${icon(CONFIG.categoryIcons[otherW.media_type] ?? 'help-circle', 14)} Інше`,
      a: otherW,
    },
  ].filter(Boolean);

  if (!rows.length) return '';
  return `<div class="cat-winners">
    ${rows.map(({ label, a: minimal }) => {
      const a = getFullAnime(minimal, enrichedMap);
      const score = a[scoreField] ?? a.score ?? 0;
      const date = a[dateField] ?? a.startDate ?? null;
      const endDate = endDateField ? (a[endDateField] ?? null) : null;
      const hasRange = endDate && endDate !== date;
      const days = hasRange ? daysBetween(date, endDate) : null;
      const dateHTML = date
        ? (hasRange
          ? `${dateLink(date, formatDateShort(date))} → ${dateLink(endDate, formatDateShort(endDate))}`
          : dateLink(date, formatDateShort(date)))
        : '';
      return `<div class="cat-winner-row">
        <span class="cat-winner-label">${label}</span>
        ${animeTitleHTML(a, 'cat-winner-title')}
        <span class="cat-winner-score">${icon('star', 14)} ${fmtScore(score)}</span>
        <span class="cat-winner-date">${dateHTML || ''}${days !== null ? `<span class="cat-winner-days"> ( ${days} ${pluralUk(days, 'днів', 'дні', 'день')} )</span>` : ''}</span>
      </div>`;
    }).join('')}
  </div>`;
}

function buildLowestEverCard(data, enrichedMap) {
  if (!data) return eventCard(icon('trending-down', 20), 'Найнижча оцінка за всю історію', 'lowestEver', '<div class="empty-state"><p>Недостатньо даних</p></div>');
  const w = getFullAnime(data.winner, enrichedMap);
  return eventCard(icon('trending-down', 20), 'Найнижча оцінка за всю історію', 'lowestEver', `
    <div class="event-winner">
      ${thumbHTML(w.image, w.title_ua ?? w.title, 'event-poster')}
      <div class="event-highlight">
        <span class="highlight-score highlight-score--low">${icon('star', 22)} ${fmtScore(w.score)}</span>
        <div class="highlight-title">${animeTitleHTML(w)}</div>
        ${w.title_ua ? `<div class="highlight-orig">${escHtml(w.title)}</div>` : ''}
        ${w.members ? `<div class="highlight-meta">${icon('users', 13)} ${fmtNum(w.members)} голосів</div>` : ''}
        <div class="highlight-date">${dateLink(w.date, formatDate(w.date))}</div>
      </div>
    </div>
    ${runnerUpRows(data.top3, enrichedMap, 'score', 'date')}
    ${categoryWinnersHTML(w.id, data.tvWinner, data.movieWinner, data.otherWinner, enrichedMap, 'score', 'date')}`, w.image);
}

function buildMostMembersCard(data, enrichedMap) {
  if (!data) return eventCard(icon('users', 20), 'Найбільша авдиторія', 'mostMembers', '<div class="empty-state"><p>Недостатньо даних</p></div>');
  const w = getFullAnime(data.winner, enrichedMap);
  const runners = data.top3.slice(1, 3).map((minimal, i) => {
    const a = getFullAnime(minimal, enrichedMap);
    return `<div class="runner-up-row">
      <span class="runner-medal runner-medal-${i + 2}">${i + 2}</span>
      ${animeTitleHTML(a, 'runner-title')}
      <span class="runner-score">${icon('users', 12)} ${fmtNum(a.members)}</span>
    </div>`;
  }).join('');

  const getId = a => a?.animeId ?? a?.id ?? null;
  const winnerId = getId(data.winner);
  const catRows = [
    data.tvWinner && getId(data.tvWinner) !== winnerId && { label: `${icon('tv', 14)} Серіал`, a: data.tvWinner },
    data.movieWinner && getId(data.movieWinner) !== winnerId && { label: `${icon('film', 14)} Фільм`, a: data.movieWinner },
    data.otherWinner && getId(data.otherWinner) !== winnerId && {
      label: `${icon(CONFIG.categoryIcons[data.otherWinner.media_type] ?? 'help-circle', 14)} Інше`,
      a: data.otherWinner,
    },
  ].filter(Boolean);

  const catWinnersHTML = catRows.length
    ? `<div class="cat-winners">
        ${catRows.map(({ label, a: minimal }) => {
          const a = getFullAnime(minimal, enrichedMap);
          return `<div class="cat-winner-row">
            <span class="cat-winner-label">${label}</span>
            ${animeTitleHTML(a, 'cat-winner-title')}
            <span class="cat-winner-score">${icon('users', 12)} ${fmtNum(a.members)}</span>
          </div>`;
        }).join('')}
      </div>`
    : '';

  return eventCard(icon('users', 20), 'Найбільша авдиторія', 'mostMembers', `
    <div class="event-winner">
      ${thumbHTML(w.image, w.title_ua ?? w.title, 'event-poster')}
      <div class="event-highlight">
        <span class="highlight-score" style="color:var(--accent)">
          ${icon('users', 22)} ${fmtNum(w.members)}
        </span>
        <div class="highlight-title">${animeTitleHTML(w)}</div>
        ${w.title_ua ? `<div class="highlight-orig">${escHtml(w.title)}</div>` : ''}
      </div>
    </div>
    ${runners}
    ${catWinnersHTML}`, w.image);
}

function buildMostScoredByCard(data, enrichedMap) {
  if (!data) return eventCard(icon('star', 20), 'Найбільше оцінок', 'mostScoredBy', '<div class="empty-state"><p>Недостатньо даних</p></div>');
  const w = getFullAnime(data.winner, enrichedMap);
  const runners = data.top3.slice(1, 3).map((minimal, i) => {
    const a = getFullAnime(minimal, enrichedMap);
    return `<div class="runner-up-row">
      <span class="runner-medal runner-medal-${i + 2}">${i + 2}</span>
      ${animeTitleHTML(a, 'runner-title')}
      <span class="runner-score">${icon('scored-by', 14)} ${fmtNum(a.scored_by)}</span>
    </div>`;
  }).join('');

  const getId = a => a?.animeId ?? a?.id ?? null;
  const winnerId = getId(data.winner);
  const catRows = [
    data.tvWinner && getId(data.tvWinner) !== winnerId && { label: `${icon('tv', 14)} Серіал`, a: data.tvWinner },
    data.movieWinner && getId(data.movieWinner) !== winnerId && { label: `${icon('film', 14)} Фільм`, a: data.movieWinner },
    data.otherWinner && getId(data.otherWinner) !== winnerId && {
      label: `${icon(CONFIG.categoryIcons[data.otherWinner.media_type] ?? 'help-circle', 14)} Інше`,
      a: data.otherWinner,
    },
  ].filter(Boolean);

  const catWinnersHTML = catRows.length
    ? `<div class="cat-winners">
        ${catRows.map(({ label, a: minimal }) => {
          const a = getFullAnime(minimal, enrichedMap);
          return `<div class="cat-winner-row">
            <span class="cat-winner-label">${label}</span>
            ${animeTitleHTML(a, 'cat-winner-title')}
            <span class="cat-winner-score">${icon('scored-by', 14)} ${fmtNum(a.scored_by)}</span>
          </div>`;
        }).join('')}
      </div>`
    : '';

  return eventCard(icon('scored-by', 20), 'Найбільше оцінок', 'mostScoredBy', `
    <div class="event-winner">
      ${thumbHTML(w.image, w.title_ua ?? w.title, 'event-poster')}
      <div class="event-highlight">
        <span class="highlight-score" style="color:var(--accent)">
          ${icon('scored-by', 22)} ${fmtNum(w.scored_by)}
        </span>
        <div class="highlight-title">${animeTitleHTML(w)}</div>
        ${w.title_ua ? `<div class="highlight-orig">${escHtml(w.title)}</div>` : ''}
      </div>
    </div>

  ${runners}
  ${catWinnersHTML}`, w.image);
}

function buildHighestEverCard(data, enrichedMap) {
  if (!data) return eventCard(icon('trophy', 20), 'Найвища оцінка за всю історію', 'highestEver', '<div class="empty-state"><p>Недостатньо даних</p></div>');
  const w = getFullAnime(data.winner, enrichedMap);
  return eventCard(icon('trophy', 20), 'Найвища оцінка за всю історію', 'highestEver', `
    <div class="event-winner">
      ${thumbHTML(w.image, w.title_ua ?? w.title, 'event-poster')}
      <div class="event-highlight">
        <span class="highlight-score">${icon('star', 22)} ${fmtScore(w.score)}</span>
        <div class="highlight-title">${animeTitleHTML(w)}</div>
        ${w.title_ua ? `<div class="highlight-orig">${escHtml(w.title)}</div>` : ''}
        ${w.scored_by ? `<div class="highlight-meta">${icon('scored_by', 13)} ${fmtNum(w.scored_by)} голосів</div>` : ''}
        <div class="highlight-date">${dateLink(w.date, formatDate(w.date))}</div>
      </div>
    </div>
    ${runnerUpRows(data.top3, enrichedMap, 'score', 'date')}
    ${categoryWinnersHTML(w.id, data.tvWinner, data.movieWinner, data.otherWinner, enrichedMap, 'score', 'date')}`, w.image);
}

function buildStableScoreCard(data, enrichedMap) {
  if (!data) return eventCard(icon('bar-chart-2', 20), 'Найстабільніша оцінка', 'stableScore', '<div class="empty-state"><p>Потрібно ≥ 2 знімки</p></div>');
  const w = getFullAnime(data.winner, enrichedMap);
  const days = daysBetween(w.startDate, w.endDate);
  return eventCard(icon('bar-chart-2', 20), 'Найстабільніша оцінка', 'stableScore', `
    <div class="event-winner">
      ${thumbHTML(w.image, w.title_ua ?? w.title, 'event-poster')}
      <div class="event-highlight">
        <span class="highlight-score">${icon('star', 22)} ${fmtScore(w.score)}</span>
        <div class="highlight-title">${animeTitleHTML(w)}</div>
        ${w.title_ua ? `<div class="highlight-orig">${escHtml(w.title)}</div>` : ''}
        <div class="highlight-date">
          ${dateLink(w.startDate, formatDateShort(w.startDate))} →
          ${dateLink(w.endDate, formatDateShort(w.endDate))}
        </div>
        <div class="highlight-meta">${days} ${pluralUk(days, 'днів', 'дні', 'день')} незмінно</div>
      </div>
    </div>
    ${runnerUpRows(data.top3.map(s => ({ ...s, score: s.score ?? 0 })), enrichedMap, 'score', 'startDate', 'endDate')}
    ${categoryWinnersHTML(w.id, data.tvWinner, data.movieWinner, data.otherWinner, enrichedMap, 'score', 'startDate', 'endDate')}`, w.image);
}

function buildLongestTop1Card(data, enrichedMap) {
  if (!data) return eventCard(icon('crown', 20), 'Найдовше утримання ТОП-1', 'longestTop1', '<div class="empty-state"><p>Недостатньо даних</p></div>');
  const w = getFullAnime(data.winner, enrichedMap);
  return eventCard(icon('crown', 20), 'Найдовше утримання ТОП-1', 'longestTop1', `
    <div class="event-winner">
      ${thumbHTML(w.image, w.title_ua ?? w.title, 'event-poster')}
      <div class="event-highlight">
        <span class="highlight-score">${icon('star', 22)} ${fmtScore(w.maxScore)}</span>
        <div class="highlight-title">${animeTitleHTML(w)}</div>
        ${w.title_ua ? `<div class="highlight-orig">${escHtml(w.title)}</div>` : ''}
        <div class="highlight-date">
          ${dateLink(w.startDate, formatDateShort(w.startDate))} →
          ${dateLink(w.endDate, formatDateShort(w.endDate))}
        </div>
        <div class="highlight-meta">${w.days} ${pluralUk(w.days, 'днів', 'дні', 'день')} на вершині</div>
      </div>
    </div>
    ${runnerUpRows(data.top3, enrichedMap, 'maxScore', 'startDate', 'endDate')}
    ${categoryWinnersHTML(w.id, data.tvWinner, data.movieWinner, data.otherWinner, enrichedMap, 'maxScore', 'startDate', 'endDate')}`, w.image);
}

function buildAbove9Panel(list, enrichedMap) {
  if (!list?.length) return `<div class="empty-state"><p>Жодне аніме ще не досягало оцінки ≥ ${CONFIG.thresholds.notable}.</p></div>`;
  const rows = list.map((minimal, i) => {
    const a = getFullAnime(minimal, enrichedMap);
    return `<div class="list-row above9-row${a.banner_image ? ' has-banner' : ''}" ${bannerStyle(a.banner_image)}>
      <span class="rank-num">${i + 1}</span>
      ${thumbHTML(a.image, a.title_ua ?? a.title, 'small')}
      <div class="list-info">
        ${animeTitleHTML(a, 'list-title')}
        <span class="list-meta">${mediaBadgeHTML(a.media_type)}</span>
        <div class="session-meta">
          <span class="session-date">${dateLink(a.firstDate, formatDateShort(a.firstDate))}</span>
        </div>
      </div>
      <span class="score-badge">${icon('star', 14)} ${fmtScore(a.maxScore)}</span>
    </div>`;
  });
  return `<div class="ranked-list">${collapsibleList(rows, 10)}</div>`;
}

function buildTop1HistoryPanel(list, enrichedMap) {
  if (!list?.length) return `<div class="empty-state"><p>Немає даних.</p></div>`;
  const sorted = [...list].toSorted((a, b) => {
    const lastA = a.sessions.at(-1)?.startDate ?? a.startDate;
    const lastB = b.sessions.at(-1)?.startDate ?? b.startDate;
    return new Date(lastB) - new Date(lastA);
  });

  const rows = sorted.map(minimal => {
    const a = getFullAnime(minimal, enrichedMap);
    const fs = a.firstScore ?? 0;
    const ms = a.maxScore ?? 0;
    const scoreStr = ms !== fs ? `${fmtScore(fs)} (${fmtScore(ms)})` : fmtScore(fs);
    const sessionDetails = a.sessions.map((s, si) => {
      const dateStr = s.startDate === s.endDate
        ? dateLink(s.startDate, formatDateShort(s.startDate))
        : `${dateLink(s.startDate, formatDateShort(s.startDate))} → ${dateLink(s.endDate, formatDateShort(s.endDate))}`;
      return `<span class="session-detail">#${si + 1}: ${dateStr}</span>`;
    }).join('');

    return `<div class="list-row top1-row${a.banner_image ? ' has-banner' : ''}" ${bannerStyle(a.banner_image)}>
      ${thumbHTML(a.image, a.title_ua ?? a.title, 'small')}
      <div class="list-info">
        <div class="list-title-row">
          ${animeTitleHTML(a, 'list-title')}
          <span class="session-num-badge" title="Кількість заходів на вершину">${a.sessionCount}×</span>
        </div>
        <span class="list-meta">${mediaBadgeHTML(a.media_type)}</span>
        <div class="session-details">${sessionDetails}</div>
      </div>
      <span class="score-badge">${icon('star', 14)} ${scoreStr}</span>
    </div>`;
  });
  return `<div class="ranked-list">${collapsibleList(rows, 10)}</div>`;
}

function buildStableTopPanel(data, enrichedMap) {
  if (!data) return `<div class="empty-state"><p>Потрібно ≥ 2 знімки для аналізу.</p></div>`;
  const rows = data.topN.map((minimal, i) => {
    const a = getFullAnime(minimal, enrichedMap);
    return `<div class="stable-row">
      <span class="rank-num">${i + 1}</span>
      ${animeTitleHTML(a, 'stable-title')}
      <span class="score-badge">${icon('star', 14)} ${fmtScore(a.score)}</span>
    </div>`;
  });

  return `
    <div class="stable-header">
      <span>ТОП-<strong>${data.n}</strong> без змін позицій:</span>
      <span>
        ${dateLink(data.startDate, formatDateShort(data.startDate))}
        → ${dateLink(data.endDate, formatDateShort(data.endDate))}
        · <strong>${data.days}</strong> ${pluralUk(data.days, 'днів', 'дні', 'день')}
      </span>
    </div>
    <div class="stable-list">${collapsibleList(rows, 10)}</div>`;
}

function buildMostAtOncePanel(data, enrichedMap) {
  if (!data || data.count === 0) return `<div class="empty-state"><p>У жодному знімку не знайдено аніме з оцінкою ≥ ${CONFIG.thresholds.notable}.</p></div>`;
  const rows = data.anime.map((minimal, i) => {
    const a = getFullAnime(minimal, enrichedMap);
    return `<div class="list-row">
      <span class="rank-num">${i + 1}</span>
      <div class="list-info">${animeTitleHTML(a, 'list-title')}</div>
      <span class="score-badge">${icon('star', 14)} ${fmtScore(a.score)}</span>
    </div>`;
  });

  return `
    <div class="most-header">
      <span><strong>${data.count}</strong> аніме з оцінкою ≥ ${CONFIG.thresholds.notable}</span>
      <span class="most-date">${dateLink(data.date, formatDate(data.date))}</span>
    </div>
    <div class="ranked-list">${collapsibleList(rows, 10)}</div>`;
}

function buildEventsTabs({ allAboveThreshold, top1History, mostStableTopN, mostAtOnce }, enrichedMap) {
  const tabs = [
    { key: 'above9', ico: icon('target', 14), label: `Усі з оцінкою ≥ ${CONFIG.thresholds.notable}`, info: 'allAbove9' },
    { key: 'top1hist', ico: icon('crown', 14), label: 'Хто тримав топ-1', info: 'top1History' },
    { key: 'stabletop', ico: icon('lock', 14), label: 'Найстабільніший топ', info: 'stableTop' },
    { key: 'mosthigh', ico: icon('trending-up', 14), label: 'Найбільше топ-тайтлів', info: 'mostAtOnce' },
  ];

  const btns = tabs.map((t, i) =>
    `<div class="tab-btn-wrap${i === 0 ? ' active' : ''}">
      <button class="tab-btn${i === 0 ? ' active' : ''}" data-tab="${t.key}">${t.ico} ${t.label}</button>
      <button class="info-btn small tab-info-btn" data-info-key="${t.info}" aria-label="Інформація" tabindex="-1">${icon('info', 12)}</button>
    </div>`
  ).join('');

  const panels = [
    buildAbove9Panel(allAboveThreshold, enrichedMap),
    buildTop1HistoryPanel(top1History, enrichedMap),
    buildStableTopPanel(mostStableTopN, enrichedMap),
    buildMostAtOncePanel(mostAtOnce, enrichedMap),
  ].map((content, i) =>
    `<div class="tab-panel${i === 0 ? ' active' : ''}" data-panel="${tabs[i].key}">${content}</div>`
  ).join('');

  return `<div class="tabs events-tabs">
    <div class="tab-list">${btns}</div>
    <div class="tab-panels">${panels}</div>
  </div>`;
}

export function renderEventsSection(analytics, source = 'mal', enrichedMap) {
  const container = $('events-content');
  if (!container) return;

  const isHikka = source === 'hikka';
  const cards = [
    buildHighestEverCard(analytics.highestEver, enrichedMap),
    isHikka ? buildLowestEverCard(analytics.lowestEver, enrichedMap) : '',
    buildLongestTop1Card(analytics.longestTop1, enrichedMap),
    buildStableScoreCard(analytics.mostStableScore, enrichedMap),
    hasPositiveWinnerValue(analytics.mostMembers, 'members') ? buildMostMembersCard(analytics.mostMembers, enrichedMap) : '',
    hasPositiveWinnerValue(analytics.mostScoredBy, 'scored_by') ? buildMostScoredByCard(analytics.mostScoredBy, enrichedMap) : '',
  ].filter(Boolean).join('');

  container.innerHTML = `
    <div class="events-grid">
      ${cards}
    </div>
    ${buildEventsTabs(analytics, enrichedMap)}
  `;

  setupTabs(container);
  setupShowMore(container);
}
