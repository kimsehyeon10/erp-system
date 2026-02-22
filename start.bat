@echo off
setlocal EnableExtensions

cd /d "%~dp0" || (echo ERROR: cd failed & pause & exit /b 1)

echo ERP START

where node >nul 2>&1 || (echo ERROR: node not found & pause & exit /b 1)
where npm  >nul 2>&1 || (echo ERROR: npm not found  & pause & exit /b 1)

if not exist "backend\server.js" (echo ERROR: backend\server.js not found & pause & exit /b 1)

pushd "backend" || (echo ERROR: cannot enter backend & pause & exit /b 1)

if not exist "node_modules" (
  echo Installing...
  npm install || (echo ERROR: npm install failed & popd & pause & exit /b 1)
)

echo Starting server...
start "" "http://localhost:5000"
node server.js

echo ERROR: server exited
popd
pause
exit /b 1
