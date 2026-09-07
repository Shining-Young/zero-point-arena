@echo off
chcp 65001 >nul
title 零点行动
where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。
  echo 请先安装 Node.js 24 或更新版本：https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo 首次启动，正在安装游戏组件……
  call npm install
  if errorlevel 1 (
    echo 安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)
echo 游戏正在启动，浏览器将在几秒后打开……
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:3000'"
call npm run dev
