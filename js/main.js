import { buildEnrichedMap } from './analytics.js';
import { loadAll, loadSnapshotPair } from './data-loader.js';
import {
  renderCategorySection,
  renderChartSection,
  renderEventsSection,
  showTooltip,
  hideTooltip,
} from './renderer.js';
import { CONFIG } from './config.js';
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
};

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const loadingEl = document.getElementById('loading');
  const contentEl = document.getElementById('content');

  try {
    const { index, analytics, enriched } = await loadAll();

    if (!index.length) throw new Error('Не вдалося завантажити жодного знімку.');
    
    state.index        = index;
    state.enrichedMap  = buildEnrichedMap(enriched);
    state.currentIndex = index.length - 1;
    state.analytics    = analytics;
    state.maxScoreMap = new Map(
      (analytics?.allAboveThreshold ?? []).map(a => [a.animeId, a.maxScore])
    );

    // Завантажуємо перший снепшот (останній за датою) одразу
    const dates = index.map(s => s.date);
    const { current, prev } = await loadSnapshotPair(dates, state.currentIndex);
    state.currentSnap = current;
    state.prevSnap    = prev;

    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');

    renderAll();
    setupEventListeners();
    setupTheme();

  } catch (err) {
    loadingEl.innerHTML = `
      <div class="error-state">
        <p>❌ ${err.message}</p>
      </div>`;
    console.error('[MAL Charts] Помилка:', err);
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderAll() {
  const sections = [
    () => renderChartSection(state.currentSnap, state.prevSnap, state.enrichedMap, state.index, state.currentIndex, state.analytics?.scoreStreaks ?? {}, state.maxScoreMap),
    () => renderCategorySection(state.analytics.categoryTopHistory),
    () => renderEventsSection(state.analytics),
  ];
  for (const fn of sections) {
    try { fn(); } catch (e) { console.error('[MAL Charts] Секція:', e); }
  }
}

function renderChart() {
  try {
    renderChartSection(state.currentSnap, state.prevSnap, state.enrichedMap, state.index, state.currentIndex, state.analytics?.scoreStreaks ?? {}, state.maxScoreMap);
  } catch (e) { console.error('[MAL Charts] Chart:', e); }
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
    // Info buttons
    const infoBtn = e.target.closest('[data-info-key]');
    if (infoBtn) {
      e.stopPropagation();
      showTooltip(infoBtn, CONFIG.infoTexts[infoBtn.dataset.infoKey] ?? 'Немає опису.');
      return;
    }

    // Snap prev/next
    if (e.target.closest('#snap-prev')) { jumpTo(state.currentIndex - 1); return; }
    if (e.target.closest('#snap-next')) { jumpTo(state.currentIndex + 1); return; }
    if (e.target.closest('#snap-latest')) { jumpTo(state.index.length - 1); return; }

    hideTooltip();
  });

  // Snap page input
  document.addEventListener('snap-jump', e => jumpTo(e.detail));

  // Keyboard
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
}

function setupTheme() {
  const btn   = document.getElementById('theme-toggle');

  const updateIcon = theme =>
    btn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon', 18);

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