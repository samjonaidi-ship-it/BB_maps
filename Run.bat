@echo off
setlocal EnableDelayedExpansion

:: ============================================================
:: BB Maps v1.0.0 | Run.bat
:: Self-hosted map service (tiles + Photon geocoder + Esri satellite)
:: Bainbridge Builders Inc.
:: Port: 8080
::
:: HIGH UPTIME: Auto-restarts on crash (up to 10 times).
::              Use --once flag to disable auto-restart.
::
:: NOTE: Full geocoding needs the Photon container (docker compose up).
::       Standalone start serves health + style/sprite/font assets and
::       proxies satellite; /geocode requires PHOTON_URL to be reachable.
:: ============================================================

title BB Maps v1.0.0

:: ============================================================
:: CONFIGURATION
:: ============================================================
set "PORT=8080"
set "SERVER_FILE=src\index.js"
set "PROJECT_DIR=%~dp0"
set "PROJECT_FILE_URL=file:///%PROJECT_DIR:\=/%"
set "SERVER_FILE_URL=%PROJECT_FILE_URL%%SERVER_FILE:\=/%"

:: Runtime env — production logging (pino-pretty is not a dependency, so
:: NODE_ENV must be 'production' to avoid a missing-transport crash).
set "NODE_ENV=production"
if not defined PHOTON_URL set "PHOTON_URL=http://localhost:2322"

:: Auto-restart settings
set "RESTART_DELAY=5"
set "MAX_RESTARTS=10"
set "RESTART_COUNT=0"
set "AUTO_RESTART=1"
set "EXIT_CODE=0"

:: Logging
set "LOG_DIR=%PROJECT_DIR%logs"
set "LOG_FILE=%LOG_DIR%\startup_%date:~-4,4%%date:~-10,2%%date:~-7,2%.log"

:: Check for --once flag (disables auto-restart)
if "%1"=="--once" set "AUTO_RESTART=0"
if "%2"=="--once" set "AUTO_RESTART=0"

:: ANSI color codes
for /f %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "GREEN=%ESC%[92m"
set "YELLOW=%ESC%[93m"
set "RED=%ESC%[91m"
set "CYAN=%ESC%[96m"
set "WHITE=%ESC%[97m"
set "DIM=%ESC%[90m"
set "RESET=%ESC%[0m"

:: Green terminal
color 0A

:: Navigate to project directory
cd /d "%~dp0"

:: Create log directory
if not exist "%LOG_DIR%\." mkdir "%LOG_DIR%"

echo.
echo %GREEN%========================================%RESET%
echo %GREEN%  BB MAPS v1.0.0%RESET%
echo %GREEN%  Self-hosted map service [High Uptime]%RESET%
echo %GREEN%  Port: %PORT%%RESET%
echo %GREEN%========================================%RESET%
echo.

:: Log startup
echo ================================================================ >> "%LOG_FILE%"
echo BB Maps v1.0.0 - Started %date% %time% >> "%LOG_FILE%"
echo ================================================================ >> "%LOG_FILE%"

:: ============================================================
:: [1/5] PORT CLEANUP (with verification)
:: ============================================================
call :log "%YELLOW%[1/5] Port %PORT% cleanup...%RESET%"

set "PORT_KILLED=0"
set "MAX_ATTEMPTS=5"
set "ATTEMPT=0"

:port_kill_loop
set /a ATTEMPT+=1

set "PID_FOUND="
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    set "PID_FOUND=%%a"
)

if not defined PID_FOUND (
    if !PORT_KILLED!==1 (
        call :log "!GREEN!    Port %PORT% confirmed clear!RESET!"
    ) else (
        call :log "!GREEN!    Port %PORT% already available!RESET!"
    )
    goto :port_clean_done
)

call :log "%CYAN%    Killing PID !PID_FOUND! on port %PORT% (attempt %ATTEMPT%/%MAX_ATTEMPTS%)%RESET%"
taskkill /PID !PID_FOUND! /F >nul 2>&1
set "PORT_KILLED=1"

%SYSTEMROOT%\System32\timeout.exe /t 1 /nobreak >nul

if %ATTEMPT% GEQ %MAX_ATTEMPTS% (
    call :log "!RED!    FATAL: Could not clear port after %MAX_ATTEMPTS% attempts!RESET!"
    %SYSTEMROOT%\System32\timeout.exe /t 5 /nobreak >nul
    exit /b 1
)

goto :port_kill_loop

:port_clean_done
echo.

:: ============================================================
:: [2/5] NODE.JS CHECK
:: ============================================================
call :log "%YELLOW%[2/5] Checking Node.js...%RESET%"

