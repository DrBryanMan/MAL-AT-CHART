"""
Скрапер актуального ТОП-аніме MyAnimeList (score ≥ 8.0)
────────────────────────────────────────────────────────
Алгоритм:
  Фаза 1 (послідовно) — збираємо рядки рейтингу (?limit=0,50,100...)
                        зупиняємось, коли row_score < MIN_SCORE
  Фаза 2 (паралельно) — MAX_WORKERS воркерів одночасно тягнуть сторінки
                        аніме та парсять score / scored_by / members
                        кожен запит: RETRY_COUNT повторів при помилці
  Фаза 3 (послідовно) — перевіряє збережений файл, повторно парсить
                        аніме де будь-яке поле є null
  Вихід: snapshots/anime-mal/YYYY-MM-DD.json
"""

import json
import re
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ── Конфіг ────────────────────────────────────────────────────────────────────

MAL_TOP_URL   = "https://myanimelist.net/topanime.php"
MAL_ANIME_URL = "https://myanimelist.net/anime/{id}"

PAGE_DELAY_SEC  = 0.4   # між запитами сторінок рейтингу (послідовно)
ANIME_DELAY_SEC = 0.3   # затримка всередині кожного воркера
MAX_WORKERS     = 5     # паралельних воркерів (5 — безпечно для MAL)
LIMIT_STEP      = 50
MIN_SCORE       = 8.0
SAVE_EVERY      = 20    # частіше, бо паралельно йде швидше

RETRY_COUNT     = 2     # кількість повторних спроб при помилці
RETRY_DELAY_SEC = 3.0   # пауза перед повторною спробою

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/134.0.0.0 Safari/537.36"
    ),
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

BASE_DIR = Path(__file__).parent.parent
OUT_DIR  = BASE_DIR / "snapshots/anime-mal"
OUT_DIR.mkdir(parents=True, exist_ok=True)


# ── Утиліти ───────────────────────────────────────────────────────────────────

def parse_int(text: str | None) -> int | None:
    if not text:
        return None
    m = re.search(r"\d+", text.replace(",", ""))
    return int(m.group()) if m else None


def parse_float(text: str | None) -> float | None:
    try:
        val = float((text or "").strip())
        return round(val, 2) if 0.0 <= val <= 10.0 else None
    except ValueError:
        return None


def id_from_href(href: str | None) -> int | None:
    if not href:
        return None
    m = re.search(r"/anime/(\d+)", href)
    if m:
        return int(m.group(1))
    m = re.search(r"[?&](?:animeid|id)=(\d+)", href)
    return int(m.group(1)) if m else None


# ── Парсер рядків сторінки рейтингу ──────────────────────────────────────────

