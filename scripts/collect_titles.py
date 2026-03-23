"""
Збирає унікальні тайтли з усіх снепшотів у папці snapshots/.
Вихід: unique_anime.json

Формат:
[
  { "id": 52991, "title": "Sousou no Frieren" },
  ...
]

Тайтли відсортовані за ID.
Якщо один ID зустрічається в кількох снепшотах — береться перший непустий title.
"""

import json
from pathlib import Path

ROOT          = Path(__file__).parent.parent
SNAPSHOTS_DIR = ROOT / "snapshots"
OUTPUT_FILE   = ROOT / "unique_anime.json"

def collect() -> None:
    anime: dict[int, str | None] = {}  # id → title

    files = sorted(SNAPSHOTS_DIR.glob("*.json"))
    print(f"📂  Сканування {len(files)} снепшотів…")

    for f in files:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        for entry in data.get("anime", []):
            anime_id = entry.get("id")
            if anime_id is None:
                continue
            # Зберігаємо перший непустий title
            if anime_id not in anime:
                anime[anime_id] = entry.get("title") or None
            elif anime[anime_id] is None and entry.get("title"):
                anime[anime_id] = entry["title"]

    result = [
        {"id": k, "title": anime[k]}
        for k in sorted(anime)
    ]

    OUTPUT_FILE.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"✅  Унікальних тайтлів: {len(result)} → {OUTPUT_FILE.name}")


if __name__ == "__main__":
    collect()