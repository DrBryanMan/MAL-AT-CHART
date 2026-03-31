"""
MAL API — ТОП-аніме (score ≥ 8.0)  |  fallback → Jikan
────────────────────────────────────────────────────────
Алгоритм:
  Фаза 1 (послідовно) — збираємо рядки рейтингу через MAL API
                        (offset=0, 500, 1000 …)
                        при помилці — фолбек на Jikan (сторінки по 25)
                        зупиняємось, коли score < MIN_SCORE
  Фаза 2 (паралельно) — ремонт null-полів через MAL API
                        при помилці — фолбек на Jikan /v4/anime/{id}
  Вихід: snapshots/anime-mal/YYYY-MM-DD.json  (дата = вчора)
"""

import json
import math
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path

import requests

# ── Конфіг ────────────────────────────────────────────────────────────────────

MAL_CLIENT_ID   = "cb89e97e48fa3548ae28f456c16d4bd3"
MAL_RANKING_URL = "https://api.myanimelist.net/v2/anime/ranking"
MAL_ANIME_URL   = "https://api.myanimelist.net/v2/anime/{id}"
MAL_FIELDS      = "mean,num_scoring_users,num_list_users"
MAL_LIMIT       = 500       # max на один запит

JIKAN_RANKING_URL = "https://api.jikan.moe/v4/top/anime"
JIKAN_ANIME_URL   = "https://api.jikan.moe/v4/anime/{id}"
JIKAN_LIMIT       = 25      # max на одну сторінку Jikan
JIKAN_PAGE_DELAY  = 0.5     # rate-limit: ~2 req/s (Jikan дозволяє 3/s)

MIN_SCORE    = 8.0
MAX_WORKERS  = 5
SAVE_EVERY   = 50
RETRY_COUNT  = 2
RETRY_DELAY  = 3.0
PAGE_DELAY   = 0.5          # між MAL-запитами рейтингу
ANIME_DELAY  = 0.3          # між запитами ремонту

BASE_DIR = Path(__file__).parent.parent
OUT_DIR  = BASE_DIR / "snapshots/anime-mal"
OUT_DIR.mkdir(parents=True, exist_ok=True)


# ── Сесії ─────────────────────────────────────────────────────────────────────

def make_mal_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "X-MAL-CLIENT-ID": MAL_CLIENT_ID,
        "Accept":          "application/json",
    })
    return s

def make_jikan_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


# ── HTTP-запит з retry ────────────────────────────────────────────────────────

def fetch_json(
    session: requests.Session,
    url: str,
    params: dict = None,
    label: str = "",
) -> dict | None:
    for attempt in range(1, RETRY_COUNT + 2):
        try:
            resp = session.get(url, params=params, timeout=15)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as e:
            tag = f"[{label}] " if label else ""
            if attempt <= RETRY_COUNT:
                print(f"   ⚠️  {tag}{e}  → повтор {attempt}/{RETRY_COUNT} через {RETRY_DELAY}с...")
                time.sleep(RETRY_DELAY)
            else:
                print(f"   ❌  {tag}{e}")
    return None


# ── Нормалізація відповідей ───────────────────────────────────────────────────

def _trunc2(value: float | None) -> float | None:
    """Обрізає до 2 знаків після коми без округлення: 9.2356 -> 9.23."""
    return math.floor(value * 100) / 100 if value is not None else None


def _normalize_mal_item(item: dict, rank_idx: int) -> dict:
    node = item["node"]
    return {
        "id":        node["id"],
        "title":     node.get("title"),
        "score":     _trunc2(node.get("mean")),
        "scored_by": node.get("num_scoring_users"),
        "members":   node.get("num_list_users"),
    }

def _normalize_jikan_item(item: dict) -> dict:
    return {
        "id":        item["mal_id"],
        "title":     item.get("title"),
        "score":     _trunc2(item.get("score")),
        "scored_by": item.get("scored_by"),
        "members":   item.get("members"),
    }


