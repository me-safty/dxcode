@echo off
REM Deprecated local Windows launcher.
REM The production health monitor now runs as the WSL user timer:
REM   t3code-orchestrator-health.timer
REM Keep this script as a no-op so the legacy admin-owned Windows
REM scheduled task exits immediately if it still fires.
exit /b 0
