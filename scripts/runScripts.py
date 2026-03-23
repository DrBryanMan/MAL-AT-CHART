import subprocess
import time
import datetime

# Список скриптів для запуску
scripts = [
    "scripts/scrap.py",          # сбирає снепшоти
    "scripts/collect_titles.py", # збирає унікальні айді
    "scripts/fetch_hikka.py",    # фетчить дані з хікки
    "scripts/precompute.js",     # робить розрахунки
]

# Час запуску щодня (година, хвилина)
RUN_AT_HOUR = 9
RUN_AT_MINUTE = 0

CHECK_INTERVAL_SECONDS = 60  # перевіряти час кожну хвилину


def run_all_scripts():
    print(f"\n{'='*50}")
    print(f"Запуск циклу: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*50}")

    for script in scripts:
        print(f"\nЗапускаю {script}...")

        result = subprocess.run(
            ["python", script],
            input="N\n",        # автоматично відповідає "N" на будь-який запит
            text=True,
        )

        if result.returncode != 0:
            print(f"Помилка при виконанні {script} (код: {result.returncode})")
            break

        print(f"{script} завершено.")

    print("\nУсі скрипти виконані.")


def get_next_run_time():
    now = datetime.datetime.now()
    target = now.replace(hour=RUN_AT_HOUR, minute=RUN_AT_MINUTE, second=0, microsecond=0)

    # Якщо сьогоднішній час вже минув — переносимо на завтра
    if target <= now:
        target += datetime.timedelta(days=1)

    return target


def main():
    cycle = 1

    # Запускаємо одразу при старті скрипта
    print(f"\n>>> Цикл #{cycle} (запуск при старті)")
    run_all_scripts()
    cycle += 1

    while True:
        next_run = get_next_run_time()
        print(f"\nНаступний запуск: {next_run.strftime('%Y-%m-%d %H:%M:%S')}")
        print("Натисніть Ctrl+C щоб зупинити.")

        # Чекаємо до потрібного часу, перевіряючи щохвилини
        # (стійко до сну/гібернації ноутбука)
        while True:
            now = datetime.datetime.now()
            if now >= next_run:
                break
            time.sleep(CHECK_INTERVAL_SECONDS)

        print(f"\n>>> Цикл #{cycle}")
        run_all_scripts()
        cycle += 1


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nСкрипт зупинено вручну.")