# ── Збір однієї "сторінки" рейтингу ─────────────────────────────────────────

def fetch_ranking_page_mal(
    session: requests.Session,
    offset: int,
) -> tuple[list[dict], bool] | None:
    """Повертає (items, has_next) або None при помилці."""
    data = fetch_json(session, MAL_RANKING_URL, params={
        "ranking_type": "all",
        "limit":        MAL_LIMIT,
        "offset":       offset,
        "fields":       MAL_FIELDS,
    }, label="MAL")

    if not data or "data" not in data:
        return None

    items    = [_normalize_mal_item(item, offset + i + 1) for i, item in enumerate(data["data"])]
    has_next = bool(data.get("paging", {}).get("next")) and len(data["data"]) == MAL_LIMIT
    return items, has_next


def fetch_ranking_page_jikan(
    session: requests.Session,
    offset: int,
) -> tuple[list[dict], bool] | None:
    """
    Jikan не має великого offset — переводимо MAL-offset у номери сторінок.
    MAL offset=0, limit=500 → Jikan pages 1–20 (по 25 записів).
    """
    jikan_start    = offset // JIKAN_LIMIT + 1
    jikan_pages    = MAL_LIMIT // JIKAN_LIMIT   # = 20

    items: list[dict] = []
    has_next = False

    for jikan_page in range(jikan_start, jikan_start + jikan_pages):
        data = fetch_json(session, JIKAN_RANKING_URL, params={
            "page":  jikan_page,
            "limit": JIKAN_LIMIT,
        }, label="Jikan")

        if not data or "data" not in data:
            break

        items.extend(_normalize_jikan_item(item) for item in data["data"])
        has_next = data.get("pagination", {}).get("has_next_page", False)

        if not has_next:
            break

        time.sleep(JIKAN_PAGE_DELAY)

    return (items, has_next) if items else None


# ── Збереження (thread-safe) ──────────────────────────────────────────────────

def save_result(
    output_path: Path,
    anime: list[dict],
    date_str: str,
    lock: threading.Lock,
) -> None:
    timestamp = datetime.strptime(date_str, "%Y-%m-%d").strftime("%Y%m%d000000")
    payload = {
        "date":      date_str,
        "timestamp": timestamp,
        "source":    "api.myanimelist.net/v2/anime/ranking",
        "min_score": MIN_SCORE,
        "total":     len(anime),
        "anime":     anime,
    }
    with lock:
        output_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


# ── Фаза 1: збір рейтингу ────────────────────────────────────────────────────

def collect_ranking() -> list[dict]:
    mal_session   = make_mal_session()
    jikan_session = make_jikan_session()

    rows: list[dict] = []
    seen_ids: set[int] = set()
    offset = 0
    page   = 1

    print("📋  Фаза 1 — збираємо рейтинг...\n")

    while True:
        print(f"   📄  Сторінка {page}  (offset={offset}) ... ", end="", flush=True)

        result = fetch_ranking_page_mal(mal_session, offset)
        source = "MAL"

        if result is None:
            print(f"⚠️  MAL недоступний → фолбек на Jikan ... ", end="", flush=True)
            result = fetch_ranking_page_jikan(jikan_session, offset)
            source = "Jikan"

        if result is None:
            print("❌  обидва джерела недоступні")
            break

        items, has_next = result
        added = 0
        stop  = False

        for item in items:
            if item["score"] is not None and item["score"] < MIN_SCORE:
                stop = True
                break
            if item["id"] in seen_ids:
                continue
            seen_ids.add(item["id"])
            rows.append(item)
            added += 1

        print(f"+{added}  (всього: {len(rows)})  [{source}]")

        if stop or not has_next:
            break

        offset += MAL_LIMIT
        page   += 1
        time.sleep(PAGE_DELAY)

    return rows


# ── Воркер: ремонт одного аніме (MAL → Jikan) ────────────────────────────────

