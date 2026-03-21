/**
 * main.js — Application entry point
 *
 * Завантажує дані, запускає аналітику, рендерить UI та налаштовує події.
 */

import { loadAll }                               from './data-loader.js';
import { buildEnrichedMap, computeAll }          from './analytics.js';
import {
  renderCategorySection,
  renderChartSection,
  renderEventsSection,
  showTooltip,
  hideTooltip,
}                                                from './renderer.js';
import { CONFIG }                                from './config.js';

// ─── App State ────────────────────────────────────────────────────────────────

const state = {
  snapshots:     [],
  enrichedMap:   new Map(),
  analytics:     null,
  currentIndex:  0,   // індекс поточного знімку в секції 2
};

// ─── Entry ───────────────────────────────────────────────────────────────────

async function init() {
  const loadingEl = document.getElementById('loading');
  const contentEl = document.getElementById('content');

  try {
    const { snapshots, enriched } = await loadAll();

    if (!snapshots.length) {
      throw new Error('Не вдалося завантажити жодного знімку. Перевірте CONFIG.snapshots та наявність файлів.');
    }

    state.snapshots   = snapshots;
    state.enrichedMap = buildEnrichedMap(enriched);
    state.currentIndex = snapshots.length - 1; // за замовчуванням — останній (найновіший)

    state.analytics = computeAll(
      state.snapshots,
      state.enrichedMap,
      CONFIG.thresholds.topRated,
      CONFIG.stableTopN,
    );

    loadingEl.classList.add('hidden');
    contentEl.classList.remove('hidden');

    renderAll();
    setupEventListeners();

  } catch (err) {
    loadingEl.innerHTML = `
      <div class="error-state">
        <p>❌ ${err.message}</p>
        <p class="error-hint">
          Запустіть локальний сервер: <code>npx serve .</code> або <code>python -m http.server</code>
        </p>
      </div>`;
    console.error('[MAL Charts] Помилка:', err);
  }
}

// ─── Render All ───────────────────────────────────────────────────────────────

function renderAll() {
  renderCategorySection(state.analytics.topByCategory);
  renderChartSection(
    state.snapshots,
    state.currentIndex,
    state.enrichedMap,
    CONFIG.thresholds.topRated,
  );
  renderEventsSection(state.analytics);
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

function setupEventListeners() {
  // ─ Global delegated click ─
  document.addEventListener('click', e => {

    // 1. Info buttons у секційних заголовках (статичний HTML)
    const infoBtn = e.target.closest('[data-info-key]');
    if (infoBtn) {
      e.stopPropagation();
      showTooltip(infoBtn, CONFIG.infoTexts[infoBtn.dataset.infoKey] ?? 'Немає опису.');
      return;
    }

    // 2. Навігація по знімках (prev / next)
    const navBtn = e.target.closest('#snap-prev, #snap-next');
    if (navBtn) {
      const delta   = navBtn.id === 'snap-prev' ? -1 : 1;
      const newIdx  = state.currentIndex + delta;

      if (newIdx < 0 || newIdx >= state.snapshots.length) return;

      state.currentIndex = newIdx;
      renderChartSection(
        state.snapshots,
        state.currentIndex,
        state.enrichedMap,
        CONFIG.thresholds.topRated,
      );
      return;
    }

    // 3. Закрити тултип при кліку деінде
    hideTooltip();
  });

  // ─ Keyboard navigation для знімків ─
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;

    if (e.key === 'ArrowLeft' && state.currentIndex > 0) {
      state.currentIndex--;
      renderChartSection(
        state.snapshots,
        state.currentIndex,
        state.enrichedMap,
        CONFIG.thresholds.topRated,
      );
    } else if (e.key === 'ArrowRight' && state.currentIndex < state.snapshots.length - 1) {
      state.currentIndex++;
      renderChartSection(
        state.snapshots,
        state.currentIndex,
        state.enrichedMap,
        CONFIG.thresholds.topRated,
      );
    }
  });

  // ─ Закрити тултип на Escape ─
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideTooltip();
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

init();