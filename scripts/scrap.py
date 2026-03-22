"""
Скрапер ТОП-аніме MyAnimeList (Wayback Machine, всі версії дизайну)
───────────────────────────────────────────────────────────────────
• Знаходить усі знімки через CDX API (останній снепшот кожного дня)
• Скрапить тільки першу сторінку кожного знімка
• Збирає всі тайтли без фільтру рейтинґу
• Пропускає дублікати за anime id
• Вихід: ./snapshots/YYYY-MM-DD.json

Підтримувані версії розмітки MAL:
  v1  (~2006)       — таблиця td.td1, без посилань (id недоступний)
  v2  (~2007-04)    — td.borderClass, href="anime.php?id=X", "Scored X.XX"
  v3  (~2007-07+)   — td.borderClass + div.picSurround, "scored X.XX"
  v5  (~2015-2018)  — tr.ranking-list, span.text.on для оцінки
  v6  (~2019+)      — tr.ranking-list + .anime_ranking_h3, span.score-label

Залежності: pip install requests beautifulsoup4 lxml
"""

import json
import re
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ── Конфіг ────────────────────────────────────────────────────────────────────

MAL_URL   = "http://myanimelist.net/topanime.php"
CDX_API   = "https://web.archive.org/cdx/search/cdx"
WB_PREFIX = "https://web.archive.org/web"

OUT_DIR        = Path(__file__).parent / "../snapshots"
DELAY_SEC      = 1.5
MAX_SNAPSHOTS  = None   # None = всі; число = ліміт (наприклад 5 для тесту)
USE_CDX_CACHE  = True   # True = брати список днів з файлу; False = новий запит до CDX API
CDX_CACHE_FILE  = Path(__file__).parent / "../data/cdx_snapshots.json"
EMPTY_LIST_FILE = Path(__file__).parent / "../data/empty_snapshots.json"

# Знімки які завідомо повертають помилку — пропускаємо одразу.
# Файл містить JSON-масив рядків: ["20070509192624", "20070312083156"]
SKIP_FILE = Path(__file__).parent / "../data/skip_timestamps.json"

# Таблиця версій розмітки MAL по датах (включно з датою початку).
# Якщо дата знімка >= ключ — використовується відповідна версія.
# Відсортовано від найновішої до найстарішої (перший матч виграє).
VERSION_BY_DATE: list[tuple[str, str]] = [
    ("2019-01-01", "v6"),   # ~2019+        tr.ranking-list + .anime_ranking_h3
    ("2017-12-25", "v5a"),  # ~2017-2018    tile-unit (інфініті скрол)
    ("2015-01-01", "v5"),   # ~2015-2018    tr.ranking-list + span.text.on
    ("2007-08-26", "v3b"),  # ~2007-08-26   picSurround, 3 колонки
    ("2007-08-16", "v3a"),  # ~2007-08-16   picSurround, 2 колонки, "Scored X"
    ("2007-05-05", "v2"),   # ~2007-05      borderClass, ранг у span
    ("2007-01-21", "v1c"),  # ~2007-01      borderClass, ранг "#N" у першій td
    ("2006-01-01", "v1"),   # ~2006         td.td1
]

def version_for_date(date: str) -> str:
    """Повертає версію розмітки за датою знімка (YYYY-MM-DD)."""
    for since, version in VERSION_BY_DATE:
        if date >= since:
            return version
    return "v1"


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/123.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# ── Типи даних ────────────────────────────────────────────────────────────────

@dataclass
class Snapshot:
    timestamp: str   # YYYYMMDDHHmmss
    date: str        # YYYY-MM-DD
    url: str

@dataclass
class AnimeEntry:
    id:      int   | None
    title:   str   | None
    members: int   | None
    score:   float | None

# ── Утиліти ───────────────────────────────────────────────────────────────────

def _id_from_href(href: str | None) -> int | None:
    if not href:
        return None
    # Wayback-префіксний URL: /web/20151127035044/http://...net/anime/5114/...
    # або https://web.archive.org/web/.../http://...net/anime/5114/...
    # Обидва варіанти вже покриваються регуляркою нижче, але прибираємо префікс явно
    href = re.sub(r"https?://web\.archive\.org/web/\d+[^/]*/", "", href)
    href = re.sub(r"^/web/\d+[^/]*/", "", href)
    # Сучасний формат: /anime/5114/...
    m = re.search(r"/anime/(\d+)", href)
    if m:
        return int(m.group(1))
    # Старий формат (2007+): anime.php?id=1535  або  forum/?animeid=1535
    m = re.search(r"[?&](?:animeid|id)=(\d+)", href)
    if m:
        return int(m.group(1))
    # Найстаріший формат (~2006): seriesinfo.php?series_id=1535
    m = re.search(r"[?&]series_id=(\d+)", href)
    return int(m.group(1)) if m else None

