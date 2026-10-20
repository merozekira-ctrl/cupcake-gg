@echo off
title cupcake.gg
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js est introuvable. Installe-le depuis https://nodejs.org puis relance ce fichier. & pause & exit /b 1)
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"
node server.js
pause
