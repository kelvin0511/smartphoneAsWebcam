"""Configuration and runtime state models for PhoneCam."""

import sys
from dataclasses import dataclass, field
from pathlib import Path


def _default_static_dir() -> Path:
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        return Path(meipass) / "static"
    return Path(__file__).resolve().parents[2] / "static"


@dataclass
class PhoneCamConfig:
    """Server and virtual camera configuration."""

    host: str = "0.0.0.0"
    port: int = 8443
    width: int = 1280
    height: int = 720
    fps: int = 30
    mock_cam: bool = False
    cam_backend: str | None = None
    cert_dir: Path = field(default_factory=lambda: Path.home() / ".phonecam" / "certs")
    static_dir: Path = field(default_factory=_default_static_dir)
