@echo off
title Metropole Livewatch
cd /d "%~dp0"

echo.
echo   METROPOLE LIVEWATCH
echo   -------------------
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   Node nao encontrado. Instale em https://nodejs.org e rode de novo.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo   Primeira execucao: instalando dependencias...
  echo.
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo   Falha no npm install. Confira sua conexao e tente de novo.
    pause
    exit /b 1
  )
  echo.
)

if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo   Criei o arquivo .env a partir do exemplo.
  echo   Abra ele e preencha as chaves da Twitch para os canais aparecerem online.
  echo.
)

echo   Abrindo o painel no navegador...
start "" /b cmd /c "timeout /t 3 >nul & start "" http://localhost:3000"

echo   Para desligar, feche esta janela ou aperte Ctrl+C.
echo.

node server.js

echo.
echo   O servidor parou. Aperte uma tecla para fechar.
pause >nul
