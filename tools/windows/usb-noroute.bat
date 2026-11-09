@echo off
setlocal
set R=%~dp0
cd /d "%R%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%R%\usb-noroute.ps1"
exit /b 0
