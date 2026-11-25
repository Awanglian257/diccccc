@echo off
setlocal
cd /d "%~dp0"
python -m unittest -v || exit /b 1
set "run_dir=run_%RANDOM%_%RANDOM%"
python experiments.py --out "%run_dir%\experiments" || exit /b 1
python stress.py --out "%run_dir%\stress-results" || exit /b 1
echo Results saved in %run_dir%
