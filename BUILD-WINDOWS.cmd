@echo off
setlocal
cd /d "%~dp0"
title MOO3D 1.8.11 - Build Windows Installer
if not exist "package.json" goto wrong_folder
where node >nul 2>nul
if errorlevel 1 goto no_node
node -e "if (Number(process.versions.node.split('.')[0]) !== 22) process.exit(1)"
if errorlevel 1 goto no_node
if not "%PROCESSOR_ARCHITECTURE%"=="AMD64" echo Note: this project builds a Windows x64 installer.
echo This builds the program files only. It does NOT reset your business data.
echo Internet access is required. Keep this window open until it finishes.
echo Detailed progress: build-windows.log
call npm ci --no-audit --no-fund > build-windows.log 2>&1
if errorlevel 1 goto failed
call npm test >> build-windows.log 2>&1
if errorlevel 1 goto failed
call npm run rebuild >> build-windows.log 2>&1
if errorlevel 1 goto failed
set ELECTRON_RUN_AS_NODE=1
start /b /wait "" "node_modules\electron\dist\electron.exe" tests\electron-runtime-smoke.cjs >> build-windows.log 2>&1
if errorlevel 1 goto failed
set ELECTRON_RUN_AS_NODE=
call npm run dist:installer >> build-windows.log 2>&1
if errorlevel 1 goto failed
echo.
echo SUCCESS. The installer is in the dist folder. Back up your old data before installing.
start "" "%CD%\dist"
pause
exit /b 0
:no_node
echo Install Node.js 22.x for Windows x64 from the official nodejs.org website.
echo Then close this window and run BUILD-WINDOWS.cmd again.
echo You can also use the GitHub Actions method in START-HERE.html without installing Node.
pause
exit /b 1
:wrong_folder
echo Extract the entire ZIP first, then run this file from inside the extracted project folder.
pause
exit /b 1
:failed
set ELECTRON_RUN_AS_NODE=
echo.
echo Build stopped. Your business data was NOT reset.
echo Open build-windows.log and share the error message for troubleshooting.
if exist "build-windows.log" start notepad "%CD%\build-windows.log"
pause
exit /b 1
