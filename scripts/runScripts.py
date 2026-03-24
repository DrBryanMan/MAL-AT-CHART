"""
runScripts.py — послідовний запуск пайплайну оновлення даних MAL.
Запуск: python scripts/runScripts.py
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

SCRIPTS = [
    ("python", "scrap.py"),
    ("python", "hikka_parser.py"),
    ("python", "clean_titles.py"),
    ("python", "enrich_anime.py"),
    ("node",   "precompute.js"),
]

def run_all():
    for runtime, script in SCRIPTS:
        print(f"\n→ {runtime} {script}")
        result = subprocess.run(
            [runtime, script],
            cwd=ROOT,
            text=True,
        )
        if result.returncode != 0:
            print(f"✗ Помилка у {script} (код {result.returncode})")
            sys.exit(result.returncode)
        print(f"✓ {script} завершено")
    print("\n✅ Пайплайн завершено успішно.")

if __name__ == "__main__":
    run_all()