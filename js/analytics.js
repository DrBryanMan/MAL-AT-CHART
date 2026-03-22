/**
 * analytics.js — All statistical computations over MAL snapshots
 */

// ─── Utilities ────────────────────────────────────────────────────────────────

export function buildEnrichedMap(enrichedData) {
  return new Map(enrichedData.map(a => [a.mal_id, a]));
}

export function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('uk-UA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

export function formatDateShort(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

/** Точна кількість днів між двома датами YYYY-MM-DD */
export function daysBetween(d1, d2) {
  return Math.abs(
    Math.round((new Date(d2 + 'T00:00:00') - new Date(d1 + 'T00:00:00')) / 86_400_000)
  );
}

/** Посилання на web.archive.org для конкретної дати */
export function archiveUrl(dateStr) {
  const compact = dateStr.replace(/-/g, '');
  return `https://web.archive.org/web/${compact}120000/https://myanimelist.net/topanime.php`;
}

function enrich(a, enrichedMap) {
  const enr = enrichedMap.get(a.id) ?? {};
  return {
    ...a,
    title_ua:   enr.title_ua   ?? null,
    media_type: enr.media_type ?? 'unknown',
    image:      enr.image      ?? null,
    hikka_slug: enr.hikka_slug ?? null,
    banner_image: enr.banner_image ?? null,
  };
}

function sortedAnime(snap) {
  return snap.anime.filter(a => a.score != null).toSorted((a, b) => b.score - a.score || a.id - b.id);
}

// ─── Section 1: Category Top History ─────────────────────────────────────────

export function computeCategoryTopHistory(allSnapshots, enrichedMap, threshold) {
  const allCats = new Set();
  for (const snap of allSnapshots) {
    for (const a of snap.anime) {
      allCats.add(enrichedMap.get(a.id)?.media_type ?? 'unknown');
    }
  }

  const catList        = ['all', ...allCats];
  const sessions       = Object.fromEntries(catList.map(c => [c, []]));
  const currentSession = Object.fromEntries(catList.map(c => [c, null]));
  const sessionCounts  = Object.fromEntries(catList.map(c => [c, new Map()]));

  const closeSession = cat => {
    if (currentSession[cat]) {
      sessions[cat].push({ ...currentSession[cat] });
      currentSession[cat] = null;
    }
  };

  const openSession = (cat, anime, date) => {
    const cnt = (sessionCounts[cat].get(anime.id) ?? 0) + 1;
    sessionCounts[cat].set(anime.id, cnt);
    currentSession[cat] = {
      animeId:    anime.id,
      title:      anime.title,
      title_ua:   anime.title_ua,
      media_type: anime.media_type,
      image:      anime.image,
      hikka_slug: anime.hikka_slug ?? null,
      firstScore: anime.score,
      maxScore:   anime.score,
      startDate:  date,
      endDate:    date,
      sessionNum: cnt,
    };
  };

  const updateCat = (cat, top, date) => {
    const cur = currentSession[cat];
    if (!top) { closeSession(cat); return; }
    if (cur?.animeId === top.id) {
      cur.endDate  = date;
      cur.maxScore = Math.max(cur.maxScore, top.score);
    } else {
      closeSession(cat);
      openSession(cat, top, date);
    }
  };

  for (const snap of allSnapshots) {
    const makeEligible = min => snap.anime
      .filter(a => a.score != null && a.score >= min)
      .map(a => enrich(a, enrichedMap))
      .toSorted((a, b) => b.score - a.score);

    const eligible    = makeEligible(threshold);
    const eligibleLow = makeEligible(8.5);

    updateCat('all', eligible[0] ?? null, snap.date);
    for (const cat of allCats) {
      const pool = (cat === 'tv' || cat === 'movie') ? eligible : eligibleLow;
      updateCat(cat, pool.find(a => a.media_type === cat) ?? null, snap.date);
    }
  }

  for (const cat of catList) closeSession(cat);

  return { sessions, categories: catList };
}

// ─── Section 2: Chart Data ────────────────────────────────────────────────────

export function computeChartData(snapshot, prevSnap, enrichedMap) {

  const sorted     = sortedAnime(snapshot);
  const prevSorted = prevSnap ? sortedAnime(prevSnap) : [];

  const rows = sorted.map((a, i) => {
    const rank      = i + 1;
    const enr       = enrichedMap.get(a.id) ?? {};
    const prevIdx   = prevSorted.findIndex(p => p.id === a.id);
    const prevRank  = prevIdx >= 0 ? prevIdx + 1 : null;
    const prevEntry = prevSnap?.anime.find(p => p.id === a.id) ?? null;

    return {
      ...a,
      title_ua:     enr.title_ua   ?? null,
      media_type:   enr.media_type ?? 'unknown',
      image:        enr.image      ?? null,
      hikka_slug:   enr.hikka_slug ?? null,
      banner_image: enr.banner_image ?? null,
      rank,
      prevRank,
      rankDelta:    prevRank !== null ? prevRank - rank : null,
      scoreDelta:   prevEntry ? +(a.score - prevEntry.score).toFixed(2) : null,
      membersDelta: prevEntry ? a.members - prevEntry.members           : null,
      isNew:        prevSnap !== null && prevIdx === -1,
    };
  });

  return { snapshot, rows };
}

// ─── Section 3: Notable Events ────────────────────────────────────────────────

function topWithCategories(sorted, enrichedMap) {
  const enriched = sorted.map(a => ({ ...enrich(a, enrichedMap), animeId: a.id }));
  const top3     = enriched.slice(0, 3);
  const find     = pred => enriched.find(pred) ?? null;
  return {
    top3,
    tvWinner:    find(a => a.media_type === 'tv'),
    movieWinner: find(a => a.media_type === 'movie'),
    otherWinner: find(a => a.media_type !== 'tv' && a.media_type !== 'movie'),
  };
}

/** 3a. Найвища оцінка за всю доступну історію */
export function computeHighestEver(allSnapshots, enrichedMap) {
  const best = new Map();
  for (const snap of allSnapshots) {
    for (const a of snap.anime) {
      if (a.score == null) continue;
      const ex = best.get(a.id);
      if (!ex || a.score > ex.score) best.set(a.id, { ...a, date: snap.date });
    }
  }
  const sorted = [...best.values()].toSorted((a, b) => b.score - a.score);
  if (!sorted.length) return null;
  const enrichedFirst = enrich(sorted[0], enrichedMap);
  return { ...topWithCategories(sorted, enrichedMap), winner: { ...enrichedFirst, animeId: sorted[0].id } };
}

/** 3b. Найстабільніша оцінка */
export function computeMostStableScore(allSnapshots, enrichedMap) {
  if (allSnapshots.length < 2) return null;

  const active    = new Map();
  const completed = [];
  const promote   = streak => completed.push({ ...streak });

  for (const snap of allSnapshots) {
    const seen = new Set();
    for (const a of snap.anime) {
      if (a.score == null) continue;
      seen.add(a.id);
      const cur = active.get(a.id);
      if (!cur) {
        active.set(a.id, { animeId: a.id, title: a.title, score: a.score, startDate: snap.date, endDate: snap.date, count: 1 });
      } else if (cur.score === a.score) {
        cur.endDate = snap.date; cur.count++;
      } else {
        promote(cur);
        active.set(a.id, { animeId: a.id, title: a.title, score: a.score, startDate: snap.date, endDate: snap.date, count: 1 });
      }
    }
    for (const [id, streak] of active) {
      if (!seen.has(id)) { promote(streak); active.delete(id); }
    }
  }
  for (const s of active.values()) promote(s);

  const sorted = completed
    .filter(s => s.count > 1)
    .toSorted((a, b) => b.count - a.count || daysBetween(a.startDate, a.endDate) - daysBetween(b.startDate, b.endDate));

  if (!sorted.length) return null;

  const top3 = sorted.slice(0, 3).map(s => ({
    ...s, ...enrich({ id: s.animeId, title: s.title, score: s.score, members: 0 }, enrichedMap),
  }));

  const getWinner = cat => {
    const match = sorted.find(s => {
      const m = enrichedMap.get(s.animeId)?.media_type ?? 'unknown';
      return cat === 'other' ? (m !== 'tv' && m !== 'movie') : m === cat;
    });
    return match ? { ...match, ...enrich({ id: match.animeId, title: match.title, score: match.score, members: 0 }, enrichedMap) } : null;
  };

  return {
    winner:      top3[0],
    top3,
    tvWinner:    getWinner('tv'),
    movieWinner: getWinner('movie'),
    otherWinner: getWinner('other'),
  };
}

/** 3c. Найдовше утримання ТОП-1 */
export function computeLongestAtTop1(allSnapshots, enrichedMap) {
  if (!allSnapshots.length) return null;

  const sessions = [];
  let cur = null;

  const close = () => { if (cur) { sessions.push({ ...cur }); cur = null; } };

  for (const snap of allSnapshots) {
    const top = sortedAnime(snap)[0];
    if (!top) { close(); continue; }
    if (cur?.animeId === top.id) {
      cur.endDate  = snap.date;
      cur.days     = daysBetween(cur.startDate, cur.endDate);
      cur.maxScore = Math.max(cur.maxScore, top.score);
    } else {
      close();
      cur = { animeId: top.id, title: top.title, startDate: snap.date, endDate: snap.date, days: 0, firstScore: top.score, maxScore: top.score };
    }
  }
  close();

  const sorted = sessions.toSorted((a, b) => b.days - a.days);
  if (!sorted.length) return null;

  const top3 = sorted.slice(0, 3).map(s => ({
    ...s, ...enrich({ id: s.animeId, title: s.title, score: s.maxScore, members: 0 }, enrichedMap),
  }));

  const getWinner = cat => {
    const match = sorted.find(s => {
      const m = enrichedMap.get(s.animeId)?.media_type ?? 'unknown';
      return cat === 'other' ? (m !== 'tv' && m !== 'movie') : m === cat;
    });
    return match ? { ...match, ...enrich({ id: match.animeId, title: match.title, score: match.maxScore, members: 0 }, enrichedMap) } : null;
  };

  return {
    winner:      top3[0],
    top3,
    tvWinner:    getWinner('tv'),
    movieWinner: getWinner('movie'),
    otherWinner: getWinner('other'),
  };
}

/** 3d-1. Усі аніме, що коли-небудь мали оцінку ≥ threshold. */
export function computeAllAboveThreshold(allSnapshots, threshold, enrichedMap) {
  const seen = new Map();
  for (const snap of allSnapshots) {
    for (const a of snap.anime) {
      if (a.score == null || a.score < threshold) continue;
      const ex = seen.get(a.id);
      if (!ex) {
        seen.set(a.id, { animeId: a.id, title: a.title, ...enrich(a, enrichedMap), maxScore: a.score, firstDate: snap.date });
      } else {
        ex.maxScore = Math.max(ex.maxScore, a.score);
      }
    }
  }
  return [...seen.values()].toSorted((a, b) => b.maxScore - a.maxScore);
}

/**
 * 3d-2. Хто тримав ТОП-1.
 * Сесія = безперервний проміжок на #1.
 */
export function computeTop1History(allSnapshots, enrichedMap) {
  const sessions = [];
  let cur = null;

  const close = () => { if (cur) { sessions.push({ ...cur }); cur = null; } };

  for (const snap of allSnapshots) {
    const top = sortedAnime(snap)[0];
    if (!top) { close(); continue; }
    if (cur?.animeId === top.id) {
      cur.endDate  = snap.date;
      cur.maxScore = Math.max(cur.maxScore, top.score);
    } else {
      close();
      const enr = enrichedMap.get(top.id) ?? {};
      cur = {
        animeId:    top.id,
        title:      top.title,
        title_ua:   enr.title_ua   ?? null,
        media_type: enr.media_type ?? 'unknown',
        image:      enr.image      ?? null,
        hikka_slug: enr.hikka_slug ?? null,
        firstScore: top.score,
        maxScore:   top.score,
        startDate:  snap.date,
        endDate:    snap.date,
      };
    }
  }
  close();

  const byAnime = new Map();
  for (const s of sessions) {
    const ex = byAnime.get(s.animeId);
    if (!ex) {
      byAnime.set(s.animeId, { ...s, sessionCount: 1, sessions: [s] });
    } else {
      ex.sessionCount++;
      ex.maxScore = Math.max(ex.maxScore, s.maxScore);
      ex.sessions.push(s);
    }
  }

  return [...byAnime.values()].toSorted((a, b) => new Date(a.startDate) - new Date(b.startDate));
}

/**
 * 3d-3. Найстабільніший ТОП-N.
 *
 * Первинний критерій: максимальне N (більше позицій = краще).
 * Вторинний критерій: найдовша серія (за кількістю знімків).
 *
 * Зміна оцінки без зміни позиції — дозволена.
 * Своп двох аніме з однаковою оцінкою — дозволений.
 */
export function computeMostStableTopN(allSnapshots, enrichedMap, threshold = 9.0) {
  if (allSnapshots.length < 2) return null;

  const getTop = snap => snap.anime
    .filter(a => a.score != null && a.score >= threshold)
    .toSorted((a, b) => b.score - a.score || a.id - b.id);

  // Повертає довжину стабільного префіксу між двома послідовними знімками.
  // Своп аніме з однаковою оцінкою — дозволений.
  const stablePrefix = (a, b) => {
    let k = 0;
    while (k < a.length && k < b.length) {
      if (a[k].id === b[k].id) { k++; continue; }

      // Знаходимо score-групу в B починаючи з k
      const scoreK = b[k].score;
      let endB = k;
      while (endB + 1 < b.length && b[endB + 1].score === scoreK) endB++;

      if (endB >= a.length) break;
      const setB = new Set(b.slice(k, endB + 1).map(x => x.id));
      const setA = new Set(a.slice(k, endB + 1).map(x => x.id));
      if (setA.size !== setB.size) break;
      let match = true;
      for (const id of setB) if (!setA.has(id)) { match = false; break; }
      if (!match) break;

      k = endB + 1;
    }
    return k;
  };

  // prefixes[i] = стабільний префікс між знімком i та i+1
  const prefixes = allSnapshots.slice(0, -1)
    .map((_, i) => stablePrefix(getTop(allSnapshots[i]), getTop(allSnapshots[i + 1])));

  const maxN = Math.max(0, ...prefixes);
  if (maxN === 0) return null;

  let best = null;

  // Ітеруємо від maxN вниз — перше знайдене best.n буде найбільшим
  for (let n = maxN; n >= 1; n--) {
    // Якщо вже є результат з більшим n — менші нас не цікавлять
    if (best && n < best.n) break;

    let runStart = -1;
    for (let i = 0; i <= prefixes.length; i++) {
      const ok = i < prefixes.length && prefixes[i] >= n;
      if (ok) {
        if (runStart === -1) runStart = i;
      } else if (runStart !== -1) {
        const snapCount = i - runStart + 1;
        const startDate = allSnapshots[runStart].date;
        const endDate   = allSnapshots[i].date;
        const days      = daysBetween(startDate, endDate);

        // Первинний критерій: n більше; вторинний: snapCount більше
        if (!best || n > best.n || (n === best.n && snapCount > best.snapCount)) {
          best = {
            n, startDate, endDate, snapCount, days,
            topN: getTop(allSnapshots[runStart]).slice(0, n).map(a => enrich(a, enrichedMap)),
          };
        }
        runStart = -1;
      }
    }
  }

  return best;
}

/** 3d-4. В якому знімку одночасно було найбільше аніме з оцінкою ≥ threshold. */
export function computeMostHighRatedAtOnce(allSnapshots, threshold, enrichedMap) {
  let best = null;
  for (const snap of allSnapshots) {
    const high = snap.anime.filter(a => a.score != null && a.score >= threshold);
    if (!best || high.length > best.count) {
      best = {
        date:  snap.date,
        count: high.length,
        anime: high.toSorted((a, b) => b.score - a.score).map(a => enrich(a, enrichedMap)),
      };
    }
  }
  return best;
}

// ─── Master computation ───────────────────────────────────────────────────────

export function computeAll(snapshots, enrichedMap, threshold = 9.0) {
  return {
    categoryTopHistory: computeCategoryTopHistory(snapshots, enrichedMap, threshold),
    highestEver:        computeHighestEver(snapshots, enrichedMap),
    mostStableScore:    computeMostStableScore(snapshots, enrichedMap),
    longestTop1:        computeLongestAtTop1(snapshots, enrichedMap),
    allAboveThreshold:  computeAllAboveThreshold(snapshots, threshold, enrichedMap),
    top1History:        computeTop1History(snapshots, enrichedMap),
    mostStableTopN:     computeMostStableTopN(snapshots, enrichedMap, threshold),
    mostAtOnce:         computeMostHighRatedAtOnce(snapshots, threshold, enrichedMap),
  };
}