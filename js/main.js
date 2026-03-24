import { buildEnrichedMap } from './analytics.js';
import { loadAll, loadSnapshotPair } from './data-loader.js';
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

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  index:        [],
  currentSnap:  null,
  prevSnap:     null,
  enrichedMap:  new Map(),
  analytics:    null,
  currentIndex: 0,
  maxScoreMap:  new Map(),
  currentMode:      'mal',
  membersThreshold: 0,
  displayLimit:     50,
};

// ─── Mode helpers ─────────────────────────────────────────────────────────────

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
      ? 'Архів рейтинґів Hikka з 02.2026'
      : 'Архів рейтинґів MyAnimeList з 2006';
  }

  const toggleBtn = document.getElementById('mode-toggle-btn');
  if (toggleBtn) toggleBtn.dataset.mode = mode;

  document.querySelectorAll('.mode-logo').forEach(el => {
    el.classList.toggle('active', el.dataset.source === mode);
  });
  document.querySelectorAll('.source-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.source === mode);
  });
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

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const mode = getStoredMode();
  state.currentMode = mode;
  applyMode(mode);
  applyModeUI(mode);
  setupEventListeners();
  setupTheme();
  await loadData();
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadData() {
  const loadingEl = document.getElementById('loading');
  const contentEl = document.getElementById('content');
  contentEl.classList.remove('visible');

  if (loadingEl) {
    loadingEl.innerHTML = `<div class="spinner"></div><p>Завантаження даних…</p>`;
    loadingEl.classList.remove('hidden');
  }
  // if (contentEl) contentEl.classList.add('hidden');

  try {
    const { index, analytics, enriched } = await loadAll();

    if (!index.length) throw new Error('Не вдалося завантажити жодного знімку.');

    state.index        = index;
    state.enrichedMap  = buildEnrichedMap(enriched);
    state.currentIndex = index.length - 1;
    state.analytics    = analytics;
    state.maxScoreMap  = new Map(
      (analytics?.allAboveThreshold ?? []).map(a => [a.animeId, { maxScore: a.maxScore, maxScoreDate: a.maxScoreDate }])
    );

    const dates = index.map(s => s.date);
    const { current, prev } = await loadSnapshotPair(dates, state.currentIndex);
    state.currentSnap = current;
    state.prevSnap    = prev;

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
      loadingEl.innerHTML = `<div class="error-state"><p>❌ ${err.message}</p></div>`;
    }
    console.error('[Charts] Помилка:', err);
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderAll() {
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
    try { fn(); } catch (e) { console.error('[Charts] Секція:', e); }
  }
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

async function jumpTo(idx) {
  const clamped = Math.max(0, Math.min(state.index.length - 1, idx));
  if (clamped === state.currentIndex) return;
  state.currentIndex = clamped;

  const dates = state.index.map(s => s.date);
  const { current, prev } = await loadSnapshotPair(dates, clamped);
  state.currentSnap = current;
  state.prevSnap    = prev;

  renderChart();
}

// ─── Events ───────────────────────────────────────────────────────────────────

function setupEventListeners() {
  document.addEventListener('click', e => {
    const infoBtn = e.target.closest('[data-info-key]');
    if (infoBtn) {
      e.stopPropagation();
      showTooltip(infoBtn, CONFIG.infoTexts[infoBtn.dataset.infoKey] ?? 'Немає опису.');
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