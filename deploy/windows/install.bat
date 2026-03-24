@echo off
chcp 65001 >nul 2>&1
title Iris Installer
setlocal EnableDelayedExpansion

REM ==========================================
REM  Iris Windows 一键安装脚本
REM
REM  流程与 Linux install.sh 统一：
REM    1. 检测/下载便携版 Node.js（若系统已有则跳过）
REM    2. 初始化配置模板
REM    3. 运行 onboard 交互式配置引导（选平台、填 Key）
REM    4. 生成 iris.bat CLI wrapper
REM
REM  用法：双击运行，或在命令行执行 install.bat
REM ==========================================

set "NODE_VERSION=22.16.0"
set "GH_REPO=Lianues/Iris"

REM 项目根目录（deploy\windows 的上两级）
set "INSTALL_DIR=%~dp0..\.."
pushd "%INSTALL_DIR%"
set "INSTALL_DIR=%CD%"
popd

set "NODE_DIR=%INSTALL_DIR%\node"
set "NODE_URL=https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip"
set "BIN_DIR=%INSTALL_DIR%\bin"

REM 将便携版 Node.js 和 bin 目录加入 PATH
set "PATH=%NODE_DIR%;%BIN_DIR%;%PATH%"

echo.
echo ============================================
echo   Iris AI Framework - Installer
echo ============================================
echo.

REM ── 步骤 1: 检测/下载 Node.js ──────────────
echo.
echo -- 检测 Node.js --
echo.

REM 优先检查系统 PATH 中是否已有 node
where node >nul 2>&1
if %errorlevel% equ 0 (
    for /f "tokens=*" %%v in ('node --version') do set "EXISTING_NODE=%%v"
    echo [OK] 检测到系统 Node.js: !EXISTING_NODE!
    goto :skip_node_download
)

REM 再检查便携版
if exist "%NODE_DIR%\node.exe" (
    echo [OK] 检测到便携版 Node.js
    goto :skip_node_download
)

echo [..] 未检测到 Node.js，正在下载便携版 v%NODE_VERSION%...
echo [..] 地址: %NODE_URL%

set "TEMP_ZIP=%INSTALL_DIR%\node-download.zip"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; " ^
    "$ProgressPreference = 'SilentlyContinue'; " ^
    "try { Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%TEMP_ZIP%' -UseBasicParsing; Write-Host '[OK] 下载完成' } " ^
    "catch { Write-Host '[ERROR] 下载失败'; exit 1 }"

if %errorlevel% neq 0 (
    echo [ERROR] Node.js 下载失败，请检查网络连接。
    if exist "%TEMP_ZIP%" del /f "%TEMP_ZIP%"
    goto :fail
)

echo [..] 解压中...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "Expand-Archive -Path '%TEMP_ZIP%' -DestinationPath '%INSTALL_DIR%' -Force"

if exist "%INSTALL_DIR%\node-v%NODE_VERSION%-win-x64" (
    if exist "%NODE_DIR%" rd /s /q "%NODE_DIR%" >nul 2>&1
    ren "%INSTALL_DIR%\node-v%NODE_VERSION%-win-x64" node
)
if exist "%TEMP_ZIP%" del /f "%TEMP_ZIP%"

if not exist "%NODE_DIR%\node.exe" (
    echo [ERROR] Node.js 安装失败。
    goto :fail
)
echo [OK] Node.js 便携版安装成功

:skip_node_download

REM ── 步骤 2: 初始化配置 ─────────────────────
echo.
echo -- 初始化配置 --
echo.

set "CONFIG_DIR=%INSTALL_DIR%\data\configs"
set "EXAMPLE_DIR=%INSTALL_DIR%\data\configs.example"

