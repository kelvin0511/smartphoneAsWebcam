(function () {
  const I18N = {
    en: {
      badge: "LAN Wireless Webcam",
      langBtn: "繁體中文",
      step1Title: "1. Connect Your Phone",
      step1Desc: "Scan this QR code with your iPhone or Android camera on the same Wi-Fi network.",
      copy: "Copy",
      copied: "Copied!",
      pinLabel: "Manual Pairing PIN:",
      httpsHint:
        '<strong>First-time HTTPS notice:</strong> Because this runs 100% locally without internet, tap <em>"Advanced → Proceed"</em> (Android Chrome) or <em>"Show Details → Visit this website"</em> (iPhone Safari).',
      step2Title: "2. Virtual Webcam & Stream",
      statRes: "Incoming Resolution",
      statFps: "Live FPS",
      statBitrate: "Bitrate",
      statRtt: "Latency (RTT)",
      statFrames: "Frames Received",
      statTransform: "Transform",
      usageTitle: "Using in Zoom / Discord / OBS",
      usageDesc: (dev) =>
        `Select <strong>${dev}</strong> as your camera input in Zoom, Microsoft Teams, Discord, Google Meet, or OBS Studio.`,
      waiting: "Waiting for phone...",
      connected: "Phone Connected",
      paused: "Connected (Paused)",
      mirrored: "Mirrored",
      activeCam: (name, w, h, fps) => `Active: ${name} (${w}×${h} @ ${fps}fps)`,
      vcamUnavail: "Virtual camera unavailable.",
    },
    "zh-Hant": {
      badge: "區域網路無線攝影機",
      langBtn: "English",
      step1Title: "1. 連接您的手機",
      step1Desc: "請在同一個 Wi-Fi 網路下，使用 iPhone 或 Android 相機掃描此 QR Code。",
      copy: "複製",
      copied: "已複製！",
      pinLabel: "手動配對 PIN 碼：",
      httpsHint:
        "<strong>首次連線 HTTPS 提示：</strong>因本程式完全於區域網路離線執行，手機瀏覽器首次開啟時請點擊<em>「進階 → 繼續前往」</em>（Android Chrome）或<em>「顯示詳細資訊 → 參訪此網站」</em>（iPhone Safari）。",
      step2Title: "2. 虛擬攝影機與串流狀態",
      statRes: "輸入解析度",
      statFps: "即時幀率 (FPS)",
      statBitrate: "位元率",
      statRtt: "網路延遲 (RTT)",
      statFrames: "已接收影格數",
      statTransform: "畫面轉換",
      usageTitle: "在 OBS / Zoom / Discord 中使用",
      usageDesc: (dev) =>
        `請在 OBS Studio（視訊擷取裝置）、Zoom、Microsoft Teams、Discord 或 Google Meet 中選擇 <strong>${dev}</strong> 作為攝影機來源。`,
      waiting: "等待手機連線中...",
      connected: "手機已連線",
      paused: "已連線（已暫停）",
      mirrored: "已鏡像",
      activeCam: (name, w, h, fps) => `運作中：${name} (${w}×${h} @ ${fps}fps)`,
      vcamUnavail: "虛擬攝影機無法使用。",
    },
  };

  function detectLang() {
    const saved = localStorage.getItem("phonecam_lang");
    if (saved && I18N[saved]) return saved;
    const nav = (navigator.language || "").toLowerCase();
    return nav.startsWith("zh") ? "zh-Hant" : "en";
  }

  let currentLang = detectLang();
  let lastStats = null;
  let lastVcam = null;

  const qrContainer = document.getElementById("qr-container");
  const phoneUrlInput = document.getElementById("phone-url");
  const copyBtn = document.getElementById("copy-url-btn");
  const pairingPin = document.getElementById("pairing-pin");
  const vcamBanner = document.getElementById("vcam-banner");
  const connectionPill = document.getElementById("connection-pill");
  const langToggleBtn = document.getElementById("lang-toggle-btn");
  const httpsHint = document.getElementById("https-hint");
  const usageDesc = document.getElementById("usage-desc");

  const statRes = document.getElementById("stat-res");
  const statFps = document.getElementById("stat-fps");
  const statBitrate = document.getElementById("stat-bitrate");
  const statRtt = document.getElementById("stat-rtt");
  const statFrames = document.getElementById("stat-frames");
  const statTransform = document.getElementById("stat-transform");

  function t() {
    return I18N[currentLang];
  }

  function applyTranslations() {
    const dict = t();
    langToggleBtn.textContent = dict.langBtn;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (dict[key]) el.textContent = dict[key];
    });
    httpsHint.innerHTML = dict.httpsHint;
    const devName = (lastVcam && lastVcam.device_name) || "Unity Video Capture";
    usageDesc.innerHTML = dict.usageDesc(devName);
    renderVcamBanner();
    updateStats(lastStats);
  }

  function renderVcamBanner() {
    if (!lastVcam) return;
    const dict = t();
    if (!lastVcam.is_ready) {
      vcamBanner.className = "vcam-banner error";
      vcamBanner.textContent = lastVcam.error_message || dict.vcamUnavail;
    } else if (lastVcam.warning_message) {
      vcamBanner.className = "vcam-banner warn";
      vcamBanner.textContent = lastVcam.warning_message;
    } else {
      vcamBanner.className = "vcam-banner";
      vcamBanner.textContent = dict.activeCam(
        lastVcam.device_name,
        lastVcam.width,
        lastVcam.height,
        lastVcam.fps
      );
    }
  }

  function updateStats(stats) {
    lastStats = stats;
    const dict = t();
    if (!stats) {
      connectionPill.textContent = dict.waiting;
      connectionPill.className = "pill pill-idle";
      return;
    }

    if (stats.connected && stats.paused) {
      connectionPill.textContent = dict.paused;
      connectionPill.className = "pill pill-paused";
    } else if (stats.connected) {
      connectionPill.textContent = dict.connected;
      connectionPill.className = "pill pill-connected";
    } else {
      connectionPill.textContent = dict.waiting;
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
    statTransform.textContent = `${stats.rotation || 0}°${stats.mirror ? ` • ${dict.mirrored}` : ""}`;
  }

  async function loadInfo() {
    try {
      const res = await fetch("/api/info");
      const data = await res.json();
      qrContainer.innerHTML = data.qr_svg;
      phoneUrlInput.value = data.phone_url;
      pairingPin.textContent = data.pin;
      lastVcam = data.virtual_cam;
      lastStats = data.stats;
      applyTranslations();
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

  langToggleBtn.addEventListener("click", () => {
    currentLang = currentLang === "en" ? "zh-Hant" : "en";
    localStorage.setItem("phonecam_lang", currentLang);
    applyTranslations();
  });

  copyBtn.addEventListener("click", async () => {
    if (!phoneUrlInput.value) return;
    await navigator.clipboard.writeText(phoneUrlInput.value);
    copyBtn.textContent = t().copied;
    setTimeout(() => {
      copyBtn.textContent = t().copy;
    }, 1500);
  });

  applyTranslations();
  loadInfo();
  connectDashboardWs();
})();
