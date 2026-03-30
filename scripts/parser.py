# scripts/scrap_hikka.py
"""
Скрапер аніме-даних через Hikka.io API — MAL + Hikka в одному запуску.
────────────────────────────────────────────────────────────────────────
MAL-дані:
  - Сортування: score:desc, scored_by:desc
  - Зупиняється коли score < 8.0
  - Вихід: ./snapshots/anime-mal/YYYY-MM-DD.json

Hikka-дані:
  - Сортування: native_score:desc, native_scored_by:desc
  - Зупиняється коли native_score is None
  - Вихід: ./snapshots/anime-hikka/YYYY-MM-DD.json

Залежності: pip install requests
"""

import json
import time
from datetime import datetime, timedelta
from datetime import date as dt_date
from pathlib import Path

import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── Конфіг ────────────────────────────────────────────────────────────────────

API_URL   = "https://api.hikka.io/anime"
PAGE_SIZE = 100
DELAY_SEC = 0.2
STATS_WORKERS  = 5
STATS_DELAY    = 0.2   # паралельно, rate limit тримаємо кількістю воркерів
ANIME_DETAIL   = "https://api.hikka.io/anime/{slug}"
STATS_KEYS     = ("completed", "watching", "planned", "dropped", "on_hold")

MAL_SCORE_MIN = 8.0

ROOT         = Path(__file__).resolve().parent.parent
MAL_OUT_DIR  = ROOT / "snapshots" / "anime-mal"
HIKKA_OUT_DIR = ROOT / "snapshots" / "anime-hikka"

HEADERS = {
    "accept":       "application/json",
    "Content-Type": "application/json",
    "User-Agent":   "mal-archive-scraper/1.0",
}

PAYLOAD_BASE = {
    "score":               [0, 10],
    "native_score":        [0, 10],
    "media_type":          [],
    "status":              [],
    "season":              [],
}

PAYLOAD_MAL   = {**PAYLOAD_BASE, "sort": ["score:desc", "scored_by:desc"]}
PAYLOAD_HIKKA = {**PAYLOAD_BASE, "sort": ["native_scored_by:desc", "native_score:desc"]}

# ── Мережа ────────────────────────────────────────────────────────────────────

def fetch_page(session: requests.Session, page: int, payload: dict) -> dict:
    resp = session.post(
        API_URL,
        params={"page": page, "size": PAGE_SIZE},
        json=payload,
        timeout=15,
    )

    if resp.status_code == 429:
        retry = int(resp.headers.get("Retry-After", 30))
        print(f"\n⏳  Rate limit — чекаємо {retry}с…", flush=True)
        time.sleep(retry)
        return fetch_page(session, page, payload)

    resp.raise_for_status()
    return resp.json()

# ── MAL ───────────────────────────────────────────────────────────────────────

def extract_mal_entry(item: dict) -> dict:
    return {
        "id":        item.get("mal_id"),
        "_slug":     item.get("slug"),      # службове поле, видалиться після enrich
        "score":     item.get("score"),
        "scored_by": item.get("scored_by"),
        "members":   None,
    }

def fetch_members(slug: str) -> int | None:
    """Окремий запит для одного аніме. Кожен виклик — свій Session (thread-safe)."""
    session = requests.Session()
    session.headers.update(HEADERS)
    try:
        resp = session.get(ANIME_DETAIL.format(slug=slug), timeout=15)
        if resp.status_code == 429:
            time.sleep(int(resp.headers.get("Retry-After", 30)))
            return fetch_members(slug)
        resp.raise_for_status()
        stats = resp.json().get("stats") or {}
        total = sum(stats.get(k, 0) or 0 for k in STATS_KEYS)
        return total or None
    except Exception:
        return None


