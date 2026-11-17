"""WebRTC receiver using aiortc to decode phone video and feed VirtualCameraOutput."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import asdict, dataclass
from typing import Any, Callable

from aiortc import RTCConfiguration, RTCIceCandidate, RTCPeerConnection, RTCSessionDescription
from aiortc.sdp import candidate_from_sdp

from phonecam.frame_processor import FrameTransform, create_privacy_frame, process_rgb_frame
from phonecam.virtual_cam import VirtualCameraOutput

logger = logging.getLogger(__name__)


@dataclass
class StreamStats:
    """Live telemetry shared with the PC dashboard."""

    connected: bool = False
    ice_state: str = "disconnected"
    incoming_width: int = 0
    incoming_height: int = 0
    fps: float = 0.0
    frames_received: int = 0
    paused: bool = False
    mirror: bool = False
    rotation: int = 0
    bitrate_kbps: float = 0.0
    rtt_ms: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class WebRTCReceiver:
    """Manages the active phone RTCPeerConnection and video frame pipeline."""

    def __init__(
        self,
        virtual_cam: VirtualCameraOutput,
        on_stats_update: Callable[[dict[str, Any]], Any] | None = None,
    ) -> None:
        self.virtual_cam = virtual_cam
        self.on_stats_update = on_stats_update
        self.transform = FrameTransform()
        self.stats = StreamStats()
        self._pc: RTCPeerConnection | None = None
        self._consume_task: asyncio.Task[None] | None = None
        self._privacy_frame = create_privacy_frame(virtual_cam.width, virtual_cam.height)

    async def handle_offer(self, sdp: str, sdp_type: str = "offer") -> dict[str, str]:
        """Accept an SDP offer from the phone and return an SDP answer."""
        await self.close_peer()

        # LAN-only host candidates: no external STUN/TURN servers needed
        pc = RTCPeerConnection(configuration=RTCConfiguration(iceServers=[]))
        self._pc = pc

        @pc.on("connectionstatechange")
        async def on_connectionstatechange() -> None:
            state = pc.connectionState
            self.stats.ice_state = state
            self.stats.connected = state == "connected"
            logger.info("WebRTC connection state: %s", state)
            self._emit_stats()
            if state in ("failed", "closed", "disconnected"):
                if state == "failed":
                    await self.close_peer()

        @pc.on("track")
        def on_track(track: Any) -> None:
            logger.info("Received media track: kind=%s", track.kind)
            if track.kind == "video":
                if self._consume_task and not self._consume_task.done():
                    self._consume_task.cancel()
                self._consume_task = asyncio.create_task(self._consume_video(track))

        offer = RTCSessionDescription(sdp=sdp, type=sdp_type)
        await pc.setRemoteDescription(offer)
        answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)

        return {
            "sdp": pc.localDescription.sdp,
            "type": pc.localDescription.type,
        }

    async def handle_ice_candidate(self, candidate_payload: dict[str, Any] | None) -> None:
        """Add a trickle ICE candidate from the phone."""
        if not self._pc or not candidate_payload:
            return
        cand_str = candidate_payload.get("candidate")
        if not cand_str:
            return
        try:
            # Browser candidate strings start with "candidate:"
            raw = cand_str.split(":", 1)[1] if cand_str.startswith("candidate:") else cand_str
            ice_cand: RTCIceCandidate = candidate_from_sdp(raw)
            ice_cand.sdpMid = candidate_payload.get("sdpMid")
            ice_cand.sdpMLineIndex = candidate_payload.get("sdpMLineIndex")
            await self._pc.addIceCandidate(ice_cand)
        except Exception as exc:
            logger.debug("Ignoring ICE candidate (%s): %s", cand_str, exc)

    def update_transform(
        self,
        *,
        rotation: int | None = None,
        mirror: bool | None = None,
        paused: bool | None = None,
    ) -> None:
        """Update frame transformation settings from phone control messages."""
        if rotation is not None:
            self.transform.rotation = int(rotation) % 360
            self.stats.rotation = self.transform.rotation
        if mirror is not None:
            self.transform.mirror = bool(mirror)
            self.stats.mirror = self.transform.mirror
        if paused is not None:
            self.transform.paused = bool(paused)
            self.stats.paused = self.transform.paused
            if self.transform.paused:
                self.virtual_cam.send_frame(self._privacy_frame)
        self._emit_stats()

    def update_phone_stats(self, bitrate_kbps: float = 0.0, rtt_ms: float = 0.0) -> None:
        """Store client-reported outbound bitrate and RTT."""
        self.stats.bitrate_kbps = round(float(bitrate_kbps), 1)
        self.stats.rtt_ms = round(float(rtt_ms), 1)
        self._emit_stats()

    async def _consume_video(self, track: Any) -> None:
        """Continuously read frames from the WebRTC video track and push to virtual cam."""
        window_start = time.monotonic()
        window_frames = 0

        try:
            while True:
                av_frame = await track.recv()
                self.stats.frames_received += 1
                window_frames += 1

                if self.transform.paused:
                    self.virtual_cam.send_frame(self._privacy_frame)
                else:
                    rgb = av_frame.to_ndarray(format="rgb24")
                    self.stats.incoming_height, self.stats.incoming_width = rgb.shape[:2]
                    processed = process_rgb_frame(
                        rgb,
                        target_width=self.virtual_cam.width,
                        target_height=self.virtual_cam.height,
                        transform=self.transform,
                    )
                    self.virtual_cam.send_frame(processed)

                now = time.monotonic()
                elapsed = now - window_start
                if elapsed >= 1.0:
                    self.stats.fps = round(window_frames / elapsed, 1)
                    window_start = now
                    window_frames = 0
                    self._emit_stats()
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            logger.info("Video track ended: %s", exc)
        finally:
            self.stats.fps = 0.0
            self._emit_stats()

    def _emit_stats(self) -> None:
        if self.on_stats_update:
            try:
                self.on_stats_update(self.stats.to_dict())
            except Exception:
                pass

    async def close_peer(self) -> None:
        """Close any active peer connection and reset stream connection state."""
        if self._consume_task and not self._consume_task.done():
            self._consume_task.cancel()
            try:
                await self._consume_task
            except asyncio.CancelledError:
                pass
            self._consume_task = None

        if self._pc is not None:
            try:
                await self._pc.close()
            except Exception:
                pass
            self._pc = None

        self.stats.connected = False
        self.stats.ice_state = "disconnected"
        self.stats.fps = 0.0
        self._emit_stats()
