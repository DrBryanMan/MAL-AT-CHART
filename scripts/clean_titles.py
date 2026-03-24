import json
import os
import shutil
import re

# Шлях до папки зі снепшотами
base_path = os.path.join('..', 'snapshots')

for root, dirs, files in os.walk(base_path):
    # 1. Пропускаємо папки-бекапи
    if '-full' in root:
        continue

    for filename in files:
        if not filename.endswith('.json'):
            continue

        # 2. Перевірка року у імені файлу: не чіпаємо файли до 2008 року
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

        # Визначаємо ключ (anime або manga)
        key = 'anime' if 'anime' in data else ('manga' if 'manga' in data else None)

        if not key or not isinstance(data[key], list):
            continue

        original_count = len(data[key])

        # Фільтрація: прибираємо тільки тих, у кого members відомий і <= 4
        # Якщо members = null — не чіпаємо (старі знімки без цього поля)
        data[key] = [
            item for item in data[key]
            if item.get('members') is None or item.get('members') > 4
        ]
        data['total'] = len(data[key])

        # Оновлюємо файл тільки якщо щось було видалено
        if len(data[key]) == original_count:
            continue

        rel_path   = os.path.relpath(file_path, base_path)
        path_parts = rel_path.split(os.sep)

        # 3. Бекап тільки для папок *-hikka, і тільки якщо бекапу ще немає
        if '-hikka' in path_parts[0]:
            backup_folder_name = f"{path_parts[0]}-full"
            backup_path = os.path.join(base_path, backup_folder_name, *path_parts[1:])

            if not os.path.exists(backup_path):
                os.makedirs(os.path.dirname(backup_path), exist_ok=True)
                shutil.copy2(file_path, backup_path)
                status_msg = "Бекап створено (перша копія)"
            else:
                status_msg = "Бекап вже існує, не перезаписуємо"
        else:
            status_msg = "Без бекапу (MAL)"

        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        removed = original_count - data['total']
        print(f"Очищено: {rel_path} (-{removed}) | {status_msg}")

print("Обробку завершено.")