@echo off
setlocal
cd /d "%~dp0"
set "TOOL_ROOT=%~dp0."
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0portable_server.ps1" -Root "%TOOL_ROOT%" -Port 8021
pause