def fetch_anime_details(entry: dict) -> dict:
    aid     = entry["id"]
    patched = dict(entry)

    # ── спроба 1: MAL API ────────────────────────────────────────────────────
    mal  = make_mal_session()
    data = fetch_json(mal, MAL_ANIME_URL.format(id=aid), params={"fields": MAL_FIELDS}, label="MAL")
    time.sleep(ANIME_DELAY)

    if data:
        if patched["score"]     is None: patched["score"]     = _trunc2(data.get("mean"))
        if patched["scored_by"] is None: patched["scored_by"] = data.get("num_scoring_users")
        if patched["members"]   is None: patched["members"]   = data.get("num_list_users")

    # ── спроба 2: Jikan (якщо ще є null-поля) ────────────────────────────────
    if any(patched.get(f) is None for f in ("score", "scored_by", "members")):
        jikan = make_jikan_session()
        jdata = fetch_json(jikan, JIKAN_ANIME_URL.format(id=aid), label="Jikan")
        time.sleep(JIKAN_PAGE_DELAY)

        if jdata and "data" in jdata:
            d     = jdata["data"]
            if patched["score"]     is None: patched["score"]     = _trunc2(d.get("score"))
            if patched["scored_by"] is None: patched["scored_by"] = d.get("scored_by")
            if patched["members"]   is None: patched["members"]   = d.get("members")

    return patched


# ── Фаза 2: паралельний ремонт null-полів ────────────────────────────────────

def repair_nulls(output_path: Path, date_str: str) -> None:
    data       = json.loads(output_path.read_text(encoding="utf-8"))
    anime_list: list[dict] = data["anime"]

    broken_idx = [
        i for i, e in enumerate(anime_list)
        if any(e.get(f) is None for f in ("score", "scored_by", "members"))
    ]

    if not broken_idx:
        print("✅  Null-полів не знайдено — файл чистий.")
        return

    print(f"\n🔧  Фаза 2 — ремонт {len(broken_idx)} аніме ({MAX_WORKERS} воркерів, MAL + Jikan)...\n")

    print_lock = threading.Lock()
    fixed      = 0

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(fetch_anime_details, anime_list[i]): i for i in broken_idx}

        for future in as_completed(futures):
            i   = futures[future]
            old = anime_list[i]
            new = future.result()

            changed = [
                f for f in ("score", "scored_by", "members")
                if old.get(f) is None and new.get(f) is not None
            ]

            with print_lock:
                label = f"id={new['id']}  {new['title'][:50]}"
                if changed:
                    fixed += 1
                    anime_list[i] = new
                    print(f"   ✔  {label}  →  {', '.join(f'{f}={new[f]}' for f in changed)}")
                else:
                    print(f"   —  {label}  (залишилось null)")

    save_result(output_path, anime_list, date_str, threading.Lock())
    print(f"\n   💾  Файл оновлено. Виправлено {fixed}/{len(broken_idx)} аніме.")


# ── Основна логіка ────────────────────────────────────────────────────────────

def main() -> None:
    date_str    = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    output_path = OUT_DIR / f"{date_str}.json"

    t_start = time.perf_counter()

    if output_path.exists():
        print(f"📂  Файл вже існує: {output_path}")
        print("   Фаза 1 пропущена — одразу перевіряємо null-поля.\n")
    else:
        rows  = collect_ranking()
        anime = list(rows)

        save_result(output_path, anime, date_str, threading.Lock())

        elapsed = time.perf_counter() - t_start
        print(f"\n   ✅  Фаза 1 завершена за {elapsed:.1f}с  ({len(anime)} аніме)\n")

    repair_nulls(output_path, date_str)

    elapsed = time.perf_counter() - t_start
    print(f"\n🎉  Готово за {elapsed:.1f}с")
    print(f"   Файл: {output_path}")


if __name__ == "__main__":
    main()