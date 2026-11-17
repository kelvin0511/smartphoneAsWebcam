"""Self-signed TLS certificate management for local HTTPS on LAN."""

from __future__ import annotations

import datetime
import ipaddress
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def _cert_matches_ip_and_valid(cert_path: Path, lan_ip: str) -> bool:
    """Check if an existing cert is valid and includes localhost, 127.0.0.1, and lan_ip."""
    if not cert_path.exists():
        return False
    try:
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        now = datetime.datetime.now(datetime.timezone.utc)
        if cert.not_valid_after_utc < now + datetime.timedelta(days=7):
            return False
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        dns_names = set(san.get_values_for_type(x509.DNSName))
        ip_addrs = {str(ip) for ip in san.get_values_for_type(x509.IPAddress)}
        return (
            "localhost" in dns_names
            and "127.0.0.1" in ip_addrs
            and lan_ip in ip_addrs
        )
    except Exception:
        return False


def ensure_certificates(cert_dir: Path, lan_ip: str) -> tuple[Path, Path]:
    """Ensure a valid self-signed cert & key exist for localhost and the given LAN IP."""
    cert_dir.mkdir(parents=True, exist_ok=True)
    cert_path = cert_dir / "phonecam.crt"
    key_path = cert_dir / "phonecam.key"

    if key_path.exists() and _cert_matches_ip_and_valid(cert_path, lan_ip):
        return cert_path, key_path

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.COMMON_NAME, "PhoneCam Local"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "PhoneCam"),
        ]
    )

    san_entries: list[x509.GeneralName] = [
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
    ]
    try:
        parsed_lan = ipaddress.ip_address(lan_ip)
        if str(parsed_lan) != "127.0.0.1":
            san_entries.append(x509.IPAddress(parsed_lan))
    except ValueError:
        pass

    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(
            x509.SubjectAlternativeName(san_entries),
            critical=False,
        )
        .add_extension(
            x509.BasicConstraints(ca=False, path_length=None),
            critical=True,
        )
        .sign(private_key, hashes.SHA256())
    )

    key_path.write_bytes(
        private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return cert_path, key_path