def _parse_score(text: str | None) -> float | None:
    try:
        return round(float((text or "").strip()), 2)
    except ValueError:
        return None

def _parse_members(text: str | None) -> int | None:
    m = re.search(r"[\d,]+", text or "")
    return int(m.group().replace(",", "")) if m else None

def _has_rank(row, *, in_span: bool = False) -> bool:
    """
    Перевіряє чи є у рядку порядковий номер тайтлу.
    v1, v3, v5, v6 — ранг у першому <td> (текст "#1" або "1").
    v2             — ранг у span.lightLink другого <td> (текст "#1...").
    """
    tds = row.find_all("td", recursive=False)
    if not tds:
        return False
    if in_span:
        # v2: шукаємо span.lightLink що починається з "#N"
        for td in tds:
            for span in td.find_all("span", class_="lightLink"):
                if re.match(r"#\d+", span.get_text(strip=True)):
                    return True
        return False
    # всі інші: перша td містить "#N" або просто "N"
    first = tds[0].get_text(strip=True)
    return bool(re.match(r"#?\d+$", first))


def _clean_poster(url: str | None) -> str | None:
    """Прибирає Wayback-префікс і нормалізує схему."""
    if not url:
        return None
    # https://web.archive.org/web/20160120083226im_/http://cdn... → http://cdn...
    m = re.search(r"https?://web\.archive\.org/web/\d+[^/]*/(.+)", url)
    if m:
        url = m.group(1)
        # відновлюємо схему якщо була знята
        if not url.startswith("http"):
            url = "https://" + url.lstrip("/")
    if url.startswith("//"):
        url = "https:" + url
    return url

# ── Детектор версії HTML ──────────────────────────────────────────────────────

def detect_version(soup: BeautifulSoup) -> str:
    if soup.select_one("tr.ranking-list .anime_ranking_h3"):
        return "v6"   # ~2019+
    if soup.select_one("div.tile-unit"):
        return "v5a"  # ~2017-2018 (інфініті скрол, tile-картки)
    if soup.select_one("tr.ranking-list"):
        return "v5"   # ~2015-2018
    if soup.select_one("div.picSurround"):
        # v3a: 2 колонки (картинка | інфо з рангом у span), scored у тексті
        # v3b: 3 колонки (ранг | картинка | інфо)
        sample = soup.select_one("tr:has(div.picSurround)")
        # не використовуємо :has() — знаходимо вручну
        for tr in soup.find_all("tr"):
            if tr.find("div", class_="picSurround"):
                tds = tr.find_all("td", class_="borderClass")
                if len(tds) == 2:
                    return "v3a"  # ~2007-08
                return "v3b"  # ~2007-07+
        return "v3b"
    # v1 має пріоритет над v2: якщо є td.td1 (score/members) — це стара розмітка,
    # навіть якщо td.borderClass присутній як клас назви (перехідний ~2007-01)
    if soup.select_one("td.td1"):
        return "v1"   # ~2006–2007-01
    if soup.select_one("td.borderClass"):
        # v1c: ранг "#N" у першій td рядка (як v1, але клас borderClass)
        # v2:  ранг "#N..." у span.lightLink другої td
        # Перебираємо ВСІ рядки — перший може бути заголовком
        for tr in soup.find_all("tr"):
            tds = tr.find_all("td", class_="borderClass")
            if not tds:
                continue
            first_text = tds[0].get_text(strip=True)
            # Знайшли рядок даних з рангом
            if re.match(r"#\d+$", first_text):
                return "v1c"  # ~2007-01 to 2007-04
            # Знайшли рядок даних без рангу в першій td — це v2
            # (перший td містить картинку, ранг у span другої td)
            if tds[0].find("img") or (len(tds) >= 2 and tds[1].find("span", class_="lightLink")):
                return "v2"
            # Інакше — заголовок, пропускаємо
        return "v2"   # fallback
    return "unknown"

# ── Парсери рядків ────────────────────────────────────────────────────────────

