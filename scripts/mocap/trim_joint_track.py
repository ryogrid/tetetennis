#!/usr/bin/env python3

import argparse
import json
import math
from pathlib import Path
from statistics import median

KEY_JOINTS = ["hips", "shoulderR", "wristR", "shoulderL", "kneeR", "kneeL"]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Trim a cleaned joint-track JSON down to the active serve motion window."
    )
    parser.add_argument("--input", required=True, help="Path to a cleaned joint-track JSON")
    parser.add_argument("--output", help="Output JSON path (default: alongside input)")
    parser.add_argument("--contact-frame", type=int, help="Known contact frame; defaults to suggestedContactFrame")
    parser.add_argument("--threshold-scale", type=float, default=0.18, help="Peak-motion fraction used as the activity threshold")
    parser.add_argument("--padding-before", type=int, default=24, help="Frames to keep before the detected active window")
    parser.add_argument("--padding-after", type=int, default=18, help="Frames to keep after the detected active window")
    parser.add_argument("--search-before", type=int, default=220, help="How many frames before contact to search for motion start")
    parser.add_argument("--search-after", type=int, default=80, help="How many frames after contact to search for motion end")
    return parser


def motion_scores(frames):
    scores = [0.0]
    prev = None
    for frame in frames:
        pts = [frame["joints"][joint] for joint in KEY_JOINTS]
        if prev is None:
            prev = pts
            continue
        total = 0.0
        for a, b in zip(pts, prev):
            total += math.dist((a["x"], a["y"], a["z"]), (b["x"], b["y"], b["z"]))
        scores.append(total)
        prev = pts
    return scores


def smooth(values, window=7):
    radius = window // 2
    out = []
    for index in range(len(values)):
        lo = max(0, index - radius)
        hi = min(len(values), index + radius + 1)
        chunk = values[lo:hi]
        out.append(sum(chunk) / len(chunk))
    return out


def find_window(scores, contact_frame, threshold, search_before, search_after):
    start_floor = max(0, contact_frame - search_before)
    end_ceil = min(len(scores) - 1, contact_frame + search_after)

    start = contact_frame
    quiet_run = 0
    for index in range(contact_frame, start_floor - 1, -1):
        if scores[index] < threshold:
            quiet_run += 1
            if quiet_run >= 5:
                start = min(contact_frame, index + 5)
                break
        else:
            quiet_run = 0
            start = index

    end = contact_frame
    quiet_run = 0
    for index in range(contact_frame, end_ceil + 1):
        if scores[index] < threshold:
            quiet_run += 1
            if quiet_run >= 5:
                end = max(contact_frame, index - 5)
                break
        else:
            quiet_run = 0
            end = index

    return start, end


def main():
    args = build_parser().parse_args()
    input_path = Path(args.input).resolve()
    data = json.loads(input_path.read_text())
    frames = data["frames"]
    if len(frames) < 2:
        raise SystemExit("Need at least 2 frames to trim")

    contact_frame = args.contact_frame
    if contact_frame is None:
        contact_frame = data.get("suggestedContactFrame")
    if contact_frame is None:
        raise SystemExit("Missing contact frame; pass --contact-frame or include suggestedContactFrame in the JSON")

    scores = smooth(motion_scores(frames))
    peak = max(scores)
    baseline = median(scores)
    threshold = max(peak * args.threshold_scale, baseline * 2.5)
    start, end = find_window(scores, contact_frame, threshold, args.search_before, args.search_after)
    start = max(0, start - args.padding_before)
    end = min(len(frames) - 1, end + args.padding_after)

    trimmed_frames = []
    for new_index, original in enumerate(frames[start:end + 1]):
        trimmed_frames.append({
            "index": new_index,
            "joints": original["joints"],
        })

    trimmed = dict(data)
    trimmed["sourceFrameCount"] = data.get("sourceFrameCount", len(frames))
    trimmed["keptFrameCount"] = len(trimmed_frames)
    trimmed["trimmedFrom"] = {
        "startFrame": start,
        "endFrame": end,
        "originalContactFrame": contact_frame,
        "threshold": threshold,
    }
    trimmed["suggestedContactFrame"] = contact_frame - start
    trimmed["frames"] = trimmed_frames
    trimmed.setdefault("notes", []).append("Trimmed to the active motion window by scripts/mocap/trim_joint_track.py.")

    output_path = Path(args.output).resolve() if args.output else input_path.with_suffix("")
    if not args.output:
        output_path = output_path.parent / f"{output_path.name}.trimmed.json"
    output_path.write_text(json.dumps(trimmed, indent=2) + "\n", encoding="utf-8")

    print(f"Wrote trimmed joint track: {output_path}")
    print(f"Window: {start}..{end}")
    print(f"Reindexed contact frame: {trimmed['suggestedContactFrame']}")


if __name__ == "__main__":
    main()