@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 测试会向DeepSeek发送少量虚构测试文字，可能产生少量API费用；不读取健康记录。
node server\deepseek-check.cjs
pause