def parse_ranking_rows(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    rows = []

    for row in soup.select("tr.ranking-list"):
        rank_tag  = row.select_one(".rank")
        title_tag = row.select_one(".anime_ranking_h3 a") or row.select_one("a.fw-b")
        score_tag = row.select_one(".score-label") or row.select_one("span.text")

        title = title_tag.get_text(strip=True) if title_tag else None
        href  = title_tag.get("href") if title_tag else None
        aid   = id_from_href(href)

        if aid is None and title is None:
            continue

        rows.append({
            "rank":      parse_int(rank_tag.get_text(strip=True) if rank_tag else None),
            "id":        aid,
            "title":     title,
            "row_score": parse_float(score_tag.get_text(strip=True) if score_tag else None),
        })

    return rows


# ── Парсер сторінки аніме (leftside) ─────────────────────────────────────────

def parse_anime_page(html: str) -> dict:
    soup = BeautifulSoup(html, "lxml")

    score_tag     = soup.find(itemprop="ratingValue")
    scored_by_tag = soup.find(itemprop="ratingCount")

    score     = parse_float(score_tag.get_text(strip=True) if score_tag else None)
    scored_by = parse_int(scored_by_tag.get_text(strip=True) if scored_by_tag else None)

    # members — первинний пошук: .spaceit_pad з текстом "Members"
    members = None
    for tag in soup.select(".spaceit_pad"):
        text = tag.get_text(separator=" ", strip=True)
        if re.search(r"\bMembers\b", text, re.I):
            m = re.search(r"Members[:\s]+([\d,]+)", text, re.I)
            if m:
                members = parse_int(m.group(1))
                break

    # fallback: .stats-block .numbers.members
    if members is None:
        stats_block = soup.find("div", class_=lambda c: c and "stats-block" in c)
        if stats_block:
            numbers_tag = stats_block.find(class_="numbers members")
            if numbers_tag:
                members = parse_int(numbers_tag.get_text(strip=True))

    return {"score": score, "scored_by": scored_by, "members": members}


# ── HTTP-запит з retry ────────────────────────────────────────────────────────

def fetch_html(session: requests.Session, url: str) -> str | None:
    for attempt in range(1, RETRY_COUNT + 2):   # 1 основна + RETRY_COUNT повторів
        try:
            resp = session.get(url, timeout=15)
            resp.raise_for_status()
            return resp.text
        except requests.RequestException as e:
            if attempt <= RETRY_COUNT:
                print(f"   ⚠️  {e}  → повтор {attempt}/{RETRY_COUNT} через {RETRY_DELAY_SEC}с...")
                time.sleep(RETRY_DELAY_SEC)
            else:
                print(f"   ❌  {e}  — пропускаємо.")
    return None


# ── Воркер: завантажити + розпарсити одне аніме ───────────────────────────────

def fetch_anime(row: dict) -> dict:
    """Виконується в окремому треді. Кожен воркер має свою Session."""
    session = requests.Session()
    session.headers.update(HEADERS)

    html    = fetch_html(session, MAL_ANIME_URL.format(id=row["id"]))
    time.sleep(ANIME_DELAY_SEC)

    details = parse_anime_page(html) if html else {"score": None, "scored_by": None, "members": None}
    score   = details["score"] if details["score"] is not None else row["row_score"]

    return {
        "id":        row["id"],
        "title":     row["title"],
        "score":     score,
        "scored_by": details["scored_by"],
        "members":   details["members"],
        "_rank":     row["rank"],   # службове — для сортування
    }


# ── Збереження (thread-safe) ──────────────────────────────────────────────────

def save_result(
    output_path: Path,
    anime: list[dict],
    today: str,
    lock: threading.Lock,
) -> None:
    timestamp = datetime.strptime(today, "%Y-%m-%d").strftime("%Y%m%d000000")
    payload = {
        "date":      today,
        "timestamp": timestamp,
        "source":    "myanimelist.net/topanime.php",
        "min_score": MIN_SCORE,
        "total":     len(anime),
        "anime":     anime,
    }
    with lock:
        output_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


# ── Фаза 1: збір рядків рейтингу (послідовно) ────────────────────────────────

def collect_ranking_rows(session: requests.Session) -> list[dict]:
    rows: list[dict] = []
    seen_ids: set[int] = set()
    page = 0

    print("📋  Фаза 1 — збираємо список рейтингу...\n")

    while True:
        offset = page * LIMIT_STEP
        url    = f"{MAL_TOP_URL}?limit={offset}"
        print(f"   📄  Сторінка {page + 1}  (limit={offset}) ... ", end="", flush=True)

        html = fetch_html(session, url)
        if not html:
            print("❌")
            break

        page_rows = parse_ranking_rows(html)
        if not page_rows:
            print("⚠️  порожньо або зміна розмітки")
            break

        added = 0
        stop  = False
        for row in page_rows:
            if row["row_score"] is not None and row["row_score"] < MIN_SCORE:
                stop = True
                break
            if row["id"] in seen_ids:
                continue
            seen_ids.add(row["id"])
            rows.append(row)
            added += 1

        print(f"+{added}  (всього: {len(rows)})")

        if stop or len(page_rows) < LIMIT_STEP:
            break

        page += 1
        time.sleep(PAGE_DELAY_SEC)

    return rows


# ── Фаза 2: паралельне завантаження сторінок аніме ───────────────────────────

def fetch_all_anime(rows: list[dict], output_path: Path, today: str) -> list[dict]:
    total      = len(rows)
    done_count = 0
    results    = {}          # rank → entry (для фінального сортування)
    save_lock  = threading.Lock()
    print_lock = threading.Lock()

    print(f"\n🚀  Фаза 2 — {total} аніме, {MAX_WORKERS} воркерів паралельно...\n")

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(fetch_anime, row): row for row in rows}

        for future in as_completed(futures):
            entry = future.result()
            rank  = entry.pop("_rank") or 0
            results[rank] = entry

            scored_by_str = f"{entry['scored_by']:,}" if entry["scored_by"] else "—"
            members_str   = f"{entry['members']:,}"   if entry["members"]   else "—"

            with print_lock:
                done_count += 1
                print(
                    f"   [{done_count:>4}/{total}] "
                    f"#{rank:<4} {entry['title'][:48]:<48}  "
                    f"score={entry['score']}  "
                    f"scored_by={scored_by_str}  members={members_str}"
                )

                if done_count % SAVE_EVERY == 0:
                    snapshot = [results[r] for r in sorted(results)]
                    save_result(output_path, snapshot, today, save_lock)
                    print(f"\n   💾  Проміжне збереження ({done_count}/{total})\n")

    return [results[r] for r in sorted(results)]


