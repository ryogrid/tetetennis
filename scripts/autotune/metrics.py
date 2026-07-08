"""Metric and loss functions for the autotune pipeline.

Pure functions over runner match results (autotune_design/03) driven by the
numbers-only fitness config (autotune_design/05). No I/O, no Optuna imports —
unit-testable in isolation.
"""

from __future__ import annotations

import math

# ---------------------------------------------------------------- metrics


def _percentile(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        return float("nan")
    idx = (len(sorted_vals) - 1) * q
    lo, hi = int(math.floor(idx)), int(math.ceil(idx))
    if lo == hi:
        return sorted_vals[lo]
    frac = idx - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


def _reconstruct_games(points: list[dict]) -> list[dict]:
    """Split the point log into service games by server runs.

    The server changes exactly at game boundaries (tiebreak excluded from
    hold stats: its intra-game server rotation would read as tiny 'games',
    so we drop any trailing segment where the server alternates every 1-2
    points AND the match reached a tiebreak — conservatively, segments of
    fewer than 4 points at the very end are kept but tiebreak detection is
    the caller's concern; the report carries tb_points for that).
    """
    games: list[dict] = []
    cur_server = None
    cur: list[dict] | None = None
    for p in points:
        if p["server"] != cur_server:
            if cur:
                games.append({"server": cur_server, "points": cur})
            cur_server = p["server"]
            cur = []
        assert cur is not None
        cur.append(p)
    if cur:
        games.append({"server": cur_server, "points": cur})
    return games


def compute_metrics(reports: list[dict]) -> dict[str, float]:
    """Metrics over one matchup's *finished* reports (autotune_design/05).

    Percentages are 0-100. Raises ValueError on an empty list — the caller
    decides how undefined matchups affect the loss.
    """
    if not reports:
        raise ValueError("compute_metrics needs at least one finished report")

    points = [p for r in reports for p in r["points"]]
    n_points = len(points)
    if n_points == 0:
        raise ValueError("finished reports contain no points")

    rally = sorted(p["rally_shots"] for p in points)
    pct = lambda pred: 100.0 * sum(1 for p in points if pred(p)) / n_points

    first_serves = sum(r["p"]["first_serves"] + r["c"]["first_serves"] for r in reports)
    first_in = sum(r["p"]["first_in"] + r["c"]["first_in"] for r in reports)
    net_pts = sum(r["p"]["net_pts"] + r["c"]["net_pts"] for r in reports)
    net_won = sum(r["p"]["net_won"] + r["c"]["net_won"] for r in reports)
    run_m = sum(r["p"]["run_m"] + r["c"]["run_m"] for r in reports)

    second_serve_pts = [p for p in points if p["serve_number"] == 2]

    # service games from server runs; exclude tiebreak points (the rules
    # rotate the server intra-game there). A report that reached a tiebreak
    # has tb_points > 0; drop that many trailing points before reconstruction.
    holds = 0
    games_n = 0
    for r in reports:
        pts = r["points"]
        tb = r["tb_points_p"] + r["tb_points_c"]
        if tb > 0:
            pts = pts[: len(pts) - tb] if tb < len(pts) else []
        for g in _reconstruct_games(pts):
            games_n += 1
            won = sum(1 for p in g["points"] if p["winner"] == g["server"])
            lost = len(g["points"]) - won
            if won > lost:
                holds += 1

    return {
        "avg_rally_shots": sum(rally) / n_points,
        "rally_p50": _percentile(rally, 0.50),
        "rally_p90": _percentile(rally, 0.90),
        "winner_pct": pct(lambda p: p["end_kind"] == "winner"),
        "unforced_pct": pct(lambda p: p["end_kind"] == "unforced"),
        "double_fault_pct": pct(lambda p: p["end_kind"] == "double_fault"),
        "ace_pct": pct(
            lambda p: p["rally_shots"] == 0
            and p["end_kind"] == "winner"
            and p["winner"] == p["server"]
        ),
        "first_serve_in_pct": 100.0 * first_in / first_serves if first_serves else 0.0,
        "second_serve_win_pct": (
            100.0
            * sum(1 for p in second_serve_pts if p["winner"] == p["server"])
            / len(second_serve_pts)
            if second_serve_pts
            else 0.0
        ),
        "service_hold_pct": 100.0 * holds / games_n if games_n else 0.0,
        "break_rate": (games_n - holds) / len(reports),
        "net_approach_rate": 100.0 * net_pts / n_points,
        "net_point_win_pct": 100.0 * net_won / net_pts if net_pts else 0.0,
        "match_duration_s": sum(r["duration_s"] for r in reports) / len(reports),
        "points_per_match": n_points / len(reports),
        "game_margin": sum(abs(r["games_p"] - r["games_c"]) for r in reports)
        / len(reports),
        "run_m_per_point": run_m / n_points,
        "win_balance_pct": pct(lambda p: p["winner"] == "p"),
    }


METRIC_NAMES = frozenset(
    {
        "avg_rally_shots",
        "rally_p50",
        "rally_p90",
        "winner_pct",
        "unforced_pct",
        "double_fault_pct",
        "ace_pct",
        "first_serve_in_pct",
        "second_serve_win_pct",
        "service_hold_pct",
        "break_rate",
        "net_approach_rate",
        "net_point_win_pct",
        "match_duration_s",
        "points_per_match",
        "game_margin",
        "run_m_per_point",
        "win_balance_pct",
    }
)

MIRROR_ONLY_METRICS = frozenset({"win_balance_pct"})

# ------------------------------------------------------------------ loss


def aggregate_matchups(
    per_matchup: list[dict[str, float] | None], mirror_flags: list[bool]
) -> dict[str, float]:
    """Equal-weight mean across matchups with defined metrics.

    win_balance_pct averages over mirror matchups only (a 50% target is
    meaningless on asymmetric pairings and would push the optimizer to
    erase character differences).
    """
    agg: dict[str, float] = {}
    for name in METRIC_NAMES:
        if name in MIRROR_ONLY_METRICS:
            vals = [
                m[name]
                for m, mirror in zip(per_matchup, mirror_flags)
                if m is not None and mirror
            ]
        else:
            vals = [m[name] for m in per_matchup if m is not None]
        if vals:
            agg[name] = sum(vals) / len(vals)
    return agg


def term_penalty(term: dict, value: float) -> float:
    """Hinge-squared: zero inside the acceptable region, quadratic outside."""
    if "target" in term:
        d = abs(value - term["target"])
    else:
        d = max(0.0, term.get("min", -math.inf) - value, value - term.get("max", math.inf))
    scale = term.get("scale", 1.0)
    weight = term.get("weight", 1.0)
    return weight * (d / scale) ** 2


def loss(
    metrics: dict[str, float],
    fitness: list[dict],
    timeout_rate: float,
    timeout_weight: float,
) -> tuple[float, dict[str, float]]:
    """Total loss + per-term breakdown.

    A term whose metric is missing (every matchup timed out) contributes
    nothing itself — the timeout penalty carries the signal. If ALL matches
    timed out, metrics is empty and the loss is the timeout penalty alone.
    """
    breakdown: dict[str, float] = {}
    total = 0.0
    for term in fitness:
        name = term["metric"]
        if name not in metrics:
            continue
        p = term_penalty(term, metrics[name])
        breakdown[name] = p
        total += p
    timeout_pen = timeout_weight * timeout_rate
    breakdown["_timeout"] = timeout_pen
    return total + timeout_pen, breakdown


def validate_fitness(fitness: list[dict], has_mirror_matchup: bool) -> list[str]:
    """Config errors (empty list = valid)."""
    errors = []
    for i, term in enumerate(fitness):
        name = term.get("metric")
        if name not in METRIC_NAMES:
            errors.append(f"fitness[{i}]: unknown metric {name!r}")
            continue
        if "target" not in term and "min" not in term and "max" not in term:
            errors.append(f"fitness[{i}] ({name}): needs target or min/max")
        if "target" in term and ("min" in term or "max" in term):
            errors.append(f"fitness[{i}] ({name}): target and min/max are exclusive")
        if term.get("scale", 1.0) <= 0:
            errors.append(f"fitness[{i}] ({name}): scale must be > 0")
        if name in MIRROR_ONLY_METRICS and not has_mirror_matchup:
            errors.append(
                f"fitness[{i}] ({name}): requires at least one mirror matchup (you == opp)"
            )
    return errors
