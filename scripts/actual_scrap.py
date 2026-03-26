"""
Скрапер актуального ТОП-аніме MyAnimeList (score ≥ 8.0)
────────────────────────────────────────────────────────
• Використовує тільки сучасну розмітку (v6)
• Проходить сторінки по 50 тайтлів (?limit=50,100,150...)
• Зупиняється, коли з'являються аніме з рейтингом нижче 8.0
• Збирає: id, title, score, members, rank
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

MAL_BASE_URL = "https://myanimelist.net/topanime.php"
DELAY_SEC    = 0.5
LIMIT_STEP   = 50
MIN_SCORE    = 8.0
DAYS_OFFSET  = -1

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
OUT_DIR.mkdir(exist_ok=True)

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
    # Підтримка як сучасного /anime/5114/, так і старих форматів
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


def _parse_members(text: str | None) -> int | None:
    if not text:
        return None
    m = re.search(r"([\d,]+)", text.replace(",", ""))
    return int(m.group(1)) if m else None


def _parse_rank(text: str | None) -> int | None:
    if not text:
        return None
    m = re.search(r"#?(\d+)", text.strip())
    return int(m.group(1)) if m else None


# ── Парсер рядка (v6 — сучасна розмітка) ─────────────────────────────────────

def _row_v6(row) -> AnimeEntry | None:
    """
    Сучасна розмітка MyAnimeList Top Anime (2019+)
    """
    # Rank
    rank_tag = row.select_one(".rank")
    rank = _parse_rank(rank_tag.get_text(strip=True) if rank_tag else None)

    # Title block
    title_block = row.select_one(".anime_ranking_h3 a") or row.select_one("a.fw-b")
    title = title_block.get_text(strip=True) if title_block else None
    href = title_block.get("href") if title_block else None
    anime_id = _id_from_href(href)

    # Score
    score_tag = row.select_one(".score-label") or row.select_one("span.text")
    score = _parse_score(score_tag.get_text(strip=True) if score_tag else None)

    # Members
    info = row.select_one(".information")
    members = None
    if info:
        info_text = info.get_text(separator=" ")
        members_m = re.search(r"([\d,]+)\s+members?", info_text, re.I)
        members = _parse_members(members_m.group(1) if members_m else None)

    if anime_id is None and title is None:
        return None

    return AnimeEntry(
        rank=rank,
        id=anime_id,
        title=title,
        score=score,
        members=members
    )


# ── Парсер сторінки ───────────────────────────────────────────────────────────

def parse_page(html: str) -> list[AnimeEntry]:
    soup = BeautifulSoup(html, "lxml")
    entries: list[AnimeEntry] = []
    seen_ids: set[int] = set()

    for row in soup.select("tr.ranking-list"):
        entry = _row_v6(row)
        if entry is None:
            continue
        if entry.id is not None:
            if entry.id in seen_ids:
                continue
            seen_ids.add(entry.id)

        # Якщо score < 8.0 — вважаємо, що далі йде "хвост" і можна зупинятися
        if entry.score is not None and entry.score < MIN_SCORE:
            return entries  # повертаємо те, що зібрали до цього моменту

        entries.append(entry)

    return entries


# ── Основна логіка ────────────────────────────────────────────────────────────

def main() -> None:
    today = (datetime.now() + timedelta(days=DAYS_OFFSET)).strftime("%Y-%m-%d")
    filename = f"{today}.json"
    output_path = OUT_DIR / filename

    if output_path.exists():
        print(f"⚠️  Файл вже існує: {output_path}")
        print("Скрапінг пропущено.")
        return

    session = requests.Session()
    session.headers.update(HEADERS)

    all_anime: list[dict] = []
    page = 0
    stop_scraping = False

    print("🚀  Починаємо скрапінг актуального Top Anime (score ≥ 8.0)...\n")

    while not stop_scraping:
        offset = page * LIMIT_STEP
        url = f"{MAL_BASE_URL}?limit={offset}"

        print(f"📄  Сторінка {page + 1} → limit={offset} ... ", end="")

        try:
            resp = session.get(url, timeout=15)
            resp.raise_for_status()
        except requests.RequestException as e:
            print(f"❌  Помилка запиту: {e}")
            break

        entries = parse_page(resp.text)

        if not entries:
            print("⚠️  Порожня сторінка або зміна розмітки")
            break

        added = 0
        for entry in entries:
            if entry.score is None or entry.score < MIN_SCORE:
                stop_scraping = True
                break

            all_anime.append({
                "id":      entry.id,
                "title":   entry.title,
                "score":   entry.score,
                "members": entry.members,
            })
            added += 1

        print(f"✅  +{added} тайтлів (всього: {len(all_anime)})")

        if stop_scraping or len(entries) < LIMIT_STEP or added == 0:
            break

        page += 1
        time.sleep(DELAY_SEC)

    # ── Збереження результату ─────────────────────────────────────────────────
    today = (datetime.now() + timedelta(days=DAYS_OFFSET)).strftime("%Y-%m-%d")
    timestamp = (datetime.now() + timedelta(days=DAYS_OFFSET)).strftime("%Y%m%d000000")
    filename = f"{today}.json"

    output_path = OUT_DIR / filename

    result = {
        "date": today,
        "timestamp": timestamp,
        "source": "myanimelist.net/topanime.php",
        "min_score": MIN_SCORE,
        "total": len(all_anime),
        "anime": all_anime
    }

    output_path.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    print(f"\n🎉  Готово!")
    print(f"   Зібрано {len(all_anime)} аніме з рейтингом ≥ {MIN_SCORE}")
    print(f"   Файл збережено: {output_path}")


if __name__ == "__main__":
    main()