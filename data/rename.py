import os
import json
import re
import sys

def format_title(slug):
    if not slug:
        return ""
    # Видаляємо дефіс та унікальний хеш/цифри в кінці (наприклад, -859997)
    name_part = re.sub(r'-[a-z0-9]+$', '', str(slug))
    # Замінюємо дефіси на пробіли та робимо кожне слово з великої літери
    return name_part.replace('-', ' ').title()

def process_file(filename):
    if not os.path.exists(filename):
        print(f"Помилка: Файл {filename} не знайдено.")
        return

    try:
        with open(filename, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # Перевіряємо, чи це список (структура [{}, {}])
        if isinstance(data, list):
            changed = False
            for item in data:
                if isinstance(item, dict):
                    # Якщо title такий самий як slug — форматуємо
                    if item.get('title') == item.get('hikka_slug'):
                        item['title'] = format_title(item.get('hikka_slug'))
                        changed = True
            
            if changed:
                with open(filename, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                print(f"Оновлено: {filename}")
            else:
                print(f"Змін не знайдено: {filename}")
        else:
            print(f"Пропущено: {filename} (не є списком об'єктів)")
                
    except (json.JSONDecodeError, IOError) as e:
        print(f"Помилка у файлі {filename}: {e}")

if __name__ == "__main__":
    # Якщо передано назву файлу (python script.py file.json)
    if len(sys.argv) > 1:
        process_file(sys.argv[1])
    else:
        # Обробляємо всі .json у поточній папці
        for filename in os.listdir('.'):
            if filename.endswith('.json'):
                process_file(filename)