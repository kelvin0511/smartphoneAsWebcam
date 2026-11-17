@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo ============================================================
echo   PhoneCam - Starting Wireless Smartphone Webcam...
echo ============================================================
echo.

where uv >nul 2>nul
if %errorlevel% neq 0 (
    if exist "%USERPROFILE%\.local\bin\uv.exe" (
        set "PATH=%USERPROFILE%\.local\bin;%PATH%"
    ) else (
        echo [PhoneCam] Installing uv package manager ^(first-time setup^)...
        powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
        set "PATH=%USERPROFILE%\.local\bin;%USERPROFILE%\.cargo\bin;%PATH%"
    )
)

where uv >nul 2>nul
if %errorlevel% equ 0 (
    echo [PhoneCam] Launching via uv...
    uv run phonecam %*
    goto :done
)

echo [PhoneCam] uv not found. Trying python directly...
set "PYTHONPATH=%~dp0src;%PYTHONPATH%"
python -m phonecam %*

:done
echo.
echo [PhoneCam] Server stopped (exit code %errorlevel%).
pause
