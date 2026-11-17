(function () {
  const qrContainer = document.getElementById("qr-container");
  const phoneUrlInput = document.getElementById("phone-url");
  const copyBtn = document.getElementById("copy-url-btn");
  const pairingPin = document.getElementById("pairing-pin");
  const vcamBanner = document.getElementById("vcam-banner");
  const vcamDeviceName = document.getElementById("vcam-device-name");
  const connectionPill = document.getElementById("connection-pill");

  const statRes = document.getElementById("stat-res");
  const statFps = document.getElementById("stat-fps");
  const statBitrate = document.getElementById("stat-bitrate");
  const statRtt = document.getElementById("stat-rtt");
  const statFrames = document.getElementById("stat-frames");
  const statTransform = document.getElementById("stat-transform");

  function updateStats(stats) {
    if (!stats) return;

    if (stats.connected && stats.paused) {
      connectionPill.textContent = "Connected (Paused)";
      connectionPill.className = "pill pill-paused";
    } else if (stats.connected) {
      connectionPill.textContent = "Phone Connected";
      connectionPill.className = "pill pill-connected";
    } else {
      connectionPill.textContent = "Waiting for phone...";
      connectionPill.className = "pill pill-idle";
    }

    statRes.textContent =
      stats.incoming_width > 0
        ? `${stats.incoming_width} × ${stats.incoming_height}`
        : "—";
    statFps.textContent = Number(stats.fps || 0).toFixed(1);
    statBitrate.textContent = `${Math.round(stats.bitrate_kbps || 0)} kbps`;
    statRtt.textContent = `${Math.round(stats.rtt_ms || 0)} ms`;
    statFrames.textContent = String(stats.frames_received || 0);
    statTransform.textContent = `${stats.rotation || 0}°${stats.mirror ? " • Mirrored" : ""}`;
  }

  async function loadInfo() {
    try {
      const res = await fetch("/api/info");
      const data = await res.json();
      qrContainer.innerHTML = data.qr_svg;
      phoneUrlInput.value = data.phone_url;
      pairingPin.textContent = data.pin;

      const vc = data.virtual_cam;
      vcamDeviceName.textContent = vc.device_name || "Virtual Camera";
      if (vc.is_ready) {
        vcamBanner.className = "vcam-banner";
        vcamBanner.textContent = `Active: ${vc.device_name} (${vc.width}×${vc.height} @ ${vc.fps}fps)`;
      } else {
        vcamBanner.className = "vcam-banner error";
        vcamBanner.textContent = vc.error_message || "Virtual camera unavailable.";
      }
      updateStats(data.stats);
    } catch (err) {
      console.error("Failed to load /api/info", err);
    }
  }

  function connectDashboardWs() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws/dashboard`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "stats") {
          updateStats(msg.stats);
        }
      } catch (e) {
        console.error(e);
      }
    };
    ws.onclose = () => {
      setTimeout(connectDashboardWs, 2000);
    };
  }

  copyBtn.addEventListener("click", async () => {
    if (!phoneUrlInput.value) return;
    await navigator.clipboard.writeText(phoneUrlInput.value);
    copyBtn.textContent = "Copied!";
    setTimeout(() => {
      copyBtn.textContent = "Copy";
    }, 1500);
  });

  loadInfo();
  connectDashboardWs();
})();
