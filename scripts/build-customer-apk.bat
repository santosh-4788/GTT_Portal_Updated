@echo off
REM ===========================================================================
REM  Gupta Tours & Travels - build the CUSTOMER Android app (APK)
REM
REM  The app customers install: book a trip, see their trips, track one,
REM  manage their account. It contains no admin screens.
REM
REM  For the staff app, run scripts\build-apk.bat instead. The two are separate
REM  apps with separate ids, so both can sit on the same phone.
REM ===========================================================================
setlocal

set "TOOLS=E:\AndroidBuild"
set "JAVA_HOME=%TOOLS%\jdk"
set "ANDROID_HOME=%TOOLS%\sdk"
set "ANDROID_SDK_ROOT=%TOOLS%\sdk"
set "GRADLE_USER_HOME=%TOOLS%\gradle"
set "PATH=%TOOLS%\jdk\bin;%PATH%"

if not exist "%JAVA_HOME%\bin\java.exe" (
  echo  [X] No JDK at %JAVA_HOME%
  echo      The Android toolchain is missing. See docs\ANDROID-APP.md.
  pause
  exit /b 1
)

cd /d "%~dp0..\frontend"

echo.
echo  [1/3] Building the customer web bundle...
call npm run build:customer
if errorlevel 1 (
  echo.
  echo  [X] The web build failed. Fix the errors above and try again.
  pause
  exit /b 1
)

echo.
echo  [2/3] Copying it into the customer Android project...
cd customer-app
call npx cap sync android
if errorlevel 1 (
  echo.
  echo  [X] Capacitor sync failed.
  pause
  exit /b 1
)

echo.
echo  [3/3] Building the APK...
cd android
call gradlew.bat assembleDebug --console=plain
if errorlevel 1 (
  echo.
  echo  [X] The Android build failed. The error is above.
  pause
  exit /b 1
)

cd /d "%~dp0.."
if not exist "dist" mkdir "dist"
copy /Y "frontend\customer-app\android\app\build\outputs\apk\debug\app-debug.apk" "dist\GTT-Customer.apk" >nul

echo.
echo  ==========================================================
echo   Done.  dist\GTT-Customer.apk
echo.
echo   Send that file to customers, or put it on the website
echo   as a download. Android asks permission to install from
echo   an unknown source; that is expected outside the Play Store.
echo  ==========================================================
echo.
pause
