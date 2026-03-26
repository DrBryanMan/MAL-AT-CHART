import { buildEnrichedMap } from './analytics.js';
import { loadAll, loadSnapshot, loadSnapshotPair } from './data-loader.js';
import {
  renderCategorySection,
  renderChartSection,
  renderEventsSection,
  setRendererSource,
  showTooltip,
  hideTooltip,
} from './renderer.js';
import { CONFIG, applyMode } from './config.js';
import { icon } from './icons.js';

// â”€â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const state = {
  index:        [],
  currentSnap:  null,
  prevSnap:     null,
  latestSnap:   null,
  latestMonthSnap: null,
  enrichedMap:  new Map(),
  analytics:    null,
  currentIndex: 0,
  maxScoreMap:  new Map(),
  currentMode:      'mal',
  membersThreshold: 0,
  displayLimit:     50,
};

// â”€â”€â”€ Mode helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getStoredMode() {
  return localStorage.getItem('data-mode') ?? 'mal';
}

function applyModeUI(mode) {
  setRendererSource(mode);
  document.documentElement.dataset.mode = mode;

  const titleEl = document.querySelector('.site-title');
  if (titleEl) {
    titleEl.innerHTML = mode === 'hikka'
      ? 'Hikka <span class="accent">Ratings Chart</span>'
      : 'MAL <span class="accent">Ratings Chart</span>';
  }

  const subtitleEl = document.querySelector('.site-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = mode === 'hikka'
      ? 'ÐÑ€Ñ…Ñ–Ð² Ñ€ÐµÐ¹Ñ‚Ð¸Ð½Ò‘Ñ–Ð² Hikka Ð· 02.2026'
      : 'ÐÑ€Ñ…Ñ–Ð² Ñ€ÐµÐ¹Ñ‚Ð¸Ð½Ò‘Ñ–Ð² MyAnimeList Ð· 2006';
  }

  const toggleBtn = document.getElementById('mode-toggle-btn');
  if (toggleBtn) toggleBtn.dataset.mode = mode;

  document.querySelectorAll('.mode-logo').forEach(el => {
    el.classList.toggle('active', el.dataset.source === mode);
  });
  document.querySelectorAll('.source-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.source === mode);
  });

  renderHikkaSummary();
}

async function switchMode(mode) {
  if (mode === state.currentMode) return;

  const contentEl = document.getElementById('content');
  
  contentEl.classList.remove('visible');
  contentEl.classList.add('fade-out');

  await new Promise(r => setTimeout(r, 200));

  localStorage.setItem('data-mode', mode);
  state.currentMode = mode;
  applyMode(mode);
  applyModeUI(mode);

  await loadData();

  contentEl.classList.remove('fade-out');
}

// â”€â”€â”€ Init â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function init() {
  const mode = getStoredMode();
  state.currentMode = mode;
  applyMode(mode);
  applyModeUI(mode);
  setupEventListeners();
  setupTheme();
  await loadData();
}

// â”€â”€â”€ Data loading â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function loadData() {
  const loadingEl = document.getElementById('loading');
  const contentEl = document.getElementById('content');
  contentEl.classList.remove('visible');

  if (loadingEl) {
    loadingEl.innerHTML = `<div class="spinner"></div><p>Ð—Ð°Ð²Ð°Ð½Ñ‚Ð°Ð¶ÐµÐ½Ð½Ñ Ð´Ð°Ð½Ð¸Ñ…â€¦</p>`;
    loadingEl.classList.remove('hidden');
  }
  // if (contentEl) contentEl.classList.add('hidden');

  try {
    const { index, analytics, enriched } = await loadAll(state.currentMode);

    if (!index.length) throw new Error('ÐÐµ Ð²Ð´Ð°Ð»Ð¾ÑÑ Ð·Ð°Ð²Ð°Ð½Ñ‚Ð°Ð¶Ð¸Ñ‚Ð¸ Ð¶Ð¾Ð´Ð½Ð¾Ð³Ð¾ Ð·Ð½Ñ–Ð¼ÐºÑƒ.');

    state.index        = index;
    state.enrichedMap  = buildEnrichedMap(enriched);
    state.currentIndex = index.length - 1;
    state.analytics    = analytics;
    state.maxScoreMap  = new Map(
      (analytics?.allAboveThreshold ?? []).map(a => [a.animeId, { maxScore: a.maxScore, maxScoreDate: a.maxScoreDate }])
    );

    const dates = index.map(s => s.date);
    const { current, prev } = await loadSnapshotPair(dates, state.currentIndex, state.currentMode);
    state.currentSnap = current;
    state.prevSnap    = prev;
    state.latestSnap  = current;
    state.latestMonthSnap = await loadMonthStartComparisonSnapshot(dates, state.currentMode, current.date);

    if (loadingEl) loadingEl.classList.add('hidden');
    if (contentEl) contentEl.classList.remove('hidden');

    renderAll();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        contentEl.classList.add('visible');
      });
    });
  } catch (err) {
    if (loadingEl) {
      loadingEl.innerHTML = `<div class="error-state"><p>âŒ ${err.message}</p></div>`;
    }
    console.error('[Charts] ÐŸÐ¾Ð¼Ð¸Ð»ÐºÐ°:', err);
  }
}

// â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function renderAll() {
  renderHikkaSummary();

  const sections = [
    () => renderChartSection(
      state.currentSnap, state.prevSnap, state.enrichedMap,
      state.index, state.currentIndex,
      state.analytics?.scoreStreaks ?? {}, state.maxScoreMap,
      state.membersThreshold, state.displayLimit,
    ),
    () => renderCategorySection(state.analytics.categoryTopHistory, state.enrichedMap),
    () => renderEventsSection(state.analytics, state.currentMode, state.enrichedMap),
  ];
  for (const fn of sections) {
    try { fn(); } catch (e) { console.error('[Charts] Ð¡ÐµÐºÑ†Ñ–Ñ:', e); }
  }
}

