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
          statusBadge.textContent = "Live";
          statusBadge.className = "status-badge live";
          sendTransform();
        } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          statusBadge.textContent = "Disconnected";
          statusBadge.className = "status-badge error";
        }
      };

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
