# A second War Room on this same PC, for demos on one machine: its own demo team (Foreman, sim), its own studio
# server, its own window and its own player. It joins the War Room that already runs here, so the two can sit in
# different offices and fight each other in the arena. Uses the installed app (WarRoom-Setup.exe).
#   powershell -ExecutionPolicy Bypass -File second-office.ps1          start it
#   powershell -ExecutionPolicy Bypass -File second-office.ps1 -Stop    stop it
param([switch]$Stop, [switch]$NoWindow, [string]$App = "$env:LOCALAPPDATA\WarRoom")
$ErrorActionPreference = 'Stop'
$Home2 = Join-Path $env:USERPROFILE '.warroom\second'
$FPort = 7879; $SPort = 7881; $PeerPort = 7893; $DiscoPort = 7894

function Kill-Port($port) {
  $line = netstat -ano | Select-String 'LISTENING' | Select-String ":$port " | Select-Object -First 1
  if ($line) { $id = [int](($line.ToString().Trim() -split '\s+')[-1]); if ($id -gt 0) { Stop-Process -Id $id -Force -Confirm:$false; "stopped port $port" } }
}
if ($Stop) { Kill-Port $SPort; Kill-Port $FPort; exit 0 }

$node = Join-Path $App 'runtime\node\node.exe'
if (-not (Test-Path $node)) { throw "War Room is not installed in $App (run WarRoom-Setup.exe first)." }
New-Item -ItemType Directory -Force (Join-Path $Home2 'logs') | Out-Null
$state = Join-Path $Home2 'studio.json'; $peerFile = Join-Path $Home2 'studio-peer.json'

# dial the first War Room of this PC on start (its peer port); keep this studio's id between runs
$cfg = @{ hosts = @("127.0.0.1:7891"); code = ''; host = $false }
if (Test-Path $peerFile) { try { $old = Get-Content $peerFile -Raw | ConvertFrom-Json; if ($old.id) { $cfg.id = $old.id } } catch {} }
($cfg | ConvertTo-Json -Compress) | Out-File -Encoding ascii $peerFile

Kill-Port $SPort | Out-Null; Kill-Port $FPort | Out-Null
$env:AGENTCRAFT_HOME = $Home2
Start-Process -WindowStyle Hidden -FilePath $node -WorkingDirectory (Join-Path $App 'foreman') `
  -ArgumentList "--import tsx src/main.ts --backend sim --profile sim --home `"$Home2`" --port $FPort" `
  -RedirectStandardOutput (Join-Path $Home2 'logs\foreman.log') -RedirectStandardError (Join-Path $Home2 'logs\foreman.err')
Start-Sleep -Seconds 3
if (Test-Path $state) { Remove-Item $state -Force }
Start-Process -WindowStyle Hidden -FilePath $node -WorkingDirectory (Join-Path $App 'studio') `
  -ArgumentList "`"$(Join-Path $App 'studio\server.mjs')`" --port $SPort --foreman $FPort --foreman-dir `"$(Join-Path $App 'foreman')`" --state `"$state`" --peer-port $PeerPort --disco-port $DiscoPort --peer-file `"$peerFile`"" `
  -RedirectStandardOutput (Join-Path $Home2 'logs\studio.log') -RedirectStandardError (Join-Path $Home2 'logs\studio.err')

$token = $null
for ($i = 0; $i -lt 40 -and -not $token; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-Path $state) { $m = [regex]::Match((Get-Content $state -Raw), '"token"\s*:\s*"([a-f0-9]+)"'); if ($m.Success) { $token = $m.Groups[1].Value } }
}
if (-not $token) { throw "The second studio server did not start; see $Home2\logs" }

$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$url = "http://127.0.0.1:$SPort/?t=$token"
if ($NoWindow) { "token $token" } elseif ($edge) { Start-Process $edge -ArgumentList "--app=`"$url`" --user-data-dir=`"$(Join-Path $Home2 'window')`" --window-size=1200,900 --no-first-run --no-default-browser-check --autoplay-policy=no-user-gesture-required" }
else { Start-Process $url }
"Second War Room is running (window on port $SPort). Stop it with: second-office.ps1 -Stop"
