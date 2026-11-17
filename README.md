# PhoneCam — Wireless Smartphone Webcam (LAN)

Turn any **iPhone (Safari)** or **Android (Chrome)** into a wireless PC webcam over your local Wi-Fi network—no cables and no mobile app installation required.

## Features
- **100% Local & Wireless:** Uses WebRTC over your LAN with an auto-generated self-signed HTTPS certificate.
- **QR Code & PIN Pairing:** Session token embedded in the QR code (plus a 6-digit backup PIN) prevents unauthorized devices on the same Wi-Fi from connecting.
- **Virtual Webcam Output:** Streams directly to **OBS Virtual Camera** or **UnityCapture** on Windows (and `v4l2loopback` / OBS on Linux/macOS) via `pyvirtualcam`.
- **Mobile Camera Controls:**
  - Front / Back camera switch
  - Resolution & FPS selector (`720p`/`1080p`, `30`/`60fps`)
  - Rotate (`0°`/`90°`/`180°`/`270°`) & Mirror toggle
  - Tap-to-focus (on supported mobile browsers)
  - Pause / Privacy mode (displays a clean dark slate frame on PC)
  - Battery-Saver / Dim Screen mode with Screen Wake Lock
  - Live FPS, bitrate, and latency stats

---

## Windows Setup

### 1. Install a Virtual Camera Driver
- **[UnityCapture](https://github.com/schellingb/UnityCapture)** (**Recommended**): Registers a standalone **Unity Video Capture** webcam device on Windows so you can add your phone as a **Video Capture Device** source *inside* OBS Studio (as well as Zoom, Discord, Teams, and Google Meet).
  - Download UnityCapture, extract it, and run `Install\Install.bat` as Administrator.
- **[OBS Studio](https://obsproject.com/)** (Alternative): Includes *OBS Virtual Camera* for Zoom/Discord/Meet, though it cannot be added as a separate input device inside OBS itself.

PhoneCam automatically prefers `unitycapture` on Windows when installed, and falls back to `obs` if not. You can also force a backend with `--backend unitycapture`.

### 2. Install PhoneCam
Using `uv` (recommended) or `pip`:
```bash
cd phonecam
uv sync
```
Or with `pip`:
```bash
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"
```

### 3. Allow Local Network Port in Windows Firewall
Run PowerShell as Administrator if your phone cannot reach the PC's LAN IP:
```powershell
New-NetFirewallRule -DisplayName "PhoneCam HTTPS" -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow -Profile Private
```

---

## Running PhoneCam

```bash
uv run phonecam
```
Or:
```bash
python -m phonecam --width 1280 --height 720 --fps 30
```

1. Open the **PC Dashboard** at `https://localhost:8443` (or scan the QR code printed in your terminal).
2. Scan the QR code with your iPhone or Android camera.
3. **First-time HTTPS prompt:** Because the certificate is self-signed locally, tap **Show Details → Visit this website** (iOS Safari) or **Advanced → Proceed** (Android Chrome).
4. Grant camera permission and select **OBS Virtual Camera** (or your virtual cam device) in Zoom, Discord, Teams, Google Meet, or OBS.

### Testing Without a Virtual Camera Driver
```bash
uv run phonecam --mock-cam
```

---

## Running Tests

```bash
uv run pytest
```
