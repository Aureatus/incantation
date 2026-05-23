from __future__ import annotations

import argparse
import importlib
import json
import sys
import warnings
from collections import defaultdict
from pathlib import Path
from typing import cast

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.pose_features import (  # noqa: E402
    extract_pose_features,
    flatten_pose_features,
    mirror_landmarks_horizontally,
)
from app.protocol import Landmark  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train Incantation pose classifier")
    parser.add_argument("input", type=Path, help="Exported capture root directory")
    parser.add_argument("output", type=Path, help="Output model JSON path")
    parser.add_argument("--stride", type=int, default=3, help="Keep every Nth frame")
    parser.add_argument("--min-probability", type=float, default=0.58)
    parser.add_argument("--min-margin", type=float, default=0.12)
    parser.add_argument(
        "--exclude-label",
        action="append",
        default=[],
        help="Capture labels to exclude from training",
    )
    return parser.parse_args()


def iter_capture_documents(root: Path) -> list[dict[str, object]]:
    return [json.loads(path.read_text()) for path in sorted(root.glob("**/*.json"))]


def _coerce_feature_dict(value: object) -> dict[str, float] | None:
    if not isinstance(value, dict):
        return None

    normalized: dict[str, float] = {}
    for key, item in value.items():
        if not isinstance(key, str):
            return None
        if not isinstance(item, int | float):
            return None
        normalized[key] = float(item)
    return normalized


def _coerce_landmarks(value: object) -> list[Landmark]:
    if not isinstance(value, list):
        return []

    landmarks: list[Landmark] = []
    for point in value:
        if not isinstance(point, dict):
            continue
        typed_point = cast(dict[str, object], point)
        raw_x = typed_point.get("x")
        raw_y = typed_point.get("y")
        if not isinstance(raw_x, int | float) or not isinstance(raw_y, int | float):
            continue
        landmarks.append({"x": float(raw_x), "y": float(raw_y)})
    return landmarks


def _feature_rows_from_frame(frame: dict[str, object]) -> list[dict[str, float]]:
    typed_landmarks = _coerce_landmarks(frame.get("landmarks"))
    if not typed_landmarks:
        features = _coerce_feature_dict(frame.get("features"))
        return [features] if features is not None else []

    feature_rows: list[dict[str, float]] = []
    for candidate_landmarks in (
        typed_landmarks,
        mirror_landmarks_horizontally(typed_landmarks),
    ):
        pose_features = extract_pose_features(candidate_landmarks)
        feature_rows.append(flatten_pose_features(candidate_landmarks, pose_features))
    return feature_rows


def load_training_rows(
    root: Path, stride: int, excluded_labels: set[str] | None = None
) -> tuple[list[str], np.ndarray, np.ndarray, list[str]]:
    documents = iter_capture_documents(root)
    rows: list[list[float]] = []
    labels: list[str] = []
    sessions: list[str] = []
    feature_names: list[str] | None = None

    for document in documents:
        label = str(document["label"])
        if excluded_labels and label in excluded_labels:
            continue
        session_id = str(document.get("sessionId", "unknown"))
        frames = document.get("frames", [])
        if not isinstance(frames, list):
            continue
        for index, frame in enumerate(frames):
            if index % max(1, stride) != 0:
                continue
            if not isinstance(frame, dict):
                continue
            typed_frame = cast(dict[str, object], frame)
            if not typed_frame.get("tracking", False):
                continue
            feature_rows = _feature_rows_from_frame(typed_frame)
            if not feature_rows:
                continue
            if feature_names is None:
                feature_names = sorted(str(name) for name in feature_rows[0])
            for features in feature_rows:
                rows.append([float(features[name]) for name in feature_names])
                labels.append(label)
                sessions.append(session_id)

    if feature_names is None or not rows:
        raise ValueError("No capture frames with feature payloads were found")

    return feature_names, np.array(rows, dtype=np.float64), np.array(labels), sessions


def _fallback_validation_split(y: np.ndarray, sessions: list[str]) -> tuple[np.ndarray, set[str]]:
    validation_indices: set[int] = set()
    for label in sorted(set(y)):
        label_indices = [index for index, value in enumerate(y) if value == label]
        if len(label_indices) <= 1:
            continue
        validation_indices.add(label_indices[0])

    if validation_indices:
        train_mask = np.array([index not in validation_indices for index in range(len(sessions))])
        validation_refs = {f"row-{index}" for index in sorted(validation_indices)}
        return train_mask, validation_refs

    return np.ones(len(sessions), dtype=bool), set()


