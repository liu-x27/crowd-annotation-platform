# 众包标注平台 - 停止所有服务脚本
# 使用方法：在项目根目录运行 .\stop-all.ps1

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  众包标注平台 - 停止所有服务" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 停止占用端口的进程
Write-Host "正在停止服务..." -ForegroundColor Yellow

# 停止前端（端口 5173）
$frontendProcess = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($frontendProcess) {
    foreach ($pid in $frontendProcess) {
        try {
            Stop-Process -Id $pid -Force
            Write-Host "  ✓ 已停止前端服务 (PID: $pid)" -ForegroundColor Green
        } catch {
            Write-Host "  ⚠ 停止前端服务失败 (PID: $pid)" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "  ℹ 前端服务未运行" -ForegroundColor Gray
}

# 停止后端（端口 4000）
$backendProcess = Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($backendProcess) {
    foreach ($pid in $backendProcess) {
        try {
            Stop-Process -Id $pid -Force
            Write-Host "  ✓ 已停止后端服务 (PID: $pid)" -ForegroundColor Green
        } catch {
            Write-Host "  ⚠ 停止后端服务失败 (PID: $pid)" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "  ℹ 后端服务未运行" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  停止完成！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "提示：" -ForegroundColor Yellow
Write-Host "  - 如果服务是通过 PowerShell 窗口启动的，请手动关闭对应窗口" -ForegroundColor Gray
Write-Host "  - MongoDB 服务不会自动停止（如需停止：Stop-Service MongoDB）" -ForegroundColor Gray
Write-Host ""

