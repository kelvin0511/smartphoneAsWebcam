"""FastAPI HTTPS server, WebSocket signaling, and PC dashboard endpoints."""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from phonecam.config import PhoneCamConfig
from phonecam.network import SessionAuth, build_phone_url, generate_qr_svg, get_lan_ip
from phonecam.virtual_cam import VirtualCameraOutput
from phonecam.webrtc_receiver import WebRTCReceiver

logger = logging.getLogger(__name__)


class AppState:
    """Shared runtime state attached to FastAPI."""

    def __init__(self, config: PhoneCamConfig, lan_ip: str, auth: SessionAuth) -> None:
        self.config = config
        self.lan_ip = lan_ip
        self.auth = auth
        self.phone_url = build_phone_url(lan_ip, config.port, auth.token)
        self.qr_svg = generate_qr_svg(self.phone_url)
        self.virtual_cam = VirtualCameraOutput(
            width=config.width,
            height=config.height,
            fps=config.fps,
            backend=config.cam_backend,
            mock=config.mock_cam,
        )
        self.dashboard_clients: set[WebSocket] = set()
        self.receiver = WebRTCReceiver(
            virtual_cam=self.virtual_cam,
            on_stats_update=self.schedule_dashboard_broadcast,
        )
        self._loop: asyncio.AbstractEventLoop | None = None

    def schedule_dashboard_broadcast(self, stats: dict[str, Any]) -> None:
        if self._loop and self._loop.is_running() and self.dashboard_clients:
            self._loop.create_task(self.broadcast_dashboard(stats))

    async def broadcast_dashboard(self, stats: dict[str, Any]) -> None:
        payload = json.dumps({"type": "stats", "stats": stats})
        dead: list[WebSocket] = []
        for ws in list(self.dashboard_clients):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.dashboard_clients.discard(ws)


def create_app(
    config: PhoneCamConfig | None = None,
    *,
    lan_ip: str | None = None,
    auth: SessionAuth | None = None,
) -> FastAPI:
    """Create and configure the FastAPI application."""
    cfg = config or PhoneCamConfig()
    resolved_ip = lan_ip or get_lan_ip()
    session_auth = auth or SessionAuth.generate()
    state = AppState(cfg, resolved_ip, session_auth)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        state._loop = asyncio.get_running_loop()
        state.virtual_cam.open()
        yield
        await state.receiver.close_peer()
        state.virtual_cam.close()

    app = FastAPI(title="PhoneCam", lifespan=lifespan)
    app.state.phonecam = state

    static_dir = cfg.static_dir
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    @app.get("/")
    async def dashboard_index() -> FileResponse:
        return FileResponse(static_dir / "dashboard" / "index.html")

    @app.get("/phone")
    async def phone_index() -> FileResponse:
        return FileResponse(static_dir / "phone" / "index.html")

    @app.get("/api/info")
    async def api_info() -> JSONResponse:
        return JSONResponse(
            {
                "lan_ip": state.lan_ip,
                "port": state.config.port,
                "phone_url": state.phone_url,
                "pin": state.auth.pin,
                "qr_svg": state.qr_svg,
                "virtual_cam": {
                    "device_name": state.virtual_cam.device_name,
                    "is_ready": state.virtual_cam.is_ready,
                    "error_message": state.virtual_cam.error_message,
                    "warning_message": state.virtual_cam.warning_message,
                    "width": state.virtual_cam.width,
                    "height": state.virtual_cam.height,
                    "fps": state.virtual_cam.fps,
                },
                "stats": state.receiver.stats.to_dict(),
            }
        )

    @app.post("/api/auth/verify")
    async def verify_auth(payload: dict[str, Any]) -> JSONResponse:
        token = payload.get("token")
        pin = payload.get("pin")
        valid = state.auth.verify_any(token=token, pin=pin)
        return JSONResponse({"valid": valid}, status_code=200 if valid else 401)

    @app.websocket("/ws/dashboard")
    async def ws_dashboard(websocket: WebSocket) -> None:
        await websocket.accept()
        state.dashboard_clients.add(websocket)
        try:
            await websocket.send_text(
                json.dumps({"type": "stats", "stats": state.receiver.stats.to_dict()})
            )
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
        finally:
            state.dashboard_clients.discard(websocket)

    @app.websocket("/ws/signal")
    async def ws_signal(
        websocket: WebSocket,
        token: str | None = Query(default=None),
        pin: str | None = Query(default=None),
    ) -> None:
        if not state.auth.verify_any(token=token, pin=pin):
            await websocket.close(code=4401, reason="Invalid pairing token or PIN")
            return

        await websocket.accept()
        logger.info("Phone signaling WebSocket connected")
        try:
            while True:
                ws_msg = await websocket.receive()
                if ws_msg.get("type") == "websocket.disconnect":
                    break

                if ws_msg.get("bytes") is not None:
                    state.receiver.handle_ws_jpeg_frame(ws_msg["bytes"])
                    continue

                raw = ws_msg.get("text")
                if not raw:
                    continue
                msg = json.loads(raw)
                msg_type = msg.get("type")

                if msg_type == "offer":
                    answer = await state.receiver.handle_offer(
                        sdp=msg["sdp"],
                        sdp_type=msg.get("sdpType", "offer"),
                    )
                    await websocket.send_text(
                        json.dumps({"type": "answer", "sdp": answer["sdp"], "sdpType": answer["type"]})
                    )
                elif msg_type == "ice":
                    await state.receiver.handle_ice_candidate(msg.get("candidate"))
                elif msg_type == "transform":
                    state.receiver.update_transform(
                        rotation=msg.get("rotation"),
                        mirror=msg.get("mirror"),
                        paused=msg.get("paused"),
                    )
                elif msg_type == "stats":
                    state.receiver.update_phone_stats(
                        bitrate_kbps=msg.get("bitrateKbps", 0.0),
                        rtt_ms=msg.get("rttMs", 0.0),
                    )
                elif msg_type == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
        except WebSocketDisconnect:
            logger.info("Phone signaling WebSocket disconnected")
        except Exception as exc:
            logger.warning("Signaling error: %s", exc)
        finally:
            await state.receiver.close_peer()

    return app
