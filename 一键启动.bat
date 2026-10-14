@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Please install Node.js first.
  pause
  exit /b 1
)

set DISABLE_BW_OPT=1

echo ============================================
echo   Pocket Spirit - Kou Dai Jing Ling
echo ============================================
echo.
echo   Server:  http://127.0.0.1:6588/index.html
echo   Status:  Starting...
echo.
echo   BW-Opt: disabled by default
echo   Online battle: server-authoritative WebSocket
echo   Keep BW-Opt disabled when testing online battle
echo.
echo ============================================

start "Pocket Spirit Demo Server" cmd /k "cd /d ""%~dp0"" && node server.js"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:6588/index.html"

endlocal
