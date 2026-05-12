@echo off
setlocal

REM Start the t3 server, logging stdout+stderr to logs/t3code-server.log.
REM Intended for use with Windows Task Scheduler (auto-start at login),
REM but you can also run it directly for debugging.

set "REPO_ROOT=%~dp0.."
cd /d "%REPO_ROOT%"

if not exist "logs" mkdir "logs"

node apps\server\dist\bin.mjs --port 3773 --host 127.0.0.1 --no-browser >> "logs\t3code-server.log" 2>&1
