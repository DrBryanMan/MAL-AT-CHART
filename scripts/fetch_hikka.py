"""
Збагачує unique_anime.json даними з hikka.io API.
Вхід:  unique_anime.json  (список { id, title })
Вихід: anime_enriched.json

Формат запису у вихідному файлі:
{
  "mal_id":           5114,
  "title":            "Fullmetal Alchemist: Brotherhood",   ← з unique_anime (fallback)
  "media_type":       "tv",
  "title_ua":         "Стальний алхімік: Братерство",
  "image":            "https://cdn.hikka.io/...",
  "native_scored_by": 1234,
  "native_score":     9.12
}

Якщо hikka.io не знає тайтл (404) — записується з title з unique_anime, решта полів null.
Прогрес зберігається: при повторному запуску вже отримані пропускаються.

Залежності: pip install requests
"""

import json
import time
from pathlib import Path

import requests

# ── Конфіг ────────────────────────────────────────────────────────────────────

INPUT_FILE  = Path(__file__).parent / "unique_anime.json"
OUTPUT_FILE = Path(__file__).parent / "anime_enriched.json"
API_BASE    = "https://api.hikka.io/integrations/mal/anime"
DELAY_SEC   = 0.5    # пауза між запитами
TIMEOUT_SEC = 15

HEADERS = {
    "User-Agent": "mal-archive-scraper/1.0",
    "Accept":     "application/json",
}

# ── Завантаження прогресу ─────────────────────────────────────────────────────

def load_progress() -> dict[int, dict]:
    """Повертає вже отримані записи: { mal_id: {...} }"""
    if not OUTPUT_FILE.exists():
        return {}
    try:
        data = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
        return {entry["mal_id"]: entry for entry in data}
    except (json.JSONDecodeError, OSError, KeyError):
        return {}


def save(records: dict[int, dict]) -> None:
    result = sorted(records.values(), key=lambda x: x["mal_id"])
    OUTPUT_FILE.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

# ── Запит до API ──────────────────────────────────────────────────────────────

def fetch_hikka(session: requests.Session, mal_id: int) -> dict | None:
    """
    Повертає dict з потрібними полями або None якщо 404.
    Кидає виняток при мережевій помилці.
    """
    url = f"{API_BASE}/{mal_id}"
    resp = session.get(url, timeout=TIMEOUT_SEC)

    if resp.status_code == 404:
        return None
    resp.raise_for_status()

    d = resp.json()
    return {
        "media_type":       d.get("media_type"),
        "title_ua":         d.get("title_ua"),
        "image":            d.get("image"),
        "native_scored_by": d.get("native_scored_by"),
        "native_score":     d.get("native_score"),
    }

# ── Головна функція ───────────────────────────────────────────────────────────

def main() -> None:
    if not INPUT_FILE.exists():
        print(f"❌  Файл {INPUT_FILE.name} не знайдено. Спочатку запусти collect_titles.py")
        return

    source = json.loads(INPUT_FILE.read_text(encoding="utf-8"))
    print(f"📂  Тайтлів для збагачення: {len(source)}")

    progress = load_progress()
    print(f"   ✔  Вже отримано: {len(progress)}")

    session = requests.Session()
    session.headers.update(HEADERS)

    todo = [e for e in source if e["id"] not in progress]
    total = len(todo)
    print(f"   →  Залишилось: {total}\n")

    for i, entry in enumerate(todo, 1):
        mal_id = entry["id"]
        title  = entry.get("title")

        print(f"[{i:>5}/{total}] MAL #{mal_id}  {title or '—'}", end="", flush=True)

        try:
            hikka = fetch_hikka(session, mal_id)
        except requests.ConnectionError:
            print(f"\n❌  Втрачено з'єднання — зупиняємо.")
            break
        except requests.RequestException as exc:
            print(f"  ⚠️  {exc}")
            continue

        if hikka is None:
            print("  [не знайдено у hikka]")
            record = {
                "mal_id":           mal_id,
                "title":            title,
                "media_type":       None,
                "title_ua":         None,
                "image":            None,
                "native_scored_by": None,
                "native_score":     None,
            }
        else:
            print(f"  [{hikka['media_type']}] {hikka['title_ua'] or title}")
            record = {"mal_id": mal_id, "title": title, **hikka}

        progress[mal_id] = record

        # Зберігаємо після кожного запису
        save(progress)
        time.sleep(DELAY_SEC)

    print(f"\n✅  Готово! Всього записів: {len(progress)} → {OUTPUT_FILE.name}")


if __name__ == "__main__":
    main()