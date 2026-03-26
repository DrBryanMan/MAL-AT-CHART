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

import requests

# ── Конфіг ────────────────────────────────────────────────────────────────────

ROOT                = Path(__file__).resolve().parent.parent
SNAPSHOTS_MAL_DIR   = ROOT / "snapshots" / "anime-mal"
SNAPSHOTS_HIK_DIR   = ROOT / "snapshots" / "anime-hikka"
OUTPUT_FILE         = ROOT / "data" / "anime_enriched.json"

HIKKA_BASE    = "https://api.hikka.io/integrations/mal/anime"
HIKKA_DELAY   = 0.5

ANILIST_URL   = "https://graphql.anilist.co"
ANILIST_DELAY = 0.7   # 90 req/min

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
    except (json.JSONDecodeError, OSError, KeyError):
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
    }

# ── Крок 1: збір унікальних ID зі знімків ─────────────────────────────────────

def _entry_title(entry: dict) -> str | None:
    """Витягує назву з запису будь-якого формату (MAL або Hikka)."""
    return (
        entry.get("title")
        or entry.get("title_en")
        or entry.get("title_ua")
        or None
    )


def collect_unique() -> dict[int, str | None]:
    dirs = [
        (SNAPSHOTS_MAL_DIR, "MAL"),
        (SNAPSHOTS_HIK_DIR, "Hikka"),
    ]
    anime: dict[int, str | None] = {}

    for snap_dir, label in dirs:
        files = sorted(snap_dir.glob("*.json")) if snap_dir.exists() else []
        print(f"📂  Сканування {len(files)} знімків {label}…")
        for f in files:
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            for entry in data.get("anime", []):
                mal_id = entry.get("id")
                if mal_id is None:
                    continue
                mal_id = int(mal_id)
                title = _entry_title(entry)
                if mal_id not in anime:
                    anime[mal_id] = title
                elif anime[mal_id] is None and title:
                    anime[mal_id] = title

    print(f"   ✔  Унікальних ID: {len(anime)}")
    return anime

# ── Крок 2: hikka.io ──────────────────────────────────────────────────────────

def fetch_hikka(session: requests.Session, mal_id: int) -> dict | None:
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
        "yesr":             d.get("year"),
        "season":           d.get("season"),
    }


def enrich_from_hikka(enriched: dict[int, dict], unique: dict[int, str | None]) -> None:
    todo = {mid: title for mid, title in unique.items() if mid not in enriched}
    total = len(todo)

    print(f"\n── Hikka ────────────────────────────────────")
    print(f"   Вже збагачено: {len(enriched)}   Залишилось: {total}")

    if not todo:
        print("   ✅  Нічого нового.")
        return

    session = requests.Session()
    session.headers.update(HIKKA_HEADERS)

    for i, (mal_id, title) in enumerate(sorted(todo.items()), 1):
        print(f"[{i:>5}/{total}] MAL #{mal_id}  {title or '—'}", end="", flush=True)

        try:
            hikka = fetch_hikka(session, mal_id)
        except requests.ConnectionError:
            print("\n❌  Втрачено з'єднання — зупиняємо.")
            break
        except requests.RequestException as exc:
            print(f"  ⚠️  {exc}")
            continue

        record = empty_record(mal_id, title)
        if hikka:
            record.update(hikka)
            print(f"  [{hikka['media_type']}] {hikka['title_ua'] or title}")
        else:
            print("  [не знайдено у hikka]")

        enriched[mal_id] = record
        save_enriched(enriched)
        time.sleep(HIKKA_DELAY)

# ── Крок 3: AniList банери ────────────────────────────────────────────────────

def fetch_banner(session: requests.Session, mal_id: int) -> str | None:
    resp = session.post(
        ANILIST_URL,
        json={"query": ANILIST_QUERY, "variables": {"malId": mal_id}},
        timeout=TIMEOUT_SEC,
    )

    if resp.status_code == 429:
        retry = int(resp.headers.get("Retry-After", 60))
        print(f"\n⏳  Rate limit — чекаємо {retry}с…", flush=True)
        time.sleep(retry)
        return fetch_banner(session, mal_id)

    resp.raise_for_status()
    media = resp.json().get("data", {}).get("Media")
    return media.get("bannerImage") if media else None


def enrich_banners(enriched: dict[int, dict]) -> None:
    # Записи де поле banner_image взагалі відсутнє (не None, а саме відсутнє)
    todo = [r for r in enriched.values() if "banner_image" not in r]
    total = len(todo)

    print(f"\n── AniList банери ───────────────────────────")
    print(f"   Без поля banner_image: {total}")

    if not todo:
        print("   ✅  Всі записи вже мають поле banner_image.")
        return

    session = requests.Session()
    session.headers.update(ANILIST_HEADERS)

    found = 0
    for i, record in enumerate(todo, 1):
        mal_id = record["mal_id"]
        label  = record.get("title_ua") or record.get("title") or f"#{mal_id}"
        print(f"[{i:>5}/{total}] MAL #{mal_id}  {label}", end="  ", flush=True)

        try:
            banner = fetch_banner(session, mal_id)
        except requests.ConnectionError:
            print("\n❌  Втрачено з'єднання — зупиняємо.")
            break
        except requests.RequestException as exc:
            print(f"⚠️  {exc}")
            enriched[mal_id]["banner_image"] = None
            save_enriched(enriched)
            continue

        enriched[mal_id]["banner_image"] = banner
        save_enriched(enriched)

        if banner:
            found += 1
            short = banner[:60] + "…" if len(banner) > 60 else banner
            print(f"✔  {short}")
        else:
            print("—  немає банера")

        time.sleep(ANILIST_DELAY)

    print(f"\n   Банерів знайдено: {found}/{total}")

def prune_stale(enriched: dict[int, dict], unique: dict[int, str | None]) -> None:
    stale = [mid for mid in enriched if mid not in unique]
    if not stale:
        print("\n── Очищення ──────────────────────────────────")
        print("   ✅  Застарілих записів немає.")
        return

    print(f"\n── Очищення ──────────────────────────────────")
    print(f"   Застарілих ID: {len(stale)} — видаляємо…")
    for mid in stale:
        label = enriched[mid].get("title_ua") or enriched[mid].get("title") or f"#{mid}"
        print(f"   — MAL #{mid}  {label}")
        del enriched[mid]

    save_enriched(enriched)
    print(f"   ✅  Після очищення: {len(enriched)} записів.")

# ── Точка входу ───────────────────────────────────────────────────────────────

def main() -> None:
    unique   = collect_unique()
    enriched = load_enriched()

    prune_stale(enriched, unique)

    enrich_from_hikka(enriched, unique)
    enrich_banners(enriched)

    print(f"\n✅  Готово! Всього записів у {OUTPUT_FILE.name}: {len(enriched)}")


if __name__ == "__main__":
    main()