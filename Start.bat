@echo off
cd /d "%~dp0" || exit /b 1

where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js 22 or newer is required: https://nodejs.org/
  pause
  exit /b 1
)

call npm run web
if errorlevel 1 (
  pause
  exit /b 1
)