def _row_v1(row) -> AnimeEntry | None:
    """
    <tr>
      <td class="td1">#1</td>
      <td class="td1">           ← кнопки: seriesinfo.php?series_id=X, forum/?animeid=X
        <a href="seriesinfo.php?series_id=1535"><img .../></a>
        <a href="forum/?animeid=1535"><img .../></a>
      </td>
      <td class="td1">
        <strong>Title</strong>            ← до 2007-01-21 просто текст
        або
        <a href="seriesinfo.php?series_id=1535">Title</a>  ← після 2007-01-21
      </td>
      <td class="td1">8.82</td>  ← score
      <td class="td1">51</td>    ← members
    </tr>
    """
    # Беремо ВСІ td рядка — у перехідній версії (~2007-01) title-td може мати клас borderClass
    all_tds = row.find_all("td")
    if len(all_tds) < 4:
        return None

    if not _has_rank(row):
        return None

    # ID — шукаємо в БУДЬ-ЯКОМУ посиланні рядка
    anime_id = None
    for a in row.find_all("a", href=True):
        anime_id = _id_from_href(a.get("href"))
        if anime_id:
            break

    # Score — шукаємо td з числом у діапазоні 1.0–10.0
    # Остання колонка (після score) — епізоди, не members; members у v1 недоступні
    score, members = None, None
    for td in all_tds:
        text = td.get_text(strip=True)
        val  = _parse_score(text)
        if val and 1.0 <= val <= 10.0 and not td.find("a"):
            score = val
            break

    # Назва — td де є <strong> або не-javascript посилання з текстом
    title = None
    for td in all_tds[1:]:
        # Пріоритет: <a> з реальним href (не javascript:) що має текст
        real_a = td.find("a", href=lambda h: h and not h.startswith("javascript:"))
        if real_a and real_a.get_text(strip=True):
            # Переконуємось що це не кнопка-картинка (посилання містить лише img)
            if real_a.find("img") and not real_a.get_text(strip=True):
                continue
            candidate = real_a.get_text(strip=True)
            if candidate and not re.match(r"^#?\d+$", candidate) and not re.match(r"^\d+\.?\d*$", candidate):
                title = candidate
                break
        # Запасний варіант: <strong> без посилань
        strong = td.find("strong")
        if strong:
            candidate = strong.get_text(strip=True)
            if candidate and not re.match(r"^#?\d+$", candidate) and not re.match(r"^\d+\.?\d*$", candidate):
                title = candidate
                break

    return AnimeEntry(id=anime_id, title=title, members=members, score=score)


def _row_v1c(row) -> AnimeEntry | None:
    """
    Перехідна версія (~2007-01 to 2007-04): клас borderClass, але структура як v1.
    <tr>
      <td class="borderClass">#1</td>             ← ранг
      <td class="borderClass">                    ← кнопки (javascript void + img)
        <a href="javascript:void(0);">...</a>
      </td>
      <td class="borderClass">                    ← назва
        <a href="anime.php?id=1535">Title</a>
      </td>
      <td class="borderClass">8.91</td>           ← score
      <td class="borderClass">37</td>             ← епізоди (не members)
    </tr>
    """
    tds = row.find_all("td", class_="borderClass")
    if len(tds) < 4:
        return None

    if not _has_rank(row):
        return None

    # Назва і ID — перша td що містить реальне посилання (не javascript:)
    # Може бути tds[1] (Jan 2007) або tds[2] (Apr 2007)
    anime_id, title = None, None
    for td in tds[1:]:
        a = td.find("a", href=lambda h: h and not h.startswith("javascript:"))
        if a and a.get_text(strip=True) and not a.find("img"):
            anime_id = _id_from_href(a.get("href"))
            title    = a.get_text(strip=True)
            break

    # Score — перша td з числом у діапазоні 1–10 без посилань
    score = None
    for td in tds:
        val = _parse_score(td.get_text(strip=True))
        if val and 1.0 <= val <= 10.0 and not td.find("a"):
            score = val
            break

    return AnimeEntry(id=anime_id, title=title, members=None, score=score)


