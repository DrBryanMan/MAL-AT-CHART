"""
precompute.py — генерує data/snapshots-index.json та data/analytics.json
Запуск: python precompute.py  (з кореня проєкту)
"""

import json
import os
from pathlib import Path
from datetime import datetime

# ─── Конфіг ──────────────────────────────────────────────────────────────────

SNAPSHOTS_DIR  = Path(__file__).parent.parent / "snapshots"
DATA_DIR       = Path(__file__).parent.parent / "data"
ENRICHED_FILE  = DATA_DIR / "anime_enriched.json"
INDEX_FILE     = DATA_DIR / "snapshots-index.json"
ANALYTICS_FILE = DATA_DIR / "analytics.json"

THRESHOLD = 9.0

# ─── Утиліти ─────────────────────────────────────────────────────────────────

def days_between(d1: str, d2: str) -> int:
    dt1 = datetime.fromisoformat(d1)
    dt2 = datetime.fromisoformat(d2)
    return abs((dt2 - dt1).days)


def build_enriched_map(enriched: list) -> dict:
    return {a["mal_id"]: a for a in enriched}


def sorted_anime(snap: dict) -> list:
    return sorted(
        [a for a in snap["anime"] if a.get("score") is not None],
        key=lambda a: (-a["score"], a["id"]),
    )


def enrich(a: dict, enriched_map: dict) -> dict:
    enr = enriched_map.get(a["id"], {})
    return {
        **a,
        "title_ua":   enr.get("title_ua"),
        "media_type": enr.get("media_type", "unknown"),
        "image":      enr.get("image"),
        "hikka_slug": enr.get("hikka_slug"),
    }


# ─── Snapshots Index ──────────────────────────────────────────────────────────

def build_index(snapshots: list) -> list:
    index = []
    for snap in snapshots:
        date = snap["date"]
        dt = datetime.fromisoformat(date)
        index.append({
            "date":      date,
            "timestamp": snap.get("timestamp", ""),
            "label":     dt.strftime("%#d %b %Y") if os.name == "nt" else dt.strftime("%-d %b %Y"),
            "total":     snap.get("total", len(snap["anime"])),
        })
    return index


# ─── Section 2: Category Top History ─────────────────────────────────────────

def compute_category_top_history(snapshots: list, enriched_map: dict, threshold: float) -> dict:
    all_cats = set()
    for snap in snapshots:
        for a in snap["anime"]:
            all_cats.add(enriched_map.get(a["id"], {}).get("media_type", "unknown"))

    cat_list = ["all", *sorted(all_cats)]
    sessions        = {c: [] for c in cat_list}
    current_session = {c: None for c in cat_list}
    session_counts  = {c: {} for c in cat_list}

    def close_session(cat):
        if current_session[cat]:
            sessions[cat].append({**current_session[cat]})
            current_session[cat] = None

    def open_session(cat, anime, date):
        cnt = session_counts[cat].get(anime["id"], 0) + 1
        session_counts[cat][anime["id"]] = cnt
        current_session[cat] = {
            "animeId":    anime["id"],
            "title":      anime["title"],
            "title_ua":   anime.get("title_ua"),
            "media_type": anime.get("media_type", "unknown"),
            "image":      anime.get("image"),
            "hikka_slug": anime.get("hikka_slug"),
            "firstScore": anime["score"],
            "maxScore":   anime["score"],
            "startDate":  date,
            "endDate":    date,
            "sessionNum": cnt,
        }

    def update_cat(cat, top, date):
        cur = current_session[cat]
        if not top:
            close_session(cat)
            return
        if cur and cur["animeId"] == top["id"]:
            cur["endDate"]  = date
            cur["maxScore"] = max(cur["maxScore"], top["score"])
        else:
            close_session(cat)
            open_session(cat, top, date)

    for snap in snapshots:
        eligible = sorted(
            [enrich(a, enriched_map) for a in snap["anime"]
             if a.get("score") is not None and a["score"] >= threshold],
            key=lambda a: (-a["score"],),
        )

        update_cat("all", eligible[0] if eligible else None, snap["date"])
        for cat in all_cats:
            top = next((a for a in eligible if a["media_type"] == cat), None)
            update_cat(cat, top, snap["date"])

    for cat in cat_list:
        close_session(cat)

    return {"sessions": sessions, "categories": cat_list}


