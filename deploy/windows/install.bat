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
REM    3. Optionally add iris to user PATH
REM    4. Run onboard wizard
REM ==========================================

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
echo   Add iris to user PATH?
set "IRIS_BIN_DIR=!INSTALL_DIR!\bin"
echo   Directory: !IRIS_BIN_DIR!
echo ============================================
echo.

set /p "ADD_PATH=Add to PATH? [Y/n]: "
if /I "!ADD_PATH!"=="n" goto :skip_path

REM Write to user-level PATH (no admin required).
REM Use PowerShell/.NET instead of reg query + setx so non-ASCII paths
REM (for example Chinese Windows user names) are not corrupted by CMD code pages,
REM and long PATH values are not truncated by setx.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop'; " ^
  "$bin = [Environment]::GetEnvironmentVariable('IRIS_BIN_DIR', 'Process'); " ^
  "if ([string]::IsNullOrWhiteSpace($bin)) { throw 'IRIS_BIN_DIR is empty' }; " ^
  "$userPath = [Environment]::GetEnvironmentVariable('Path', 'User'); " ^
  "$binNorm = [System.IO.Path]::GetFullPath($bin).TrimEnd('\'); " ^
  "$exists = $false; " ^
  "foreach ($entry in ($userPath -split ';')) { " ^
  "  if ([string]::IsNullOrWhiteSpace($entry)) { continue }; " ^
  "  try { $entryNorm = [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($entry)).TrimEnd('\') } catch { $entryNorm = $entry.Trim().TrimEnd('\') }; " ^
  "  if ($entryNorm -ieq $binNorm) { $exists = $true; break }; " ^
  "}; " ^
  "if ($exists) { exit 10 }; " ^
  "$newPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $bin } else { $userPath.TrimEnd(';') + ';' + $bin }; " ^
  "[Environment]::SetEnvironmentVariable('Path', $newPath, 'User');"

if !ERRORLEVEL!==10 (
  echo [OK] Already in user PATH.
) else if !ERRORLEVEL!==0 (
  echo [OK] Added to user PATH. Reopen your terminal to use "iris" globally.
) else (
  echo [WARN] Failed. Please add this directory to PATH manually:
  echo        !IRIS_BIN_DIR!
)
goto :after_path

:skip_path
echo [SKIP] You can add !IRIS_BIN_DIR! to PATH later.

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