def _row_v2(row) -> AnimeEntry | None:
    """
    <tr>
      <td class="borderClass"><a href="anime.php?id=1535"><img src="..."/></a></td>
      <td class="borderClass">
        <a href="anime.php?id=1535">Title</a> - N eps<br>
        N members<br>
        <span class="lightLink">Scored 8.85</span>
      </td>
    </tr>
    """
    tds = row.find_all("td", class_="borderClass")
    if len(tds) < 2:
        return None

    if not _has_rank(row, in_span=True):
        return None

    # ID + постер з першої клітинки
    a_img  = tds[0].find("a")
    anime_id = _id_from_href(a_img.get("href") if a_img else None)

    # Назва, score, members з другої клітинки
    a_title = tds[1].find("a")
    title   = a_title.get_text(strip=True) if a_title else None

    # Шукаємо span що містить "Scored X.XX" (не span з рангом "#1...")
    score = None
    for span in tds[1].find_all("span", class_="lightLink"):
        score_m = re.search(r"Scored\s+([\d.]+)", span.get_text(), re.I)
        if score_m:
            score = _parse_score(score_m.group(1))
            break

    members_m = re.search(r"([\d,]+)\s+members", tds[1].get_text(), re.I)
    members   = _parse_members(members_m.group(1) if members_m else None)

    return AnimeEntry(id=anime_id, title=title, members=members, score=score)


def _row_v3a(row) -> AnimeEntry | None:
    """
    Версія ~2007-08: 2 колонки (картинка | інфо з рангом у span).
    <tr>
      <td class="borderClass"><div class="picSurround"><a href="anime.php?id=1535"><img/></a></div></td>
      <td class="borderClass">
        <span class="lightLink">1<div>...</div></span>
        <a href="anime.php?id=1535">Death Note</a> - 37 eps<br>
        Scored 8.91<br>
        <span class="lightLink">3738 members</span>
      </td>
    </tr>
    """
    tds = row.find_all("td", class_="borderClass")
    if len(tds) < 2:
        return None

    pic_div  = tds[0].find("div", class_="picSurround")
    if not pic_div:
        return None

    a_img    = pic_div.find("a")
    anime_id = _id_from_href(a_img.get("href") if a_img else None)

    info_td = tds[1]

    # Назва — перше посилання що не є картинкою
    a_title = info_td.find("a", href=lambda h: h and not h.startswith("javascript:"))
    title   = a_title.get_text(strip=True) if a_title else None

    # Score — "Scored X.XX" у тексті (не у span)
    info_text = info_td.get_text(separator="\n")
    score_m   = re.search(r"Scored\s+([\d.]+)", info_text, re.I)
    score     = _parse_score(score_m.group(1) if score_m else None)

    # Members — span.lightLink що містить "N members"
    members = None
    for span in info_td.find_all("span", class_="lightLink"):
        m = re.search(r"([\d,]+)\s+members", span.get_text(), re.I)
        if m:
            members = _parse_members(m.group(1))
            break
    # Запасний варіант — шукаємо у всьому тексті td
    if members is None:
        m = re.search(r"([\d,]+)\s+members", info_text, re.I)
        if m:
            members = _parse_members(m.group(1))

    return AnimeEntry(id=anime_id, title=title, members=members, score=score)


def _row_v3(row) -> AnimeEntry | None:
    """
    <tr>
      <td class="borderClass"><span class="lightLink">1</span></td>   ← rank
      <td class="borderClass"><div class="picSurround"><a href="anime.php?id=44"><img/></a></div></td>
      <td class="borderClass">
        <a href="anime.php?id=44"><strong>Title</strong></a>
        <div class="spaceit_pad">
          OVA, 4 eps, scored 8.96<br>
          <span class="lightLink">1561 members</span>
        </div>
      </td>
    </tr>
    """
    if not _has_rank(row):
        return None

    pic_div = row.find("div", class_="picSurround")
    if not pic_div:
        return None

    a_img    = pic_div.find("a")
    anime_id = _id_from_href(a_img.get("href") if a_img else None)

    tds = row.find_all("td", class_="borderClass")
    info_td = tds[2] if len(tds) >= 3 else None

    a_title = info_td.find("a") if info_td else None
    title   = a_title.get_text(strip=True) if a_title else None

    spaceit   = info_td.find("div", class_="spaceit_pad") if info_td else None
    spaceit_t = spaceit.get_text() if spaceit else ""

    score_m = re.search(r"scored\s+([\d.]+)", spaceit_t, re.I)
    score   = _parse_score(score_m.group(1) if score_m else None)

    members_span = spaceit.find("span", class_="lightLink") if spaceit else None
    members_m    = re.search(r"([\d,]+)", members_span.get_text()) if members_span else None
    members      = _parse_members(members_m.group(1) if members_m else None)

    return AnimeEntry(id=anime_id, title=title, members=members, score=score)


