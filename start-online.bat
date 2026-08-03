@echo off
echo ============================================
echo   德州扑克 - 一键公网联机启动
echo ============================================
echo.

cd /d "%~dp0"

REM --- 1. 启动本地服务器 ---
echo [1/3] 启动本地游戏服务器...
start "德州扑克服务器" cmd /k "npm start"
REM 等待 3000 端口就绪
powershell -Command "$r=0; while($r -lt 30 -and -not (Test-NetConnection -ComputerName 127.0.0.1 -Port 3000 -InformationLevel Quiet -WarningAction SilentlyContinue)) { Start-Sleep -Milliseconds 500; $r++ }" >nul 2>&1
echo      本地服务器已就绪: http://localhost:3000

REM --- 2. 准备 cloudflared（复制到无空格路径，避免引号问题）---
set CFLDIR=%LOCALAPPDATA%\Cloudflared
if exist "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" copy /y "%ProgramFiles(x86)%\cloudflared\cloudflared.exe" "%CFLDIR%\cloudflared.exe" >nul 2>&1
if exist "%ProgramFiles%\cloudflared\cloudflared.exe" copy /y "%ProgramFiles%\cloudflared\cloudflared.exe" "%CFLDIR%\cloudflared.exe" >nul 2>&1
if not exist "%CFLDIR%\cloudflared.exe" (
  echo [错误] 未找到 cloudflared，请先运行: winget install Cloudflare.cloudflared
  pause
  exit /b 1
)

REM --- 3. 启动公网隧道 ---
echo [2/3] 创建公网隧道 (Cloudflare Quick Tunnel)...
set URLFILE=%TEMP%\th_tunnel_url.txt
del "%URLFILE%" 2>nul

start "德州扑克公网隧道" cmd /c ""%CFLDIR%\cloudflared.exe" tunnel --url http://127.0.0.1:3000 --no-autoupdate > "%URLFILE%" 2>&1"

echo [3/3] 正在等待公网地址生成 (最多 30 秒)...
echo.
powershell -Command "$i=0; while($i -lt 60) { if(Test-Path $env:TEMP\th_tunnel_url.txt) { $c = Get-Content -Path $env:TEMP\th_tunnel_url.txt -ErrorAction SilentlyContinue; foreach($line in $c) { $m = [regex]::Match($line,'https://[a-z0-9-]+\.trycloudflare\.com'); if($m.Success) { Write-Output $m.Value; exit } } }; Start-Sleep -Milliseconds 500; $i++ }" > "%URLFILE%.url" 2>&1

set /p TUNURL=<"%URLFILE%.url"
if defined TUNURL (
  echo.
  echo ============================================
  echo   公网地址已生成！
  echo.
  echo   所有人（任意网络）在手机浏览器打开：
  echo.
  echo     %TUNURL%
  echo.
  echo   不需要同一 WiFi，4G/5G 流量也能进
  echo   可添加到主屏幕安装为 App
  echo ============================================
) else (
  echo [警告] 30 秒内未抓到公网地址，请查看「德州扑克公网隧道」窗口
  echo   该窗口中 https://xxx.trycloudflare.com 即为公网地址
)
echo.
echo 本窗口可关闭；「德州扑克服务器」「德州扑克公网隧道」请保持打开。
pause
