@echo off
REM ===========================================================================
REM  Gupta Tours & Travels - development mode
REM  API on http://localhost:4100, website with hot reload on http://localhost:5273
REM ===========================================================================
setlocal
cd /d "%~dp0.."

start "GTT API"      cmd /k "cd /d %~dp0..\backend && npm run dev"
start "GTT Website"  cmd /k "cd /d %~dp0..\frontend && npm run dev"

echo.
echo  Two windows have opened:
echo    - GTT API      http://localhost:4100
echo    - GTT Website  http://localhost:5273   ^<-- open this one
echo.
echo  Close those windows to stop the servers.
echo.
pause
