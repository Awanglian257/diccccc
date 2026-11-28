@echo off
cd /d "%~dp0"
xelatex -interaction=nonstopmode -halt-on-error paper.tex
if errorlevel 1 exit /b 1
xelatex -interaction=nonstopmode -halt-on-error paper.tex
if errorlevel 1 exit /b 1
copy /Y paper.pdf 论文_最终提交版_承诺页待手签.pdf