where node >nul 2>&1
if errorlevel 1 (
    call :log "!RED!    ERROR: Node.js not found. Please install Node.js 20+.!RESET!"
    %SYSTEMROOT%\System32\timeout.exe /t 5 /nobreak >nul
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
call :log "%GREEN%    Node.js %NODE_VER%%RESET%"
echo.

:: ============================================================
:: [3/5] DEPENDENCIES
:: ============================================================
call :log "%YELLOW%[3/5] Checking dependencies...%RESET%"

if not exist "node_modules" (
    call :log "!CYAN!    Installing dependencies...!RESET!"
    call npm ci
    if errorlevel 1 (
        call :log "!RED!    ERROR: npm ci failed.!RESET!"
        %SYSTEMROOT%\System32\timeout.exe /t 5 /nobreak >nul
        exit /b 1
    )
    call :log "!GREEN!    Dependencies installed!RESET!"
) else (
    call :log "!GREEN!    Dependencies OK!RESET!"
)
echo.

:: ============================================================
:: [4/5] SERVER FILE CHECK
:: ============================================================
call :log "%YELLOW%[4/5] Verifying server file...%RESET%"

if not exist "%PROJECT_DIR%%SERVER_FILE%" (
    call :log "!RED!    ERROR: Server file not found: %SERVER_FILE%!RESET!"
    call :log "!RED!    Expected at: %SERVER_FILE_URL%!RESET!"
    %SYSTEMROOT%\System32\timeout.exe /t 5 /nobreak >nul
    exit /b 1
)
call :log "%GREEN%    %SERVER_FILE% OK%RESET%"
echo.

:: ============================================================
:: FILES (Ctrl+Click to open)
:: ============================================================
echo %YELLOW%================================================================%RESET%
echo %YELLOW%  FILES (Ctrl+Click to open)%RESET%
echo %YELLOW%================================================================%RESET%
echo.
echo   %WHITE%Server:%RESET%         %SERVER_FILE_URL%
echo   %WHITE%Launcher:%RESET%       %PROJECT_FILE_URL%Run.bat
echo   %WHITE%Project:%RESET%        %PROJECT_FILE_URL%
echo   %WHITE%Port:%RESET%           %PORT%
echo   %WHITE%Photon:%RESET%         %PHOTON_URL%
echo   %WHITE%Auto-Restart:%RESET%   %AUTO_RESTART% (max %MAX_RESTARTS%)
echo.
echo %YELLOW%================================================================%RESET%
echo.

:: ============================================================
:: ENDPOINTS (Ctrl+Click to open)
:: ============================================================
echo %CYAN%================================================================%RESET%
echo %CYAN%  ENDPOINTS (Ctrl+Click to open)%RESET%
echo %CYAN%================================================================%RESET%
echo.
echo   %CYAN%Health:%RESET%
echo   %GREEN%-%RESET% %WHITE%Liveness:%RESET%    http://localhost:%PORT%/health
echo   %GREEN%-%RESET% %WHITE%Readiness:%RESET%   http://localhost:%PORT%/health/ready
echo.
echo   %CYAN%Geocoding (Photon):%RESET%
echo   %GREEN%-%RESET% %WHITE%Forward:%RESET%     http://localhost:%PORT%/geocode?q=bainbridge
echo   %GREEN%-%RESET% %WHITE%Reverse:%RESET%     http://localhost:%PORT%/geocode/reverse?lat=37.6^&lon=-122.1
echo.
echo   %CYAN%Map assets / tiles:%RESET%
echo   %GREEN%-%RESET% %WHITE%Satellite:%RESET%   http://localhost:%PORT%/satellite/12/1580/2851
echo   %GREEN%-%RESET% %WHITE%Style:%RESET%       http://localhost:%PORT%/styles/default.json
echo.
echo   %CYAN%Admin:%RESET%
echo   %GREEN%-%RESET% %WHITE%Version:%RESET%     http://localhost:%PORT%/admin/version
echo   %GREEN%-%RESET% %WHITE%Usage:%RESET%       http://localhost:%PORT%/admin/usage
echo.
echo %CYAN%================================================================%RESET%
echo.

:: ============================================================
:: [5/5] START SERVER
:: ============================================================
call :log "%YELLOW%[5/5] Starting BB Maps on port %PORT%...%RESET%"

if "%AUTO_RESTART%"=="1" (
    echo !DIM![%time:~0,8%]!RESET! !CYAN!    Auto-restart: ENABLED ^(max %MAX_RESTARTS%^)!RESET!
) else (
    echo !DIM![%time:~0,8%]!RESET! !CYAN!    Auto-restart: DISABLED!RESET!
)
echo.

:: ============================================================
:: SERVER LOOP (with auto-restart)
:: ============================================================
:StartServer
set /a RESTART_COUNT+=1

if !RESTART_COUNT! GTR 1 (
    echo.
    echo !DIM![%time:~0,8%]!RESET! !YELLOW!Restarting server [attempt !RESTART_COUNT!/%MAX_RESTARTS%]...!RESET!
    echo [%date% %time%] Restart attempt !RESTART_COUNT! >> "%LOG_FILE%"
)

echo.
echo %GREEN%================================================================%RESET%
echo %GREEN%  SERVER RUNNING%RESET%
echo %GREEN%================================================================%RESET%
echo.
echo   %WHITE%URL:%RESET%           http://localhost:%PORT%
echo   %WHITE%Mode:%RESET%          High Uptime
echo   %WHITE%Press:%RESET%         Ctrl+C to stop
echo.
echo %GREEN%================================================================%RESET%
echo.

:: Final port verification before starting (last line of defense)
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    echo !DIM![%time:~0,8%]!RESET! !RED!    ABORT: Port %PORT% still occupied by PID %%a!RESET!
    echo [%date% %time%] Port still occupied by PID %%a >> "%LOG_FILE%"
    goto :shutdown
)

