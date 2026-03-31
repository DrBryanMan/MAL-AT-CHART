"""
runScripts.py — послідовний запуск пайплайну оновлення даних MAL.
Запуск: python scripts/runScripts.py
"""

import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

SCRIPTS = [
    # ("python", "actual_scrap.py"),
    ("python", "mal_api_parser.py"),
    ("python", "parser.py"),
    ("python", "clean_titles.py"),
    ("python", "enrich_anime.py"),
    ("node",   "precompute.js"),
]

SCRIPT_NAMES = [s for _, s in SCRIPTS]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Послідовний запуск пайплайну MAL.",
        formatter_class=argparse.RawTextHelpFormatter,
        epilog=(
            "Скрипти пайплайну (індекси від 0):\n" +
            "\n".join(f"  {i}  {s}" for i, (_, s) in enumerate(SCRIPTS))
        ),
    )

    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--from", dest="start_from", metavar="SCRIPT",
        help="Почати з цього скрипту (назва або індекс). Приклад: --from clean_titles.py або --from 2",
    )
    group.add_argument(
        "--skip", dest="skip", type=int, metavar="N",
        help="Пропустити перші N скриптів. Приклад: --skip 2",
    )

    return parser.parse_args()


def resolve_start_index(args: argparse.Namespace) -> int:
    if args.skip is not None:
        if not (0 <= args.skip < len(SCRIPTS)):
            print(f"✗ --skip {args.skip} виходить за межі (доступно 0–{len(SCRIPTS) - 1})")
            sys.exit(1)
        return args.skip

    if args.start_from is not None:
        token = args.start_from.strip()
        # спробуємо як індекс
        if token.isdigit():
            idx = int(token)
            if not (0 <= idx < len(SCRIPTS)):
                print(f"✗ Індекс {idx} виходить за межі (доступно 0–{len(SCRIPTS) - 1})")
                sys.exit(1)
            return idx
        # спробуємо як назву (часткове співпадіння)
        matches = [i for i, name in enumerate(SCRIPT_NAMES) if token in name]
        if not matches:
            print(f"✗ Скрипт '{token}' не знайдено. Доступні:\n" +
                  "\n".join(f"  {i}  {s}" for i, s in enumerate(SCRIPT_NAMES)))
            sys.exit(1)
        if len(matches) > 1:
            print(f"✗ '{token}' збігається з кількома скриптами: {[SCRIPT_NAMES[i] for i in matches]}")
            sys.exit(1)
        return matches[0]

    return 0


def run_all(start_idx: int) -> None:
    queue = SCRIPTS[start_idx:]

    if start_idx > 0:
        skipped = ", ".join(SCRIPT_NAMES[:start_idx])
        print(f"⏭  Пропущено: {skipped}")

    print(f"▶  Запускаємо з: {SCRIPTS[start_idx][1]}\n")

    for runtime, script in queue:
        print(f"\n→ {runtime} {script}")
        result = subprocess.run([runtime, script], cwd=ROOT, text=True)
        if result.returncode != 0:
            print(f"✗ Помилка у {script} (код {result.returncode})")
            sys.exit(result.returncode)
        print(f"✓ {script} завершено")

    print("\n✅ Пайплайн завершено успішно.")


if __name__ == "__main__":
    args      = parse_args()
    start_idx = resolve_start_index(args)
    run_all(start_idx)