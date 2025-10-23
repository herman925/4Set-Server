@echo off
REM ========================================
REM 4Set Processor Agent Launcher
REM ========================================
REM This batch file launches the processor_agent.ps1 with PowerShell 7
REM 
REM Usage:
REM   run_processor_agent.bat           - Run with default config
REM   run_processor_agent.bat -SingleRun - Run once and exit
REM ========================================

echo.
echo ========================================
echo 4Set Processor Agent Launcher
echo ========================================
echo.

REM Check if PowerShell 7 is installed
where pwsh.exe >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] PowerShell 7 not found!
    echo.
    echo Please install PowerShell 7 from:
    echo https://github.com/PowerShell/PowerShell/releases
    echo.
    pause
    exit /b 1
)

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

REM Build the full path to processor_agent.ps1
set "PS_SCRIPT=%SCRIPT_DIR%processor_agent.ps1"

REM Check if the PowerShell script exists
if not exist "%PS_SCRIPT%" (
    echo [ERROR] processor_agent.ps1 not found at:
    echo %PS_SCRIPT%
    echo.
    pause
    exit /b 1
)

echo Starting Processor Agent...
echo Script location: %PS_SCRIPT%
echo.

REM Run the PowerShell script with all arguments passed to this batch file
REM -NoProfile: Don't load user profile (faster startup)
REM -ExecutionPolicy Bypass: Allow script execution
REM -File: Specify the script file
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*

REM Check if the script exited with an error
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Processor agent exited with error code: %ERRORLEVEL%
    echo.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo Processor agent completed successfully.
