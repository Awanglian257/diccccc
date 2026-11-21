@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "server\.env" copy "server\.env.example" "server\.env" >nul
echo 请在记事本里填写DEEPSEEK_API_KEY，保存后关闭；密钥不需要发给别人。
start /wait notepad.exe "server\.env"
echo 配置已保留。请运行“测试DeepSeek连接.bat”，然后启动健康管家。
pause
