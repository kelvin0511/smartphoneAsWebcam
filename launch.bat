@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   PhoneCam - Starting Wireless Smartphone Webcam...
echo ============================================================

where uv >nul 2>nul
if %errorlevel% neq 0 (
    echo [PhoneCam] Installing uv package manager (first-time setup)...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
    set "PATH=%USERPROFILE%\.local\bin;%USERPROFILE%\.cargo\bin;%PATH%"
)

where uv >nul 2>nul
if %errorlevel% neq 0 (
    echo [PhoneCam] Could not find uv. Trying python directly...
    python -m phonecam %*
    goto :done
)

uv run phonecam %*

:done
if %errorlevel% neq 0 (
    echo.
    echo [PhoneCam] Exited with error code %errorlevel%.
    pause
)
