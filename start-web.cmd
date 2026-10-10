@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run the local Web version.
  pause
  exit /b 1
)

if exist node_modules (
  call npm run build
  if errorlevel 1 (
    echo Web build failed; the server was not started.
    pause
    exit /b 1
  )
) else if not exist dist\index.html (
  echo No built Web app found. Run npm ci once, then start this file again.
  pause
  exit /b 1
)

node scripts\serve-web.mjs
endlocal
