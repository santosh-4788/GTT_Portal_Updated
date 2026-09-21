@echo off
REM ===========================================================================
REM  Gupta Tours & Travels - one-time setup
REM  Installs dependencies, creates the database and loads the starting data.
REM ===========================================================================
setlocal
cd /d "%~dp0.."

echo.
echo  ==========================================================
echo   GUPTA TOURS ^& TRAVELS - Portal Setup
echo  ==========================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js was not found on this machine.
  echo      Install Node.js 20 or later from https://nodejs.org and run this again.
  pause
  exit /b 1
)

echo  [1/4] Installing backend packages...
cd backend
call npm install --no-audit --no-fund
if errorlevel 1 goto :failed

echo.
echo  [2/4] Creating the database...
call npm run migrate
if errorlevel 1 goto :failed

echo.
echo  [3/4] Loading company settings, admin user and sample data...
call npm run seed
if errorlevel 1 goto :failed

echo.
echo  [4/4] Installing and building the website...
cd ..\frontend
call npm install --no-audit --no-fund
if errorlevel 1 goto :failed
call npm run build
if errorlevel 1 goto :failed

cd ..
echo.
echo  ==========================================================
echo   Setup complete.
echo.
echo   Start the portal with:  scripts\start.bat
echo   Then open:              http://localhost:4100
echo.
echo   Login ID : Admin@gmail.com
echo   Password : Pass@123   (you must change it at first sign-in)
echo  ==========================================================
echo.
pause
exit /b 0

:failed
echo.
echo  [X] Setup failed. Read the message above for the reason.
pause
exit /b 1