def _select_validation_split(y: np.ndarray, sessions: list[str]) -> tuple[np.ndarray, set[str]]:
    unique_sessions = sorted(set(sessions))
    if not unique_sessions:
        return np.ones(len(sessions), dtype=bool), set()

    all_labels = {str(label) for label in y}
    target_count = max(1, len(unique_sessions) // 5)
    session_to_indices = {
        session: [index for index, value in enumerate(sessions) if value == session]
        for session in unique_sessions
    }
    session_to_labels = {
        session: {str(y[index]) for index in indices}
        for session, indices in session_to_indices.items()
    }
    label_to_sessions: dict[str, set[str]] = {label: set() for label in all_labels}
    for session, labels in session_to_labels.items():
        for label in labels:
            label_to_sessions[label].add(session)

    selected_sessions: set[str] = set()
    uncovered_labels = set(all_labels)

    def can_select(session: str) -> bool:
        for label in session_to_labels[session]:
            if len(label_to_sessions[label] - (selected_sessions | {session})) == 0:
                return False
        return True

    while uncovered_labels:
        candidates = [
            session
            for session in unique_sessions
            if session not in selected_sessions
            and can_select(session)
            and session_to_labels[session] & uncovered_labels
        ]
        if not candidates:
            break
        chosen_session = sorted(
            candidates,
            key=lambda session: (
                -len(session_to_labels[session] & uncovered_labels),
                -len(session_to_indices[session]),
                session,
            ),
        )[0]
        selected_sessions.add(chosen_session)
        uncovered_labels -= session_to_labels[chosen_session]

    for session in unique_sessions:
        if len(selected_sessions) >= target_count:
            break
        if session in selected_sessions or not can_select(session):
            continue
        selected_sessions.add(session)

    if selected_sessions:
        train_mask = np.array([session not in selected_sessions for session in sessions])
        train_labels = {str(label) for label in y[train_mask]} if train_mask.any() else set()
        validation_labels = (
            {str(label) for label in y[~train_mask]} if (~train_mask).any() else set()
        )
        if (
            train_mask.any()
            and (~train_mask).any()
            and train_labels == all_labels
            and validation_labels == all_labels
        ):
            return train_mask, selected_sessions

    return _fallback_validation_split(y, sessions)


def train_model(
    feature_names: list[str], x: np.ndarray, y: np.ndarray, sessions: list[str]
) -> dict[str, object]:
    try:
        sklearn_linear_model = importlib.import_module("sklearn.linear_model")
        sklearn_metrics = importlib.import_module("sklearn.metrics")
    except ImportError as error:  # pragma: no cover - depends on optional group
        raise SystemExit(
            "Training dependencies are missing. Run with `uv sync --group train` first."
        ) from error
    LogisticRegression = sklearn_linear_model.LogisticRegression
    classification_report = sklearn_metrics.classification_report
    confusion_matrix = sklearn_metrics.confusion_matrix

    train_mask, validation_sessions = _select_validation_split(y, sessions)

    mean = x[train_mask].mean(axis=0)
    scale = x[train_mask].std(axis=0)
    scale[scale == 0] = 1.0
    x_train = (x[train_mask] - mean) / scale
    x_val = (x[~train_mask] - mean) / scale if (~train_mask).any() else x_train
    y_train = y[train_mask]
    y_val = y[~train_mask] if (~train_mask).any() else y_train

    model = LogisticRegression(max_iter=2000)
    model.fit(x_train, y_train)

    predictions = model.predict(x_val)
    labels = [str(label) for label in model.classes_]
    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message=".*Recall is ill-defined.*",
            category=UserWarning,
        )
        report = classification_report(
            y_val,
            predictions,
            labels=labels,
            output_dict=True,
        )
    matrix = np.asarray(confusion_matrix(y_val, predictions, labels=labels)).tolist()

    return {
        "feature_schema_version": int(x[0][0]) if feature_names[0] == "schema_version" else 1,
        "feature_names": feature_names,
        "labels": labels,
        "mean": mean.tolist(),
        "scale": scale.tolist(),
        "weights": np.asarray(model.coef_).tolist(),
        "bias": np.asarray(model.intercept_).tolist(),
        "metrics": {
            "classification_report": report,
            "confusion_matrix": matrix,
            "validation_sessions": sorted(validation_sessions),
            "samples_by_label": dict(
                defaultdict(int, ((label, int((y == label).sum())) for label in labels))
            ),
        },
    }


def main() -> None:
    args = parse_args()
    feature_names, x, y, sessions = load_training_rows(
        args.input,
        args.stride,
        excluded_labels={str(label) for label in args.exclude_label},
    )
    artifact = train_model(feature_names, x, y, sessions)
    artifact.update(
        {
            "model_version": args.output.stem,
            "min_probability": args.min_probability,
            "min_margin": args.min_margin,
        }
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, indent=2))


if __name__ == "__main__":
    main()
