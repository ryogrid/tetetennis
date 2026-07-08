"""Unit tests for metrics.py against a canned report. Run: python3 test_metrics.py"""

import math

from metrics import (
    aggregate_matchups,
    compute_metrics,
    loss,
    term_penalty,
    validate_fitness,
)


def _pt(server, winner, rally, kind, serve_number=1, dur=8.0):
    return {
        "server": server,
        "winner": winner,
        "rally_shots": rally,
        "end_kind": kind,
        "serve_number": serve_number,
        "duration_s": dur,
    }


def canned_report():
    # game 1: P serves and holds 4-1; game 2: C serves, broken 1-4.
    points = (
        [_pt("p", "p", 0, "winner")]  # ace
        + [_pt("p", "p", 4, "winner") for _ in range(2)]
        + [_pt("p", "c", 6, "unforced")]
        + [_pt("p", "p", 2, "winner", serve_number=2)]
        + [_pt("c", "c", 3, "winner")]
        + [_pt("c", "p", 5, "unforced") for _ in range(3)]
        + [_pt("c", "p", 0, "double_fault", serve_number=2)]
    )
    return {
        "schema": 1,
        "finished": True,
        "winner": "p",
        "games_p": 2,
        "games_c": 0,
        "tb_points_p": 0,
        "tb_points_c": 0,
        "duration_s": 300.0,
        "points_played": len(points),
        "total_rally_shots": sum(p["rally_shots"] for p in points),
        "total_first_bounces": 10,
        "deep_first_bounces": 8,
        "p": {
            "winners": 4, "unforced": 3, "double_faults": 0,
            "first_serves": 5, "first_in": 4, "run_m": 400.0,
            "net_pts": 2, "net_won": 1,
        },
        "c": {
            "winners": 1, "unforced": 1, "double_faults": 1,
            "first_serves": 5, "first_in": 4, "run_m": 420.0,
            "net_pts": 0, "net_won": 0,
        },
        "points": points,
    }


def mini_report(winner):
    r = canned_report()
    r["winner"] = winner
    return r


def approx(a, b, eps=1e-9):
    assert abs(a - b) < eps, f"{a} != {b}"


def main():
    r = canned_report()
    m = compute_metrics([r])
    n = len(r["points"])
    assert n == 10
    approx(m["avg_rally_shots"], sum(p["rally_shots"] for p in r["points"]) / n)
    approx(m["winner_pct"], 50.0)  # 5 of 10
    approx(m["unforced_pct"], 40.0)
    approx(m["double_fault_pct"], 10.0)
    approx(m["ace_pct"], 10.0)  # the one rally=0 winner by the server
    approx(m["first_serve_in_pct"], 80.0)  # 8/10
    approx(m["second_serve_win_pct"], 50.0)  # P won his, C lost his
    approx(m["service_hold_pct"], 50.0)  # P held, C broken
    approx(m["break_rate"], 1.0)  # one break in one match
    approx(m["net_approach_rate"], 20.0)
    approx(m["net_point_win_pct"], 50.0)
    approx(m["match_duration_s"], 300.0)
    approx(m["points_per_match"], 10.0)
    approx(m["game_margin"], 2.0)
    approx(m["win_balance_pct"], 80.0)  # P wins 8 of 10 points
    approx(m["deep_first_bounce_pct"], 80.0)  # 8 of 10 first bounces are deep

    # aggregation: win_balance only over mirror matchups
    agg = aggregate_matchups([m, m], [True, False])
    approx(agg["win_balance_pct"], 80.0)
    agg2 = aggregate_matchups([m, None], [True, False])
    approx(agg2["winner_pct"], 50.0)

    # hinge-squared shapes
    approx(term_penalty({"metric": "x", "min": 5, "max": 10, "scale": 2, "weight": 1}, 7), 0.0)
    approx(term_penalty({"metric": "x", "min": 5, "max": 10, "scale": 2, "weight": 1}, 12), 1.0)
    approx(term_penalty({"metric": "x", "target": 20, "scale": 5, "weight": 2}, 25), 2.0)

    # loss: missing metric skipped; timeout penalty carries through
    total, breakdown = loss(
        {"winner_pct": 50.0},
        [{"metric": "winner_pct", "target": 50, "scale": 5, "weight": 1},
         {"metric": "ace_pct", "target": 5, "scale": 2, "weight": 1}],
        timeout_rate=0.25,
        timeout_weight=50.0,
    )
    approx(total, 12.5)
    assert "ace_pct" not in breakdown
    approx(breakdown["_timeout"], 12.5)

    # validation
    errs = validate_fitness([{"metric": "nope", "target": 1}], True)
    assert errs and "unknown metric" in errs[0]
    errs = validate_fitness([{"metric": "win_balance_pct", "target": 50}], False)
    assert errs and "mirror" in errs[0]
    errs = validate_fitness([{"metric": "winner_pct", "min": 10, "max": 30}], False)
    assert errs == []

    # side-A per-match win rate + sample size
    approx(m["side_a_win_pct"], 100.0)  # single canned report, winner "p"
    approx(m["side_a_win_n"], 1.0)
    reports5 = [mini_report("p")] * 3 + [mini_report("c")] * 2
    m5 = compute_metrics(reports5)
    approx(m5["side_a_win_pct"], 60.0)
    approx(m5["side_a_win_n"], 5.0)

    # robust term: a near-target rate from FEW matches must score worse than
    # from many, and the plain hinge is zero at target.
    base = {"metric": "side_a_win_pct", "target": 60, "scale": 6, "weight": 1}
    approx(term_penalty(base, 60.0), 0.0)
    rob = {**base, "robust": True, "z": 1.0}
    small_n = term_penalty(rob, 60.0, 5)
    large_n = term_penalty(rob, 60.0, 200)
    assert small_n > large_n > 0.0, (small_n, large_n)
    # robust falls back to the plain hinge when the sample size is unknown
    approx(term_penalty(rob, 60.0, None), 0.0)

    # loss reads the companion sample-size metric for a robust term
    tot, _ = loss(
        {"side_a_win_pct": 60.0, "side_a_win_n": 5.0},
        [rob],
        timeout_rate=0.0,
        timeout_weight=50.0,
    )
    approx(tot, small_n)

    # aggregate sums side_a_win_n across mirror matchups, averages the pct
    aggm = aggregate_matchups([m5, m5], [True, True])
    approx(aggm["side_a_win_n"], 10.0)
    approx(aggm["side_a_win_pct"], 60.0)

    # a robust term validates its (defaulted) companion metric name
    assert validate_fitness([{**rob, "n_metric": "nope"}], True)
    assert validate_fitness([rob], True) == []

    # NaN never sneaks in
    assert not any(math.isnan(v) for v in m.values())
    print("test_metrics: all assertions passed")


if __name__ == "__main__":
    main()
