@echo off
setlocal
chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%POWERSHELL_EXE%" (
  rem Use Windows PowerShell from the system directory.
) else (
  set "POWERSHELL_EXE=powershell.exe"
)

set "ROCO_DEPLOY_PERSISTENT_WINDOW=1"
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%deploy-cf-worker.ps1" -NoPause %*
set "EXIT_CODE=%ERRORLEVEL%"

if "%ROCO_DEPLOY_CMD_NO_PAUSE%"=="1" (
  exit /b %EXIT_CODE%
)

echo.
echo 执行结束，按任意键关闭窗口...
pause >nul
exit /b %EXIT_CODE%
