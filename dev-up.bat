@echo off
setlocal
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-up.ps1" -OneClick
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-up.ps1" %*
)
endlocal
