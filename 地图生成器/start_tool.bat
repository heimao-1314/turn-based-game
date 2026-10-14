@echo off
setlocal
cd /d "%~dp0"
set PORT=8021
start "" "http://[::1]:%PORT%/index.html"
where python >nul 2>nul
if %errorlevel%==0 (
  if exist "..\tools\prepare_image_tile_tool_assets.py" (
    python "..\tools\prepare_image_tile_tool_assets.py"
  )
  python -m http.server %PORT% --bind ::
  exit /b
)
where py >nul 2>nul
if %errorlevel%==0 (
  if exist "..\tools\prepare_image_tile_tool_assets.py" (
    py -3 "..\tools\prepare_image_tile_tool_assets.py"
  )
  py -3 -m http.server %PORT% --bind ::
  exit /b
)
echo Cannot find Python. Please install Python or run another static web server in this folder.
pause