# ── Фаза 3: ремонт null-полів у збереженому файлі ────────────────────────────

def repair_nulls(output_path: Path, today: str) -> None:
    """
    Читає вже збережений JSON, знаходить аніме де будь-яке з полів
    score / scored_by / members є null, і повторно їх парсить (послідовно).
    """
    data = json.loads(output_path.read_text(encoding="utf-8"))
    anime_list: list[dict] = data["anime"]

    broken = [
        (i, entry) for i, entry in enumerate(anime_list)
        if any(entry.get(f) is None for f in ("score", "scored_by", "members"))
    ]

    if not broken:
        print("✅  Null-полів не знайдено — файл чистий.")
        return

    print(f"\n🔧  Фаза 3 — ремонт {len(broken)} аніме з null-полями...\n")

    session = requests.Session()
    session.headers.update(HEADERS)
    save_lock = threading.Lock()
    fixed = 0

    for idx, (i, entry) in enumerate(broken, 1):
        aid = entry.get("id")
        print(f"   [{idx:>3}/{len(broken)}] id={aid}  {entry['title'][:55]} ... ", end="", flush=True)

        html = fetch_html(session, MAL_ANIME_URL.format(id=aid))
        if not html:
            print("пропуск")
            continue

        details = parse_anime_page(html)

        # Оновлюємо тільки поля, які були null
        patched = []
        if entry.get("score") is None and details["score"] is not None:
            anime_list[i]["score"] = details["score"]
            patched.append(f"score={details['score']}")
        if entry.get("scored_by") is None and details["scored_by"] is not None:
            anime_list[i]["scored_by"] = details["scored_by"]
            patched.append(f"scored_by={details['scored_by']:,}")
        if entry.get("members") is None and details["members"] is not None:
            anime_list[i]["members"] = details["members"]
            patched.append(f"members={details['members']:,}")

        if patched:
            fixed += 1
            print("✔  " + "  ".join(patched))
        else:
            print("—  поля залишились null (сторінка не містить даних)")

        time.sleep(ANIME_DELAY_SEC)

    # Зберігаємо оновлений файл
    data["anime"] = anime_list
    save_lock_final = threading.Lock()
    save_result(output_path, anime_list, today, save_lock_final)
    print(f"\n   💾  Файл оновлено. Виправлено {fixed}/{len(broken)} аніме.")


# ── Основна логіка ────────────────────────────────────────────────────────────

def main() -> None:
    today       = datetime.now().strftime("%Y-%m-%d")
    output_path = OUT_DIR / f"{today}.json"

    t_start = time.perf_counter()

    if output_path.exists():
        print(f"📂  Файл вже існує: {output_path}")
        print("   Фази 1 і 2 пропущено — одразу перевіряємо null-поля.\n")
    else:
        session = requests.Session()
        session.headers.update(HEADERS)

        rows      = collect_ranking_rows(session)
        all_anime = fetch_all_anime(rows, output_path, today)
        save_result(output_path, all_anime, today, threading.Lock())

        elapsed_scrape = time.perf_counter() - t_start
        print(f"\n   Скрапінг завершено за {elapsed_scrape:.1f}с  ({len(all_anime)} аніме)\n")

    # Фаза 3: завжди — перевіряємо і лагодимо null-поля
    repair_nulls(output_path, today)

    elapsed = time.perf_counter() - t_start
    print(f"\n🎉  Готово за {elapsed:.1f}с")
    print(f"   Файл: {output_path}")


if __name__ == "__main__":
    main()