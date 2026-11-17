from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from phonecam.config import PhoneCamConfig
from phonecam.network import SessionAuth
from phonecam.server import create_app


def _make_client():
    cfg = PhoneCamConfig(mock_cam=True)
    auth = SessionAuth(token="test-token-123", pin="654321")
    app = create_app(cfg, lan_ip="192.168.1.10", auth=auth)
    return TestClient(app)


def test_dashboard_and_phone_routes():
    with _make_client() as client:
        res_dash = client.get("/")
        assert res_dash.status_code == 200
        assert "PhoneCam" in res_dash.text

        res_phone = client.get("/phone")
        assert res_phone.status_code == 200
        assert "PhoneCam" in res_phone.text

        res_info = client.get("/api/info")
        assert res_info.status_code == 200
        data = res_info.json()
        assert data["lan_ip"] == "192.168.1.10"
        assert data["pin"] == "654321"
        assert data["virtual_cam"]["is_ready"] is True


def test_auth_verify_and_websocket_rejection():
    with _make_client() as client:
        assert client.post("/api/auth/verify", json={"pin": "654321"}).status_code == 200
        assert client.post("/api/auth/verify", json={"pin": "000000"}).status_code == 401

        # Invalid token should be rejected
        try:
            with client.websocket_connect("/ws/signal?token=bad"):
                assert False, "Expected WebSocketDisconnect"
        except WebSocketDisconnect as exc:
            assert exc.code == 4401

        # Valid token connects and responds to ping + transform
        with client.websocket_connect("/ws/signal?token=test-token-123") as ws:
            ws.send_json({"type": "ping"})
            assert ws.receive_json() == {"type": "pong"}
            ws.send_json({"type": "transform", "rotation": 90, "mirror": True, "paused": True})


def test_ws_binary_jpeg_fallback():
    import io
    import av
    import numpy as np

    arr = np.zeros((72, 128, 3), dtype=np.uint8)
    buf = io.BytesIO()
    with av.open(buf, "w", format="mjpeg") as container:
        stream = container.add_stream("mjpeg")
        stream.width = 128
        stream.height = 72
        stream.pix_fmt = "yuvj420p"
        frame = av.VideoFrame.from_ndarray(arr, format="rgb24")
        for pkt in stream.encode(frame):
            container.mux(pkt)
        for pkt in stream.encode(None):
            container.mux(pkt)
    jpeg_bytes = buf.getvalue()

    with _make_client() as client:
        with client.websocket_connect("/ws/signal?token=test-token-123") as ws:
            ws.send_bytes(jpeg_bytes)
            ws.send_json({"type": "ping"})
            assert ws.receive_json() == {"type": "pong"}

            info = client.get("/api/info").json()
            assert info["stats"]["frames_received"] >= 1
            assert info["stats"]["ice_state"] == "ws-fallback"
            assert info["stats"]["incoming_width"] == 128
            assert info["stats"]["incoming_height"] == 72

