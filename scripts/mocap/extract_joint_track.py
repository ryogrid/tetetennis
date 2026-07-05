#!/usr/bin/env python3

import argparse
import json
import math
from pathlib import Path
from typing import Dict, List, Optional
import urllib.request

JOINT_NAMES = [
    "hips",
    "shoulderR",
    "elbowR",
    "wristR",
    "shoulderL",
    "elbowL",
    "kneeR",
    "kneeL",
]

LANDMARK_INDEX = {
    "LEFT_SHOULDER": 11,
    "RIGHT_SHOULDER": 12,
    "LEFT_ELBOW": 13,
    "RIGHT_ELBOW": 14,
    "LEFT_WRIST": 15,
    "RIGHT_WRIST": 16,
    "LEFT_HIP": 23,
    "RIGHT_HIP": 24,
    "LEFT_KNEE": 25,
    "RIGHT_KNEE": 26,
}

DEFAULT_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Extract a serve joint track from an mp4 using MediaPipe Pose."
    )
    parser.add_argument("--input", required=True, help="Path to the source mp4 file")
    parser.add_argument("--output", help="Output JSON path (default: alongside input)")
    parser.add_argument("--frame-step", type=int, default=1, help="Process every Nth frame (default: 1)")
    parser.add_argument(
        "--visibility-threshold",
        type=float,
        default=0.55,
        help="Landmarks below this visibility are treated as missing before interpolation",
    )
    parser.add_argument(
        "--smooth-window",
        type=int,
        default=5,
        help="Centered moving-average window applied after interpolation (default: 5)",
    )
    parser.add_argument("--model-complexity", type=int, choices=[0, 1, 2], default=2)
    parser.add_argument("--min-detection-confidence", type=float, default=0.5)
    parser.add_argument("--min-tracking-confidence", type=float, default=0.5)
    parser.add_argument("--name", default="", help="Optional label written into output metadata")
    return parser


def lazy_imports():
    try:
        import cv2  # type: ignore
        import mediapipe as mp  # type: ignore
        from mediapipe.tasks.python.core import base_options as base_options_module  # type: ignore
        from mediapipe.tasks.python.vision import pose_landmarker  # type: ignore
        from mediapipe.tasks.python.vision.core import vision_task_running_mode as running_mode_module  # type: ignore
    except ImportError as exc:
        raise SystemExit(
            "Missing Python dependencies. Install them with: "
            "python3 -m pip install -r scripts/mocap/requirements.txt"
        ) from exc
    return cv2, mp, base_options_module, pose_landmarker, running_mode_module


def ensure_model_asset() -> Path:
    model_dir = Path("scripts/mocap/models")
    model_dir.mkdir(parents=True, exist_ok=True)
    model_path = model_dir / "pose_landmarker_heavy.task"
    if model_path.exists() and model_path.stat().st_size > 0:
        return model_path
    print(f"Downloading pose model to {model_path} ...")
    urllib.request.urlretrieve(DEFAULT_MODEL_URL, model_path)
    return model_path


def midpoint(a, b, visibility=1.0):
    return {
        "x": (a.x + b.x) / 2,
        "y": (a.y + b.y) / 2,
        "z": (a.z + b.z) / 2,
        "visibility": visibility,
    }


def point(landmark, visibility=1.0):
    return {
        "x": landmark.x,
        "y": landmark.y,
        "z": landmark.z,
        "visibility": visibility,
    }