function renderHikkaSummary() {
  const summaryEl = document.getElementById('hikka-summary');
  const scoreEl = document.getElementById('hikka-summary-score');
  const deltaEl = document.getElementById('hikka-summary-delta');
  const countEl = document.getElementById('hikka-summary-count');
  const dateEl = document.getElementById('hikka-summary-date');

  if (!summaryEl || !scoreEl || !deltaEl || !countEl || !dateEl) return;

  if (state.currentMode !== 'hikka' || !state.latestSnap?.anime?.length) {
    summaryEl.classList.add('hidden');
    return;
  }

  const ratedAnime = state.latestSnap.anime.filter(a => Number.isFinite(a.score) && a.score > 0);
  const totalScore = ratedAnime.reduce((sum, anime) => sum + anime.score, 0);
  const averageScore = ratedAnime.length ? totalScore / ratedAnime.length : 0;
  const monthRatedAnime = state.latestMonthSnap?.anime?.filter(a => Number.isFinite(a.score) && a.score > 0) ?? [];
  const monthTotalScore = monthRatedAnime.reduce((sum, anime) => sum + anime.score, 0);
  const monthAverageScore = monthRatedAnime.length ? monthTotalScore / monthRatedAnime.length : null;
  const delta = monthAverageScore === null ? null : averageScore - monthAverageScore;
  const deltaRounded = delta === null ? null : Number(delta.toFixed(3));
  const formattedDate = new Intl.DateTimeFormat('uk-UA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${state.latestSnap.date}T00:00:00`));

  scoreEl.textContent = averageScore.toFixed(3);
  deltaEl.className = `hikka-summary__delta ${deltaRounded === null || deltaRounded === 0 ? 'neutral' : deltaRounded > 0 ? 'positive' : 'negative'}`;
  deltaEl.textContent = deltaRounded === null
    ? 'new'
    : `${deltaRounded > 0 ? '+' : deltaRounded < 0 ? '-' : '±'}${Math.abs(deltaRounded).toFixed(3)}`;
  countEl.textContent = `На основі ${ratedAnime.length.toLocaleString('uk-UA')} аніме`;
  dateEl.textContent = `Актуально на ${formattedDate}`;
  deltaEl.title = state.latestMonthSnap?.date
    ? `Зміна відносно ${state.latestMonthSnap.date}`
    : 'Немає снепшоту на перше число місяця для порівняння';
  summaryEl.classList.remove('hidden');
}

function renderChart() {
  try {
    renderChartSection(
      state.currentSnap, state.prevSnap, state.enrichedMap,
      state.index, state.currentIndex,
      state.analytics?.scoreStreaks ?? {}, state.maxScoreMap,
      state.membersThreshold, state.displayLimit,
    );
  } catch (e) { console.error('[Charts] Chart:', e); }
}

async function loadMonthStartComparisonSnapshot(dates, source, latestDate) {
  if (!dates?.length || !latestDate) return null;

  const monthStartDate = `${latestDate.slice(0, 8)}01`;
  if (!dates.includes(monthStartDate)) return null;
  return loadSnapshot(monthStartDate, source);
}

async function jumpTo(idx) {
  const clamped = Math.max(0, Math.min(state.index.length - 1, idx));
  if (clamped === state.currentIndex) return;
  state.currentIndex = clamped;

  const dates = state.index.map(s => s.date);
  const { current, prev } = await loadSnapshotPair(dates, clamped, state.currentMode);
  state.currentSnap = current;
  state.prevSnap    = prev;

  renderChart();
}

// â”€â”€â”€ Events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function setupEventListeners() {
  document.addEventListener('click', e => {
    const infoBtn = e.target.closest('[data-info-key]');
    if (infoBtn) {
      e.stopPropagation();
      showTooltip(infoBtn, CONFIG.infoTexts[infoBtn.dataset.infoKey] ?? 'ÐÐµÐ¼Ð°Ñ” Ð¾Ð¿Ð¸ÑÑƒ.');
      return;
    }

    if (e.target.closest('#snap-prev'))   { jumpTo(state.currentIndex - 1); return; }
    if (e.target.closest('#snap-next'))   { jumpTo(state.currentIndex + 1); return; }
    if (e.target.closest('#snap-latest')) { jumpTo(state.index.length - 1); return; }

    // Mode toggle
    const sourceBtn = e.target.closest('.source-btn');
    if (sourceBtn) {
      const mode = sourceBtn.dataset.source;
      switchMode(mode);
      return;
    }

    hideTooltip();
  });

  document.addEventListener('snap-jump', e => jumpTo(e.detail));

  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'ArrowLeft')  jumpTo(state.currentIndex - 1);
    if (e.key === 'ArrowRight') jumpTo(state.currentIndex + 1);
    if (e.key === 'Escape')     hideTooltip();
  });

  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[data-score-tooltip]');
    if (el) showTooltip(el, el.dataset.scoreTooltip);
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest('[data-score-tooltip]')) hideTooltip();
  });
  document.addEventListener('chart-filter', e => {
    if (e.detail.type === 'members') state.membersThreshold = e.detail.value;
    if (e.detail.type === 'limit')   state.displayLimit     = e.detail.value;
    renderChart();
  });
}

function setupTheme() {
  const btn = document.getElementById('theme-toggle');

  const updateIcon = theme => btn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon', 18);

  const saved = localStorage.getItem('theme') ?? 'dark';
  document.documentElement.dataset.theme = saved;
  updateIcon(saved);

  btn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    updateIcon(next);
  });
}

init();

