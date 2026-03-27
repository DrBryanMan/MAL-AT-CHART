// ─── Utilities ────────────────────────────────────────────────────────────────

export function buildEnrichedMap(enrichedData) {
  return new Map(enrichedData.map(a => [a.mal_id, a]));
}

const UK_UA_DATE_FMT = new Intl.DateTimeFormat('uk-UA', {
  year: 'numeric', month: 'long', day: 'numeric',
});

export function formatDate(dateStr) {
  return UK_UA_DATE_FMT.format(new Date(dateStr + 'T00:00:00'));
}

export function formatDateShort(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}.${m}.${y}`;
}

export function daysBetween(d1, d2) {
  return Math.abs(
    Math.round((new Date(d2 + 'T00:00:00') - new Date(d1 + 'T00:00:00')) / 86_400_000)
  );
}

export function archiveUrl(dateStr) {
  if (!dateStr) return 'https://web.archive.org/web/*/https://myanimelist.net/topanime.php';
  const compact = dateStr.replace(/-/g, '');
  return `https://web.archive.org/web/${compact}120000/https://myanimelist.net/topanime.php`;
}

function sortedAnime(snap) {
  return snap.anime
    .filter(a => a.score != null)
    .toSorted((a, b) => {
      const d = b.score - a.score;
      if (d) return d;
      const ai = a.id, bi = b.id;
      return ai < bi ? -1 : ai > bi ? 1 : 0;
    });
}

// ─── Score Streaks (без dates!) ─────────────────────────────────────────────
export function computeScoreStreaksByAnime(allSnapshots) {
  const active = new Map();
  const byAnime = new Map();

  for (const snap of allSnapshots) {
    const seen = new Set();
    for (const a of snap.anime) {
      if (a.score == null) continue;
      seen.add(a.id);
      const cur = active.get(a.id);
      if (!cur) {
        active.set(a.id, { score: a.score, startDate: snap.date, endDate: snap.date });
      } else if (cur.score === a.score) {
        cur.endDate = snap.date;
      } else {
        if (!byAnime.has(a.id)) byAnime.set(a.id, []);
        byAnime.get(a.id).push({ ...cur });
        active.set(a.id, { score: a.score, startDate: snap.date, endDate: snap.date });
      }
    }
    for (const [id, streak] of active) {
      if (!seen.has(id)) {
        if (!byAnime.has(id)) byAnime.set(id, []);
        byAnime.get(id).push({ ...streak });
        active.delete(id);
      }
    }
  }
  for (const [id, streak] of active) {
    if (!byAnime.has(id)) byAnime.set(id, []);
    byAnime.get(id).push({ ...streak });
  }
  return Object.fromEntries(byAnime);
}

// ─── Chart Data ─────────────────────────────────────────────────────────────
export function computeChartData(snapshot, prevSnap, enrichedMap, scoreStreaks = {}, snapshotDates = []) {
  const sorted = sortedAnime(snapshot);
  const prevSorted = prevSnap ? sortedAnime(prevSnap) : [];

  const prevRankById = new Map();
  for (let i = 0; i < prevSorted.length; i++) prevRankById.set(prevSorted[i].id, i + 1);

  const prevEntryById = prevSnap ? new Map(prevSnap.anime.map(a => [a.id, a])) : null;
  const snapshotDateIndex = snapshotDates instanceof Map
    ? snapshotDates
    : (snapshotDates?.length ? new Map(snapshotDates.map((d, i) => [d, i])) : null);

  const rows = sorted.map((a, i) => {const rank = i + 1;
    const enr = enrichedMap.get(a.id) ?? {};
    const prevRank = prevRankById.get(a.id) ?? null;
    const prevEntry = prevEntryById?.get(a.id) ?? null;

    const scoreStreak = (() => {
      const streaksForAnime = scoreStreaks[a.id] ?? [];
      let s = null;
      for (let i = 0; i < streaksForAnime.length; i++) {
        const cand = streaksForAnime[i];
        if (cand.startDate <= snapshot.date && cand.endDate >= snapshot.date) { s = cand; break; }
      }
      if (!s) return null;

      const startIdx = snapshotDateIndex?.get(s.startDate) ?? -1;
      const currIdx  = snapshotDateIndex?.get(snapshot.date) ?? -1;
      const count = (startIdx >= 0 && currIdx >= 0) ? (currIdx - startIdx + 1) : 1;

      return { ...s, count };
    })();

    return {
      ...a,
      title:        enr.title        ?? a.title   ?? '',
      title_ua:     enr.title_ua     ?? null,
      media_type:   enr.media_type   ?? 'unknown',
      image:        enr.image        ?? null,
      hikka_slug:   enr.hikka_slug   ?? a.slug    ?? null,
      banner_image: enr.banner_image ?? null,
      rank,
      prevRank,
      rankDelta: prevRank !== null ? prevRank - rank : null,
      membersDelta: prevEntry ? a.members - prevEntry.members : null,
      isNew: prevSnap !== null && prevRank === null,
      scoreDelta: prevEntry && prevEntry.score != null 
        ? (Math.round((a.score - prevEntry.score) * 100) / 100) 
        : null,
      scoredByDelta: prevEntry ? a.scored_by - prevEntry.scored_by : null,
      scoreStreak,
    };
  });

  return { snapshot, rows };
}