def extract_joint_map(norm_landmarks, world_landmarks):
    left_hip = world_landmarks[LANDMARK_INDEX["LEFT_HIP"]]
    right_hip = world_landmarks[LANDMARK_INDEX["RIGHT_HIP"]]
    hip_visibility = min(
        getattr(norm_landmarks[LANDMARK_INDEX["LEFT_HIP"]], "visibility", 1.0),
        getattr(norm_landmarks[LANDMARK_INDEX["RIGHT_HIP"]], "visibility", 1.0),
    )
    return {
        "hips": midpoint(left_hip, right_hip, hip_visibility),
        "shoulderR": point(
            world_landmarks[LANDMARK_INDEX["RIGHT_SHOULDER"]],
            getattr(norm_landmarks[LANDMARK_INDEX["RIGHT_SHOULDER"]], "visibility", 1.0),
        ),
        "elbowR": point(
            world_landmarks[LANDMARK_INDEX["RIGHT_ELBOW"]],
            getattr(norm_landmarks[LANDMARK_INDEX["RIGHT_ELBOW"]], "visibility", 1.0),
        ),
        "wristR": point(
            world_landmarks[LANDMARK_INDEX["RIGHT_WRIST"]],
            getattr(norm_landmarks[LANDMARK_INDEX["RIGHT_WRIST"]], "visibility", 1.0),
        ),
        "shoulderL": point(
            world_landmarks[LANDMARK_INDEX["LEFT_SHOULDER"]],
            getattr(norm_landmarks[LANDMARK_INDEX["LEFT_SHOULDER"]], "visibility", 1.0),
        ),
        "elbowL": point(
            world_landmarks[LANDMARK_INDEX["LEFT_ELBOW"]],
            getattr(norm_landmarks[LANDMARK_INDEX["LEFT_ELBOW"]], "visibility", 1.0),
        ),
        "kneeR": point(
            world_landmarks[LANDMARK_INDEX["RIGHT_KNEE"]],
            getattr(norm_landmarks[LANDMARK_INDEX["RIGHT_KNEE"]], "visibility", 1.0),
        ),
        "kneeL": point(
            world_landmarks[LANDMARK_INDEX["LEFT_KNEE"]],
            getattr(norm_landmarks[LANDMARK_INDEX["LEFT_KNEE"]], "visibility", 1.0),
        ),
    }


def mark_missing(raw_frames: List[Dict], visibility_threshold: float):
    series: Dict[str, Dict[str, List[Optional[float]]]] = {
        joint: {axis: [] for axis in ("x", "y", "z")} for joint in JOINT_NAMES
    }
    vis_series: Dict[str, List[float]] = {joint: [] for joint in JOINT_NAMES}
    for frame in raw_frames:
        for joint in JOINT_NAMES:
            sample = frame["joints"][joint]
            visibility = sample["visibility"]
            vis_series[joint].append(visibility)
            for axis in ("x", "y", "z"):
                value = sample[axis]
                series[joint][axis].append(value if visibility >= visibility_threshold else None)
    return series, vis_series


def interpolate(values: List[Optional[float]]) -> List[float]:
    result = list(values)
    valid = [index for index, value in enumerate(result) if value is not None]
    if not valid:
        return [0.0 for _ in result]

    first = valid[0]
    last = valid[-1]
    for index in range(0, first):
        result[index] = result[first]
    for index in range(last + 1, len(result)):
        result[index] = result[last]

    for left, right in zip(valid, valid[1:]):
        left_value = result[left]
        right_value = result[right]
        gap = right - left
        if gap <= 1:
            continue
        for step in range(1, gap):
            alpha = step / gap
            result[left + step] = left_value + (right_value - left_value) * alpha

    return [float(value) for value in result]


def smooth(values: List[float], window: int) -> List[float]:
    if window <= 1:
        return list(values)
    radius = window // 2
    smoothed = []
    for index in range(len(values)):
        lo = max(0, index - radius)
        hi = min(len(values), index + radius + 1)
        chunk = values[lo:hi]
        smoothed.append(sum(chunk) / len(chunk))
    return smoothed


def clean_frames(raw_frames: List[Dict], visibility_threshold: float, smooth_window: int) -> List[Dict]:
    series, vis_series = mark_missing(raw_frames, visibility_threshold)
    cleaned_axes: Dict[str, Dict[str, List[float]]] = {joint: {} for joint in JOINT_NAMES}
    for joint in JOINT_NAMES:
        for axis in ("x", "y", "z"):
            cleaned_axes[joint][axis] = smooth(interpolate(series[joint][axis]), smooth_window)

    cleaned = []
    for index, raw in enumerate(raw_frames):
        joints = {}
        for joint in JOINT_NAMES:
            joints[joint] = {
                "x": cleaned_axes[joint]["x"][index],
                "y": cleaned_axes[joint]["y"][index],
                "z": cleaned_axes[joint]["z"][index],
                "visibility": vis_series[joint][index],
            }
        cleaned.append({
            "index": raw["index"],
            "sourceFrame": raw["sourceFrame"],
            "joints": joints,
        })
    return cleaned


