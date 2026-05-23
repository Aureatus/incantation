import numpy as np

from app.leap_device import _merge_preview_images, _merge_projected_landmarks


def test_merge_preview_images_uses_brightest_pixel_from_each_camera() -> None:
    left = np.array([[10, 200], [40, 30]], dtype=np.uint8)
    right = np.array([[25, 150], [90, 255]], dtype=np.uint8)

    merged = _merge_preview_images([left, right])

    assert merged is not None
    assert merged.shape == left.shape
    assert np.array_equal(merged, np.array([[25, 200], [90, 255]], dtype=np.uint8))


def test_merge_projected_landmarks_averages_available_points() -> None:
    merged = _merge_projected_landmarks([{"x": 0.2, "y": 0.3}, {"x": 0.6, "y": 0.7}, None])

    assert merged == {"x": 0.4, "y": 0.5}