if exist "%CONFIG_DIR%" (
    echo [OK] 配置目录已存在，跳过初始化（运行 iris onboard 可重新配置）
) else (
    if exist "%EXAMPLE_DIR%" (
        mkdir "%CONFIG_DIR%" >nul 2>&1
        xcopy "%EXAMPLE_DIR%\*" "%CONFIG_DIR%\" /E /I /Y >nul
        echo [OK] 已从模板创建默认配置
    ) else (
        echo [WARN] 配置模板不存在，跳过
    )
)

REM ── 步骤 3: 运行 Onboard 配置引导 ──────────
echo.
echo -- 交互式配置引导 --
echo.

set "ONBOARD_BIN=%INSTALL_DIR%\bin\iris-onboard.exe"

if exist "%ONBOARD_BIN%" (
    echo [..] 启动 onboard 配置引导...
    echo.
    "%ONBOARD_BIN%" "%INSTALL_DIR%"
    echo.
    echo [OK] 配置引导完成
) else (
    echo [WARN] iris-onboard.exe 未找到
    echo [WARN] 请手动编辑配置文件: %CONFIG_DIR%\
)

REM ── 步骤 4: 生成 iris.bat CLI ──────────────
echo.
echo -- 安装 iris 命令 --
echo.

mkdir "%BIN_DIR%" >nul 2>&1

REM 生成 CLI wrapper 脚本
REM 功能与 Linux 的 iris CLI wrapper 对齐：start / onboard / help
> "%BIN_DIR%\iris.bat" (
    echo @echo off
    echo setlocal
    echo set "IRIS_DIR=%INSTALL_DIR%"
    echo set "PATH=%INSTALL_DIR%\node;%INSTALL_DIR%\bin;%%PATH%%"
    echo.
    echo if "%%1"=="" goto :start
    echo if "%%1"=="start" goto :start
    echo if "%%1"=="onboard" goto :onboard
    echo if "%%1"=="help" goto :help
    echo if "%%1"=="--help" goto :help
    echo if "%%1"=="-h" goto :help
    echo echo 未知命令: %%1
    echo echo 运行 iris help 查看帮助
    echo exit /b 1
    echo.
    echo :start
    echo if not exist "%%IRIS_DIR%%\dist\index.js" (
    echo     echo [ERROR] Iris 尚未构建。
    echo     exit /b 1
    echo )
    echo echo 正在启动 Iris...
    echo cd /d "%%IRIS_DIR%%"
    echo node dist\index.js
    echo exit /b %%errorlevel%%
    echo.
    echo :onboard
    echo if exist "%%IRIS_DIR%%\bin\iris-onboard.exe" (
    echo     "%%IRIS_DIR%%\bin\iris-onboard.exe" "%%IRIS_DIR%%"
    echo ) else (
    echo     echo [ERROR] iris-onboard.exe 未安装
    echo     echo 请手动编辑配置: %%IRIS_DIR%%\data\configs\
    echo )
    echo exit /b 0
    echo.
    echo :help
    echo.
    echo   Iris AI Chat Framework
    echo.
    echo   用法: iris ^<command^>
    echo.
    echo   命令:
    echo     start      启动 Iris（默认）
    echo     onboard    交互式配置引导
    echo     help       显示此帮助
    echo.
    echo   配置文件: %%IRIS_DIR%%\data\configs\
    echo.
    echo exit /b 0
)

echo [OK] 已生成 %BIN_DIR%\iris.bat

REM ── 完成 ───────────────────────────────────
echo.
echo ============================================
echo   安装完成！
echo.
echo   启动 Iris:
echo     iris start
echo.
echo   重新配置:
echo     iris onboard
echo.
echo   配置文件位置:
echo     %CONFIG_DIR%\
echo ============================================
echo.

REM 检查 bin 目录是否在 PATH 中
echo %PATH% | findstr /C:"%BIN_DIR%" >nul
if %errorlevel% neq 0 (
    echo [提示] 请将以下目录添加到系统 PATH 环境变量:
    echo   %BIN_DIR%
    echo.
)

pause
exit /b 0

:fail
echo.
echo 安装失败，请检查以上错误信息。
pause
exit /b 1