// ─── Category Top History ───────────────────────────────────────────────────
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
      animeId: anime.id,
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
      .map(a => ({ id: a.id, score: a.score }));

    const eligible    = makeEligible(threshold);
    const eligibleLow = makeEligible(8.5);

    updateCat('all', eligible[0] ?? null, snap.date);
    for (const cat of allCats) {
      const pool = (cat === 'tv' || cat === 'movie') ? eligible : eligibleLow;
      const topInCat = pool.find(a => (enrichedMap.get(a.id)?.media_type ?? 'unknown') === cat) ?? null;
      updateCat(cat, topInCat, snap.date);
    }
  }

  for (const cat of catList) closeSession(cat);

  return { sessions, categories: catList };
}

// ─── Notable Events (тільки animeId + метрики) ──────────────────────────────
function topWithCategoriesIds(sorted, enrichedMap) {
  const top3 = sorted.slice(0, 3).map(a => ({
    animeId: a.id,
    score: a.score,
    date: a.date ?? a.startDate ?? null,
    members: a.members ?? null,
    scored_by: a.scored_by ?? null,
  }));

  const getMedia = id => enrichedMap.get(id)?.media_type ?? 'unknown';

  const find = pred => {
    const found = sorted.find(pred);
    return found ? {
      animeId: found.id,
      score: found.score,
      date: found.date ?? found.startDate ?? null,
      members: found.members ?? null,
      scored_by: found.scored_by ?? null,
    } : null;
  };

  return {
    top3,
    tvWinner: find(a => getMedia(a.id) === 'tv'),
    movieWinner: find(a => getMedia(a.id) === 'movie'),
    otherWinner: find(a => {
      const m = getMedia(a.id);
      return m !== 'tv' && m !== 'movie';
    }),
  };
}

export function computeHighestEver(allSnapshots, enrichedMap) {
  const best = new Map();
  for (const snap of allSnapshots) {
    for (const a of snap.anime) {
      if (a.score == null) continue;
      const ex = best.get(a.id);
      if (!ex || a.score > ex.score)
        best.set(a.id, { id: a.id, score: a.score, date: snap.date, members: a.members ?? null });
    }
  }
  const sorted = [...best.values()].toSorted((a, b) => b.score - a.score);
  if (!sorted.length) return null;
  return { ...topWithCategoriesIds(sorted, enrichedMap), winner: sorted[0] };
}

export function computeLowestEver(allSnapshots, enrichedMap) {
  const worst = new Map();
  for (const snap of allSnapshots) {
    for (const a of snap.anime) {
      if (a.score == null) continue;
      const ex = worst.get(a.id);
      if (!ex || a.score < ex.score)
        worst.set(a.id, { id: a.id, score: a.score, date: snap.date, members: a.members ?? null });
    }
  }
  const sorted = [...worst.values()].toSorted((a, b) => a.score - b.score);
  if (!sorted.length) return null;
  return { ...topWithCategoriesIds(sorted, enrichedMap), winner: sorted[0] };
}

export function computeMostMembers(allSnapshots, enrichedMap) {
  const best = new Map();
  for (const snap of allSnapshots) {
    for (const a of snap.anime) {
      if (a.members == null) continue;
      const ex = best.get(a.id);
      if (!ex || a.members > ex.members) best.set(a.id, { id: a.id, members: a.members, date: snap.date });
    }
  }
  if (!best.size) return null;
  const sorted = [...best.values()].toSorted((a, b) => b.members - a.members);
  return { ...topWithCategoriesIds(sorted, enrichedMap), winner: sorted[0] };
}

