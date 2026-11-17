from phonecam.network import (
    SessionAuth,
    build_phone_url,
    generate_qr_ascii,
    generate_qr_svg,
    get_lan_ip,
)


def test_session_auth_verify():
    auth = SessionAuth.generate()
    assert len(auth.pin) == 6
    assert auth.pin.isdigit()
    assert auth.verify_token(auth.token)
    assert auth.verify_pin(auth.pin)
    assert auth.verify_any(token=auth.token)
    assert auth.verify_any(pin=auth.pin)
    assert not auth.verify_any(token="wrong", pin="000000")
    assert not auth.verify_any(token=None, pin=None)


def test_qr_and_url_helpers():
    url = build_phone_url("192.168.1.50", 8443, "abc123")
    assert url == "https://192.168.1.50:8443/phone?token=abc123"

    svg = generate_qr_svg(url)
    assert "<svg" in svg

    ascii_qr = generate_qr_ascii(url)
    assert len(ascii_qr.strip()) > 0


def test_get_lan_ip_returns_string():
    ip = get_lan_ip()
    assert isinstance(ip, str)
    assert len(ip.split(".")) == 4
