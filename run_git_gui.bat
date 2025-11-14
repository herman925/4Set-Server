@echo off
setlocal

REM Simply launch the Git GUI via PowerShell
pushd "%~dp0" >nul 2>&1
pwsh -NoLogo -NoProfile -ExecutionPolicy Bypass -File "git_gui.ps1"
popd >nul 2>&1

endlocal
