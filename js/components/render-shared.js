import { icon } from '../icons.js';
import { CONFIG } from '../config.js';
import { archiveUrl } from '../analytics.js';

let currentSource = 'mal';
let activeAnchor = null;

export function setRendererSource(source) {
  currentSource = source;
}

export const $ = id => document.getElementById(id);
export const fmtNum = n => (n ?? 0).toLocaleString('uk-UA');
export const fmtScore = s => (s ?? 0).toFixed(2);

export function fmtDelta(val, decimals = 0) {
  if (val === null || val === undefined || val === 0) return val === 0 ? '±0' : '';
  return (val > 0 ? '+' : '−') + Math.abs(val).toFixed(decimals);
}

export function deltaClass(val) {
  if (!val || val === 0) return 'neutral';
  return val > 0 ? 'positive' : 'negative';
}

export function escAttr(str) {
  return String(str ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function dateLink(dateStr, label) {
  if (currentSource !== 'mal') return `<span class="date-text">${label}</span>`;
  return `<a class="archive-link" href="${archiveUrl(dateStr)}" target="_blank" rel="noopener" title="Архів MAL">${label}</a>`;
}

export function animeTitleHTML(a, cls = '') {
  const name = escHtml(a.title_ua ?? a.title);
  const slug = a.hikka_slug ?? a.slug ?? null;
  const malId = a.id ?? a.mal_id ?? null;

  if (slug) return `<a class="${cls} anime-link" href="https://hikka.io/anime/${escAttr(slug)}" target="_blank" rel="noopener">${name}</a>`;
  if (malId) return `<a class="${cls} anime-link" href="https://myanimelist.net/anime/${encodeURIComponent(malId)}" target="_blank" rel="noopener">${name}</a>`;
  return `<span class="${cls}">${name}</span>`;
}

export function rankBadgeHTML(delta, isNew) {
  if (isNew) return `<span class="rank-badge rank-new">New</span>`;
  if (delta === null) return `<span class="rank-badge rank-same">—</span>`;
  if (delta === 0) return `<span class="rank-badge rank-same">${icon('minus', 9)}</span>`;
  if (delta > 0) return `<span class="rank-badge rank-up">${icon('arrow-up', 9)} ${delta}</span>`;
  return `<span class="rank-badge rank-down">${icon('arrow-down', 9)} ${Math.abs(delta)}</span>`;
}

export function thumbHTML(src, alt, cls = '') {
  if (!src) return `<div class="anime-thumb placeholder ${cls}"></div>`;
  return `<img class="anime-thumb ${cls}" src="${escAttr(src)}" alt="${escAttr(alt)}" loading="lazy">`;
}

export function mediaBadgeHTML(type) {
  const label = CONFIG.categoryLabels[type] ?? (type?.toUpperCase() ?? '?');
  const iconName = CONFIG.categoryIcons[type] ?? 'help-circle';
  return `<span class="badge badge-${type ?? 'unknown'}">${icon(iconName, 10)} ${label}</span>`;
}

export function collapsibleList(rows, limit = 10) {
  if (rows.length <= limit) return rows.join('');
  const visible = rows.slice(0, limit).join('');
  const hidden = rows.slice(limit).join('');
  return `${visible}
    <div class="collapsed-rows hidden">${hidden}</div>
    <button class="show-more-btn" data-show-more>Показати ще ${rows.length - limit} →</button>`;
}

export function pluralUk(n, genPlural, genSingularFew, nominativeSingular) {
  const abs = Math.abs(n) % 100;
  const rem = abs % 10;
  if (abs >= 11 && abs <= 14) return genPlural;
  if (rem === 1) return nominativeSingular;
  if (rem >= 2 && rem <= 4) return genSingularFew;
  return genPlural;
}

export function bannerStyle(url) {
  return url ? `style="--banner:url('${escAttr(url)}')"` : '';
}

export function showTooltip(anchor, text) {
  const tip = $('tooltip-popup');
  if (!tip) return;
  if (activeAnchor === anchor) {
    hideTooltip();
    return;
  }
  tip.textContent = text;
  tip.classList.add('visible');
  tip.setAttribute('aria-hidden', 'false');
  activeAnchor = anchor;
  const rect = anchor.getBoundingClientRect();
  let top = rect.bottom + window.scrollY + 8;
  let left = rect.left + window.scrollX;
  if (left + 300 > window.innerWidth - 12) left = window.innerWidth - 312;
  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
}

export function hideTooltip() {
  const tip = $('tooltip-popup');
  if (tip) {
    tip.classList.remove('visible');
    tip.setAttribute('aria-hidden', 'true');
  }
  activeAnchor = null;
}

export function setupTabs(container) {
  container.querySelectorAll('.tab-list .tab-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      if (e.target.closest('.tab-info-btn')) return;
      const key = btn.dataset.tab;
      const scope = btn.closest('.tabs');
      scope.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      scope.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      scope.querySelector(`.tab-panel[data-panel="${key}"]`)?.classList.add('active');
    });
  });
}

export function setupShowMore(container) {
  container.querySelectorAll('[data-show-more]').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.previousElementSibling?.classList.remove('hidden');
      btn.remove();
    });
  });

  container.querySelectorAll('.session-group-header[data-toggle]').forEach(header => {
    header.addEventListener('click', () => {
      const body = header.nextElementSibling;
      const chevron = header.querySelector('.group-chevron');
      const open = !body.classList.contains('hidden');
      body.classList.toggle('hidden', open);
      header.closest('.session-group').classList.toggle('open', !open);
      chevron.style.transform = open ? '' : 'rotate(90deg)';
    });
  });
}

export function getFullAnime(minimal, enrichedMap) {
  if (!minimal?.animeId && !minimal?.id) return { ...minimal };
  const id = minimal.animeId ?? minimal.id;
  const enr = enrichedMap.get(id) ?? {};
  return {
    id,
    title: enr.title ?? minimal.title ?? '',
    title_ua: enr.title_ua ?? minimal.title_ua ?? null,
    media_type: enr.media_type ?? minimal.media_type ?? 'unknown',
    image: enr.image ?? minimal.image ?? null,
    hikka_slug: enr.hikka_slug ?? minimal.hikka_slug ?? null,
    banner_image: enr.banner_image ?? minimal.banner_image ?? null,
    score: minimal.score ?? null,
    members: minimal.members ?? null,
    scored_by: minimal.scored_by ?? null,
    date: minimal.date ?? null,
    startDate: minimal.startDate ?? null,
    endDate: minimal.endDate ?? null,
    ...minimal,
  };
}

export function hasPositiveWinnerValue(data, field) {
  return (data?.winner?.[field] ?? 0) > 0;
}
