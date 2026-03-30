"""
Скрапер актуального ТОП-аніме MyAnimeList (score ≥ 8.0)
────────────────────────────────────────────────────────
• Використовує тільки сучасну розмітку (v6)
• Проходить сторінки по 50 тайтлів (?limit=50,100,150...)
• Зупиняється, коли з'являються аніме з рейтингом нижче 8.0
• Збирає: id, title, score, members, scored_by
• scored_by — <span itemprop="ratingCount"> з /anime/{id}
• Зберігає проміжний результат кожні SAVE_EVERY оброблених аніме
• Вихід: ./top_anime_8plus_YYYY-MM-DD.json
"""

import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ── Конфіг ────────────────────────────────────────────────────────────────────

MAL_BASE_URL  = "https://myanimelist.net/topanime.php"
MAL_ANIME_URL = "https://myanimelist.net/anime/{id}"

DELAY_SEC       = 0.5   # між запитами сторінок рейтингу
STATS_DELAY_SEC = 0.8   # між запитами сторінок аніме
LIMIT_STEP      = 50
MIN_SCORE       = 8.0
DAYS_OFFSET     = -1
SAVE_EVERY      = 10    # зберігати проміжний результат кожні N аніме

FETCH_SCORED_BY = True  # ← вмикає/вимикає парсинг scored_by

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/134.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

BASE_DIR = Path(__file__).parent.parent
OUT_DIR  = BASE_DIR / "snapshots/anime-mal"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ── Типи даних ────────────────────────────────────────────────────────────────

@dataclass
class AnimeEntry:
    rank:    int | None
    id:      int | None
    title:   str | None
    score:   float | None
    members: int | None


# ── Утиліти ───────────────────────────────────────────────────────────────────

def _id_from_href(href: str | None) -> int | None:
    if not href:
        return None
    m = re.search(r"/anime/(\d+)", href)
    if m:
        return int(m.group(1))
    m = re.search(r"[?&](?:animeid|id)=(\d+)", href)
    return int(m.group(1)) if m else None


def _parse_score(text: str | None) -> float | None:
    try:
        val = float((text or "").strip())
        return round(val, 2) if 0 <= val <= 10 else None
    except ValueError:
        return None


def _parse_int(text: str | None) -> int | None:
    if not text:
        return None
    m = re.search(r"[\d]+", text.replace(",", ""))
    return int(m.group()) if m else None


def _parse_rank(text: str | None) -> int | None:
    if not text:
        return None
    m = re.search(r"#?(\d+)", text.strip())
    return int(m.group(1)) if m else None


def _target_date() -> datetime:
    return datetime.now() + timedelta(days=DAYS_OFFSET)


# ── Парсер scored_by з інфобоксу аніме ───────────────────────────────────────