:: Record start time for uptime tracking
for /f "tokens=*" %%t in ('pwsh -NoProfile -NonInteractive -Command "[DateTime]::Now.Ticks"') do set "START_TICKS=%%t"

:: Run server (foreground -- blocks until exit)
node "%PROJECT_DIR%%SERVER_FILE%"

set "EXIT_CODE=!ERRORLEVEL!"

:: Calculate uptime
for /f "tokens=*" %%t in ('pwsh -NoProfile -NonInteractive -Command "[DateTime]::Now.Ticks"') do set "END_TICKS=%%t"
for /f "tokens=*" %%u in ('pwsh -NoProfile -NonInteractive -Command "[math]::Round((!END_TICKS! - !START_TICKS!) / 10000000)"') do set "UPTIME_SECS=%%u"

echo [%date% %time%] Server exited with code !EXIT_CODE! after !UPTIME_SECS!s >> "%LOG_FILE%"

:: Check if auto-restart is disabled
if "%AUTO_RESTART%"=="0" goto :shutdown

:: Clean exit (code 0) = don't restart (user stopped it intentionally)
if !EXIT_CODE!==0 (
    echo.
    echo !DIM![%time:~0,8%]!RESET! !GREEN!Server exited cleanly ^(code 0^). No restart needed.!RESET!
    echo [%date% %time%] Clean exit - no restart >> "%LOG_FILE%"
    goto :shutdown
)

:: If server ran for 5+ minutes, reset restart counter (it was stable)
if !UPTIME_SECS! GEQ 300 (
    echo !DIM![%time:~0,8%]!RESET! !CYAN!    Server was stable for !UPTIME_SECS!s - resetting restart counter!RESET!
    set "RESTART_COUNT=0"
)

:: Check if max restarts reached
if !RESTART_COUNT! GEQ %MAX_RESTARTS% (
    echo.
    echo !DIM![%time:~0,8%]!RESET! !RED!Maximum restarts ^(%MAX_RESTARTS%^) reached. Stopping.!RESET!
    echo [%date% %time%] Max restarts reached >> "%LOG_FILE%"
    goto :shutdown
)

:: Auto-restart (only for crashes, not clean exits)
echo.
echo %DIM%[%time:~0,8%]%RESET% %YELLOW%Server crashed ^(code !EXIT_CODE!^). Restarting in %RESTART_DELAY%s...%RESET%
%SYSTEMROOT%\System32\timeout.exe /t %RESTART_DELAY% /nobreak >nul 2>&1

:: Port cleanup before restart
echo !DIM![%time:~0,8%]!RESET! !YELLOW!    Clearing port %PORT% before restart...!RESET!
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
:: Extra safety delay for OS to fully release port
%SYSTEMROOT%\System32\timeout.exe /t 2 /nobreak >nul 2>&1

goto :StartServer

:: ============================================================
:: SHUTDOWN
:: ============================================================
:shutdown
echo.
echo %DIM%[%time:~0,8%]%RESET% %YELLOW%Server stopped ^(exit code: !EXIT_CODE!^)%RESET%

:: Kill our port
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo [%date% %time%] Shutdown complete >> "%LOG_FILE%"

echo.
echo %GREEN%================================================================%RESET%
echo %GREEN%  BB Maps stopped%RESET%
echo %GREEN%================================================================%RESET%

:: Pass exit code out of delayed expansion scope
set "_EXIT=!EXIT_CODE!"
endlocal & pause & exit /b %_EXIT%

:: ============================================================
:: SUBROUTINES
:: ============================================================
:log
echo %DIM%[%time:~0,8%]%RESET% %~1
goto :eof
