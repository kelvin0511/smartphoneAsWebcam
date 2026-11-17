"""Video frame transformation, aspect-preserving scaling, and privacy slate generation."""

from __future__ import annotations

from dataclasses import dataclass

import av
import numpy as np


@dataclass
class FrameTransform:
    """Real-time transform state controlled by the phone UI."""

    rotation: int = 90  # Clockwise degrees: 0, 90, 180, 270
    mirror: bool = False
    paused: bool = False

    def normalized_rotation(self) -> int:
        return self.rotation % 360


def create_privacy_frame(width: int, height: int) -> np.ndarray:
    """Create a dark slate RGB24 frame used when privacy/pause mode is active."""
    frame = np.full((height, width, 3), fill_value=18, dtype=np.uint8)
    # Subtle centered accent bar to indicate an intentional pause state
    bar_h = max(4, height // 90)
    bar_w = max(40, width // 6)
    y0 = (height - bar_h) // 2
    x0 = (width - bar_w) // 2
    frame[y0 : y0 + bar_h, x0 : x0 + bar_w] = (75, 85, 99)
    return frame


def fit_to_canvas(
    rgb_frame: np.ndarray,
    target_width: int,
    target_height: int,
) -> np.ndarray:
    """Scale an RGB24 frame proportionally and letterbox into target_width x target_height."""
    src_h, src_w = rgb_frame.shape[:2]
    if src_w == target_width and src_h == target_height:
        return rgb_frame

    scale = min(target_width / src_w, target_height / src_h)
    new_w = max(2, int(round(src_w * scale)) & ~1)
    new_h = max(2, int(round(src_h * scale)) & ~1)
    new_w = min(new_w, target_width)
    new_h = min(new_h, target_height)

    av_frame = av.VideoFrame.from_ndarray(rgb_frame, format="rgb24")
    resized = av_frame.reformat(width=new_w, height=new_h, format="rgb24").to_ndarray()

    if new_w == target_width and new_h == target_height:
        return resized

    canvas = np.zeros((target_height, target_width, 3), dtype=np.uint8)
    y_off = (target_height - new_h) // 2
    x_off = (target_width - new_w) // 2
    canvas[y_off : y_off + new_h, x_off : x_off + new_w] = resized
    return canvas


def process_rgb_frame(
    rgb_frame: np.ndarray,
    target_width: int,
    target_height: int,
    transform: FrameTransform,
) -> np.ndarray:
    """Apply rotation, mirroring, and target-canvas fitting to an RGB24 frame."""
    out = rgb_frame

    rot = transform.normalized_rotation()
    if rot == 90:
        out = np.rot90(out, k=-1)
    elif rot == 180:
        out = np.rot90(out, k=2)
    elif rot == 270:
        out = np.rot90(out, k=1)

    if transform.mirror:
        out = np.fliplr(out)

    if not out.flags["C_CONTIGUOUS"]:
        out = np.ascontiguousarray(out)

    return fit_to_canvas(out, target_width, target_height)