def fetch_scored_by(session: requests.Session, anime_id: int) -> int | None:
    """
    Завантажує /anime/{id} і читає прихований span з кількістю оцінок:
        <span itemprop="ratingCount" style="display: none">859923</span>
    """
    url = MAL_ANIME_URL.format(id=anime_id)
    try:
        resp = session.get(url, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        print(f"⚠️  {e}")
        return None

    soup = BeautifulSoup(resp.text, "lxml")
    tag = soup.find("span", itemprop="ratingCount")
    if tag:
        return _parse_int(tag.get_text(strip=True))
    return None


# ── Збереження (проміжне і фінальне) ─────────────────────────────────────────

def save_result(output_path: Path, anime: list[dict], today: str) -> None:
    timestamp = datetime.strptime(today, "%Y-%m-%d").strftime("%Y%m%d000000")
    result = {
        "date":      today,
        "timestamp": timestamp,
        "source":    "myanimelist.net/topanime.php",
        "min_score": MIN_SCORE,
        "total":     len(anime),
        "anime":     anime,
    }
    output_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


# ── Парсер рядка (v6 — сучасна розмітка) ─────────────────────────────────────

def _row_v6(row) -> AnimeEntry | None:
    rank_tag = row.select_one(".rank")
    rank = _parse_rank(rank_tag.get_text(strip=True) if rank_tag else None)

    title_block = row.select_one(".anime_ranking_h3 a") or row.select_one("a.fw-b")
    title = title_block.get_text(strip=True) if title_block else None
    href = title_block.get("href") if title_block else None
    anime_id = _id_from_href(href)

    score_tag = row.select_one(".score-label") or row.select_one("span.text")
    score = _parse_score(score_tag.get_text(strip=True) if score_tag else None)

    info = row.select_one(".information")
    members = None
    if info:
        info_text = info.get_text(separator=" ")
        members_m = re.search(r"([\d,]+)\s+members?", info_text, re.I)
        members = _parse_int(members_m.group(1) if members_m else None)

    if anime_id is None and title is None:
        return None

    return AnimeEntry(rank=rank, id=anime_id, title=title, score=score, members=members)


# ── Парсер сторінки рейтингу ──────────────────────────────────────────────────

def parse_page(html: str) -> tuple[list[AnimeEntry], bool]:
    soup = BeautifulSoup(html, "lxml")
    entries: list[AnimeEntry] = []
    seen_ids: set[int] = set()
    stop = False

    for row in soup.select("tr.ranking-list"):
        entry = _row_v6(row)
        if entry is None:
            continue
        if entry.id is not None:
            if entry.id in seen_ids:
                continue
            seen_ids.add(entry.id)

        if entry.score is not None and entry.score < MIN_SCORE:
            stop = True
            break

        entries.append(entry)

    return entries, stop


# ── Основна логіка ────────────────────────────────────────────────────────────

def main() -> None:
    target = _target_date()
    today  = target.strftime("%Y-%m-%d")
    output_path = OUT_DIR / f"{today}.json"

    if output_path.exists():
        print(f"⚠️  Файл вже існує: {output_path}")
        print("Скрапінг пропущено.")
        return

    session = requests.Session()
    session.headers.update(HEADERS)

    all_anime: list[dict] = []
    page = 0

    # ── Крок 1: збір основного списку ─────────────────────────────────────────

    print("🚀  Починаємо скрапінг актуального Top Anime (score ≥ 8.0)...\n")

    while True:
        offset = page * LIMIT_STEP
        url = f"{MAL_BASE_URL}?limit={offset}"
        print(f"📄  Сторінка {page + 1} → limit={offset} ... ", end="", flush=True)

        try:
            resp = session.get(url, timeout=15)
            resp.raise_for_status()
        except requests.RequestException as e:
            print(f"❌  Помилка запиту: {e}")
            break

        entries, stop = parse_page(resp.text)

        if not entries:
            print("⚠️  Порожня сторінка або зміна розмітки")
            break

        added = 0
        for entry in entries:
            if entry.score is None or entry.score < MIN_SCORE:
                stop = True
                break
            all_anime.append({
                "id":      entry.id,
                "title":   entry.title,
                "score":   entry.score,
                "members": entry.members,
            })
            added += 1

        print(f"✅  +{added} тайтлів (всього: {len(all_anime)})")

        if stop or len(entries) < LIMIT_STEP or added == 0:
            break

        page += 1
        time.sleep(DELAY_SEC)

    # ── Крок 2: збагачення scored_by ──────────────────────────────────────────

    if FETCH_SCORED_BY and all_anime:
        total = len(all_anime)
        print(f"\n📊  Завантажуємо scored_by для {total} аніме...\n")

        for i, item in enumerate(all_anime, 1):
            anime_id = item.get("id")
            if anime_id is None:
                item["scored_by"] = None
                continue

            print(f"   [{i:>4}/{total}] id={anime_id:>6} ... ", end="", flush=True)
            scored_by = fetch_scored_by(session, anime_id)
            item["scored_by"] = scored_by
            print(f"{scored_by:,}" if scored_by else "—")

            # Проміжне збереження кожні SAVE_EVERY аніме
            if i % SAVE_EVERY == 0:
                save_result(output_path, all_anime, today)
                print(f"   💾  Проміжне збереження ({i}/{total})\n")

            time.sleep(STATS_DELAY_SEC)

    # ── Фінальне збереження ───────────────────────────────────────────────────

    save_result(output_path, all_anime, today)

    print(f"\n🎉  Готово!")
    print(f"   Зібрано {len(all_anime)} аніме з рейтингом ≥ {MIN_SCORE}")
    print(f"   Файл збережено: {output_path}")


if __name__ == "__main__":
    main()