def _row_v5a(div) -> AnimeEntry | None:
    """
    Tile-картка (~2017-2018, інфініті скрол).
    <div class="tile-unit">
      <div class="information">
        <div class="rank icon-ranking d1"><span class="text">1</span></div>
        <div class="title">Fullmetal Alchemist: Brotherhood</div>
        <div class="misc">
          <span class="type di-ib mr4">TV(64)</span>
          <span class="score icon-score di-ib mr4">9.25</span>
          <span class="member icon-member di-ib">1,065,476</span>
        </div>
      </div>
      <a href="...myanimelist.net/anime/5114/..." class="thumb"></a>
    </div>
    """
    # ID — з посилання <a class="thumb">
    thumb = div.find("a", class_="thumb")
    anime_id = _id_from_href(thumb.get("href") if thumb else None)

    title_div = div.select_one(".information .title")
    title     = title_div.get_text(strip=True) if title_div else None

    score_span = div.select_one(".score")
    score      = _parse_score(score_span.get_text(strip=True) if score_span else None)

    member_span = div.select_one(".member")
    members     = _parse_members(member_span.get_text(strip=True) if member_span else None)

    if anime_id is None and score is None:
        return None
    return AnimeEntry(id=anime_id, title=title, members=members, score=score)


def _row_v5(row) -> AnimeEntry | None:
    """
    <tr class="ranking-list">
      <td class="title ...">
        <a href="/anime/5114/..." class="hoverinfo_trigger fl-l ...">
          <img class="image" src="..."/>
        </a>
        <div class="detail">
          <a class="hoverinfo_trigger fs14 fw-b" href="/anime/5114/...">Title</a>
          <div class="information di-ib mt4">
            TV (64 eps)<br>Apr 2009...<br>589,545 members
          </div>
        </div>
      </td>
      <td class="score ...">
        <div class="js-top-ranking-score-col ...">
          <span class="text on">9.25</span>
        </div>
      </td>
    </tr>
    """
    title_td = row.find("td", class_=lambda c: c and "title" in c.split())
    if not title_td:
        return None

    img_a  = title_td.find("a", class_=lambda c: c and "fl-l" in (c or "").split())

    a_title  = title_td.find("a", class_=lambda c: c and "fw-b" in (c or "").split())
    title    = a_title.get_text(strip=True) if a_title else None
    href     = a_title.get("href") if a_title else (img_a.get("href") if img_a else None)
    anime_id = _id_from_href(href)

    info     = title_td.find("div", class_=lambda c: c and "information" in (c or "").split())
    info_t   = info.get_text(separator="\n") if info else ""
    members_m = re.search(r"([\d,]+)\s+members", info_t, re.I)
    members   = _parse_members(members_m.group(1) if members_m else None)

    score_span = row.find("span", class_="text")
    score      = _parse_score(score_span.get_text() if score_span else None)

    return AnimeEntry(id=anime_id, title=title, members=members, score=score)


def _row_v6(row) -> AnimeEntry | None:
    """
    <tr class="ranking-list">
      <td class="title al va-t word-break">
        <div class="anime_ranking_h3"><a href="/anime/5114/...">Title</a></div>
        <div class="information">TV, 64 eps, Apr 2009, 3,049,384 members</div>
      </td>
      <td class="score"><span class="score-label score-9">9.09</span></td>
    </tr>
    """
    score_tag = row.select_one(".score-label")
    score     = _parse_score(score_tag.get_text() if score_tag else None)

    # Основний варіант v6: назва у .anime_ranking_h3 a
    anchor = row.select_one(".anime_ranking_h3 a")
    if anchor:
        href     = anchor.get("href")
        anime_id = _id_from_href(href)
        title    = anchor.get_text(strip=True)
    else:
        # Перехідний період (~2020): score-label є, але структура ще v5-подібна
        # Назва — a.fw-b, як у v5
        a_fw = row.find("a", class_=lambda c: c and "fw-b" in (c or "").split())
        href     = a_fw.get("href") if a_fw else None
        anime_id = _id_from_href(href)
        title    = a_fw.get_text(strip=True) if a_fw else None

    info      = row.select_one(".information")
    info_t    = info.get_text(separator="\n") if info else ""
    members_m = re.search(r"([\d,]+)\s+members", info_t, re.I)
    members   = _parse_members(members_m.group(1) if members_m else None)

    # Якщо .score-label не знайдено (старий v5-подібний період) — пробуємо span.text
    if score is None:
        text_span = row.find("span", class_="text")
        score = _parse_score(text_span.get_text() if text_span else None)

    return AnimeEntry(id=anime_id, title=title, members=members, score=score)

