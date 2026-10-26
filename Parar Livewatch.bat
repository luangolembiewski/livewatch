@echo off
title Parar Livewatch
cd /d "%~dp0"

echo.
echo   Procurando o Livewatch na porta 3000...
echo.

set "encontrado="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"TCP.*:3000 .*LISTENING"') do (
  taskkill /pid %%p /f >nul 2>&1
  if not errorlevel 1 (
    echo   Encerrado o processo %%p.
    set "encontrado=1"
  )
)

if not defined encontrado echo   Nada rodando na porta 3000.

echo.
timeout /t 2 >nul
