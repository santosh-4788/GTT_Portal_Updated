@echo off
REM ===========================================================================
REM  Gupta Tours & Travels - build the Android app (APK)
REM
REM  Produces a debug-signed APK that can be copied to a phone and installed
REM  directly. Nothing here needs Android Studio.
REM
REM  The toolchain lives on E: rather than in the usual places under C:\Users,
REM  because C: has very little space free on this machine.
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
echo  [1/3] Building the app's web bundle...
call npm run build:mobile
if errorlevel 1 (
  echo.
  echo  [X] The web build failed. Fix the errors above and try again.
  pause
  exit /b 1
)

echo.
echo  [2/3] Copying it into the Android project...
call npx cap sync android
if errorlevel 1 (
  echo.
  echo  [X] Capacitor sync failed.
  pause
  exit /b 1
)

echo.
echo  [3/3] Building the APK ^(first run downloads Gradle, several minutes^)...
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
copy /Y "frontend\android\app\build\outputs\apk\debug\app-debug.apk" "dist\GTT-Portal.apk" >nul

echo.
echo  ==========================================================
echo   Done.  dist\GTT-Portal.apk
echo.
echo   Copy that file to the phone and open it to install.
echo   Android will ask permission to install from this source.
echo  ==========================================================
echo.
pause