# ── Парсер сторінки ───────────────────────────────────────────────────────────

_VERSION_CFG = {
    "v6":      (_row_v6,  "tr.ranking-list"),
    "v5a":     (_row_v5a, "div.tile-unit"),
    "v5":      (_row_v5,  "tr.ranking-list"),
    "v3b":     (_row_v3,  "tr"),
    "v3a":     (_row_v3a, "tr"),
    "v2":      (_row_v2,  "tr"),
    "v1c":     (_row_v1c, "tr"),
    "v1":      (_row_v1,  "tr"),
    "unknown": (_row_v6,  "tr.ranking-list"),
}

def _has_anime_links(html: str) -> bool:
    """
    Перевіряє чи є на сторінці хоча б одне посилання на аніме-сторінку MAL.
    Це єдина умова для того щоб вважати сторінку валідною і пробувати скрапити.
    Wayback може огорнути URL: /web/TIMESTAMP/http://myanimelist.net/anime/ID/
    або пряме: /anime/ID/ або http://myanimelist.net/anime/ID/
    """
    return bool(re.search(r'/anime/\d+', html))


def _parse_with_version(soup: BeautifulSoup, version: str) -> list[AnimeEntry]:
    parser_fn, row_sel = _VERSION_CFG.get(version, _VERSION_CFG["unknown"])
    entries: list[AnimeEntry] = []
    seen_ids: set[int] = set()
    for row in soup.select(row_sel):
        entry = parser_fn(row)
        if entry is None:
            continue
        if entry.score is None and entry.id is None:
            continue
        if entry.id is not None:
            if entry.id in seen_ids:
                continue
            seen_ids.add(entry.id)
        entries.append(entry)
    return entries


def _entries_quality(entries: list[AnimeEntry]) -> tuple[int, int, int]:
    """Повертає (total, з id, з title) — для оцінки якості результату."""
    has_id    = sum(1 for e in entries if e.id    is not None)
    has_title = sum(1 for e in entries if e.title is not None)
    return len(entries), has_id, has_title


def parse_page(html: str, version: str) -> tuple[list[AnimeEntry], str]:
    soup    = BeautifulSoup(html, "lxml")
    entries = _parse_with_version(soup, version)

    # Fallback на автодетект якщо:
    # 1) отримали 0 записів, або
    # 2) є записи, але жоден не має id або жоден не має title
    total, has_id, has_title = _entries_quality(entries)
    need_fallback = (total == 0) or (has_id == 0) or (has_title == 0)

    if need_fallback:
        auto = detect_version(soup)
        if auto != version:
            fallback = _parse_with_version(soup, auto)
            fb_total, fb_id, fb_title = _entries_quality(fallback)
            # Беремо fallback якщо він кращий за поточний результат
            if fb_total > 0 and (fb_id > has_id or fb_title > has_title):
                return fallback, f"{auto}(auto)"

    return entries, version

# ── CDX: пошук знімків ────────────────────────────────────────────────────────

def _snapshots_from_rows(rows: list) -> list[Snapshot]:
    by_day: dict[str, str] = {}
    for ts, _code in rows:
        day = ts[:8]
        if day not in by_day or ts > by_day[day]:
            by_day[day] = ts
    return [
        Snapshot(
            timestamp = ts,
            date      = f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}",
            url       = f"{WB_PREFIX}/{ts}/{MAL_URL}".replace(" ", ""),
        )
        for ts in sorted(by_day.values())
    ]


def _print_year_summary(snapshots: list[Snapshot]) -> None:
    by_year: dict[str, int] = defaultdict(int)
    for s in snapshots:
        by_year[s.date[:4]] += 1
    print(f"   ✔  Всього {len(snapshots)} унікальних днів:")
    for year, count in sorted(by_year.items()):
        print(f"      {year}: {count} днів")


