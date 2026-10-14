@echo off
setlocal

echo Stopping Pocket Spirit demo server on port 6588...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$pids = Get-NetTCPConnection -LocalPort 6588 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if (-not $pids) { Write-Host 'No service is listening on port 6588.'; exit 0 }; foreach ($pidValue in $pids) { if ($pidValue -and $pidValue -ne 0) { Stop-Process -Id $pidValue -Force; Write-Host ('Stopped process ' + $pidValue) } }"

pause
endlocal
