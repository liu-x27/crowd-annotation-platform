# 众包标注平台 - 快速启动脚本
# 使用方法：在项目根目录运行 .\start-all.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  众包标注平台 - 启动所有服务" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 获取脚本所在目录（项目根目录）
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1. 检查并启动 MongoDB
Write-Host "[1/4] 检查 MongoDB 服务..." -ForegroundColor Yellow
try {
    $mongoService = Get-Service -Name "MongoDB" -ErrorAction SilentlyContinue
    if ($mongoService) {
        if ($mongoService.Status -ne "Running") {
            Write-Host "  正在启动 MongoDB..." -ForegroundColor Yellow
            Start-Service MongoDB
            Start-Sleep -Seconds 2
            Write-Host "  ✓ MongoDB 已启动" -ForegroundColor Green
        } else {
            Write-Host "  ✓ MongoDB 已在运行" -ForegroundColor Green
        }
    } else {
        Write-Host "  ⚠ MongoDB 服务未找到，请确保已安装 MongoDB" -ForegroundColor Red
    }
} catch {
    Write-Host "  ⚠ MongoDB 检查失败: $_" -ForegroundColor Red
}

Write-Host ""

# 2. 检查 Ollama（可选，不影响启动）
Write-Host "[2/4] 检查 Ollama..." -ForegroundColor Yellow
try {
    $ollamaVersion = ollama --version 2>$null
    if ($ollamaVersion) {
        Write-Host "  ✓ Ollama 已安装" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ Ollama 未找到（LLM 功能将不可用）" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ⚠ Ollama 未找到（LLM 功能将不可用）" -ForegroundColor Yellow
}

Write-Host ""

# 3. 启动后端服务
Write-Host "[3/4] 启动后端服务..." -ForegroundColor Yellow
$backendPath = Join-Path $scriptDir "backend"
if (Test-Path $backendPath) {
    Write-Host "  正在新窗口中启动后端（端口 4000）..." -ForegroundColor Yellow
    
    # 设置环境变量
    $envVars = @"
`$env:MONGO_URI='mongodb://localhost:27017/crowd_platform'
`$env:JWT_SECRET='your_jwt_secret'
"@
    
    $backendCommand = @"
$envVars
cd '$backendPath'
Write-Host '后端服务启动中...' -ForegroundColor Cyan
npm run dev
"@
    
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCommand
    Start-Sleep -Seconds 2
    Write-Host "  ✓ 后端服务窗口已打开" -ForegroundColor Green
} else {
    Write-Host "  ✗ 后端目录不存在: $backendPath" -ForegroundColor Red
}

Write-Host ""

# 4. 启动前端服务
Write-Host "[4/4] 启动前端服务..." -ForegroundColor Yellow
$frontendPath = Join-Path $scriptDir "frontend"
if (Test-Path $frontendPath) {
    Write-Host "  正在新窗口中启动前端（端口 5173）..." -ForegroundColor Yellow
    
    $frontendCommand = @"
cd '$frontendPath'
Write-Host '前端服务启动中...' -ForegroundColor Cyan
npm run dev
"@
    
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCommand
    Start-Sleep -Seconds 2
    Write-Host "  ✓ 前端服务窗口已打开" -ForegroundColor Green
} else {
    Write-Host "  ✗ 前端目录不存在: $frontendPath" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  启动完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "服务地址：" -ForegroundColor Yellow
Write-Host "  前端: http://localhost:5173" -ForegroundColor White
Write-Host "  后端: http://localhost:4000" -ForegroundColor White
Write-Host ""
Write-Host "提示：" -ForegroundColor Yellow
Write-Host "  - 请等待后端和前端服务完全启动（看到 'ready' 或 'running' 提示）" -ForegroundColor Gray
Write-Host "  - 首次使用请先注册账号（管理员或标注员）" -ForegroundColor Gray
Write-Host "  - 关闭服务：直接关闭对应的 PowerShell 窗口" -ForegroundColor Gray
Write-Host ""
Write-Host "按任意键退出此脚本（服务将继续在后台运行）..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

