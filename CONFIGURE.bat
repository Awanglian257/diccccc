@echo off
cd /d "%~dp0"
if not exist "server\.env" copy "server\.env.example" "server\.env" >nul
start /wait notepad.exe "server\.env"
