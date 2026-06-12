param(
  [string]$HostName = "117.72.120.209",
  [string]$User = "root",
  [int]$Port = 22,
  [string]$IdentityFile = "$env:USERPROFILE\.ssh\id_rsa-jd.pem",
  [int]$LocalWebPort = 17573,
  [int]$LocalDaemonPort = 17456
)

$ErrorActionPreference = "Stop"
$sshArgs = @(
  "-N",
  "-p", "$Port",
  "-i", "$IdentityFile",
  "-L", "${LocalWebPort}:127.0.0.1:17573",
  "-L", "${LocalDaemonPort}:127.0.0.1:17456",
  "$User@$HostName"
)

Write-Host "[jdcloud] starting ssh tunnel"
$proc = Start-Process -FilePath "ssh" -ArgumentList $sshArgs -PassThru -WindowStyle Hidden
try {
  Start-Sleep -Seconds 4
  Invoke-RestMethod -Uri "http://127.0.0.1:$LocalDaemonPort/api/health" -TimeoutSec 10 | ConvertTo-Json -Depth 4
  $web = Invoke-WebRequest -Uri "http://127.0.0.1:$LocalWebPort/" -UseBasicParsing -TimeoutSec 10
  Write-Host "[jdcloud] web status: $($web.StatusCode), bytes: $($web.Content.Length)"
  Write-Host "[jdcloud] open http://127.0.0.1:$LocalWebPort"
} finally {
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}