def enrich_members(entries: list[dict]) -> list[dict]:
    """Паралельно добирає members через /anime/{slug} і прибирає службовий _slug."""
    slugged = [(i, e["_slug"]) for i, e in enumerate(entries) if e.get("_slug")]

    print(f"   ▶  [stats] Паралельне завантаження для {len(slugged)} аніме "
          f"({STATS_WORKERS} воркерів)…")

    with ThreadPoolExecutor(max_workers=STATS_WORKERS) as pool:
        futures = {pool.submit(fetch_members, slug): idx for idx, slug in slugged}
        done = 0
        for future in as_completed(futures):
            idx = futures[future]
            done += 1
            print(f"   [{done:>4}/{len(slugged)}]", end="\r", flush=True)
            entries[idx]["members"] = future.result()

    print(f"\n   ✔  Stats отримано")

    for e in entries:
        e.pop("_slug", None)   # прибираємо службове поле

    return entries


def _collect_mal_entries(items: list[dict]) -> tuple[list[dict], bool]:
    """
    Збирає MAL-записи зі сторінки.
    Зупиняється коли score < MAL_SCORE_MIN або score відсутній.
    """
    entries = []
    for item in items:
        score = item.get("score")
        if not score or score < MAL_SCORE_MIN:
            return entries, True

        if item.get("status") == "announced":
            continue

        entries.append(extract_mal_entry(item))

    return entries, False


def fetch_all_mal(session: requests.Session) -> list[dict]:
    print("▶  [MAL] Запит першої сторінки…")
    first = fetch_page(session, 1, PAYLOAD_MAL)

    pagination  = first.get("pagination", {})
    total_pages = pagination.get("pages", 1)
    total_items = pagination.get("total", 0)
    print(f"   ✔  Сторінок: {total_pages}, тайтлів усього: {total_items}")

    entries, done = _collect_mal_entries(first.get("list", []))
    if done:
        print(f"   ✔  Поріг score < {MAL_SCORE_MIN} вже на сторінці 1 — зупиняємось")
        return entries

    for page in range(2, total_pages + 1):
        print(f"   [{page:>4}/{total_pages}]  зібрано: {len(entries)}", end="\r", flush=True)
        try:
            data = fetch_page(session, page, PAYLOAD_MAL)
        except requests.ConnectionError as exc:
            print(f"\n❌  Втрачено з'єднання на сторінці {page}: {exc}")
            break
        except requests.RequestException as exc:
            print(f"\n⚠️  Помилка на сторінці {page}: {exc}")
            continue

        batch, done = _collect_mal_entries(data.get("list", []))
        entries.extend(batch)

        if done:
            print(f"\n   ✔  Score < {MAL_SCORE_MIN} на сторінці {page} — зупиняємось")
            break

        time.sleep(DELAY_SEC)

    print(f"\n   ✔  Отримано MAL-записів: {len(entries)}")
    entries = enrich_members(entries)
    return entries

# ── Hikka ─────────────────────────────────────────────────────────────────────

def extract_hikka_entry(item: dict) -> dict:
    return {
        "id":        item.get("mal_id"),
        "score":     item.get("native_score"),
        "scored_by": item.get("native_scored_by"),
    }


def _collect_hikka_entries(items: list[dict]) -> tuple[list[dict], bool]:
    """
    Збирає Hikka-записи зі сторінки.
    Зупиняється коли native_score відсутній.
    """
    entries = []
    for item in items:
        if not item.get("native_score"):
            return entries, True

        if item.get("status") == "announced":
            continue

        entries.append(extract_hikka_entry(item))

    return entries, False


def fetch_all_hikka(session: requests.Session) -> list[dict]:
    print("▶  [Hikka] Запит першої сторінки…")
    first = fetch_page(session, 1, PAYLOAD_HIKKA)

    pagination  = first.get("pagination", {})
    total_pages = pagination.get("pages", 1)
    total_items = pagination.get("total", 0)
    print(f"   ✔  Сторінок: {total_pages}, тайтлів усього: {total_items}")

    entries, done = _collect_hikka_entries(first.get("list", []))
    if done:
        print(f"   ✔  Неоцінені знайдені вже на сторінці 1 — зупиняємось")
        return entries

    for page in range(2, total_pages + 1):
        print(f"   [{page:>4}/{total_pages}]  зібрано: {len(entries)}", end="\r", flush=True)
        try:
            data = fetch_page(session, page, PAYLOAD_HIKKA)
        except requests.ConnectionError as exc:
            print(f"\n❌  Втрачено з'єднання на сторінці {page}: {exc}")
            break
        except requests.RequestException as exc:
            print(f"\n⚠️  Помилка на сторінці {page}: {exc}")
            continue

        batch, done = _collect_hikka_entries(data.get("list", []))
        entries.extend(batch)

        if done:
            print(f"\n   ✔  Зустріли неоцінене аніме на сторінці {page} — зупиняємось")
            break

        time.sleep(DELAY_SEC)

    print(f"\n   ✔  Отримано Hikka-записів: {len(entries)}")
    return entries

