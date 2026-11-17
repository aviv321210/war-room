<#
  Builds WarRoom-Setup.exe (out\) from this repo (the studio app + launcher) and the upstream
  AgentCraft checkout (the Foreman, with its node_modules already installed).
  Needs: Inno Setup 6, the .NET Framework 4 C# compiler (on every Windows), and in downloads\:
    node.zip   - Node for Windows x64 (https://nodejs.org/dist/ -> node-vXX-win-x64.zip; the Foreman's
                 node_modules must be installed with the same major version)
    mingit.zip - MinGit 64-bit (https://github.com/git-for-windows/git/releases -> MinGit-*-64-bit.zip)
  Usage: powershell -ExecutionPolicy Bypass -File build.ps1 [-Repo C:\dev\agentcraft]
#>
param([string]$Repo = 'C:\dev\agentcraft')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Dist = $PSScriptRoot
$Dl = Join-Path $Dist 'downloads'
$Stage = Join-Path $Dist 'stage\WarRoom'
$Out = Join-Path $Dist 'out'
function Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }

$iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 not found (winget install JRSoftware.InnoSetup)' }
foreach ($z in 'node.zip', 'mingit.zip') { if (-not (Test-Path (Join-Path $Dl $z))) { throw "missing downloads\$z" } }
if (-not (Test-Path "$Repo\foreman\node_modules\ws")) { throw "no Foreman deps in $Repo\foreman (run npm install there)" }

# --- 1. stage ----------------------------------------------------------------------------------
Step 'staging'
if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force $Stage | Out-Null

function Expand-Into($zip, $dest, [switch]$StripTop) {
    $tmp = Join-Path $Dist ('stage\_x_' + [IO.Path]::GetFileNameWithoutExtension($zip))
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive (Join-Path $Dl $zip) $tmp
    $src = $tmp
    if ($StripTop) { $kids = @(Get-ChildItem $tmp); if ($kids.Count -eq 1 -and $kids[0].PSIsContainer) { $src = $kids[0].FullName } }
    New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
    Move-Item $src $dest
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
}
Expand-Into 'node.zip' "$Stage\runtime\node" -StripTop
Expand-Into 'mingit.zip' "$Stage\runtime\git"
# the agents never need npm/npx/corepack at run time
foreach ($d in 'node_modules\npm', 'node_modules\corepack') { $p = "$Stage\runtime\node\$d"; if (Test-Path $p) { Remove-Item -Recurse -Force $p } }
Get-ChildItem "$Stage\runtime\node" -File | Where-Object { $_.Name -match '^(npm|npx|corepack)' } | Remove-Item -Force

# Foreman: sources + the node_modules already installed (and tested) in the checkout
Step 'copying the Foreman'
$fm = "$Stage\foreman"
New-Item -ItemType Directory -Force $fm | Out-Null
foreach ($f in 'package.json', 'package-lock.json', 'tsconfig.json') { Copy-Item "$Repo\foreman\$f" $fm }
& robocopy "$Repo\foreman\src" "$fm\src" /E /NFL /NDL /NJH /NJS /NP | Out-Null
& robocopy "$Repo\foreman\node_modules" "$fm\node_modules" /E /NFL /NDL /NJH /NJS /NP /MT:16 /XD .cache | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'robocopy node_modules failed' }
# dev-only packages the Foreman never loads at run time (tsx and esbuild stay: they run the TypeScript)
foreach ($d in 'typescript', 'vitest', '@vitest', 'vite', '@rollup', 'rollup', '@rolldown', 'rolldown', 'lightningcss', 'lightningcss-win32-x64-msvc', '@types') { $p = "$fm\node_modules\$d"; if (Test-Path $p) { Remove-Item -Recurse -Force $p } }
New-Item -ItemType Directory -Force "$Stage\sandbox" | Out-Null
Copy-Item "$Repo\sandbox\create-demo.mjs" "$Stage\sandbox\"
Copy-Item "$Repo\LICENSE" "$Stage\LICENSE-AgentCraft.txt"

# the studio app (server + web), without the dev test tools
Step 'copying the studio app'
New-Item -ItemType Directory -Force "$Stage\studio" | Out-Null
Copy-Item "$Dist\studio\server.mjs" "$Stage\studio\"
& robocopy "$Dist\studio\web" "$Stage\studio\web" /E /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'robocopy studio\web failed' }
# demos on one PC: a second War Room (own demo team, studio and window) that joins this one
New-Item -ItemType Directory -Force "$Stage\tools" | Out-Null
Copy-Item "$Dist\tools\second-office.ps1" "$Stage\tools\"

# --- 2. launcher exe ----------------------------------------------------------------------------
Step 'compiling WarRoom.exe'
Add-Type -AssemblyName System.Drawing
$png = [System.Drawing.Bitmap]::FromFile("$Dist\studio\web\assets\icon.png")
$ico = "$Stage\WarRoom.ico"
# PNG-compressed single-image .ico (Vista+), 256x256
$bmp = New-Object System.Drawing.Bitmap $png, 256, 256
$ms = New-Object IO.MemoryStream; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bytes = $ms.ToArray()
$fs = [IO.File]::Create($ico); $w = New-Object IO.BinaryWriter $fs
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]1)
$w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([UInt16]1); $w.Write([UInt16]32)
$w.Write([UInt32]$bytes.Length); $w.Write([UInt32]22); $w.Write($bytes); $w.Close(); $png.Dispose(); $bmp.Dispose()
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:winexe /optimize+ "/out:$Stage\WarRoom.exe" "/win32icon:$ico" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Security.dll "$Dist\src\Launcher.cs"
if ($LASTEXITCODE -ne 0) { throw 'launcher compile failed' }

# --- 3. installer -------------------------------------------------------------------------------
Step 'building the installer (a few minutes: LZMA)'
New-Item -ItemType Directory -Force $Out | Out-Null
& $iscc /Q "$Dist\src\WarRoom.iss"
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup failed' }
$exe = Get-Item "$Out\WarRoom-Setup.exe"
"{0}  ({1:N0} MB)" -f $exe.FullName, ($exe.Length / 1MB)
