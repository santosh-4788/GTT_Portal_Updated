@echo off
REM ===========================================================================
REM  Gupta Tours & Travels - back up the database, templates and invoices
REM  Backups are written to  data\backups\backup_<date>_<time>\
REM  Safe to run while the portal is running.
REM ===========================================================================
setlocal
cd /d "%~dp0..\backend"

echo.
echo  Creating backup...
echo.
call npm run backup

echo.
echo  To see all backups:   npx tsx scripts\backup.ts list
echo  To restore one:       npx tsx scripts\backup.ts restore backup_YYYY-MM-DD_HH-MM-SS
echo.
pause
