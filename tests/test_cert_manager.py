from cryptography import x509

from phonecam.cert_manager import ensure_certificates


def test_cert_generation_and_sans(tmp_path):
    cert_path, key_path = ensure_certificates(tmp_path, "192.168.1.42")
    assert cert_path.exists()
    assert key_path.exists()

    cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
    san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    dns_names = set(san.get_values_for_type(x509.DNSName))
    ip_addrs = {str(ip) for ip in san.get_values_for_type(x509.IPAddress)}

    assert "localhost" in dns_names
    assert "127.0.0.1" in ip_addrs
    assert "192.168.1.42" in ip_addrs


def test_cert_reused_for_same_ip_and_regenerated_on_ip_change(tmp_path):
    cert1, _ = ensure_certificates(tmp_path, "192.168.1.42")
    bytes1 = cert1.read_bytes()

    cert2, _ = ensure_certificates(tmp_path, "192.168.1.42")
    assert cert2.read_bytes() == bytes1

    cert3, _ = ensure_certificates(tmp_path, "192.168.1.99")
    bytes3 = cert3.read_bytes()
    assert bytes3 != bytes1

    cert = x509.load_pem_x509_certificate(bytes3)
    san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    ip_addrs = {str(ip) for ip in san.get_values_for_type(x509.IPAddress)}
    assert "192.168.1.99" in ip_addrs
