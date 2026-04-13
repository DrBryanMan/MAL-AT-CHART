import argparse
import json
import sys
from pathlib import Path

from hikka_score_utils import (
    build_raw_score_map,
    calculate_weighted_score,
    reorder_snapshot_fields,
    resolve_average_score,
    truncate_score,
)


ROOT                = Path(__file__).resolve().parent.parent
HIKKA_DIR           = ROOT / "snapshots" / "anime-hikka"
HIKKA_FULL_DIR      = ROOT / "snapshots" / "anime-hikka-full"


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Оновлює існуючі Hikka-снепшоти: додає average_score і перераховує weighted_score.",
    )
    parser.add_argument(
        "--date",
        help="Обробити лише одну дату у форматі YYYY-MM-DD.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Тільки показати, що буде змінено, без запису у файли.",
    )
    return parser.parse_args()


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data):
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def iter_snapshot_paths(target_date=None):
    if target_date:
        yield HIKKA_DIR / f"{target_date}.json"
        return

    yield from sorted(HIKKA_DIR.glob("*.json"))


def backfill_snapshot(snapshot_path: Path, dry_run=False):
    full_snapshot_path = HIKKA_FULL_DIR / snapshot_path.name
    if not snapshot_path.exists():
        print(f"Пропущено {snapshot_path.name}: снепшот не знайдено.")
        return False
    if not full_snapshot_path.exists():
        print(f"Пропущено {snapshot_path.name}: не знайдено відповідний anime-hikka-full.")
        return False

    snapshot      = load_json(snapshot_path)
    full_snapshot = load_json(full_snapshot_path)

    snapshot_anime = snapshot.get("anime")
    full_anime     = full_snapshot.get("anime")
    if not isinstance(snapshot_anime, list) or not isinstance(full_anime, list):
        print(f"Пропущено {snapshot_path.name}: некоректна структура anime.")
        return False

    average_score  = resolve_average_score(full_anime)
    raw_score_by_id = build_raw_score_map(full_anime, average_score)

    updated_weighted_scores = 0
    missing_scores = 0

    average_score_changed = snapshot.get("average_score") != average_score
    min_score_removed     = "min_score" in snapshot

    if average_score_changed:
        snapshot["average_score"] = average_score

    snapshot.pop("min_score", None)

    for item in snapshot_anime:
        anime_id = item.get("id")
        raw_score = raw_score_by_id.get(anime_id)
        if raw_score is None:
            raw_score = truncate_score(item.get("score"))

        if raw_score is None:
            missing_scores += 1
            continue

        new_weighted_score = calculate_weighted_score(
            raw_score,
            item.get("scored_by"),
            average_score,
        )
        if new_weighted_score is None:
            missing_scores += 1
            continue

        if item.get("weighted_score") != new_weighted_score:
            item["weighted_score"] = new_weighted_score
            updated_weighted_scores += 1

    changed = updated_weighted_scores > 0 or average_score_changed or min_score_removed

    if not dry_run and changed:
        snapshot = reorder_snapshot_fields(snapshot)
        save_json(snapshot_path, snapshot)

    status = "dry-run" if dry_run else "оновлено"
    print(
        f"{snapshot_path.name}: {status} | "
        f"weighted_score={updated_weighted_scores}, missing={missing_scores}, average_score={average_score}"
    )
    return changed


def main():
    args = parse_args()
    changed_count = 0

    for snapshot_path in iter_snapshot_paths(args.date):
        changed = backfill_snapshot(snapshot_path, dry_run=args.dry_run)
        if changed:
            changed_count += 1

    print(f"Готово. Оброблено змінених снепшотів: {changed_count}")


if __name__ == "__main__":
    main()
