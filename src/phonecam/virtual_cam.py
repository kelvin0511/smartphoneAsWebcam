"""Virtual webcam output wrapper using pyvirtualcam with a mock fallback."""

from __future__ import annotations

import logging
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)


class VirtualCameraOutput:
    """Outputs RGB24 frames to an OS virtual camera driver or a mock sink."""

    def __init__(
        self,
        width: int = 1280,
        height: int = 720,
        fps: int = 30,
        backend: str | None = None,
        mock: bool = False,
    ) -> None:
        self.width = width
        self.height = height
        self.fps = fps
        self.backend = backend
        self.mock = mock
        self._cam: Any = None
        self.frames_sent: int = 0
        self.error_message: str | None = None
        self.warning_message: str | None = None
        self.device_name: str = "Mock Virtual Camera" if mock else "Uninitialized"

    def open(self) -> None:
        """Initialize the virtual camera device."""
        if self.mock:
            self.device_name = "Mock Virtual Camera (Headless)"
            self.error_message = None
            self.warning_message = None
            logger.info("Opened %s (%dx%d @ %dfps)", self.device_name, self.width, self.height, self.fps)
            return

        try:
            import sys
            import pyvirtualcam

            kwargs: dict[str, Any] = {
                "width": self.width,
                "height": self.height,
                "fps": self.fps,
                "fmt": pyvirtualcam.PixelFormat.RGB,
            }
            if self.backend:
                kwargs["backend"] = self.backend
                self._cam = pyvirtualcam.Camera(**kwargs)
            elif sys.platform == "win32":
                # Prefer UnityCapture on Windows so it appears as a standalone webcam
                # device that can be added as a source inside OBS Studio.
                try:
                    self._cam = pyvirtualcam.Camera(backend="unitycapture", **kwargs)
                except Exception:
                    self._cam = pyvirtualcam.Camera(**kwargs)
            else:
                self._cam = pyvirtualcam.Camera(**kwargs)

            self.device_name = getattr(self._cam, "device", "Virtual Camera")
            self.error_message = None
            if "OBS" in self.device_name and not self.backend:
                self.warning_message = (
                    "Using 'OBS Virtual Camera'. To add your phone as a new webcam source "
                    "inside OBS Studio, install UnityCapture (https://github.com/schellingb/UnityCapture)."
                )
                logger.warning(self.warning_message)
            else:
                self.warning_message = None
            logger.info(
                "Opened virtual camera '%s' (%dx%d @ %dfps)",
                self.device_name,
                self.width,
                self.height,
                self.fps,
            )
        except Exception as exc:
            self._cam = None
            self.device_name = "Unavailable"
            self.error_message = (
                f"Could not open virtual camera ({exc}). "
                "On Windows, install UnityCapture (recommended for OBS input) or OBS Studio."
            )
            logger.warning(self.error_message)

    def send_frame(self, rgb_frame: np.ndarray) -> None:
        """Send an RGB24 frame (height, width, 3) to the virtual camera."""
        if self.mock:
            self.frames_sent += 1
            return

        if self._cam is None:
            return

        self._cam.send(rgb_frame)
        self.frames_sent += 1

    def sleep_until_next_frame(self) -> None:
        """Pace output if running a steady loop."""
        if self._cam is not None:
            self._cam.sleep_until_next_frame()

    def close(self) -> None:
        """Close the virtual camera handle."""
        if self._cam is not None:
            try:
                self._cam.close()
            except Exception:
                pass
            self._cam = None

    @property
    def is_ready(self) -> bool:
        return self.mock or self._cam is not None
