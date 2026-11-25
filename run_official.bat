@echo off
setlocal
cd /d "%~dp0"
grader.exe run --solver main.py --problem all --no-open
if errorlevel 1 exit /b 1
echo The new grading report is in the timestamped folder printed above.
