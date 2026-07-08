#!/usr/bin/env python3
"""Optuna controller for the autotune pipeline (autotune_design/05).

    python tune.py --config autotune.config.json [--resume]

Fully unattended: reads the numbers-only config, drives the Node headless
runner in parallel subprocesses, minimizes the weighted hinge loss with TPE,
then re-evaluates the top-K trials on held-out seeds and writes
best_params.json / top_k.csv / study_summary.md to the output dir.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import optuna
from optuna.trial import TrialState

from metrics import (
    aggregate_matchups,
    compute_metrics,
    loss,
    validate_fitness,
)

HERE = Path(__file__).resolve().parent
RUNNER = HERE / "run_match.mjs"
REGISTRY = json.loads((HERE / "registry.json").read_text())
STUDY_NAME = "autotune"
MAX_SEARCH_DIMS_WARN = 12

# ------------------------------------------------------------- config


def load_config(path: Path) -> dict:
    cfg = json.loads(path.read_text())
    errors: list[str] = []

    params = REGISTRY["params"]
    virtual = REGISTRY["virtual_params"]
    search = cfg.get("search_space", {})
    for name, spec in {**search, **cfg.get("fixed_params", {})}.items():
        if name not in params and name not in virtual:
            errors.append(f"unknown parameter: {name!r} (see registry.json)")
    for name, spec in search.items():
        if not isinstance(spec, dict) or "min" not in spec or "max" not in spec:
            errors.append(f"search_space[{name}]: needs min and max")
        elif spec["min"] >= spec["max"]:
            errors.append(f"search_space[{name}]: min must be < max")

    run = cfg.get("run", {})
    matchups = run.get("matchups", [])
    if not matchups:
        errors.append("run.matchups must be non-empty")
    has_mirror = any(m.get("you") == m.get("opp") for m in matchups)
    errors += validate_fitness(cfg.get("fitness", []), has_mirror)

    shot_policy = {"none", "flat", "topspin", "slice"}
    for i, mu in enumerate(matchups):
        force = mu.get("force")
        if force is None:
            continue
        if not isinstance(force, dict):
            errors.append(f"run.matchups[{i}].force must be an object")
            continue
        for side in ("a", "b"):
            v = force.get(side)
            if v is not None and v not in shot_policy:
                errors.append(
                    f"run.matchups[{i}].force.{side}: must be one of {sorted(shot_policy)}"
                )
        if force.get("return") not in (None, "slice", "none"):
            errors.append(f"run.matchups[{i}].force.return: must be 'slice' or 'none'")

    val = cfg.get("validation", {})
    if val:
        run_seeds = set(
            range(run.get("seed_base", 1000), run.get("seed_base", 1000) + run.get("matches_per_trial", 8))
        )
        val_seeds = set(
            range(val.get("seed_base", 100000), val.get("seed_base", 100000) + val.get("matches_per_matchup", 24))
        )
        if run_seeds & val_seeds:
            errors.append("validation seeds overlap run seeds")

    if errors:
        for e in errors:
            print(f"config error: {e}", file=sys.stderr)
        sys.exit(1)

    if len(search) > MAX_SEARCH_DIMS_WARN:
        print(
            f"warning: {len(search)} search dimensions — TPE degrades in high "
            f"dimensions; prefer staged sub-space studies",
            file=sys.stderr,
        )
    return cfg


def to_engine_params(sampled: dict[str, float]) -> dict[str, float]:
    """Resolve virtual parameters into engine parameters (registry.json).

    err_mul_lo -> err_mul_slope = err_mul_hi - err_mul_lo
    serve_sweet_width -> serve_sweet_hi = serve_sweet_lo + serve_sweet_width
    """
    out = dict(sampled)
    defaults = {k: v["default"] for k, v in REGISTRY["params"].items()}
    if "err_mul_lo" in out:
        lo = out.pop("err_mul_lo")
        hi = out.get("err_mul_hi", defaults["err_mul_hi"])
        out["err_mul_slope"] = hi - lo
    if "serve_sweet_width" in out:
        width = out.pop("serve_sweet_width")
        lo = out.get("serve_sweet_lo", defaults["serve_sweet_lo"])
        out["serve_sweet_hi"] = lo + width
    return out


# ------------------------------------------------------------- runner


class RunnerError(RuntimeError):
    pass


def run_jobs(
    params: dict[str, float],
    matches: list[dict],
    max_steps: int,
    workers: int,
    keep_dir: Path | None = None,
) -> list[dict]:
    """Fan the match list across `workers` Node subprocesses; return results."""
    chunks = [matches[i::workers] for i in range(workers)]
    chunks = [c for c in chunks if c]

    def run_chunk(i_chunk):
        i, chunk = i_chunk
        job = {"params": params, "matches": chunk, "max_steps": max_steps}
        if keep_dir:
            (keep_dir / f"job-{i}.json").write_text(json.dumps(job, indent=2))
        proc = subprocess.run(
            ["node", str(RUNNER)],
            input=json.dumps(job),
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            raise RunnerError(f"runner exit {proc.returncode}: {proc.stderr[-2000:]}")
        if keep_dir:
            (keep_dir / f"out-{i}.json").write_text(proc.stdout)
        if proc.stderr.strip():
            print(proc.stderr.rstrip(), file=sys.stderr)
        return json.loads(proc.stdout)["results"]

    with ThreadPoolExecutor(max_workers=len(chunks)) as ex:
        parts = list(ex.map(run_chunk, enumerate(chunks)))
    return [r for part in parts for r in part]


def evaluate(
    engine_params: dict[str, float],
    cfg: dict,
    seeds: list[int],
    keep_dir: Path | None = None,
) -> tuple[float, dict, dict]:
    """Run all matchups x seeds; return (loss, agg_metrics, extras)."""
    run = cfg["run"]
    matchups = run["matchups"]
    matches = []
    for mi, mu in enumerate(matchups):
        # Optional per-side shot policy for balance studies. "a" -> side P (you),
        # "b" -> side C (opp); "return":"slice" plays Slice on the return of
        # serve; "alternate_server" flips first server by seed parity so the
        # win-rate reflects shot merit, not serve order.
        force = mu.get("force") or {}
        ret_slice = 1 if force.get("return") == "slice" else 0
        alternate = bool(force.get("alternate_server"))
        for si, seed in enumerate(seeds):
            m = {
                "seed": seed,
                "you": mu["you"],
                "opp": mu["opp"],
                "surface": mu["surface"],
                "difficulty": mu["difficulty"],
                "games": run.get("games", 4),
                "_matchup": mi,
            }
            if force:
                if force.get("a") is not None:
                    m["force_p"] = force["a"]
                if force.get("b") is not None:
                    m["force_c"] = force["b"]
                m["return_slice"] = ret_slice
                if alternate:
                    m["first_server"] = "p" if si % 2 == 0 else "c"
            matches.append(m)
    results = run_jobs(
        engine_params,
        [{k: v for k, v in m.items() if k != "_matchup"} for m in matches],
        run.get("max_steps_per_match", 600000),
        run.get("workers", 4),
        keep_dir,
    )
    # rejoin results to matchups by (seed, you, opp, surface) — order-safe
    keyed = {}
    for m in matches:
        keyed[(m["seed"], m["you"], m["opp"], m["surface"], m["difficulty"])] = m["_matchup"]

    per_matchup_reports: list[list[dict]] = [[] for _ in matchups]
    n_timeout = 0
    progress_deficit = 0.0  # 0 = finished, →1 = timed out with zero points
    games = run.get("games", 4)
    for r in results:
        mi = keyed[(r["seed"], r["you"], r["opp"], r["surface"], r["difficulty"])]
        rep = r.get("report") or {}
        if r["timed_out"] or not rep.get("finished"):
            n_timeout += 1
            # graded timeout: partial-report point progress gives TPE a
            # gradient toward match-completing regions instead of a flat
            # all-timeout plateau (~12 points per target game as the yardstick)
            progress = min(1.0, rep.get("points_played", 0) / (12.0 * games))
            progress_deficit += 1.0 - 0.5 * progress  # finishing still matters most
        elif rep:
            per_matchup_reports[mi].append(rep)

    per_matchup_metrics = [
        compute_metrics(reports) if reports else None for reports in per_matchup_reports
    ]
    mirror_flags = [mu["you"] == mu["opp"] for mu in matchups]
    agg = aggregate_matchups(per_matchup_metrics, mirror_flags)
    timeout_rate = n_timeout / len(results) if results else 1.0
    deficit = progress_deficit / len(results) if results else 1.0
    total, breakdown = loss(
        agg,
        cfg["fitness"],
        deficit,
        run.get("timeout_weight", 50.0),
    )
    extras = {
        "timeout_rate": timeout_rate,
        "breakdown": breakdown,
        "finished_matches": len(results) - n_timeout,
        "total_matches": len(results),
    }
    return total, agg, extras


# ------------------------------------------------------------- study


def make_storage(out_dir: Path):
    from optuna.storages import JournalStorage

    try:  # optuna >= 3.4
        from optuna.storages.journal import JournalFileBackend

        return JournalStorage(JournalFileBackend(str(out_dir / "journal.log")))
    except ImportError:  # older optuna
        from optuna.storages import JournalFileStorage

        return JournalStorage(JournalFileStorage(str(out_dir / "journal.log")))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True, type=Path)
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    cfg = load_config(args.config)
    run = cfg["run"]
    out_dir = Path(cfg.get("output_dir", "autotune_out"))
    out_dir.mkdir(parents=True, exist_ok=True)
    trials_dir = out_dir / "trials"
    trials_dir.mkdir(exist_ok=True)

    journal = out_dir / "journal.log"
    if journal.exists() and not args.resume:
        print(
            f"{journal} exists — pass --resume to continue that study, or remove "
            f"the output dir to start fresh",
            file=sys.stderr,
        )
        sys.exit(1)

    storage = make_storage(out_dir)
    sampler = optuna.samplers.TPESampler(
        seed=run.get("sampler_seed", 42), multivariate=True
    )
    study = optuna.create_study(
        study_name=STUDY_NAME,
        storage=storage,
        sampler=sampler,
        direction="minimize",
        load_if_exists=True,
    )

    seeds = list(
        range(run.get("seed_base", 1000), run.get("seed_base", 1000) + run.get("matches_per_trial", 8))
    )
    consecutive_failures = 0
    max_fail = run.get("max_consecutive_failures", 5)

    def objective(trial: optuna.Trial) -> float:
        nonlocal consecutive_failures
        sampled = {
            name: trial.suggest_float(name, spec["min"], spec["max"])
            for name, spec in cfg.get("search_space", {}).items()
        }
        engine = to_engine_params({**cfg.get("fixed_params", {}), **sampled})
        keep = trials_dir / f"trial-{trial.number}"
        keep.mkdir(exist_ok=True)
        try:
            total, agg, extras = evaluate(engine, cfg, seeds, keep_dir=keep)
        except RunnerError as e:
            consecutive_failures += 1
            trial.set_user_attr("error", str(e)[-1000:])
            if consecutive_failures >= max_fail:
                print(f"aborting: {max_fail} consecutive runner failures", file=sys.stderr)
                raise SystemExit(1) from e
            raise  # marks the trial FAILED; the study continues
        consecutive_failures = 0
        trial.set_user_attr("metrics", agg)
        trial.set_user_attr("breakdown", extras["breakdown"])
        trial.set_user_attr("timeout_rate", extras["timeout_rate"])
        trial.set_user_attr("engine_params", engine)
        print(
            f"trial {trial.number}: loss={total:.4f} timeouts={extras['timeout_rate']:.0%} "
            f"finished={extras['finished_matches']}/{extras['total_matches']}",
            file=sys.stderr,
        )
        # prune old trial dirs, keep the newest 5 (best is re-derivable)
        kept = sorted(trials_dir.iterdir(), key=lambda p: p.stat().st_mtime)
        for old in kept[:-5]:
            shutil.rmtree(old, ignore_errors=True)
        return total

    done = len([t for t in study.trials if t.state in (TrialState.COMPLETE, TrialState.FAIL)])
    remaining = max(0, run.get("n_trials", 100) - done)
    print(f"study: {done} trials done, running {remaining} more", file=sys.stderr)
    if remaining:
        study.optimize(objective, n_trials=remaining, catch=(RunnerError,))

    finalize(study, cfg, out_dir)


def finalize(study: optuna.Study, cfg: dict, out_dir: Path) -> None:
    run = cfg["run"]
    val_cfg = cfg.get("validation", {"top_k": 5, "seed_base": 100000, "matches_per_matchup": 24})
    complete = [t for t in study.trials if t.state == TrialState.COMPLETE]
    if not complete:
        print("no completed trials — nothing to report", file=sys.stderr)
        return
    complete.sort(key=lambda t: t.value)
    top = complete[: val_cfg.get("top_k", 5)]

    # held-out validation: disjoint seeds, larger sample, pick by validation loss
    val_seeds = list(
        range(
            val_cfg.get("seed_base", 100000),
            val_cfg.get("seed_base", 100000) + val_cfg.get("matches_per_matchup", 24),
        )
    )
    print(f"validating top {len(top)} trials on {len(val_seeds)} held-out seeds", file=sys.stderr)
    validated = []
    for t in top:
        engine = t.user_attrs["engine_params"]
        vloss, vmetrics, vextras = evaluate(engine, cfg, val_seeds)
        validated.append({"trial": t, "val_loss": vloss, "val_metrics": vmetrics, "val_extras": vextras})
        print(
            f"  trial {t.number}: study_loss={t.value:.4f} val_loss={vloss:.4f}",
            file=sys.stderr,
        )
    validated.sort(key=lambda v: v["val_loss"])
    best = validated[0]
    bt = best["trial"]

    if bt.value > 0 and best["val_loss"] > 1.5 * bt.value:
        print(
            "warning: best validation loss exceeds its study loss by >50% — the "
            "study overfit its seed list; increase matches_per_trial and rerun",
            file=sys.stderr,
        )

    params_info = REGISTRY["params"]
    best_params = {
        "schema": 1,
        "study": STUDY_NAME,
        "trial": bt.number,
        "study_loss": bt.value,
        "validation_loss": best["val_loss"],
        "metrics": best["val_metrics"],
        "params": {
            name: {
                "value": value,
                "default": params_info[name]["default"],
                "file": params_info[name]["file"],
                "symbol": params_info[name]["symbol"],
                "kind": params_info[name]["kind"],
            }
            for name, value in bt.user_attrs["engine_params"].items()
        },
    }
    (out_dir / "best_params.json").write_text(json.dumps(best_params, indent=2) + "\n")

    # top_k.csv
    with (out_dir / "top_k.csv").open("w", newline="") as f:
        w = csv.writer(f)
        param_names = sorted({k for v in validated for k in v["trial"].user_attrs["engine_params"]})
        w.writerow(["trial", "study_loss", "val_loss", "timeout_rate"] + param_names)
        for v in validated:
            t = v["trial"]
            ep = t.user_attrs["engine_params"]
            w.writerow(
                [t.number, f"{t.value:.5f}", f"{v['val_loss']:.5f}", f"{t.user_attrs['timeout_rate']:.3f}"]
                + [f"{ep.get(n, ''):.5g}" if n in ep else "" for n in param_names]
            )

    # study_summary.md
    lines = [
        "# Autotune Study Summary",
        "",
        f"- completed trials: {len(complete)}",
        f"- best by validation loss: trial {bt.number} "
        f"(study {bt.value:.4f} / validation {best['val_loss']:.4f})",
        "",
        "## Best trial metrics vs fitness targets (validation)",
        "",
        "| metric | value | term |",
        "| --- | --- | --- |",
    ]
    for term in cfg["fitness"]:
        name = term["metric"]
        v = best["val_metrics"].get(name)
        goal = (
            f"target {term['target']}" if "target" in term else f"[{term.get('min', '')}, {term.get('max', '')}]"
        )
        lines.append(f"| {name} | {v:.2f} | {goal} (w={term.get('weight', 1.0)}) |" if v is not None else f"| {name} | — | {goal} |")
    # bound-pinning warnings
    lines += ["", "## Search-bound pinning", ""]
    pinned = []
    for name, spec in cfg.get("search_space", {}).items():
        v = bt.params.get(name)
        if v is None:
            continue
        span = spec["max"] - spec["min"]
        if v - spec["min"] < 0.02 * span or spec["max"] - v < 0.02 * span:
            pinned.append(f"- `{name}` = {v:.4g} pins its bound [{spec['min']}, {spec['max']}] — widen and rerun")
    lines += pinned if pinned else ["- none"]
    # loss curve sparkline
    values = [t.value for t in sorted(complete, key=lambda t: t.number)]
    best_so_far = []
    cur = float("inf")
    for v in values:
        cur = min(cur, v)
        best_so_far.append(cur)
    blocks = "▁▂▃▄▅▆▇█"
    lo, hi = min(best_so_far), max(best_so_far)
    spark = "".join(
        blocks[min(7, int((v - lo) / (hi - lo + 1e-12) * 7.999))] for v in best_so_far[:: max(1, len(best_so_far) // 80)]
    )
    lines += ["", "## Best-so-far loss curve", "", f"`{spark}`", ""]
    lines += ["## Config echo", "", "```json", json.dumps(cfg, indent=2), "```", ""]
    (out_dir / "study_summary.md").write_text("\n".join(lines))
    print(f"wrote {out_dir}/best_params.json, top_k.csv, study_summary.md", file=sys.stderr)


if __name__ == "__main__":
    main()