# ── Збереження ────────────────────────────────────────────────────────────────

def _build_snapshot(entries: list[dict], date: str, source: str) -> dict:
    return {
        "date":      date,
        "timestamp": datetime.now().strftime("%Y%m%d%H%M%S"),
        "source":    source,
        "min_score": MAL_SCORE_MIN,
        "total":     len(entries),
        "anime":     entries,
    }


def save_snapshot(entries: list[dict], date: str, out_dir: Path, source: str) -> None:
    out_file = out_dir / f"{date}.json"
    snapshot = _build_snapshot(entries, date, source)
    out_file.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    size_kb = out_file.stat().st_size / 1024
    print(f"💾  Збережено → {out_file.name}  ({len(entries)} аніме, {size_kb:.1f} KB)")


def _is_snapshot_fresh(path: Path) -> bool:
    """Повертає True якщо знімок вже існує і непорожній."""
    if not path.exists():
        return False
    try:
        cached = json.loads(path.read_text(encoding="utf-8"))
        return cached.get("total", 0) > 0
    except (json.JSONDecodeError, OSError):
        return False

# ── Точка входу ───────────────────────────────────────────────────────────────

def main() -> None:
    MAL_OUT_DIR.mkdir(parents=True, exist_ok=True)
    HIKKA_OUT_DIR.mkdir(parents=True, exist_ok=True)

    today = dt_date.today().isoformat()

    mal_file   = MAL_OUT_DIR   / f"{today}.json"
    hikka_file = HIKKA_OUT_DIR / f"{today}.json"

    run_mal   = not _is_snapshot_fresh(mal_file)
    run_hikka = not _is_snapshot_fresh(hikka_file)

    if not run_mal:
        cached_total = json.loads(mal_file.read_text(encoding="utf-8")).get("total", 0)
        print(f"⏭️  [MAL]   Знімок за {today} вже є ({cached_total} тайтлів), пропускаємо.")

    if not run_hikka:
        cached_total = json.loads(hikka_file.read_text(encoding="utf-8")).get("total", 0)
        print(f"⏭️  [Hikka] Знімок за {today} вже є ({cached_total} тайтлів), пропускаємо.")

    if not run_mal and not run_hikka:
        return

    session = requests.Session()
    session.headers.update(HEADERS)

    # ── MAL ──
    if run_mal:
        if mal_file.exists():
            print(f"⚠️  [MAL]   Файл {mal_file.name} порожній або пошкоджений — перезаписуємо.")
        try:
            mal_entries = fetch_all_mal(session)
        except requests.ConnectionError as exc:
            print(f"❌  [MAL]   Не вдалось підключитись: {exc}")
            mal_entries = []

        if mal_entries:
            save_snapshot(mal_entries, today, MAL_OUT_DIR, "hikka-api-mal")
        else:
            print("⚠️  [MAL]   Отримано 0 записів — знімок не збережено.")

    # ── Hikka ──
    if run_hikka:
        if hikka_file.exists():
            print(f"⚠️  [Hikka] Файл {hikka_file.name} порожній або пошкоджений — перезаписуємо.")
        try:
            hikka_entries = fetch_all_hikka(session)
        except requests.ConnectionError as exc:
            print(f"❌  [Hikka] Не вдалось підключитись: {exc}")
            hikka_entries = []

        if hikka_entries:
            save_snapshot(hikka_entries, today, HIKKA_OUT_DIR, "hikka-aggregator-revisions")
        else:
            print("⚠️  [Hikka] Отримано 0 записів — знімок не збережено.")

    print("✅  Готово!")


if __name__ == "__main__":
    main()