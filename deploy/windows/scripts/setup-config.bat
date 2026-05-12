@echo off
REM ==========================================
REM  配置文件初始化（Web GUI 默认配置）
REM ==========================================

call "%~dp0env.bat"

REM 与 Iris 主程序保持一致：运行时配置写入 IRIS_DATA_DIR\configs，
REM 未设置 IRIS_DATA_DIR 时使用当前用户的 %USERPROFILE%\.iris\configs。
if defined IRIS_DATA_DIR (
    set "DATA_DIR=%IRIS_DATA_DIR%"
) else (
    set "DATA_DIR=%USERPROFILE%\.iris"
)
set "CONFIG_DIR=%DATA_DIR%\configs"
set "CONFIG_EXAMPLE_DIR=%PROJECT_ROOT%\data\configs.example"
set "CONFIG_CREATED=0"

REM 切换到项目根目录
pushd "%PROJECT_ROOT%"

REM 检查模板目录是否存在
if not exist "%CONFIG_EXAMPLE_DIR%" (
    echo [config] ERROR: data\configs.example not found.
    popd
    exit /b 1
)

REM 首次运行：从模板复制整个目录（不依赖 PowerShell）
if not exist "%CONFIG_DIR%" (
    echo [config] First run, initializing runtime configs from data\configs.example...
    mkdir "%CONFIG_DIR%" >nul 2>&1
    xcopy "%CONFIG_EXAMPLE_DIR%\*" "%CONFIG_DIR%\" /E /I /Y >nul
    if errorlevel 4 (
        echo [config] ERROR: failed to initialize config directory.
        popd
        exit /b 1
    )
    set "CONFIG_CREATED=1"
) else (
    echo [config] Found runtime config directory, checking for missing files...
)

REM 补齐缺失的配置文件
for %%F in (llm.yaml platform.yaml storage.yaml system.yaml ocr.yaml memory.yaml mcp.yaml modes.yaml sub_agents.yaml) do (
    if not exist "%CONFIG_DIR%\%%F" (
        if exist "%CONFIG_EXAMPLE_DIR%\%%F" copy /Y "%CONFIG_EXAMPLE_DIR%\%%F" "%CONFIG_DIR%\%%F" >nul
    )
)

REM 首次初始化时，直接写入最小可用的 Web 配置，避免依赖 PowerShell 改 YAML
if "%CONFIG_CREATED%"=="1" (
    > "%CONFIG_DIR%\platform.yaml" (
        echo type: web
        echo.
        echo web:
        echo   port: 8192
        echo   host: 127.0.0.1
    )
)

REM 校验 platform.yaml 是否已经是 Web 模式；已有自定义内容时只提示，不强制覆写
findstr /R /C:"^[ ]*type:[ ]*web[ ]*$" "%CONFIG_DIR%\platform.yaml" >nul
set "PLATFORM_TYPE_OK=%errorlevel%"
findstr /R /C:"^[ ]*web:[ ]*$" "%CONFIG_DIR%\platform.yaml" >nul
set "PLATFORM_WEB_BLOCK_OK=%errorlevel%"

if "%PLATFORM_TYPE_OK%"=="0" if "%PLATFORM_WEB_BLOCK_OK%"=="0" (
    echo [config] Web GUI mode ready.
) else (
    echo [config] WARNING: platform.yaml was not auto-rewritten.
    echo [config] Please make sure %CONFIG_DIR%\platform.yaml contains:
    echo [config]   type: web
    echo [config]   web:
    echo [config]     port: 8192
    echo [config]     host: 127.0.0.1
)

echo [config] To set API Key, edit: %CONFIG_DIR%\llm.yaml
echo.

popd
exit /b 0