# ─── Section 3a: Highest Ever ────────────────────────────────────────────────

def compute_highest_ever(snapshots: list, enriched_map: dict) -> dict | None:
    best = {}
    for snap in snapshots:
        for a in snap["anime"]:
            if a.get("score") is None:
                continue
            ex = best.get(a["id"])
            if not ex or a["score"] > ex["score"]:
                best[a["id"]] = {**a, "date": snap["date"]}

    if not best:
        return None

    sorted_list = sorted(best.values(), key=lambda a: -a["score"])
    enriched_sorted = [enrich(a, enriched_map) for a in sorted_list]

    def find_cat(pred):
        return next((a for a in enriched_sorted if pred(a)), None)

    w = enriched_sorted[0]
    return {
        "winner":      {**w, "animeId": w["id"]},
        "top3":        [{**a, "animeId": a["id"]} for a in enriched_sorted[:3]],
        "tvWinner":    find_cat(lambda a: a["media_type"] == "tv"),
        "movieWinner": find_cat(lambda a: a["media_type"] == "movie"),
        "otherWinner": find_cat(lambda a: a["media_type"] not in ("tv", "movie")),
    }


# ─── Section 3b: Most Stable Score ───────────────────────────────────────────

def compute_most_stable_score(snapshots: list, enriched_map: dict) -> dict | None:
    if len(snapshots) < 2:
        return None

    active    = {}
    completed = []

    for snap in snapshots:
        seen = set()
        for a in snap["anime"]:
            if a.get("score") is None:
                continue
            seen.add(a["id"])
            cur = active.get(a["id"])
            if not cur:
                active[a["id"]] = {"animeId": a["id"], "title": a["title"],
                                    "score": a["score"], "startDate": snap["date"],
                                    "endDate": snap["date"], "count": 1}
            elif cur["score"] == a["score"]:
                cur["endDate"] = snap["date"]
                cur["count"]  += 1
            else:
                completed.append({**cur})
                active[a["id"]] = {"animeId": a["id"], "title": a["title"],
                                    "score": a["score"], "startDate": snap["date"],
                                    "endDate": snap["date"], "count": 1}

        for aid in list(active):
            if aid not in seen:
                completed.append({**active.pop(aid)})

    for s in active.values():
        completed.append({**s})

    filtered = sorted(
        [s for s in completed if s["count"] > 1],
        key=lambda s: (-s["count"], days_between(s["startDate"], s["endDate"])),
    )

    if not filtered:
        return None

    top3 = [{**s, **enrich({"id": s["animeId"], "title": s["title"],
                             "score": s["score"], "members": 0}, enriched_map)}
            for s in filtered[:3]]

    def get_winner(cat):
        match = next((s for s in filtered if (
            enriched_map.get(s["animeId"], {}).get("media_type", "unknown") ==
            ("unknown" if cat == "other" else cat)
            if cat != "other" else
            enriched_map.get(s["animeId"], {}).get("media_type", "unknown") not in ("tv", "movie")
        )), None)
        if not match:
            return None
        return {**match, **enrich({"id": match["animeId"], "title": match["title"],
                                    "score": match["score"], "members": 0}, enriched_map)}

    return {
        "winner":      top3[0],
        "top3":        top3,
        "tvWinner":    get_winner("tv"),
        "movieWinner": get_winner("movie"),
        "otherWinner": get_winner("other"),
    }


# ─── Section 3c: Longest at Top-1 ────────────────────────────────────────────

