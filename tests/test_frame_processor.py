import numpy as np

from phonecam.frame_processor import FrameTransform, create_privacy_frame, process_rgb_frame


def test_privacy_frame_shape_and_dtype():
    frame = create_privacy_frame(1280, 720)
    assert frame.shape == (720, 1280, 3)
    assert frame.dtype == np.uint8


def test_process_rgb_frame_rotation_and_mirror():
    # 4x6 RGB frame with a distinct top-left red pixel
    src = np.zeros((4, 6, 3), dtype=np.uint8)
    src[0, 0] = (255, 0, 0)

    mirrored = process_rgb_frame(src, 6, 4, FrameTransform(rotation=0, mirror=True))
    assert mirrored.shape == (4, 6, 3)
    assert tuple(mirrored[0, 5]) == (255, 0, 0)

    rot90 = process_rgb_frame(src, 4, 6, FrameTransform(rotation=90, mirror=False))
    assert rot90.shape == (6, 4, 3)
    assert tuple(rot90[0, 3]) == (255, 0, 0)


def test_process_rgb_frame_letterbox_resize():
    src = np.full((480, 640, 3), 120, dtype=np.uint8)
    out = process_rgb_frame(src, 1280, 720, FrameTransform())
    assert out.shape == (720, 1280, 3)
    assert out.dtype == np.uint8
