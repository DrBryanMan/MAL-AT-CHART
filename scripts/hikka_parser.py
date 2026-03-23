# scripts/scrap_hikka.py
"""
Скрапер топ-аніме Hikka.io через офіційний API.
────────────────────────────────────────────────
- Сортування: native_score:desc, native_scored_by:desc
- Зупиняється щойно зустрічає аніме без оцінки (native_score is None)
- Вихід: ./snapshots/anime-hikka/YYYY-MM-DD.json

Залежності: pip install requests
"""

import json
import time
from datetime import date as dt_date
from pathlib import Path

import requests

# ── Конфіг ────────────────────────────────────────────────────────────────────

API_URL   = "https://api.hikka.io/anime"
PAGE_SIZE = 100
DELAY_SEC = 0.5

ROOT    = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "snapshots" / "anime-hikka"

HEADERS = {
    "accept":       "application/json",
    "Content-Type": "application/json",
    "User-Agent":   "mal-archive-scraper/1.0",
}

PAYLOAD_BASE = {
    "years":               [],
    "include_multiseason": False,
    "only_translated":     False,
    "score":               [0, 10],
    "native_score":        [0, 10],
    "media_type":          [],
    "rating":              [],
    "status":              [],
    "source":              [],
    "season":              [],
    "producers":           [],
    "studios":             [],
    "genres":              [],
    "sort":                ["native_score:desc", "native_scored_by:desc"],
}

# ── Отримання даних ───────────────────────────────────────────────────────────

def fetch_page(session: requests.Session, page: int) -> dict:
    resp = session.post(
        API_URL,
        params={"page": page, "size": PAGE_SIZE},
        json=PAYLOAD_BASE,
        timeout=15,
    )

    if resp.status_code == 429:
        retry = int(resp.headers.get("Retry-After", 30))
        print(f"\n⏳  Rate limit — чекаємо {retry}с…", flush=True)
        time.sleep(retry)
        return fetch_page(session, page)

    resp.raise_for_status()
    return resp.json()


def extract_entry(item: dict) -> dict:
    return {
        "id":       item.get("mal_id"),
        "slug":     item.get("slug"),
        "title_en": item.get("title_en") or item.get("title_ja"),
        "title_ua": item.get("title_ua"),
        "score":    item.get("native_score"),
        "members":  item.get("native_scored_by"),
    }


def fetch_all(session: requests.Session) -> list[dict]:
    """
    Завантажує сторінки доки зустрічає аніме з оцінкою.
    Щойно native_score is None — зупиняємось (далі лише неоцінені).
    """
    print("▶  Запит першої сторінки…")
    first = fetch_page(session, 1)

    pagination  = first.get("pagination", {})
    total_pages = pagination.get("pages", 1)
    total_items = pagination.get("total", 0)
    print(f"   ✔  Сторінок: {total_pages}, тайтлів усього: {total_items}")

    entries, done = _collect_entries(first.get("list", []))
    if done:
        print(f"   ✔  Неоцінені знайдені вже на сторінці 1 — зупиняємось")
        return entries

    for page in range(2, total_pages + 1):
        print(f"   [{page:>4}/{total_pages}]  зібрано: {len(entries)}", end="\r", flush=True)
        try:
            data = fetch_page(session, page)
        except requests.ConnectionError as exc:
            print(f"\n❌  Втрачено з'єднання на сторінці {page}: {exc}")
            break
        except requests.RequestException as exc:
            print(f"\n⚠️  Помилка на сторінці {page}: {exc}")
            continue

        batch, done = _collect_entries(data.get("list", []))
        entries.extend(batch)

        if done:
            print(f"\n   ✔  Зустріли неоцінене аніме на сторінці {page} — зупиняємось")
            break

        time.sleep(DELAY_SEC)

    print(f"\n   ✔  Отримано оцінених записів: {len(entries)}")
    return entries


def _collect_entries(items: list[dict]) -> tuple[list[dict], bool]:
    """
    Перетворює список відповіді API на записи.
    Повертає (зібрані записи, чи треба зупинитись).
    """
    entries = []
    for item in items:
        if not item.get("native_score"):
            return entries, True
        entries.append(extract_entry(item))
    return entries, False

# ── Збереження ────────────────────────────────────────────────────────────────

def save_snapshot(entries: list[dict], today: str) -> None:
    out_file = OUT_DIR / f"{today}.json"
    snapshot = {
        "date":      today,
        "timestamp": "20260323235959",
        "source":    "hikka-aggregator-revisions",
        "total":     len(entries),
        "anime":     entries,
    }
    out_file.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    size_kb = out_file.stat().st_size / 1024
    print(f"💾  Збережено → {out_file.name}  ({len(entries)} аніме, {size_kb:.1f} KB)")

# ── Точка входу ───────────────────────────────────────────────────────────────

def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    today    = dt_date.today().isoformat()
    out_file = OUT_DIR / f"{today}.json"

    if out_file.exists():
        try:
            cached = json.loads(out_file.read_text(encoding="utf-8"))
            if cached.get("total", 0) > 0:
                print(f"⏭️  Знімок за {today} вже є ({cached['total']} тайтлів), пропускаємо.")
                return
        except (json.JSONDecodeError, OSError):
            pass
        print(f"⚠️  Файл {out_file.name} порожній або пошкоджений — перезаписуємо.")

    session = requests.Session()
    session.headers.update(HEADERS)

    try:
        entries = fetch_all(session)
    except requests.ConnectionError as exc:
        print(f"❌  Не вдалось підключитись: {exc}")
        return

    if not entries:
        print("⚠️  Отримано 0 записів — знімок не збережено.")
        return

    save_snapshot(entries, today)
    print("✅  Готово!")


if __name__ == "__main__":
    main()