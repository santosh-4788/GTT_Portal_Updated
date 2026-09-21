@echo off
REM ===========================================================================
REM  Gupta Tours & Travels - start the portal (production mode)
REM  Serves the website and the API together on http://localhost:4100
REM ===========================================================================
setlocal
cd /d "%~dp0..\backend"

if not exist "node_modules" (
  echo  [X] Packages are not installed. Run scripts\setup.bat first.
  pause
  exit /b 1
)

if not exist "..\frontend\dist\index.html" (
  echo  [!] The website has not been built yet. Building it now...
  cd ..\frontend
  call npm run build
  cd ..\backend
)

REM  The API is TypeScript and "npm start" runs the COMPILED copy in dist\.
REM  Skipping this step serves whatever the API looked like the last time
REM  somebody compiled it, which shows up as "That API endpoint does not exist"
REM  on screens the website has since gained. Compiling takes a few seconds.
echo  Building the API...
call npm run build
if errorlevel 1 (
  echo.
  echo  [X] The API did not compile. Fix the errors above and try again.
  pause
  exit /b 1
)

echo.
echo  ==========================================================
echo   GUPTA TOURS ^& TRAVELS - Portal starting
echo   Open http://localhost:4100 in your browser
echo   Press Ctrl+C in this window to stop
echo  ==========================================================
echo.

call npm start
pause