def strip_visibility(cleaned_frames: List[Dict]) -> List[Dict]:
    output = []
    for frame in cleaned_frames:
        joints = {}
        for joint in JOINT_NAMES:
            sample = frame["joints"][joint]
            joints[joint] = {
                "x": round(sample["x"], 6),
                "y": round(sample["y"], 6),
                "z": round(sample["z"], 6),
            }
        output.append({"index": frame["index"], "joints": joints})
    return output


def suggest_contact_frame(cleaned_frames: List[Dict]) -> int:
    best_index = 0
    best_score = -math.inf
    for frame in cleaned_frames:
        wrist = frame["joints"]["wristR"]
        shoulder = frame["joints"]["shoulderR"]
        hips = frame["joints"]["hips"]
        score = (hips["y"] - wrist["y"]) + abs(wrist["x"] - shoulder["x"]) * 0.35
        if score > best_score:
            best_score = score
            best_index = frame["index"]
    return best_index


def main():
    parser = build_parser()
    args = parser.parse_args()

    if args.frame_step <= 0:
        raise SystemExit("--frame-step must be >= 1")
    if args.smooth_window <= 0:
        raise SystemExit("--smooth-window must be >= 1")

    cv2, mp, base_options_module, pose_landmarker, running_mode_module = lazy_imports()
    input_path = Path(args.input).resolve()
    if not input_path.exists():
        raise SystemExit(f"Input video not found: {input_path}")

    output_path = Path(args.output).resolve() if args.output else input_path.with_suffix("")
    if not args.output:
        output_path = output_path.parent / f"{output_path.name}.cleaned.json"

    cap = cv2.VideoCapture(str(input_path))
    if not cap.isOpened():
        raise SystemExit(f"Failed to open video: {input_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

    model_path = ensure_model_asset()
    options = pose_landmarker.PoseLandmarkerOptions(
        base_options=base_options_module.BaseOptions(model_asset_path=str(model_path)),
        running_mode=running_mode_module.VisionTaskRunningMode.IMAGE,
        num_poses=1,
        min_pose_detection_confidence=args.min_detection_confidence,
        min_pose_presence_confidence=args.min_detection_confidence,
        min_tracking_confidence=args.min_tracking_confidence,
        output_segmentation_masks=False,
    )
    pose = pose_landmarker.PoseLandmarker.create_from_options(options)

    raw_frames: List[Dict] = []
    source_index = 0
    kept_index = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if source_index % args.frame_step != 0:
            source_index += 1
            continue

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = pose.detect(mp_image)
        if result.pose_landmarks and result.pose_world_landmarks:
            joints = extract_joint_map(result.pose_landmarks[0], result.pose_world_landmarks[0])
            raw_frames.append({"index": kept_index, "sourceFrame": source_index, "joints": joints})
            kept_index += 1
        source_index += 1

    pose.close()
    cap.release()

    if len(raw_frames) < 2:
        raise SystemExit(
            "Pose extraction produced fewer than 2 usable frames. Try a clearer clip or a lower visibility threshold."
        )

    cleaned_frames = clean_frames(raw_frames, args.visibility_threshold, args.smooth_window)
    output_frames = strip_visibility(cleaned_frames)
    contact_frame = suggest_contact_frame(cleaned_frames)

    payload = {
        "source": args.name or input_path.name,
        "fps": round(fps / args.frame_step if fps else 0.0, 3),
        "frameStep": args.frame_step,
        "sourceFps": round(fps, 3),
        "resolution": {"width": width, "height": height},
        "sourceFrameCount": total_frames,
        "keptFrameCount": len(output_frames),
        "suggestedContactFrame": contact_frame,
        "frames": output_frames,
        "notes": [
            "Output is compatible with scripts/mocap/extract-serve-keyframes.mjs.",
            "Review and trim manually before treating this as a final cleaned track.",
        ],
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote cleaned joint track: {output_path}")
    print(f"Suggested contact frame: {contact_frame}")
    print(f"Processed frames: {len(output_frames)} / {total_frames}")


if __name__ == "__main__":
    main()