export function computeMostScoredBy(allSnapshots, enrichedMap) {
  const best = new Map();
  for (const snap of allSnapshots) {
    for (const a of snap.anime) {
      if (a.scored_by == null) continue;
      const ex = best.get(a.id);
      if (!ex || a.scored_by > ex.scored_by) {
        best.set(a.id, { id: a.id, scored_by: a.scored_by, date: snap.date, members: a.members ?? null });
      }
    }
  }
  if (!best.size) return null;
  const sorted = [...best.values()].toSorted((a, b) => b.scored_by - a.scored_by);
  return { ...topWithCategoriesIds(sorted, enrichedMap), winner: sorted[0] };
}

export function computeMostStableScore(allSnapshots, enrichedMap) {
  if (allSnapshots.length < 2) return null;

  const active = new Map();
  const completed = [];

  for (const snap of allSnapshots) {
    const seen = new Set();
    for (const a of snap.anime) {
      if (a.score == null) continue;
      seen.add(a.id);
      const cur = active.get(a.id);
      if (!cur) {
        active.set(a.id, { animeId: a.id, score: a.score, startDate: snap.date, endDate: snap.date, count: 1 });
      } else if (cur.score === a.score) {
        cur.endDate = snap.date;
        cur.count++;
      } else {
        completed.push({ ...cur });
        active.set(a.id, { animeId: a.id, score: a.score, startDate: snap.date, endDate: snap.date, count: 1 });
      }
    }
    for (const [id, streak] of active) {
      if (!seen.has(id)) {
        completed.push({ ...streak });
        active.delete(id);
      }
    }
  }
  for (const s of active.values()) completed.push({ ...s });

  const sorted = completed
    .filter(s => s.count > 1)
    .toSorted((a, b) => b.count - a.count || daysBetween(a.startDate, a.endDate) - daysBetween(b.startDate, b.endDate));

  if (!sorted.length) return null;

  const top3 = sorted.slice(0, 3);
  const getWinner = cat => {
    const match = sorted.find(s => {
      const m = enrichedMap.get(s.animeId)?.media_type ?? 'unknown';
      return cat === 'other' ? (m !== 'tv' && m !== 'movie') : m === cat;
    });
    return match ?? null;
  };

  return {
    winner:      top3[0],
    top3,
    tvWinner:    getWinner('tv'),
    movieWinner: getWinner('movie'),
    otherWinner: getWinner('other'),
  };
}

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
      cur = {
        animeId: top.id,
        startDate: snap.date,
        endDate: snap.date,
        days: 0,
        firstScore: top.score,
        maxScore: top.score,
      };
    }
  }
  close();

  const sorted = sessions.toSorted((a, b) => b.days - a.days);
  if (!sorted.length) return null;

  const top3 = sorted.slice(0, 3);
  const getWinner = cat => {
    const match = sorted.find(s => {
      const m = enrichedMap.get(s.animeId)?.media_type ?? 'unknown';
      return cat === 'other' ? (m !== 'tv' && m !== 'movie') : m === cat;
    });
    return match ?? null;
  };

  return {
    winner:      top3[0],
    top3,
    tvWinner:    getWinner('tv'),
    movieWinner: getWinner('movie'),
    otherWinner: getWinner('other'),
  };
}

export function computeAllAboveThreshold(allSnapshots, threshold, enrichedMap) {
  const seen = new Map();
  for (const snap of allSnapshots) {
    for (const a of snap.anime) {
      if (a.score == null || a.score < threshold) continue;
      const ex = seen.get(a.id);
      if (!ex) {
        seen.set(a.id, { animeId: a.id, maxScore: a.score, maxScoreDate: snap.date, firstDate: snap.date });
      } else if (a.score > ex.maxScore) {
        ex.maxScore = a.score;
        ex.maxScoreDate = snap.date;
      }
    }
  }
  return [...seen.values()].toSorted((a, b) => b.maxScore - a.maxScore);
}

