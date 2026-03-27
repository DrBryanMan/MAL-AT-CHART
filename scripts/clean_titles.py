import json
import os
import shutil
import re

# Шлях до папки зі снепшотами
BASE_PATH = os.path.join('..', 'snapshots')
WR_MIN_VOTES = 10   # m — мінімальний поріг голосів

# ── Зважена оцінка (Weighted Rank) ───────────────────────────────────────────


def mean_score(anime_list):
    scores = [a["score"] for a in anime_list if a.get("score") is not None]
    return sum(scores) / len(scores) if scores else 0.0

def weighted_score(score, scored_by, C, m=WR_MIN_VOTES):
    """WR = (v / (v + m)) * S + (m / (v + m)) * C"""
    if score is None or not scored_by:
        return None
    v = scored_by
    
    raw_value = (v / (v + m)) * score + (m / (v + m)) * C
    
    return int(raw_value * 100) / 100

def apply_weighted_scores(anime_list):
    """Обчислює та записує weighted_score лише для записів, де його ще немає."""
    C = mean_score(anime_list)
    added = 0
    for item in anime_list:
        if item.get("weighted_score") is not None:
            continue

        item["weighted_score"] = weighted_score(
            item.get("score"),
            item.get("scored_by"),
            C,
        )
        if item.get("weighted_score") is not None:
            added += 1

    return added

# ── Основна обробка ───────────────────────────────────────────────────────────

for root, dirs, files in os.walk(BASE_PATH):
    # 1. Пропускаємо папки-бекапи
    if '-full' in root:
        continue

    for filename in files:
        if not filename.endswith('.json'):
            continue

        # 2. Не чіпаємо файли до 2008 року
        year_match = re.search(r'\b(19\d{2}|20\d{2})\b', filename)
        if year_match and int(year_match.group(1)) < 2008:
            continue

        file_path = os.path.join(root, filename)

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except (json.JSONDecodeError, Exception) as e:
            print(f"Пропущено {filename}: помилка читання ({e})")
            continue

        key = 'anime' if 'anime' in data else ('manga' if 'manga' in data else None)
        if not key or not isinstance(data[key], list):
            continue

        rel_path   = os.path.relpath(file_path, BASE_PATH)
        path_parts = rel_path.split(os.sep)
        is_hikka   = '-hikka' in path_parts[0]

        original_count = len(data[key])

        # 3. Фільтрація: прибираємо тільки тих, у кого members відомий і <= 9
        data[key] = [
            item for item in data[key]
            if item.get('scored_by') is None or item.get('scored_by') >= WR_MIN_VOTES
        ]
        data['total'] = len(data[key])
        filtered = len(data[key]) < original_count

        # 4. Зважена оцінка — тільки для хікки
        wr_added = 0
        if is_hikka:
            wr_added = apply_weighted_scores(data[key])

        # Не перезаписуємо файл, якщо фактичних змін немає
        if not filtered and wr_added == 0:
            continue

        # 5. Бекап для хікки — лише перший раз
        if is_hikka:
            backup_folder = f"{path_parts[0]}-full"
            backup_path   = os.path.join(BASE_PATH, backup_folder, *path_parts[1:])
            if not os.path.exists(backup_path):
                os.makedirs(os.path.dirname(backup_path), exist_ok=True)
                shutil.copy2(file_path, backup_path)
                status_msg = "Бекап створено (перша копія)"
            else:
                status_msg = "Бекап вже існує"
        else:
            status_msg = "Без бекапу (MAL)"

        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        removed = original_count - data['total']
        parts = []
        if removed:
            parts.append(f"-{removed}")
        if wr_added:
            parts.append("WR додано")
        print(f"Оновлено: {rel_path} ({', '.join(parts) or 'без змін'}) | {status_msg}")

print("Обробку завершено.")
