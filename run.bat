@echo off
setlocal enabledelayedexpansion
title Binance Crypto Structure & Forecasting Chart
echo ==========================================================
echo   Menjalankan Binance Crypto Structure & Forecasting App
echo ==========================================================

:: 1. Cek Python Runtime untuk Backend
cd backend
set PYTHON_CMD=python
if exist "venv\Scripts\python.exe" (
    set PYTHON_CMD=venv\Scripts\python.exe
)
echo [1/3] Menjalankan Backend FastAPI di Port 8000...
start "Backend - FastAPI" cmd /k "%PYTHON_CMD% -m uvicorn app.main:app --host 0.0.0.0 --port 8000"
cd ..

:: 2. Cek Frontend Dependencies
cd frontend
if not exist "node_modules\" (
    echo [2/3] Menginstal dependensi frontend (pertama kali)...
    call npm.cmd install
)
echo [2/3] Menjalankan Frontend Vite di Port 3000...
start "Frontend - Vite" cmd /k "npm.cmd run dev"
cd ..

:: 3. Buka browser
echo [3/3] Membuka Web App di browser...
timeout /t 3 >nul
start http://localhost:3000

echo ==========================================================
echo   Aplikasi berhasil dijalankan!
echo   Frontend : http://localhost:3000
echo   Backend  : http://localhost:8000/docs
echo ==========================================================
pause