def compute_longest_top1(snapshots: list, enriched_map: dict) -> dict | None:
    if not snapshots:
        return None

    sessions, cur = [], None

    for snap in snapshots:
        top = sorted_anime(snap)
        top = top[0] if top else None

        if not top:
            if cur:
                sessions.append({**cur})
                cur = None
            continue

        if cur and cur["animeId"] == top["id"]:
            cur["endDate"]  = snap["date"]
            cur["days"]     = days_between(cur["startDate"], cur["endDate"])
            cur["maxScore"] = max(cur["maxScore"], top["score"])
        else:
            if cur:
                sessions.append({**cur})
            cur = {"animeId": top["id"], "title": top["title"],
                   "startDate": snap["date"], "endDate": snap["date"],
                   "days": 0, "firstScore": top["score"], "maxScore": top["score"]}

    if cur:
        sessions.append({**cur})

    if not sessions:
        return None

    sorted_list = sorted(sessions, key=lambda s: -s["days"])

    top3 = [{**s, **enrich({"id": s["animeId"], "title": s["title"],
                             "score": s["maxScore"], "members": 0}, enriched_map)}
            for s in sorted_list[:3]]

    def get_winner(cat):
        match = next((s for s in sorted_list if (
            enriched_map.get(s["animeId"], {}).get("media_type", "unknown") not in ("tv", "movie")
            if cat == "other" else
            enriched_map.get(s["animeId"], {}).get("media_type", "unknown") == cat
        )), None)
        if not match:
            return None
        return {**match, **enrich({"id": match["animeId"], "title": match["title"],
                                    "score": match["maxScore"], "members": 0}, enriched_map)}

    return {
        "winner":      top3[0],
        "top3":        top3,
        "tvWinner":    get_winner("tv"),
        "movieWinner": get_winner("movie"),
        "otherWinner": get_winner("other"),
    }


# ─── Section 3d-1: All Above Threshold ───────────────────────────────────────

def compute_all_above_threshold(snapshots: list, threshold: float, enriched_map: dict) -> list:
    seen = {}
    for snap in snapshots:
        for a in snap["anime"]:
            if a.get("score") is None or a["score"] < threshold:
                continue
            if a["id"] not in seen:
                seen[a["id"]] = {
                    "animeId": a["id"], "title": a["title"],
                    **enrich(a, enriched_map),
                    "maxScore": a["score"], "firstDate": snap["date"],
                }
            else:
                seen[a["id"]]["maxScore"] = max(seen[a["id"]]["maxScore"], a["score"])

    return sorted(seen.values(), key=lambda a: -a["maxScore"])


# ─── Section 3d-2: Top-1 History ─────────────────────────────────────────────

def compute_top1_history(snapshots: list, enriched_map: dict) -> list:
    sessions, cur = [], None

    for snap in snapshots:
        top = sorted_anime(snap)
        top = top[0] if top else None

        if not top:
            if cur:
                sessions.append({**cur})
                cur = None
            continue

        if cur and cur["animeId"] == top["id"]:
            cur["endDate"]  = snap["date"]
            cur["maxScore"] = max(cur["maxScore"], top["score"])
        else:
            if cur:
                sessions.append({**cur})
            enr = enriched_map.get(top["id"], {})
            cur = {
                "animeId":    top["id"],
                "title":      top["title"],
                "title_ua":   enr.get("title_ua"),
                "media_type": enr.get("media_type", "unknown"),
                "image":      enr.get("image"),
                "hikka_slug": enr.get("hikka_slug"),
                "firstScore": top["score"],
                "maxScore":   top["score"],
                "startDate":  snap["date"],
                "endDate":    snap["date"],
            }

    if cur:
        sessions.append({**cur})

    by_anime = {}
    for s in sessions:
        aid = s["animeId"]
        if aid not in by_anime:
            by_anime[aid] = {**s, "sessionCount": 1, "sessions": [s]}
        else:
            by_anime[aid]["sessionCount"] += 1
            by_anime[aid]["maxScore"] = max(by_anime[aid]["maxScore"], s["maxScore"])
            by_anime[aid]["sessions"].append(s)

    return sorted(by_anime.values(), key=lambda a: a["startDate"])


# ─── Section 3d-3: Most Stable Top-N ─────────────────────────────────────────

