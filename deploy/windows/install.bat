@echo off
setlocal EnableDelayedExpansion
title Iris Installer

REM ==========================================
REM  Iris Windows Installer
REM
REM  Usage (PowerShell or CMD):
REM    .\install.bat
REM
REM  Steps:
REM    1. Detect install directory
REM    2. Initialize config directory
REM    3. Optionally add iris to system PATH
REM    4. Run onboard wizard
REM ==========================================

REM Auto-detect install directory
set "INSTALL_DIR=%~dp0"
if exist "!INSTALL_DIR!bin\iris.exe" goto :found_install_dir
set "INSTALL_DIR=%~dp0..\.."
:found_install_dir
for %%I in ("!INSTALL_DIR!") do set "INSTALL_DIR=%%~fI"

if defined IRIS_DATA_DIR (
  set "DATA_DIR=!IRIS_DATA_DIR!"
) else (
  set "DATA_DIR=%USERPROFILE%\.iris"
)

set "CONFIG_DIR=!DATA_DIR!\configs"
set "EXAMPLE_DIR=!INSTALL_DIR!\data\configs.example"
set "MAIN_BIN=!INSTALL_DIR!\bin\iris.exe"
set "ONBOARD_BIN=!INSTALL_DIR!\bin\iris-onboard.exe"

if not exist "!MAIN_BIN!" (
  echo [ERROR] iris.exe not found: !MAIN_BIN!
  echo [ERROR] Please extract the GitHub Release package first.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   Iris Windows Installer
echo ============================================
echo   Install dir: !INSTALL_DIR!
echo   Data dir:    !DATA_DIR!
echo.

REM --- Initialize config ---
if exist "!CONFIG_DIR!" (
  echo [OK] Config directory exists. Run "iris onboard" to reconfigure.
) else (
  mkdir "!CONFIG_DIR!" >nul 2>&1
  if exist "!EXAMPLE_DIR!" (
    copy /Y "!EXAMPLE_DIR!\*.yaml" "!CONFIG_DIR!\" >nul
    echo [OK] Default config templates initialized.
  ) else (
    echo [WARN] Config template directory not found: !EXAMPLE_DIR!
  )
)

REM --- Add to PATH ---
echo.
echo ============================================
echo   Add iris to system PATH?
echo   Directory: !INSTALL_DIR!\bin
echo ============================================
echo.

set /p "ADD_PATH=Add to PATH? [Y/n]: "
if /I "!ADD_PATH!"=="n" goto :skip_path

REM Check if already in PATH
echo !PATH! | findstr /I /C:"!INSTALL_DIR!\bin" >nul 2>&1
if !ERRORLEVEL!==0 (
  echo [OK] Already in PATH.
  goto :after_path
)

REM Write to user-level PATH (no admin required)
set "USER_PATH="
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USER_PATH=%%B"
if not defined USER_PATH (
  setx PATH "!INSTALL_DIR!\bin" >nul 2>&1
) else (
  setx PATH "!USER_PATH!;!INSTALL_DIR!\bin" >nul 2>&1
)

if !ERRORLEVEL!==0 (
  echo [OK] Added to PATH. Reopen your terminal to use "iris" globally.
) else (
  echo [WARN] Failed. Please add this directory to PATH manually:
  echo        !INSTALL_DIR!\bin
)
goto :after_path

:skip_path
echo [SKIP] You can add !INSTALL_DIR!\bin to PATH later.

:after_path

REM --- Run onboard wizard ---
echo.
echo -- Starting onboard wizard --
echo.
set "IRIS_DATA_DIR=!DATA_DIR!"
if exist "!ONBOARD_BIN!" (
  "!ONBOARD_BIN!"
) else (
  echo [WARN] iris-onboard.exe not found. You can edit configs manually at !CONFIG_DIR!
)

echo.
echo ============================================
echo   Done. Run "iris start" / "iris onboard"
echo ============================================
echo.
pause
exit /b 0
