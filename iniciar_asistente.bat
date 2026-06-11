@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Asistente de Escritura Academica

echo ============================================
echo   Asistente de Escritura Academica
echo ============================================
echo.

if not exist "node_modules\" (
    echo [1/2] Instalando dependencias...
    call npm install
    if errorlevel 1 (
        echo.
        echo Error al instalar dependencias. Verifica que Node.js este instalado.
        pause
        exit /b 1
    )
    echo.
) else (
    echo [1/2] Dependencias OK.
)

echo [2/2] Iniciando servidor en http://localhost:4000 ...
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:4000"
call npm start