def compute_most_stable_top_n(snapshots: list, enriched_map: dict, threshold: float) -> dict | None:
    if len(snapshots) < 2:
        return None

    def get_top(snap):
        return sorted(
            [a for a in snap["anime"] if a.get("score") is not None and a["score"] >= threshold],
            key=lambda a: (-a["score"], a["id"]),
        )

    def stable_prefix(a, b):
        k = 0
        while k < len(a) and k < len(b):
            if a[k]["id"] == b[k]["id"]:
                k += 1
                continue
            score_k = b[k]["score"]
            end_b = k
            while end_b + 1 < len(b) and b[end_b + 1]["score"] == score_k:
                end_b += 1
            if end_b >= len(a):
                break
            set_b = {x["id"] for x in b[k:end_b + 1]}
            set_a = {x["id"] for x in a[k:end_b + 1]}
            if set_a != set_b:
                break
            k = end_b + 1
        return k

    tops    = [get_top(s) for s in snapshots]
    prefixes = [stable_prefix(tops[i], tops[i + 1]) for i in range(len(tops) - 1)]

    max_n = max(prefixes, default=0)
    if max_n == 0:
        return None

    best = None
    for n in range(max_n, 0, -1):
        if best and n < best["n"]:
            break

        run_start = -1
        for i in range(len(prefixes) + 1):
            ok = i < len(prefixes) and prefixes[i] >= n
            if ok:
                if run_start == -1:
                    run_start = i
            elif run_start != -1:
                snap_count = i - run_start + 1
                start_date = snapshots[run_start]["date"]
                end_date   = snapshots[i]["date"]
                days       = days_between(start_date, end_date)

                if not best or n > best["n"] or (n == best["n"] and snap_count > best["snapCount"]):
                    best = {
                        "n":         n,
                        "startDate": start_date,
                        "endDate":   end_date,
                        "snapCount": snap_count,
                        "days":      days,
                        "topN":      [enrich(a, enriched_map) for a in tops[run_start][:n]],
                    }
                run_start = -1

    return best


# ─── Section 3d-4: Most High-Rated at Once ───────────────────────────────────

def compute_most_high_rated_at_once(snapshots: list, threshold: float, enriched_map: dict) -> dict | None:
    best = None
    for snap in snapshots:
        high = [a for a in snap["anime"] if a.get("score") is not None and a["score"] >= threshold]
        if not best or len(high) > best["count"]:
            best = {
                "date":  snap["date"],
                "count": len(high),
                "anime": [enrich(a, enriched_map) for a in
                          sorted(high, key=lambda a: -a["score"])],
            }
    return best


# ─── Master compute ───────────────────────────────────────────────────────────

def compute_all(snapshots: list, enriched_map: dict, threshold: float = THRESHOLD) -> dict:
    return {
        "categoryTopHistory": compute_category_top_history(snapshots, enriched_map, threshold),
        "highestEver":        compute_highest_ever(snapshots, enriched_map),
        "mostStableScore":    compute_most_stable_score(snapshots, enriched_map),
        "longestTop1":        compute_longest_top1(snapshots, enriched_map),
        "allAboveThreshold":  compute_all_above_threshold(snapshots, threshold, enriched_map),
        "top1History":        compute_top1_history(snapshots, enriched_map),
        "mostStableTopN":     compute_most_stable_top_n(snapshots, enriched_map, threshold),
        "mostAtOnce":         compute_most_high_rated_at_once(snapshots, threshold, enriched_map),
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    DATA_DIR.mkdir(exist_ok=True)

    # Завантажуємо всі знімки
    snap_files = sorted(SNAPSHOTS_DIR.glob("*.json"))
    if not snap_files:
        print("❌  Не знайдено жодного знімку в snapshots/")
        return

    snapshots = []
    for f in snap_files:
        with f.open(encoding="utf-8") as fh:
            snapshots.append(json.load(fh))

    print(f"✅  Завантажено {len(snapshots)} знімків")

    # Збагачені дані
    enriched_map = {}
    if ENRICHED_FILE.exists():
        with ENRICHED_FILE.open(encoding="utf-8") as fh:
            enriched_map = build_enriched_map(json.load(fh))
        print(f"✅  Збагачені дані: {len(enriched_map)} записів")
    else:
        print(f"⚠️   {ENRICHED_FILE} не знайдено — збагачення пропущено")

    # Генеруємо snapshots-index.json
    index = build_index(snapshots)
    with INDEX_FILE.open("w", encoding="utf-8") as fh:
        json.dump({"snapshots": index}, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"✅  {INDEX_FILE} ({len(index)} записів)")

    # Генеруємо analytics.json
    analytics = compute_all(snapshots, enriched_map)
    with ANALYTICS_FILE.open("w", encoding="utf-8") as fh:
        json.dump(analytics, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"✅  {ANALYTICS_FILE}")

    print("\n🎉  Готово!")


if __name__ == "__main__":
    main()