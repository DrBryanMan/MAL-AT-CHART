"""
enrich_anime.py — збирає унікальні аніме зі знімків і збагачує з двох джерел:
  1. hikka.io  — назва UA, постер, тип медіа, slug
  2. AniList   — банер (GraphQL)

Кроки запуску:
  1. Сканує snapshots/anime-mal/*.json → збирає {id: title}
  2. Нові ID збагачує через hikka.io
  3. Записи без banner_image збагачує через AniList

Вихід: data/anime_enriched.json
Зберігає прогрес після кожного запиту — стійко до переривань.
"""

import json
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

# ── Конфіг ────────────────────────────────────────────────────────────────────

ROOT                = Path(__file__).resolve().parent.parent
SNAPSHOTS_MAL_DIR   = ROOT / "snapshots" / "anime-mal"
SNAPSHOTS_HIK_DIR   = ROOT / "snapshots" / "anime-hikka"
OUTPUT_FILE         = ROOT / "data" / "anime_enriched.json"

HIKKA_BASE    = "https://api.hikka.io/integrations/mal/anime"
HIKKA_DELAY   = 0.15
HIKKA_WORKERS = 8            # ← можна міняти (5-10)

ANILIST_URL   = "https://graphql.anilist.co"
ANILIST_DELAY = 0.7          # ≈ 66 запитів на хвилину — безпечно
FORCE_FULL_BANNER_SCAN = False

TIMEOUT_SEC   = 15

HIKKA_HEADERS = {
    "User-Agent": "mal-archive-scraper/1.0",
    "Accept":     "application/json",
}

ANILIST_HEADERS = {
    "Content-Type": "application/json",
    "Accept":       "application/json",
    "User-Agent":   "mal-archive-scraper/1.0",
}

ANILIST_QUERY = """
query ($malId: Int) {
  Media(idMal: $malId, type: ANIME) {
    bannerImage
  }
}
"""

# ── I/O ───────────────────────────────────────────────────────────────────────

def load_enriched() -> dict[int, dict]:
    if not OUTPUT_FILE.exists():
        return {}
    try:
        data = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
        return {int(r["mal_id"]): r for r in data}
    except Exception:
        return {}

