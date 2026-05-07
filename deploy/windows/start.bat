@echo off
title Iris
setlocal EnableDelayedExpansion

REM Auto-detect install directory
set "INSTALL_DIR=%~dp0"
if exist "!INSTALL_DIR!bin\iris.exe" goto :found_install_dir
set "INSTALL_DIR=%~dp0..\.."
:found_install_dir
for %%I in ("!INSTALL_DIR!\.") do set "INSTALL_DIR=%%~fI"

if defined IRIS_DATA_DIR (
  set "DATA_DIR=!IRIS_DATA_DIR!"
) else (
  set "DATA_DIR=%USERPROFILE%\.iris"
)

set "MAIN_BIN=!INSTALL_DIR!\bin\iris.exe"
if not exist "!MAIN_BIN!" (
  echo [ERROR] iris.exe not found: !MAIN_BIN!
  pause
  exit /b 1
)

set "IRIS_DATA_DIR=!DATA_DIR!"
"!MAIN_BIN!" start
set "EXIT_CODE=!ERRORLEVEL!"

echo.
echo Iris exited with code !EXIT_CODE!
pause
exit /b !EXIT_CODE!
