/**
 * analytics.js — All statistical computations over MAL snapshots
 *
 * Кожна функція є чистою (pure), не має побічних ефектів.
 */

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Створює Map: mal_id → збагачені дані аніме.
 * @param {object[]} enrichedData
 * @returns {Map<number, object>}
 */
export function buildEnrichedMap(enrichedData) {
  return new Map(enrichedData.map(a => [a.mal_id, a]));
}

/**
 * Форматує дату рядком до людиночитабельного вигляду (uk-UA).
 * @param {string} dateStr YYYY-MM-DD
 * @returns {string}
 */
export function formatDate(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('uk-UA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

/**
 * Повертає список аніме з певного знімку, збагачений даними з enrichedMap.
 * @param {object}            snapshot
 * @param {Map<number,object>} enrichedMap
 * @returns {object[]}
 */
function enrichSnapshot(snapshot, enrichedMap) {
  return snapshot.anime.map(a => {
    const enr = enrichedMap.get(a.id) ?? {};
    return {
      ...a,
      title_ua:   enr.title_ua   ?? null,
      media_type: enr.media_type ?? 'unknown',
      image:      enr.image      ?? null,
    };
  });
}

// ─── Section 1: Top by Category ───────────────────────────────────────────────

/**
 * Групує аніме останнього знімку за типом медіа.
 * В кожній категорії — відсортовано за оцінкою (спадання).
 *
 * @param {object[]}          allSnapshots
 * @param {Map<number,object>} enrichedMap
 * @returns {Record<string, object[]>}  { tv: [...], movie: [...], ... }
 */
export function computeTopByCategory(allSnapshots, enrichedMap) {
  if (!allSnapshots.length) return {};

  const latest  = allSnapshots.at(-1);
  const tagged  = enrichSnapshot(latest, enrichedMap);
  const grouped = Object.groupBy(tagged, a => a.media_type);

  return Object.fromEntries(
    Object.entries(grouped).map(([cat, list]) => [
      cat,
      list.toSorted((a, b) => b.score - a.score),
    ])
  );
}

// ─── Section 2: Chart Data ────────────────────────────────────────────────────

/**
 * Формує дані для рядків чарту за конкретним знімком.
 * Обчислює дельти відносно попереднього знімку.
 *
 * @param {object[]}          allSnapshots
 * @param {number}            index        — індекс обраного знімку
 * @param {number}            threshold    — мінімальна оцінка (напр. 9.0)
 * @param {Map<number,object>} enrichedMap
 * @returns {{ snapshot: object, rows: object[] }}
 */
export function computeChartData(allSnapshots, index, threshold, enrichedMap) {
  const snapshot = allSnapshots[index];
  const prevSnap = index > 0 ? allSnapshots[index - 1] : null;

  // Поточний список (вже відсортований за оцінкою у файлі)
  const sorted  = snapshot.anime.toSorted((a, b) => b.score - a.score);
  const above   = sorted.filter(a => a.score >= threshold);

  // Попередній знімок — для дельт
  const prevSorted = prevSnap
    ? prevSnap.anime.toSorted((a, b) => b.score - a.score)
    : [];
  const prevAbove = prevSorted.filter(a => a.score >= threshold);

  const rows = above.map((a, i) => {
    const rank     = i + 1;
    const enr      = enrichedMap.get(a.id) ?? {};

    // Позиція в попередньому знімку (серед усіх, не лише ≥ порогу)
    const prevAllIdx = prevSorted.findIndex(p => p.id === a.id);
    const prevAboveIdx = prevAbove.findIndex(p => p.id === a.id);
    const prevRank   = prevAboveIdx >= 0 ? prevAboveIdx + 1 : null;
    const prevEntry  = prevSnap?.anime.find(p => p.id === a.id);

    return {
      ...a,
      title_ua:     enr.title_ua   ?? null,
      media_type:   enr.media_type ?? 'unknown',
      image:        enr.image      ?? null,
      rank,
      prevRank,
      rankDelta:    prevRank !== null ? prevRank - rank : null,
      scoreDelta:   prevEntry ? +(a.score - prevEntry.score).toFixed(2)   : null,
      membersDelta: prevEntry ? a.members - prevEntry.members             : null,
      isNew:        prevSnap !== null && prevAllIdx === -1,
    };
  });

  return { snapshot, rows };
}

// ─── Section 3: Notable Events ────────────────────────────────────────────────

/**
 * 3a. Найвища оцінка за всю доступну історію.
 */
export function computeHighestEver(allSnapshots) {
  let best = null;

  for (const snap of allSnapshots) {
    for (const a of snap.anime) {
      if (!best || a.score > best.score) {
        best = { ...a, date: snap.date };
      }
    }
  }

  return best;
}

/**
 * 3b. Найстабільніша оцінка:
 * Аніме, що найдовше тримало одну й ту саму оцінку підряд.
 * Повертає запис з кількістю знімків (count) та датами початку/кінця.
 */
export function computeMostStableScore(allSnapshots) {
  if (allSnapshots.length < 2) return null;

  /** animeId → поточна серія */
  const active = new Map();
  let best = null;

  const promote = streak => {
    if (!best || streak.count > best.count) best = { ...streak };
  };

  for (const snap of allSnapshots) {
    const seen = new Set();

    for (const a of snap.anime) {
      seen.add(a.id);
      const cur = active.get(a.id);

      if (!cur) {
        active.set(a.id, {
          animeId: a.id, title: a.title, score: a.score,
          startDate: snap.date, endDate: snap.date, count: 1,
        });
      } else if (cur.score === a.score) {
        cur.endDate = snap.date;
        cur.count++;
      } else {
        promote(cur);
        active.set(a.id, {
          animeId: a.id, title: a.title, score: a.score,
          startDate: snap.date, endDate: snap.date, count: 1,
        });
      }
    }

    // Аніме, яке зникло зі знімку — завершуємо серію
    for (const [id, streak] of active) {
      if (!seen.has(id)) {
        promote(streak);
        active.delete(id);
      }
    }
  }

  for (const s of active.values()) promote(s);
  return best;
}

/**
 * 3c. Найдовше утримання топ-1.
 */
export function computeLongestAtTop1(allSnapshots) {
  if (!allSnapshots.length) return null;

  let best = null;
  let cur  = null;

  const promote = s => {
    if (s && (!best || s.count > best.count)) best = { ...s };
  };

  for (const snap of allSnapshots) {
    const top = snap.anime.toSorted((a, b) => b.score - a.score)[0];
    if (!top) continue;

    if (cur?.animeId === top.id) {
      cur.endDate  = snap.date;
      cur.count++;
      cur.maxScore = Math.max(cur.maxScore, top.score);
    } else {
      promote(cur);
      cur = {
        animeId: top.id, title: top.title,
        startDate: snap.date, endDate: snap.date,
        count: 1, firstScore: top.score, maxScore: top.score,
      };
    }
  }

  promote(cur);
  return best;
}

/**
 * 3d-1. Усі аніме, що коли-небудь мали оцінку ≥ threshold.
 * Відсортовано за максимальною досягнутою оцінкою.
 */
export function computeAllAboveThreshold(allSnapshots, threshold, enrichedMap) {
  const seen = new Map(); // id → запис

  for (const snap of allSnapshots) {
    for (const a of snap.anime) {
      if (a.score < threshold) continue;

      const enr = enrichedMap.get(a.id) ?? {};
      const ex  = seen.get(a.id);

      if (!ex) {
        seen.set(a.id, {
          animeId:    a.id,
          title:      a.title,
          title_ua:   enr.title_ua   ?? null,
          media_type: enr.media_type ?? 'unknown',
          image:      enr.image      ?? null,
          maxScore:   a.score,
          firstDate:  snap.date,
        });
      } else {
        ex.maxScore = Math.max(ex.maxScore, a.score);
      }
    }
  }

  return [...seen.values()].toSorted((a, b) => b.maxScore - a.maxScore);
}

/**
 * 3d-2. Хто тримав топ-1 і скільки разів.
 * Відсортовано хронологічно за першою появою на вершині.
 */
export function computeTop1History(allSnapshots, enrichedMap) {
  const orderArr = []; // порядок першої появи
  const dataMap  = new Map();

  for (const snap of allSnapshots) {
    const sorted = snap.anime.toSorted((a, b) => b.score - a.score);
    const top    = sorted[0];
    if (!top) continue;

    const enr = enrichedMap.get(top.id) ?? {};
    const ex  = dataMap.get(top.id);

    if (!ex) {
      orderArr.push(top.id);
      dataMap.set(top.id, {
        animeId:    top.id,
        title:      top.title,
        title_ua:   enr.title_ua   ?? null,
        media_type: enr.media_type ?? 'unknown',
        image:      enr.image      ?? null,
        count:      1,
        firstScore: top.score,
        maxScore:   top.score,
        firstDate:  snap.date,
      });
    } else {
      ex.count++;
      ex.maxScore = Math.max(ex.maxScore, top.score);
    }
  }

  return orderArr
    .map(id => dataMap.get(id))
    .toSorted((a, b) => new Date(a.firstDate) - new Date(b.firstDate));
}

/**
 * 3d-3. Найстабільніший топ-N:
 * Найдовший підряд де одні й ті ж N аніме в тому ж порядку.
 */
export function computeMostStableTopN(allSnapshots, n = 10) {
  if (allSnapshots.length < 2) return null;

  const key = snap =>
    snap.anime.toSorted((a, b) => b.score - a.score).slice(0, n).map(a => a.id).join(',');

  let best = null;
  let cur  = null;

  const promote = s => {
    if (s && (!best || s.count > best.count)) best = { ...s };
  };

  for (const snap of allSnapshots) {
    const k = key(snap);

    if (cur?.key === k) {
      cur.endDate = snap.date;
      cur.count++;
    } else {
      promote(cur);
      cur = {
        key, n,
        topN:      snap.anime.toSorted((a, b) => b.score - a.score).slice(0, n),
        startDate: snap.date,
        endDate:   snap.date,
        count:     1,
      };
    }
  }

  promote(cur);
  return best;
}

/**
 * 3d-4. В якому знімку одночасно було найбільше аніме з оцінкою ≥ threshold.
 */
export function computeMostHighRatedAtOnce(allSnapshots, threshold) {
  let best = null;

  for (const snap of allSnapshots) {
    const high = snap.anime.filter(a => a.score >= threshold);
    if (!best || high.length > best.count) {
      best = {
        date:   snap.date,
        config: snap.config,
        count:  high.length,
        anime:  high.toSorted((a, b) => b.score - a.score),
      };
    }
  }

  return best;
}

// ─── Master computation ───────────────────────────────────────────────────────

/**
 * Запускає всі аналітичні функції одразу.
 * @returns {object} Об'єкт з усіма обчисленими даними.
 */
export function computeAll(snapshots, enrichedMap, threshold = 9.0, stableN = 10) {
  return {
    topByCategory:      computeTopByCategory(snapshots, enrichedMap),
    highestEver:        computeHighestEver(snapshots),
    mostStableScore:    computeMostStableScore(snapshots),
    longestTop1:        computeLongestAtTop1(snapshots),
    allAboveThreshold:  computeAllAboveThreshold(snapshots, threshold, enrichedMap),
    top1History:        computeTop1History(snapshots, enrichedMap),
    mostStableTopN:     computeMostStableTopN(snapshots, stableN),
    mostAtOnce:         computeMostHighRatedAtOnce(snapshots, threshold),
  };
}