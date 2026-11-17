(function () {
  const pinScreen = document.getElementById("pin-screen");
  const cameraScreen = document.getElementById("camera-screen");
  const pinInput = document.getElementById("pin-input");
  const pinSubmitBtn = document.getElementById("pin-submit-btn");
  const pinError = document.getElementById("pin-error");

  const videoEl = document.getElementById("preview");
  const videoStage = document.getElementById("video-stage");
  const focusRing = document.getElementById("focus-ring");
  const pausedOverlay = document.getElementById("paused-overlay");
  const statusBadge = document.getElementById("status-badge");
  const statsHud = document.getElementById("stats-hud");
  const toastEl = document.getElementById("toast");

  const qualitySelect = document.getElementById("quality-select");
  const flipCamBtn = document.getElementById("flip-cam-btn");
  const rotateBtn = document.getElementById("rotate-btn");
  const mirrorBtn = document.getElementById("mirror-btn");
  const pauseBtn = document.getElementById("pause-btn");
  const dimBtn = document.getElementById("dim-btn");
  const dimOverlay = document.getElementById("dim-overlay");

  let authQuery = "";
  let ws = null;
  let pc = null;
  let localStream = null;
  let facingMode = "environment";
  let rotation = 0;
  let mirror = false;
  let paused = false;
  let wakeLock = null;
  let lastBytesSent = 0;
  let lastStatsTime = 0;
  let statsTimer = null;
  let webrtcFallbackTimer = null;
  let wsFallbackTimer = null;
  let wsFallbackActive = false;
  const fallbackCanvas = document.createElement("canvas");
  const fallbackCtx = fallbackCanvas.getContext("2d");

  function stopWsFallback() {
    wsFallbackActive = false;
    clearTimeout(webrtcFallbackTimer);
    clearInterval(wsFallbackTimer);
    webrtcFallbackTimer = null;
    wsFallbackTimer = null;
  }

  function startWsFallback() {
    if (wsFallbackActive || !ws || ws.readyState !== WebSocket.OPEN) return;
    wsFallbackActive = true;
    clearInterval(statsTimer);
    statusBadge.textContent = "Live (WS)";
    statusBadge.className = "status-badge live";
    showToast("Switched to WebSocket stream (firewall/hotspot safe)");
    sendTransform();

    let sending = false;
    let frameCount = 0;
    let bytesCount = 0;
    let winStart = performance.now();

    const [, , targetFps] = qualitySelect.value.split("x").map(Number);
    const intervalMs = Math.max(16, Math.round(1000 / Math.min(targetFps || 30, 30)));

    wsFallbackTimer = setInterval(() => {
      if (!wsFallbackActive || !ws || ws.readyState !== WebSocket.OPEN) {
        stopWsFallback();
        return;
      }
      if (sending || paused || videoEl.readyState < 2 || videoEl.videoWidth === 0) {
        return;
      }
      if (ws.bufferedAmount > 512 * 1024) {
        return; // Backpressure guard
      }

      fallbackCanvas.width = videoEl.videoWidth;
      fallbackCanvas.height = videoEl.videoHeight;
      fallbackCtx.drawImage(videoEl, 0, 0);
      sending = true;
      fallbackCanvas.toBlob(
        (blob) => {
          sending = false;
          if (!blob || !wsFallbackActive || !ws || ws.readyState !== WebSocket.OPEN) return;
          ws.send(blob);
          frameCount += 1;
          bytesCount += blob.size;

          const now = performance.now();
          const dt = (now - winStart) / 1000;
          if (dt >= 1.0) {
            const fps = Math.round(frameCount / dt);
            const kbps = Math.round((bytesCount * 8) / (dt * 1000));
            statsHud.textContent = `${videoEl.videoHeight}p ${fps} fps • ${kbps} kbps`;
            frameCount = 0;
            bytesCount = 0;
            winStart = now;
          }
        },
        "image/jpeg",
        0.8
      );
    }, intervalMs);
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove("hidden");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toastEl.classList.add("hidden"), 2200);
  }

  function applyPreviewTransform() {
    const parts = [];
    if (mirror) parts.push("scaleX(-1)");
    if (rotation !== 0) parts.push(`rotate(${rotation}deg)`);
    videoEl.style.transform = parts.join(" ");
  }

  function sendSignal(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  function sendTransform() {
    sendSignal({
      type: "transform",
      rotation,
      mirror,
      paused,
    });
  }

  async function requestWakeLock() {
    if ("wakeLock" in navigator) {
      try {
        wakeLock = await navigator.wakeLock.request("screen");
      } catch (_err) {
        // Ignore if battery saver / browser denies wake lock
      }
    }
  }

  function getSelectedConstraints() {
    const [w, h, fps] = qualitySelect.value.split("x").map(Number);
    return {
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: w },
        height: { ideal: h },
        frameRate: { ideal: fps },
      },
      audio: false,
    };
  }

  async function acquireCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera API unavailable. Ensure you opened this page over HTTPS.");
    }
    const newStream = await navigator.mediaDevices.getUserMedia(getSelectedConstraints());
    const newTrack = newStream.getVideoTracks()[0];

    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
    localStream = newStream;
    videoEl.srcObject = localStream;

    if (pc) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender) {
        await sender.replaceTrack(newTrack);
      }
    }
    return newTrack;
  }

  async function startWebRTC() {
    stopWsFallback();
    statusBadge.textContent = "Connecting...";
    statusBadge.className = "status-badge";

    const track = await acquireCamera();

    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws/signal?${authQuery}`);

    ws.onopen = async () => {
      pc = new RTCPeerConnection({ iceServers: [] });
      pc.addTrack(track, localStream);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal({ type: "ice", candidate: event.candidate.toJSON() });
        }
      };

      pc.onconnectionstatechange = () => {
        if (!pc) return;
        if (pc.connectionState === "connected") {
          stopWsFallback();
          statusBadge.textContent = "Live";
          statusBadge.className = "status-badge live";
          sendTransform();
        } else if (pc.connectionState === "failed") {
          startWsFallback();
        } else if (pc.connectionState === "disconnected" && !wsFallbackActive) {
          statusBadge.textContent = "Disconnected";
          statusBadge.className = "status-badge error";
        }
      };

      // If WebRTC UDP ICE cannot connect within 3.5s (e.g., iPhone Hotspot mDNS or Windows Firewall),
      // automatically switch to binary WebSocket frame streaming over the open WSS connection.
      webrtcFallbackTimer = setTimeout(() => {
        if (pc && pc.connectionState !== "connected" && !wsFallbackActive) {
          startWsFallback();
        }
      }, 3500);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal({
        type: "offer",
        sdp: pc.localDescription.sdp,
        sdpType: pc.localDescription.type,
      });

      startStatsLoop();
    };

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "answer" && pc) {
        await pc.setRemoteDescription(new RTCSessionDescription({ sdp: msg.sdp, type: msg.sdpType }));
      }
    };

    ws.onclose = (event) => {
      clearInterval(statsTimer);
      stopWsFallback();
      if (event.code === 4401) {
        statusBadge.textContent = "Invalid Token / PIN";
        statusBadge.className = "status-badge error";
      } else {
        statusBadge.textContent = "Reconnecting...";
        statusBadge.className = "status-badge";
        setTimeout(() => {
          if (pc) {
            pc.close();
            pc = null;
          }
          startWebRTC().catch(console.error);
        }, 2000);
      }
    };
  }

  function startStatsLoop() {
    clearInterval(statsTimer);
    lastBytesSent = 0;
    lastStatsTime = performance.now();

    statsTimer = setInterval(async () => {
      if (!pc) return;
      try {
        const report = await pc.getStats();
        let fps = 0;
        let width = 0;
        let height = 0;
        let bitrateKbps = 0;
        let rttMs = 0;

        report.forEach((stat) => {
          if (stat.type === "outbound-rtp" && stat.kind === "video") {
            fps = stat.framesPerSecond || 0;
            width = stat.frameWidth || 0;
            height = stat.frameHeight || 0;
            const now = performance.now();
            const dt = (now - lastStatsTime) / 1000;
            if (lastBytesSent > 0 && dt > 0) {
              bitrateKbps = ((stat.bytesSent - lastBytesSent) * 8) / (dt * 1000);
            }
            lastBytesSent = stat.bytesSent || 0;
            lastStatsTime = now;
          }
          if (stat.type === "candidate-pair" && stat.state === "succeeded" && stat.currentRoundTripTime != null) {
            rttMs = stat.currentRoundTripTime * 1000;
          }
        });

        const resLabel = width > 0 ? `${height}p ` : "";
        statsHud.textContent = `${resLabel}${Math.round(fps)} fps • ${Math.round(bitrateKbps)} kbps`;
        sendSignal({ type: "stats", bitrateKbps, rttMs });
      } catch (_err) {
        // Ignore transient getStats errors
      }
    }, 1000);
  }

  // Tap-to-focus
  videoStage.addEventListener("click", async (e) => {
    const rect = videoStage.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    focusRing.style.left = `${e.clientX - rect.left}px`;
    focusRing.style.top = `${e.clientY - rect.top}px`;
    focusRing.classList.remove("hidden");
    // Restart CSS animation
    void focusRing.offsetWidth;
    focusRing.classList.remove("hidden");
    setTimeout(() => focusRing.classList.add("hidden"), 650);

    const track = localStream && localStream.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== "function") {
      return;
    }
    const caps = track.getCapabilities();
    if (caps && caps.pointsOfInterest) {
      try {
        await track.applyConstraints({
          advanced: [{ focusMode: "manual", pointsOfInterest: [{ x, y }] }],
        });
        showToast("Focus updated");
      } catch (_err) {
        showToast("Auto-focus active");
      }
    }
  });

  qualitySelect.addEventListener("change", () => {
    acquireCamera().catch((err) => showToast(err.message));
  });

  flipCamBtn.addEventListener("click", () => {
    facingMode = facingMode === "environment" ? "user" : "environment";
    acquireCamera().catch((err) => showToast(err.message));
  });

  rotateBtn.addEventListener("click", () => {
    rotation = (rotation + 90) % 360;
    rotateBtn.textContent = `Rotate ${rotation}°`;
    applyPreviewTransform();
    sendTransform();
  });

  mirrorBtn.addEventListener("click", () => {
    mirror = !mirror;
    mirrorBtn.textContent = `Mirror: ${mirror ? "On" : "Off"}`;
    mirrorBtn.classList.toggle("active", mirror);
    applyPreviewTransform();
    sendTransform();
  });

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? "Resume" : "Pause";
    pauseBtn.classList.toggle("danger", paused);
    pausedOverlay.classList.toggle("hidden", !paused);
    sendTransform();
  });

  dimBtn.addEventListener("click", () => {
    dimOverlay.classList.remove("hidden");
    requestWakeLock();
  });

  dimOverlay.addEventListener("click", () => {
    dimOverlay.classList.add("hidden");
  });

  async function bootWithAuth(query) {
    authQuery = query;
    pinScreen.classList.add("hidden");
    cameraScreen.classList.remove("hidden");
    requestWakeLock();
    try {
      await startWebRTC();
    } catch (err) {
      statusBadge.textContent = "Camera Error";
      statusBadge.className = "status-badge error";
      showToast(err.message);
    }
  }

  pinSubmitBtn.addEventListener("click", async () => {
    const pin = pinInput.value.trim();
    if (!pin) return;
    pinError.classList.add("hidden");
    const res = await fetch("/api/auth/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (res.ok) {
      bootWithAuth(`pin=${encodeURIComponent(pin)}`);
    } else {
      pinError.textContent = "Invalid PIN. Check your PC dashboard.";
      pinError.classList.remove("hidden");
    }
  });

  // Entrypoint
  const params = new URLSearchParams(location.search);
  const token = params.get("token");
  if (token) {
    bootWithAuth(`token=${encodeURIComponent(token)}`);
  } else {
    pinScreen.classList.remove("hidden");
  }
})();
