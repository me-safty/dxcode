@echo off
setlocal

REM Start all three prod pieces of the t3code setup via Windows Task Scheduler:
REM   - t3code-server  : local t3 server on 127.0.0.1:3773
REM   - t3code-tunnel  : cloudflared tunnel exposing it at the public URL
REM   - t3code-desktop : the packaged desktop app
REM
REM Safe to run if they're already running (schtasks /run is a no-op on a
REM running task). Intended for local use; the tasks themselves auto-fire
REM at user login via Windows Task Scheduler.

set "REPO_ROOT=%~dp0.."
set "LOG_FILE=%REPO_ROOT%\logs\t3code-server.log"

echo Starting t3code-server...
schtasks /run /tn t3code-server >nul 2>&1

echo Starting t3code-tunnel...
schtasks /run /tn t3code-tunnel >nul 2>&1

echo Starting t3code-desktop...
schtasks /run /tn t3code-desktop >nul 2>&1

echo.
echo Waiting for server to bind port 3773...
set /a TRIES=0
:wait_loop
set /a TRIES+=1
powershell -NoProfile -Command "exit !(([bool](Get-NetTCPConnection -LocalPort 3773 -State Listen -ErrorAction SilentlyContinue)))" >nul 2>&1
if %ERRORLEVEL%==0 goto wait_done
if %TRIES% GEQ 30 (
  echo [warn] server did not bind within 30s. Check "%LOG_FILE%"
  goto wait_done
)
timeout /t 1 /nobreak >nul
goto wait_loop
:wait_done

echo Checking public endpoint https://t3.olumbe.com...
curl -sS -o NUL -w "  https://t3.olumbe.com -> %%{http_code}\n" https://t3.olumbe.com/

echo Checking unauthenticated bridge route...
curl -sS -o NUL -X POST -w "  /api/execution/runs/status -> %%{http_code} (expected 401 when secret is configured)\n" https://t3.olumbe.com/api/execution/runs/status

echo.
echo Pairing URL:
powershell -NoProfile -Command "if ($env:T3CODE_OWNER_PAIRING_TOKEN) { '  https://t3.olumbe.com/pair#token=' + [uri]::EscapeDataString($env:T3CODE_OWNER_PAIRING_TOKEN) } else { $line = Get-Content -LiteralPath '%LOG_FILE%' -Tail 200 -ErrorAction SilentlyContinue | Where-Object { $_ -match 'pairingUrl:' } | Select-Object -Last 1; if ($line) { '  ' + (($line -replace '.*pairingUrl:\s*', '').Trim() -replace 'http://127\.0\.0\.1:3773', 'https://t3.olumbe.com') } else { '  (no pairingUrl found yet - check ' + '%LOG_FILE%' + ')' } }"

endlocal
