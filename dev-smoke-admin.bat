@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\smoke-admin.ps1" -OpenBrowser %*
endlocal
