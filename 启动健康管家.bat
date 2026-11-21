@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo 请先安装 Node.js 20.19 或更新版本。
 pause
 exit /b 1
)
echo 启动后请打开 http://127.0.0.1:8787
node server\start.cjs
pause