def save_enriched(records: dict[int, dict]) -> None:
    OUTPUT_FILE.parent.mkdir(exist_ok=True)
    OUTPUT_FILE.write_text(
        json.dumps(
            sorted(records.values(), key=lambda r: r["mal_id"]),
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

def empty_record(mal_id: int, title: str | None) -> dict:
    return {
        "mal_id":           mal_id,
        "media_type":       None,
        "title":            title,
        "title_ua":         None,
        "image":            None,
        "hikka_slug":       None,
        "year":             None,
        "season":           None,
        "banner_image":     None,
    }

# ── Крок 1: збір унікальних ID зі знімків ─────────────────────────────────────

def _entry_title(entry: dict) -> str | None:
    return (
        entry.get("title")
        or entry.get("title_en")
        or entry.get("title_ua")
        or None
    )

def collect_unique() -> dict[int, str | None]:
    dirs = [(SNAPSHOTS_MAL_DIR, "MAL"), (SNAPSHOTS_HIK_DIR, "Hikka")]
    anime: dict[int, str | None] = {}

    for snap_dir, label in dirs:
        files = sorted(snap_dir.glob("*.json")) if snap_dir.exists() else []
        print(f"📂  Сканування {len(files)} знімків {label}…")
        for f in files:
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                for entry in data.get("anime", []):
                    mal_id = entry.get("id")
                    if mal_id is None:
                        continue
                    mal_id = int(mal_id)
                    title = _entry_title(entry)
                    if mal_id not in anime or (anime[mal_id] is None and title):
                        anime[mal_id] = title
            except Exception:
                continue

    print(f"   ✔  Унікальних ID: {len(anime)}")
    return anime

# ── Крок 2: hikka.io ──────────────────────────────────────────────────────────

def fetch_hikka(mal_id: int) -> dict | None:
    session = requests.Session()
    session.headers.update(HIKKA_HEADERS)
    try:
        resp = session.get(f"{HIKKA_BASE}/{mal_id}", timeout=TIMEOUT_SEC)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        d = resp.json()
        return {
            "media_type":       d.get("media_type"),
            "title_ua":         d.get("title_ua"),
            "image":            d.get("image"),
            "hikka_slug":       d.get("slug"),
            "year":             d.get("year"),
            "season":           d.get("season"),
        }
    except Exception:
        return None

def enrich_from_hikka(enriched: dict[int, dict], unique: dict[int, str | None]) -> None:
    todo = {mid: title for mid, title in unique.items() if mid not in enriched}
    if not todo:
        print("   ✅  Hikka: нічого нового.")
        return

    print(f"\n── Hikka (паралельно {HIKKA_WORKERS} воркерів) ─────────────────────")
    print(f"   Залишилось: {len(todo)}")

    records_to_process = list(todo.items())
    completed = 0

    with ThreadPoolExecutor(max_workers=HIKKA_WORKERS) as pool:
        future_to_id = {pool.submit(fetch_hikka, mal_id): mal_id for mal_id, _ in records_to_process}

        for future in as_completed(future_to_id):
            mal_id = future_to_id[future]
            title = todo[mal_id]
            completed += 1

            try:
                hikka_data = future.result()
                record = empty_record(mal_id, title)
                if hikka_data:
                    record.update(hikka_data)
                enriched[mal_id] = record
            except Exception:
                enriched[mal_id] = empty_record(mal_id, title)

            print(f"[{completed:>5}/{len(todo)}] MAL #{mal_id}", end="\r", flush=True)

            if completed % 20 == 0:
                save_enriched(enriched)

    save_enriched(enriched)
    print(f"\n   ✔  Hikka збагачено. Всього: {len(enriched)}")

# ── AniList (послідовно, без воркерів) ───────────────────────────────────────

def fetch_banner(session: requests.Session, mal_id: int) -> str | None:
    try:
        resp = session.post(
            ANILIST_URL,
            json={"query": ANILIST_QUERY, "variables": {"malId": mal_id}},
            timeout=TIMEOUT_SEC,
        )

        if resp.status_code == 429:
            retry = int(resp.headers.get("Retry-After", 60))
            print(f"\n⏳  Rate limit AniList — чекаємо {retry}с...")
            time.sleep(retry)
            return fetch_banner(session, mal_id)

        resp.raise_for_status()
        media = resp.json().get("data", {}).get("Media")
        return media.get("bannerImage") if media else None

    except Exception as e:
        print(f"  ⚠️  AniList error для {mal_id}: {e}")
        return None


def enrich_banners(enriched: dict[int, dict]) -> None:
    if not FORCE_FULL_BANNER_SCAN:
        # Нормальний режим: перевіряємо ТІЛЬКИ ті, у кого ще немає поля banner_image
        todo = [r for r in enriched.values() if "banner_image" not in r]
        mode = " (тільки нові)"
    else:
        # Повний скан: перевіряємо все, навіть якщо banner_image = None
        todo = list(enriched.values())
        mode = " (ПОВНИЙ СКАН — примусово)"

    if not todo:
        print("   ✅  AniList: нічого не потрібно перевіряти.")
        return

    print(f"\n── AniList банери{mode} ─────────────────────────────")
    print(f"   Потрібно обробити: {len(todo)} записів")

    session = requests.Session()
    session.headers.update(ANILIST_HEADERS)

    checked = 0
    found_new = 0

    for i, record in enumerate(todo, 1):
        mal_id = record["mal_id"]
        label = record.get("title_ua") or record.get("title") or f"#{mal_id}"

        # Якщо це не повний скан і банер вже є (навіть None) — пропускаємо
        if not FORCE_FULL_BANNER_SCAN and "banner_image" in record:
            print(f"[{i:>5}/{len(todo)}] MAL #{mal_id}  — пропущено (вже перевірено)", end="\r", flush=True)
            continue

        print(f"[{i:>5}/{len(todo)}] MAL #{mal_id}  {label}", end="  ", flush=True)

        banner = fetch_banner(session, mal_id)
        record["banner_image"] = banner
        checked += 1

        if banner:
            found_new += 1
            short = banner[:65] + "…" if len(banner) > 65 else banner
            print(f"✔ знайдено банер")
        else:
            print("— немає банера")

        # Зберігаємо прогрес після кожного запиту
        save_enriched(enriched)

        time.sleep(ANILIST_DELAY)

    print(f"\n   ✔  AniList завершено. Перевірено: {checked} | Нових банерів: {found_new}")


# ── Очищення ────────────────────────────────────────────────────────────────

def prune_stale(enriched: dict[int, dict], unique: dict[int, str | None]) -> None:
    stale = [mid for mid in list(enriched.keys()) if mid not in unique]
    if not stale:
        return

    print(f"\n── Очищення застарілих записів ───────────────────────")
    for mid in stale:
        del enriched[mid]
    save_enriched(enriched)
    print(f"   Видалено {len(stale)} застарілих. Залишилось: {len(enriched)}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    unique   = collect_unique()
    enriched = load_enriched()

    prune_stale(enriched, unique)
    enrich_from_hikka(enriched, unique)
    enrich_banners(enriched)

    print(f"\n✅  Готово! Всього записів у enriched: {len(enriched)}")

if __name__ == "__main__":
    main()