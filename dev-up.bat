@echo off
setlocal
set "SCRIPT=%~dp0dev-up.ps1"
set "TAIL_ARGS=%~2 %~3 %~4 %~5 %~6 %~7 %~8 %~9"

if "%~1"=="" (
  start "SciAgentDemo Launcher" powershell -NoProfile -NoExit -ExecutionPolicy Bypass -File "%SCRIPT%" -OneClick
  goto :end
)

if /I "%~1"=="test" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Test %TAIL_ARGS%
  goto :end
)

if /I "%~1"=="user" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -SmokeUser -OpenBrowser %TAIL_ARGS%
  goto :end
)

if /I "%~1"=="admin" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -SmokeAdmin -OpenBrowser %TAIL_ARGS%
  goto :end
)

if /I "%~1"=="home" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -OpenHome %TAIL_ARGS%
  goto :end
)

if /I "%~1"=="chat" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -OpenChat %TAIL_ARGS%
  goto :end
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
:end
endlocal
