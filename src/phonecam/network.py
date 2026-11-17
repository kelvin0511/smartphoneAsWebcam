"""LAN IP detection, session pairing authentication, and QR code helpers."""

from __future__ import annotations

import io
import secrets
import socket
from dataclasses import dataclass

import qrcode
import qrcode.image.svg


def get_lan_ip() -> str:
    """Detect the PC's primary LAN IPv4 address without requiring internet access."""
    for target in ("10.255.255.255", "192.168.255.255", "172.16.0.1"):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect((target, 1))
            ip = sock.getsockname()[0]
            if ip and not ip.startswith("127."):
                return ip
        except OSError:
            continue
        finally:
            sock.close()

    try:
        hostname_ip = socket.gethostbyname(socket.gethostname())
        if hostname_ip and not hostname_ip.startswith("127."):
            return hostname_ip
    except OSError:
        pass

    return "127.0.0.1"


@dataclass
class SessionAuth:
    """Manages the per-session pairing token (QR) and 6-digit backup PIN."""

    token: str
    pin: str

    @classmethod
    def generate(cls) -> SessionAuth:
        token = secrets.token_urlsafe(16)
        pin = f"{secrets.randbelow(1_000_000):06d}"
        return cls(token=token, pin=pin)

    def verify_token(self, candidate: str | None) -> bool:
        if not candidate:
            return False
        return secrets.compare_digest(self.token, candidate.strip())

    def verify_pin(self, candidate: str | None) -> bool:
        if not candidate:
            return False
        return secrets.compare_digest(self.pin, candidate.strip())

    def verify_any(self, token: str | None = None, pin: str | None = None) -> bool:
        return self.verify_token(token) or self.verify_pin(pin)


def build_phone_url(lan_ip: str, port: int, token: str) -> str:
    """Build the HTTPS pairing URL for the phone browser."""
    return f"https://{lan_ip}:{port}/phone?token={token}"


def generate_qr_svg(data: str) -> str:
    """Generate a scalable SVG QR code string for the PC dashboard."""
    factory = qrcode.image.svg.SvgPathImage
    img = qrcode.make(data, image_factory=factory, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue().decode("utf-8")


def generate_qr_ascii(data: str) -> str:
    """Generate a terminal-friendly ASCII QR code string."""
    qr = qrcode.QRCode(border=1)
    qr.add_data(data)
    qr.make(fit=True)
    buf = io.StringIO()
    qr.print_ascii(out=buf, invert=True)
    return buf.getvalue()
