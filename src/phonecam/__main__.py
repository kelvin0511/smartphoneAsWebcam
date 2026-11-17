"""CLI entrypoint for PhoneCam."""

from __future__ import annotations

import argparse
import logging
import uvicorn

from phonecam.cert_manager import ensure_certificates
from phonecam.config import PhoneCamConfig
from phonecam.network import SessionAuth, build_phone_url, generate_qr_ascii, get_lan_ip
from phonecam.server import create_app


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="phonecam",
        description="Use your iPhone or Android phone as a wireless PC webcam over LAN.",
    )
    parser.add_argument("--port", type=int, default=8443, help="HTTPS port (default: 8443)")
    parser.add_argument("--width", type=int, default=1280, help="Virtual cam width (default: 1280)")
    parser.add_argument("--height", type=int, default=720, help="Virtual cam height (default: 720)")
    parser.add_argument("--fps", type=int, default=30, help="Virtual cam FPS (default: 30)")
    parser.add_argument(
        "--backend",
        type=str,
        default=None,
        help="Optional pyvirtualcam backend (e.g., obs, unitycapture, v4l2loopback)",
    )
    parser.add_argument(
        "--mock-cam",
        action="store_true",
        help="Run without an OS virtual camera driver (for testing)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    args = parse_args(argv)

    config = PhoneCamConfig(
        port=args.port,
        width=args.width,
        height=args.height,
        fps=args.fps,
        cam_backend=args.backend,
        mock_cam=args.mock_cam,
    )

    lan_ip = get_lan_ip()
    auth = SessionAuth.generate()
    cert_path, key_path = ensure_certificates(config.cert_dir, lan_ip)
    phone_url = build_phone_url(lan_ip, config.port, auth.token)

    print("\n" + "=" * 60)
    print("  PhoneCam — Wireless Smartphone Webcam")
    print("=" * 60)
    print(f"  PC Dashboard : https://localhost:{config.port}")
    print(f"  Phone URL    : {phone_url}")
    print(f"  Pairing PIN  : {auth.pin}")
    print("=" * 60)
    print("\nScan this QR code with your iPhone or Android camera:\n")
    print(generate_qr_ascii(phone_url))
    print("Note: On first visit, accept the self-signed HTTPS certificate in your phone browser.\n")

    app = create_app(config, lan_ip=lan_ip, auth=auth)
    uvicorn.run(
        app,
        host=config.host,
        port=config.port,
        ssl_certfile=str(cert_path),
        ssl_keyfile=str(key_path),
        log_level="info",
    )


if __name__ == "__main__":
    main()