def fetch_snapshots(session: requests.Session) -> list[Snapshot]:
    if USE_CDX_CACHE and CDX_CACHE_FILE.exists():
        print(f"📂  Читаємо список знімків з кешу: {CDX_CACHE_FILE.name}")
        cached = json.loads(CDX_CACHE_FILE.read_text(encoding="utf-8"))
        snapshots = [Snapshot(**s) for s in cached]
        _print_year_summary(snapshots)
        return snapshots

    print("🔍  Запит до CDX API…")
    resp = session.get(CDX_API, params={
        "url":    MAL_URL,
        "output": "json",
        "fl":     "timestamp,statuscode",
        "filter": "statuscode:200",
    }, timeout=60)
    resp.raise_for_status()

    rows = resp.json()
    if not rows or len(rows) < 2:
        print("⚠️   CDX повернув порожній результат")
        return []

    snapshots = _snapshots_from_rows(rows[1:])
    _print_year_summary(snapshots)

    # Зберігаємо кеш
    CDX_CACHE_FILE.write_text(
        json.dumps([s.__dict__ for s in snapshots], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"   💾  Кеш збережено → {CDX_CACHE_FILE.name}")

    return snapshots

# ── Головна функція ───────────────────────────────────────────────────────────

def add_to_skip(timestamp: str) -> None:
    """Додає timestamp до SKIP_FILE."""
    try:
        data = json.loads(SKIP_FILE.read_text(encoding="utf-8")) if SKIP_FILE.exists() else []
        if timestamp not in data:
            data.append(timestamp)
            SKIP_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except (json.JSONDecodeError, OSError) as e:
        print(f"⚠️  Не вдалось оновити {SKIP_FILE.name}: {e}")


def add_to_empty(snap: Snapshot) -> None:
    """Додає знімок до EMPTY_LIST_FILE (якщо його там ще немає)."""
    try:
        data = json.loads(EMPTY_LIST_FILE.read_text(encoding="utf-8")) if EMPTY_LIST_FILE.exists() else []
        if not any(e.get("timestamp") == snap.timestamp for e in data):
            data.append({
                "date":         snap.date,
                "timestamp":    snap.timestamp,
                "source":       snap.url,
                "html_version": "",
            })
            EMPTY_LIST_FILE.write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
    except (json.JSONDecodeError, OSError) as e:
        print(f"⚠️  Не вдалось оновити {EMPTY_LIST_FILE.name}: {e}")


def load_skip_timestamps() -> set[str]:
    """Читає список timestamp для пропуску з файлу. Якщо файлу немає — повертає порожній set."""
    if not SKIP_FILE.exists():
        return set()
    try:
        data = json.loads(SKIP_FILE.read_text(encoding="utf-8"))
        return set(data)
    except (json.JSONDecodeError, OSError) as e:
        print(f"⚠️  Не вдалось прочитати {SKIP_FILE.name}: {e}")
        return set()


def build_or_load_empty_list(skip: set[str]) -> list[dict]:
    """
    Повертає список знімків з порожнім масивом тайтлів, виключаючи ті що у skip.
    Якщо файл EMPTY_LIST_FILE вже є — читає з нього і перефільтровує.
    Якщо ні — сканує всі файли у OUT_DIR і будує список.
    Формат запису: {date, timestamp, source, html_version}
    """
    def _filter(lst: list[dict]) -> list[dict]:
        return [e for e in lst if e.get("timestamp") not in skip]

    if EMPTY_LIST_FILE.exists():
        data = json.loads(EMPTY_LIST_FILE.read_text(encoding="utf-8"))
        # Прибираємо зі списку ті що вже успішно перескрапились (total > 0)
        still_empty = []
        resolved = 0
        for entry in data:
            snap_file = OUT_DIR / f"{entry.get('date', '')}.json"
            if snap_file.exists():
                try:
                    cached = json.loads(snap_file.read_text(encoding="utf-8"))
                    if cached.get("total", 0) > 0:
                        resolved += 1
                        continue
                except (json.JSONDecodeError, OSError):
                    pass
            still_empty.append(entry)
        # Фільтруємо skip
        filtered = _filter(still_empty)
        # Перезаписуємо якщо щось змінилось
        changed = len(filtered) != len(data)
        if changed:
            EMPTY_LIST_FILE.write_text(
                json.dumps(filtered, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        msg_parts = [f"{len(filtered)} шт."]
        if resolved:
            msg_parts.append(f"вирішено {resolved}")
        if len(still_empty) != len(filtered):
            msg_parts.append(f"вилучено {len(still_empty) - len(filtered)} зі skip")
        print(f"📋  Порожніх знімків: {', '.join(msg_parts)} ({EMPTY_LIST_FILE.name})")
        return filtered

    print("🔎  Сканування збережених файлів на порожні знімки…")
    empty: list[dict] = []

    for f in sorted(OUT_DIR.glob("*.json")):
        if f.name == EMPTY_LIST_FILE.name:
            continue
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if d.get("total", 0) == 0:
            empty.append({
                "date":         d.get("date", f.stem),
                "timestamp":    d.get("timestamp", ""),
                "source":       d.get("source", ""),
                "html_version": d.get("html_version", ""),
            })

    filtered = _filter(empty)
    EMPTY_LIST_FILE.write_text(
        json.dumps(filtered, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"   ✔  Знайдено {len(filtered)} порожніх → збережено у {EMPTY_LIST_FILE.name}")
    return filtered


def main() -> None:
    OUT_DIR.mkdir(exist_ok=True)

    session = requests.Session()
    session.headers.update(HEADERS)

    snapshots = fetch_snapshots(session)
    if not snapshots:
        return

    if MAX_SNAPSHOTS is not None:
        snapshots = snapshots[:MAX_SNAPSHOTS]
        print(f"\n⚙️   Ліміт MAX_SNAPSHOTS={MAX_SNAPSHOTS}, обрано перших {len(snapshots)} знімків")

    # Завантажуємо список виключень
    skip_timestamps = load_skip_timestamps()
    if skip_timestamps:
        print(f"⛔  Виключень у {SKIP_FILE.name}: {len(skip_timestamps)}")

    # Список порожніх знімків (для аналізу)
    build_or_load_empty_list(skip_timestamps)

    total = len(snapshots)
    print(f"\n▶  Починаємо скрапінг {total} знімків…\n")

    for i, snap in enumerate(snapshots, 1):
        out_file = OUT_DIR / f"{snap.date}.json"

        if snap.timestamp in skip_timestamps:
            # print(f"[{i:>4}/{total}] ⏭️  {snap.date} — у списку виключень, пропускаємо")
            continue

        if out_file.exists():
            try:
                cached = json.loads(out_file.read_text(encoding="utf-8"))
                if cached.get("total", 0) > 0:
                    # print(f"[{i:>4}/{total}] ⏭️  {snap.date} — вже є ({cached['total']} тайтлів), пропускаємо")
                    continue
                print(f"[{i:>4}/{total}] ⚠️  {snap.date} — файл порожній або total=0, перескрапюємо")
            except (json.JSONDecodeError, OSError):
                print(f"[{i:>4}/{total}] ⚠️  {snap.date} — файл пошкоджений, перескрапюємо")

        print(f"[{i:>4}/{total}] 🗓  {snap.date} ({snap.timestamp})")

        try:
            resp = session.get(snap.url, timeout=15)
            resp.raise_for_status()
        except requests.ConnectionError as exc:
            print(f"          ❌  Втрачено з'єднання: {exc}")
            print("          ⛔  Зупиняємо скрапінг.")
            break
        except requests.Timeout:
            print(f"          ⏱️  Таймаут — додаємо до порожніх (спробуй пізніше)")
            add_to_empty(snap)
            continue
        except requests.RequestException as exc:
            print(f"          ❌  {exc}")
            continue

        # Перевіряємо чи є на сторінці посилання на аніме — єдиний критерій валідності
        if not _has_anime_links(resp.text):
            print(f"          ⛔  Немає посилань /anime/ID — додаємо до виключень")
            add_to_skip(snap.timestamp)
            skip_timestamps.add(snap.timestamp)
            continue

        version = version_for_date(snap.date)
        entries, version = parse_page(resp.text, version)

        data = {
            "date":         snap.date,
            "timestamp":    snap.timestamp,
            "source":       snap.url,
            "html_version": version,
            "total":        len(entries),
            "anime": [
                {
                    "id":      e.id,
                    "title":   e.title,
                    "members": e.members,
                    "score":   e.score,
                }
                for e in entries
            ],
        }

        out_file.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"          ✔  [{version}] {len(entries)} тайтлів → {out_file.name}")

        # Якщо знімок порожній — додаємо до EMPTY_LIST_FILE
        if len(entries) == 0 and EMPTY_LIST_FILE.exists():
            try:
                empty = json.loads(EMPTY_LIST_FILE.read_text(encoding="utf-8"))
                if not any(e["date"] == snap.date for e in empty):
                    empty.append({
                        "date":         snap.date,
                        "timestamp":    snap.timestamp,
                        "source":       snap.url,
                        "html_version": version,
                    })
                    EMPTY_LIST_FILE.write_text(
                        json.dumps(empty, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
            except (json.JSONDecodeError, OSError):
                pass

        time.sleep(DELAY_SEC)

    print(f"\n✅  Готово! Всі файли у: {OUT_DIR}")


if __name__ == "__main__":
    main()