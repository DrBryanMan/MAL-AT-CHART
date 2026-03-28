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

// State

const state = {
  index:        [],
  currentSnap:  null,
  prevSnap:     null,
  latestSnap:   null,
  latestMonthSnap: null,
  enrichedMap:  new Map(),
  analytics:    null,
  currentIndex: 0,
  scoreRecordMap: new Map(),
  currentMode:      'mal',
  membersThreshold: 0,
  displayLimit:     50,
};

// Mode helpers

function getStoredMode() {
  return localStorage.getItem('data-mode') ?? 'mal';
}

function applyModeUI(mode) {
  setRendererSource(mode);
  document.documentElement.dataset.mode = mode;

  const titleEl = document.querySelector('.site-title');
  if (titleEl) {
    titleEl.innerHTML = mode === 'hikka'
      ? '<span class="accent">Hikka</span> Ratings Chart'
      : '<span class="accent">MAL</span> Ratings Chart';
  }

  const subtitleEl = document.querySelector('.site-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = mode === 'hikka'
      ? 'Архів рейтингів Hikka з 02.2026'
      : 'Архів рейтингів MyAnimeList з 2006';
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

// Init

async function init() {
  const mode = getStoredMode();
  state.currentMode = mode;
  applyMode(mode);
  applyModeUI(mode);
  setupEventListeners();
  setupTheme();
  await loadData();
}

// Data loading

async function loadData() {
  const loadingEl = document.getElementById('loading');
  const contentEl = document.getElementById('content');
  contentEl.classList.remove('visible');

  if (loadingEl) {
    loadingEl.innerHTML = `<div class="spinner"></div><p>Завантаження даних...</p>`;
    loadingEl.classList.remove('hidden');
  }
  // if (contentEl) contentEl.classList.add('hidden');

  try {
    const { index, analytics, enriched } = await loadAll(state.currentMode);

    if (!index.length) throw new Error('Не вдалося завантажити жодного знімку.');

    state.index        = index;
    state.enrichedMap  = buildEnrichedMap(enriched);
    state.currentIndex = index.length - 1;
    state.analytics    = analytics;
    state.scoreRecordMap = new Map(
      Object.entries(analytics?.scoreRecordsByAnime ?? {}).map(([id, records]) => [Number(id), records])
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
      loadingEl.innerHTML = `<div class="error-state"><p>Помилка: ${err.message}</p></div>`;
    }
    console.error('[Charts] Помилка:', err);
  }
}

// Render

function renderAll() {
  renderHikkaSummary();

  const sections = [
    () => renderChartSection(
      state.currentSnap,
      state.prevSnap,
      state.enrichedMap,
      state.index,
      state.currentIndex,
      state.analytics?.scoreStreaks ?? {},
      state.scoreRecordMap,
      state.membersThreshold,
      state.displayLimit,
    ),
    () => renderCategorySection(state.analytics.categoryTopHistory, state.enrichedMap),
    () => renderEventsSection(state.analytics, state.currentMode, state.enrichedMap),
  ];
  for (const fn of sections) {
    try {
      fn();
    } catch (e) {
      console.error('[Charts] Секція:', e);
    }
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
      state.currentSnap,
      state.prevSnap,
      state.enrichedMap,
      state.index,
      state.currentIndex,
      state.analytics?.scoreStreaks ?? {},
      state.scoreRecordMap,
      state.membersThreshold,
      state.displayLimit,
    );
  } catch (e) {
    console.error('[Charts] Chart:', e);
  }
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

// Events

function setupEventListeners() {
  document.addEventListener('click', e => {
    const infoBtn = e.target.closest('[data-info-key]');
    if (infoBtn) {
      e.stopPropagation();
      showTooltip(infoBtn, CONFIG.infoTexts[infoBtn.dataset.infoKey] ?? 'Немає опису.');
      return;
    }

    if (e.target.closest('#snap-prev')) {
      jumpTo(state.currentIndex - 1);
      return;
    }
    if (e.target.closest('#snap-next')) {
      jumpTo(state.currentIndex + 1);
      return;
    }
    if (e.target.closest('#snap-latest')) {
      jumpTo(state.index.length - 1);
      return;
    }

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
