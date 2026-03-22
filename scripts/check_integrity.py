"""
Перевіряє всі снепшоти на цілісність даних.
Знаходить файли де хоча б один запис має відсутній id або title.
Записує такі снепшоти у empty_snapshots.json для повторного скрапінгу.

Запуск: python check_integrity.py
"""

import json
from pathlib import Path

SNAPSHOTS_DIR   = Path(__file__).parent / "../snapshots"
EMPTY_LIST_FILE = Path(__file__).parent / "../data/empty_snapshots.json"
SKIP_FILE       = Path(__file__).parent / "../data/skip_timestamps.json"


def load_skip() -> set[str]:
    if not SKIP_FILE.exists():
        return set()
    try:
        return set(json.loads(SKIP_FILE.read_text(encoding="utf-8")))
    except (json.JSONDecodeError, OSError):
        return set()


def load_empty() -> list[dict]:
    if not EMPTY_LIST_FILE.exists():
        return []
    try:
        return json.loads(EMPTY_LIST_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def save_empty(data: list[dict]) -> None:
    EMPTY_LIST_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def check() -> None:
    skip        = load_skip()
    empty       = load_empty()
    empty_dates = {e["date"] for e in empty}

    files = sorted(SNAPSHOTS_DIR.glob("*.json"))
    print(f"📂  Перевірка {len(files)} снепшотів…\n")

    checked  = 0
    found    = 0
    added    = 0
    skipped  = 0

    for f in files:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            print(f"  ⚠️  Пошкоджений файл: {f.name}")
            continue

        anime = data.get("anime", [])
        if not anime:
            continue

        checked += 1
        ts = data.get("timestamp", "")

        # Пропускаємо якщо вже у skip
        if ts in skip:
            skipped += 1
            continue

        # Рахуємо записи без id або без title
        no_id    = sum(1 for a in anime if a.get("id")    is None)
        # no_title = sum(1 for a in anime if a.get("title") is None)

        # if no_id == 0 and no_title == 0:
        if no_id == 0:
            continue

        found += 1
        date = data.get("date", f.stem)

        print(
            f"  ⚠️  {date}  [{data.get('html_version', '?')}]"
            f"  без id: {no_id}/{len(anime)}"
            # f"  без title: {no_title}/{len(anime)}"
        )

        # Додаємо до empty якщо ще не там
        if date not in empty_dates:
            empty.append({
                "date":         date,
                "timestamp":    ts,
                "source":       data.get("source", ""),
                "html_version": data.get("html_version", ""),
            })
            empty_dates.add(date)
            added += 1

    print(f"\n{'─' * 50}")
    print(f"Перевірено:          {checked}")
    print(f"Пропущено (в skip):  {skipped}")
    print(f"З неповними даними:  {found}")
    print(f"Додано до empty:     {added}")

    if added > 0:
        save_empty(empty)
        print(f"\n💾  Збережено → {EMPTY_LIST_FILE.name}")
    else:
        print(f"\n✅  Нових проблем не знайдено")


if __name__ == "__main__":
    check()