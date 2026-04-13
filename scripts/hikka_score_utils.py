WR_MIN_VOTES = 10


def truncate_score(value):
    if value is None:
        return None
    return int(value * 100) / 100


def solve_raw_mean_score(anime_list, weighted_field='weighted_score', votes_field='scored_by', m=WR_MIN_VOTES):
    """
    Виводить середню сиру оцінку C із системи:
      W = (v / (v + m)) * R + (m / (v + m)) * C
      C = average(R)
    """
    valid_entries = [
        (item.get(weighted_field), item.get(votes_field))
        for item in anime_list
        if item.get(weighted_field) is not None and item.get(votes_field)
    ]

    if not valid_entries:
        return 0.0

    numerator   = 0.0
    denominator = 0.0

    for weighted_score, scored_by in valid_entries:
        v = scored_by
        numerator   += ((v + m) / v) * weighted_score
        denominator += 1 + (m / v)

    return truncate_score(numerator / denominator) if denominator else 0.0


def restore_raw_score(weighted_score, scored_by, average_score, m=WR_MIN_VOTES):
    """R = ((v + m) * W - m * C) / v"""
    if weighted_score is None or not scored_by:
        return None

    v = scored_by
    raw_value = (((v + m) * weighted_score) - (m * average_score)) / v
    return truncate_score(raw_value)


def calculate_weighted_score(raw_score, scored_by, average_score, m=WR_MIN_VOTES):
    """W = (v / (v + m)) * R + (m / (v + m)) * C"""
    if raw_score is None or not scored_by:
        return None

    v = scored_by
    weighted_value = (v / (v + m)) * raw_score + (m / (v + m)) * average_score
    return truncate_score(weighted_value)


def mean_raw_score(anime_list, score_field='score'):
    scores = [item.get(score_field) for item in anime_list if item.get(score_field) is not None]
    if not scores:
        return None
    return truncate_score(sum(scores) / len(scores))


def resolve_average_score(anime_list, score_field='score', weighted_field='weighted_score', votes_field='scored_by', m=WR_MIN_VOTES):
    raw_average_score = mean_raw_score(anime_list, score_field)
    if raw_average_score is not None:
        return raw_average_score
    return solve_raw_mean_score(anime_list, weighted_field, votes_field, m)


def build_raw_score_map(
    anime_list,
    average_score,
    id_field='id',
    score_field='score',
    weighted_field='weighted_score',
    votes_field='scored_by',
    m=WR_MIN_VOTES,
):
    raw_score_by_id = {}

    for item in anime_list:
        anime_id = item.get(id_field)
        if anime_id is None:
            continue

        raw_score = item.get(score_field)
        if raw_score is None:
            raw_score = restore_raw_score(
                item.get(weighted_field),
                item.get(votes_field),
                average_score,
                m,
            )
        else:
            raw_score = truncate_score(raw_score)

        if raw_score is not None:
            raw_score_by_id[anime_id] = raw_score

    return raw_score_by_id


def reorder_snapshot_fields(snapshot):
    ordered_snapshot = {}

    for key in ("date", "timestamp", "source", "min_score", "total", "average_score", "anime"):
        if key in snapshot:
            ordered_snapshot[key] = snapshot[key]

    for key, value in snapshot.items():
        if key not in ordered_snapshot:
            ordered_snapshot[key] = value

    return ordered_snapshot
