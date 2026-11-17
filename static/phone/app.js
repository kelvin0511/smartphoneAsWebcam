(function () {
  const I18N = {
    en: {
      langBtn: "繁中",
      pinPrompt: "Enter the 6-digit pairing PIN shown on your PC dashboard.",
      connectBtn: "Connect",
      invalidPin: "Invalid PIN. Check your PC dashboard.",
      pausedBadge: "Camera Paused (Privacy Mode)",
      flipCam: "Flip Cam",
      rotate: (deg) => `Rotate ${deg}°`,
      mirrorOn: "Mirror: On",
      mirrorOff: "Mirror: Off",
      pause: "Pause",
      resume: "Resume",
      dimScreen: "Dim Screen",
      dimStreaming: "Streaming in Battery-Saver Mode",
      dimWake: "Tap anywhere to wake screen",
      connecting: "Connecting...",
      live: "Live",
      liveWs: "Live (WS)",
      disconnected: "Disconnected",
      reconnecting: "Reconnecting...",
      invalidToken: "Invalid Token / PIN",
      camError: "Camera Error",
      wsFallbackToast: "Switched to WebSocket stream (firewall/hotspot safe)",
      focusUpdated: "Focus updated",
      autoFocusActive: "Auto-focus active",
    },
    "zh-Hant": {
      langBtn: "EN",
      pinPrompt: "請輸入電腦控制台顯示的 6 位數配對 PIN 碼。",
      connectBtn: "連線",
      invalidPin: "PIN 碼無效，請確認電腦控制台上的數字。",
      pausedBadge: "攝影機已暫停（隱私模式）",
      flipCam: "翻轉鏡頭",
      rotate: (deg) => `旋轉 ${deg}°`,
      mirrorOn: "鏡像：開",
      mirrorOff: "鏡像：關",
      pause: "暫停",
      resume: "繼續",
      dimScreen: "省電暗屏",
      dimStreaming: "省電模式串流中",
      dimWake: "點擊螢幕任意處喚醒",
      connecting: "連線中...",
      live: "直播中",
      liveWs: "直播中 (WS)",
      disconnected: "已斷線",
      reconnecting: "重新連線中...",
      invalidToken: "權杖或 PIN 碼無效",
      camError: "相機錯誤",
      wsFallbackToast: "已切換至 WebSocket 串流（防火牆／熱點相容）",
      focusUpdated: "已更新對焦",
      autoFocusActive: "自動對焦運作中",
    },
  };

  function detectLang() {
    const saved = localStorage.getItem("phonecam_lang");
    if (saved && I18N[saved]) return saved;
    const nav = (navigator.language || "").toLowerCase();
    return nav.startsWith("zh") ? "zh-Hant" : "en";
  }

  let currentLang = detectLang();
  function t() {
    return I18N[currentLang];
  }

  const pinScreen = document.getElementById("pin-screen");
  const cameraScreen = document.getElementById("camera-screen");
  const pinInput = document.getElementById("pin-input");
  const pinSubmitBtn = document.getElementById("pin-submit-btn");
  const pinError = document.getElementById("pin-error");
  const pinLangBtn = document.getElementById("pin-lang-btn");
  const camLangBtn = document.getElementById("cam-lang-btn");

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
  let statusKey = "connecting";
  const fallbackCanvas = document.createElement("canvas");
  const fallbackCtx = fallbackCanvas.getContext("2d");

  function setStatus(key, cls = "") {
    statusKey = key;
    statusBadge.textContent = t()[key] || key;
    statusBadge.className = cls ? `status-badge ${cls}` : "status-badge";
  }

  function applyTranslations() {
    const dict = t();
    pinLangBtn.textContent = dict.langBtn;
    camLangBtn.textContent = dict.langBtn;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (dict[key]) el.textContent = dict[key];
    });
    rotateBtn.textContent = dict.rotate(rotation);
    mirrorBtn.textContent = mirror ? dict.mirrorOn : dict.mirrorOff;
    pauseBtn.textContent = paused ? dict.resume : dict.pause;
    statusBadge.textContent = dict[statusKey] || statusBadge.textContent;
  }

  function toggleLang() {
    currentLang = currentLang === "en" ? "zh-Hant" : "en";
    localStorage.setItem("phonecam_lang", currentLang);
    applyTranslations();
  }

  pinLangBtn.addEventListener("click", toggleLang);
  camLangBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleLang();
  });

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
    setStatus("liveWs", "live");
    showToast(t().wsFallbackToast);
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
    setStatus("connecting");

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
          setStatus("live", "live");
          sendTransform();
        } else if (pc.connectionState === "failed") {
          startWsFallback();
        } else if (pc.connectionState === "disconnected" && !wsFallbackActive) {
          setStatus("disconnected", "error");
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
        setStatus("invalidToken", "error");
      } else {
        setStatus("reconnecting");
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
        showToast(t().focusUpdated);
      } catch (_err) {
        showToast(t().autoFocusActive);
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
    rotateBtn.textContent = t().rotate(rotation);
    applyPreviewTransform();
    sendTransform();
  });

  mirrorBtn.addEventListener("click", () => {
    mirror = !mirror;
    mirrorBtn.textContent = mirror ? t().mirrorOn : t().mirrorOff;
    mirrorBtn.classList.toggle("active", mirror);
    applyPreviewTransform();
    sendTransform();
  });

  pauseBtn.addEventListener("click", () => {
    paused = !paused;
    pauseBtn.textContent = paused ? t().resume : t().pause;
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
      setStatus("camError", "error");
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
      pinError.textContent = t().invalidPin;
      pinError.classList.remove("hidden");
    }
  });

  // Entrypoint
  applyTranslations();
  const params = new URLSearchParams(location.search);
  const token = params.get("token");
  if (token) {
    bootWithAuth(`token=${encodeURIComponent(token)}`);
  } else {
    pinScreen.classList.remove("hidden");
  }
})();
