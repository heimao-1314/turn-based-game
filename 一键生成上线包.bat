@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Please install Node.js first.
  pause
  exit /b 1
)

if not exist node_modules\@yao-pkg\pkg (
  echo Installing build dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Building release package for this project...
call npm.cmd run build:release
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

echo.
echo Release package generated: %~dp0dist-public
echo Upload or run files from dist-public only.
echo.
pause
endlocal
