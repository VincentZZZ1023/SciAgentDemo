@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\smoke-user.ps1" -OpenBrowser %*
endlocal