export function computeScoreRecordsByAnime(allSnapshots) {
  const byAnime = new Map();
  const bestByAnime = new Map();

  for (const snap of allSnapshots) {
    for (const a of snap.anime) {
      if (a.score == null) continue;

      const prevBest = bestByAnime.get(a.id);
      if (prevBest != null && a.score <= prevBest) continue;

      bestByAnime.set(a.id, a.score);
      if (!byAnime.has(a.id)) byAnime.set(a.id, []);
      byAnime.get(a.id).push({
        score: a.score,
        date: snap.date,
      });
    }
  }

  return Object.fromEntries(byAnime);
}

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
      cur = {
        animeId: top.id,
        firstScore: top.score,
        maxScore: top.score,
        startDate: snap.date,
        endDate: snap.date,
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
  return [...byAnime.values()];
}

export function computeMostStableTopN(allSnapshots, enrichedMap, threshold = 9.0) {
  if (allSnapshots.length < 2) return null;

  const getTop = snap => snap.anime
    .filter(a => a.score != null && a.score >= threshold)
    .toSorted((a, b) => b.score - a.score || a.id - b.id);

  const stablePrefix = (a, b) => {
    let k = 0;
    while (k < a.length && k < b.length) {
      if (a[k].id === b[k].id) { k++; continue; }
      const scoreK = b[k].score;
      let endB = k;
      while (endB + 1 < b.length && b[endB + 1].score === scoreK) endB++;
      if (endB >= a.length) break;
      const setB = new Set(b.slice(k, endB + 1).map(x => x.id));
      const setA = new Set(a.slice(k, endB + 1).map(x => x.id));
      if (setA.size !== setB.size || ![...setB].every(id => setA.has(id))) break;
      k = endB + 1;
    }
    return k;
  };

  const prefixes = allSnapshots.slice(0, -1).map((_, i) =>
    stablePrefix(getTop(allSnapshots[i]), getTop(allSnapshots[i + 1]))
  );

  const maxN = Math.max(0, ...prefixes);
  if (maxN === 0) return null;

  let best = null;
  for (let n = maxN; n >= 1; n--) {
    if (best && n < best.n) break;
    let runStart = -1;
    for (let i = 0; i <= prefixes.length; i++) {
      const ok = i < prefixes.length && prefixes[i] >= n;
      if (ok) {
        if (runStart === -1) runStart = i;
      } else if (runStart !== -1) {
        const snapCount = i - runStart + 1;
        const startDate = allSnapshots[runStart].date;
        const endDate = allSnapshots[i].date;
        const days = daysBetween(startDate, endDate);

        if (!best || n > best.n || (n === best.n && snapCount > best.snapCount)) {
          best = {
            n,
            startDate,
            endDate,
            snapCount,
            days,
            topN: getTop(allSnapshots[runStart]).slice(0, n).map(a => ({ animeId: a.id, score: a.score })),
          };
        }
        runStart = -1;
      }
    }
  }
  return best;
}

export function computeMostHighRatedAtOnce(allSnapshots, threshold, enrichedMap) {
  let best = null;
  for (const snap of allSnapshots) {
    const high = snap.anime.filter(a => a.score != null && a.score >= threshold);
    if (!best || high.length > best.count) {
      best = {
        date: snap.date,
        count: high.length,
        anime: high.toSorted((a, b) => b.score - a.score).map(a => ({ animeId: a.id, score: a.score })),
      };
    }
  }
  return best;
}

export function computeAll(snapshots, enrichedMap, threshold = 9.0) {
  return {
    scoreStreaks:       computeScoreStreaksByAnime(snapshots),
    scoreRecordsByAnime:computeScoreRecordsByAnime(snapshots),
    categoryTopHistory: computeCategoryTopHistory(snapshots, enrichedMap, threshold),
    highestEver:        computeHighestEver(snapshots, enrichedMap),
    lowestEver:         computeLowestEver(snapshots, enrichedMap),
    mostMembers:        computeMostMembers(snapshots, enrichedMap),
    mostScoredBy:       computeMostScoredBy(snapshots, enrichedMap),
    mostStableScore:    computeMostStableScore(snapshots, enrichedMap),
    longestTop1:        computeLongestAtTop1(snapshots, enrichedMap),
    allAboveThreshold:  computeAllAboveThreshold(snapshots, threshold, enrichedMap),
    top1History:        computeTop1History(snapshots, enrichedMap),
    mostStableTopN:     computeMostStableTopN(snapshots, enrichedMap, threshold),
    mostAtOnce:         computeMostHighRatedAtOnce(snapshots, threshold, enrichedMap),
  };
}
