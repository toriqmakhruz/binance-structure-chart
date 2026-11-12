@echo off
title Binance Crypto Structure & Forecasting Chart
echo ==========================================================
echo   Menjalankan Binance Crypto Structure & Forecasting App
echo ==========================================================

:: 1. Jalankan Backend FastAPI di background / window terpisah
echo [1/3] Menjalankan Backend FastAPI (Port 8000)...
start "Backend - FastAPI" cmd /k "cd backend && venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000"

:: 2. Jalankan Frontend Vite
echo [2/3] Menjalankan Frontend Vite (Port 3000)...
start "Frontend - Vite" cmd /k "cd frontend && npm.cmd run dev"

:: 3. Buka browser
echo [3/3] Membuka Web App di browser...
timeout /t 3 >nul
start http://localhost:3000

echo ==========================================================
echo   Aplikasi berhasil dijalankan!
echo   Buka: http://localhost:3000
echo ==========================================================
