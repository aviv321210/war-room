<#
  Builds AgentCraft-Setup.exe (out\) from the checkout in C:\dev\agentcraft.
  Needs: Java 25 JDK, Node, Inno Setup 6, and the runtime zips in downloads\
  (prism.zip, jre25.zip, node.zip, mingit.zip).
  Usage: powershell -ExecutionPolicy Bypass -File build.ps1 [-SkipModBuild]
#>
param([string]$Repo = 'C:\dev\agentcraft', [switch]$SkipModBuild)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Dist = $PSScriptRoot
$Dl = Join-Path $Dist 'downloads'
$Stage = Join-Path $Dist 'stage\AgentCraft'
$Out = Join-Path $Dist 'out'
function Step($m) { Write-Host "==> $m" -ForegroundColor Cyan }

$jdk = Get-ChildItem 'C:\Program Files\Eclipse Adoptium' -Directory -Filter 'jdk-25*' | Select-Object -First 1 -Expand FullName
if (-not $jdk) { throw 'Java 25 JDK not found (winget install EclipseAdoptium.Temurin.25.JDK)' }
$iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 not found (winget install JRSoftware.InnoSetup)' }
foreach ($z in 'prism.zip', 'jre25.zip', 'node.zip', 'mingit.zip') { if (-not (Test-Path (Join-Path $Dl $z))) { throw "missing downloads\$z" } }

# --- 1. mod jar --------------------------------------------------------------------------------
if (-not $SkipModBuild) {
    Step 'building the mod jar'
    $env:JAVA_HOME = $jdk
    & cmd /d /c "`"$Repo\mod\gradlew.bat`" -p `"$Repo\mod`" build --console=plain -q"
    if ($LASTEXITCODE -ne 0) { throw 'mod build failed' }
    & cmd /d /c "`"$Repo\mod\gradlew.bat`" -p `"$Repo\mod`" --stop -q" | Out-Null
}
$props = @{}
Get-Content "$Repo\mod\gradle.properties" | Where-Object { $_ -match '^\s*([\w.]+)\s*=\s*(.+)$' } | ForEach-Object { $props[$Matches[1]] = $Matches[2].Trim() }
$modJar = Join-Path $Repo "mod\build\libs\agentcraft-$($props.mod_version).jar"
if (-not (Test-Path $modJar)) { throw "no mod jar at $modJar" }
$fapi = Get-ChildItem "$env:USERPROFILE\.gradle\caches\modules-2\files-2.1\net.fabricmc.fabric-api\fabric-api\$($props.fabric_api_version)" -Recurse -Filter "fabric-api-$($props.fabric_api_version).jar" | Select-Object -First 1 -Expand FullName
if (-not $fapi) { throw "Fabric API $($props.fabric_api_version) not in the Gradle cache (build the mod once)" }

# --- 2. stage ----------------------------------------------------------------------------------
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
Expand-Into 'jre25.zip' "$Stage\runtime\jre" -StripTop
Expand-Into 'mingit.zip' "$Stage\runtime\git"
Expand-Into 'prism.zip' "$Stage\prism" -StripTop
Set-Content "$Stage\prism\portable.txt" '' -Encoding ascii

# Foreman: sources + the node_modules already installed (and tested) in the checkout
Step 'copying the Foreman'
$fm = "$Stage\foreman"
New-Item -ItemType Directory -Force $fm | Out-Null
foreach ($f in 'package.json', 'package-lock.json', 'tsconfig.json') { Copy-Item "$Repo\foreman\$f" $fm }
& robocopy "$Repo\foreman\src" "$fm\src" /E /NFL /NDL /NJH /NJS /NP | Out-Null
& robocopy "$Repo\foreman\node_modules" "$fm\node_modules" /E /NFL /NDL /NJH /NJS /NP /MT:16 /XD .cache | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'robocopy node_modules failed' }
# dev-only packages the Foreman never loads at run time (tsx and esbuild stay: they run the TypeScript)
foreach ($d in 'typescript', 'vitest', '@vitest', 'vite', '@rollup', 'rollup', '@types') { $p = "$fm\node_modules\$d"; if (Test-Path $p) { Remove-Item -Recurse -Force $p } }
New-Item -ItemType Directory -Force "$Stage\sandbox" | Out-Null
Copy-Item "$Repo\sandbox\create-demo.mjs" "$Stage\sandbox\"
Copy-Item "$Repo\LICENSE" "$Stage\LICENSE-AgentCraft.txt"

# --- 3. Prism instance ---------------------------------------------------------------------------
Step 'writing the Prism instance'
$inst = "$Stage\prism\instances\AgentCraft"
New-Item -ItemType Directory -Force "$inst\minecraft\mods" | Out-Null
Copy-Item $modJar "$inst\minecraft\mods\"
Copy-Item $fapi "$inst\minecraft\mods\"
New-Item -ItemType Directory -Force "$Stage\prism\icons" | Out-Null
Copy-Item "$Repo\mod\src\main\resources\assets\agentcraft\icon.png" "$Stage\prism\icons\agentcraft.png"

@"
{
    "components": [
        { "uid": "net.minecraft", "version": "$($props.minecraft_version)", "important": true },
        { "uid": "net.fabricmc.intermediary", "version": "$($props.minecraft_version)", "dependencyOnly": true },
        { "uid": "net.fabricmc.fabric-loader", "version": "$($props.loader_version)" }
    ],
    "formatVersion": 1
}
"@ | Set-Content "$inst\mmc-pack.json" -Encoding ascii

# JavaPath is added by the installer (absolute path)
@"
[General]
InstanceType=OneSix
name=AgentCraft
iconKey=agentcraft
notes=AgentCraft: Claude agents in a Minecraft studio. Start it from the AgentCraft shortcut so the agents run too.
OverrideMemory=true
MinMemAlloc=1024
MaxMemAlloc=2048
OverrideWindow=true
LaunchMaximized=false
MinecraftWinWidth=1280
MinecraftWinHeight=720
OverrideJavaLocation=true
AutomaticJava=false
OverrideJavaArgs=true
JvmArgs=-Dagentcraft.autoworld=1 -Dagentcraft.mute=0 -Dagentcraft.focus=1
"@ | Set-Content "$inst\instance.cfg" -Encoding ascii

@"
[General]
Language=en_US
ApplicationTheme=system
IconTheme=pe_colored
MinMemAlloc=1024
MaxMemAlloc=2048
AutomaticJavaDownload=false
AutomaticJavaSwitch=false
UserAskedAboutAutomaticJavaDownload=true
ShowConsole=false
CloseAfterLaunch=true
ConfigVersion=1.3
"@ | Set-Content "$Stage\prism\prismlauncher.cfg" -Encoding ascii

# options.txt: the repo's 26.3 template, tuned for integrated graphics (plan doc: Video settings)
$opts = [ordered]@{}
Get-Content "$Repo\mod\run-template\options.txt" | Where-Object { $_ -match '^([^:]+):(.*)$' } | ForEach-Object { $opts[$Matches[1]] = $Matches[2] }
$tune = [ordered]@{
    renderDistance = '6'; simulationDistance = '5'; maxFps = '60'; enableVsync = 'true'; guiScale = '2'
    ao = 'false'; renderClouds = '"false"'; particles = '2'; entityShadows = 'false'; biomeBlendRadius = '0'
    mipmapLevels = '0'; pauseOnLostFocus = 'false'; soundCategory_master = '1.0'; soundCategory_music = '0.3'
    onboardAccessibility = 'false'; fullscreen = 'false'
}
foreach ($k in $tune.Keys) { $opts[$k] = $tune[$k] }
($opts.Keys | ForEach-Object { "${_}:$($opts[$_])" }) | Set-Content "$inst\minecraft\options.txt" -Encoding ascii

# --- 4. launcher exe ----------------------------------------------------------------------------
Step 'compiling AgentCraft.exe'
Add-Type -AssemblyName System.Drawing
$png = [System.Drawing.Bitmap]::FromFile("$Repo\mod\src\main\resources\assets\agentcraft\icon.png")
$ico = "$Stage\AgentCraft.ico"
# PNG-compressed single-image .ico (Vista+), 256x256
$bmp = New-Object System.Drawing.Bitmap $png, 256, 256
$ms = New-Object IO.MemoryStream; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bytes = $ms.ToArray()
$fs = [IO.File]::Create($ico); $w = New-Object IO.BinaryWriter $fs
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]1)
$w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([UInt16]1); $w.Write([UInt16]32)
$w.Write([UInt32]$bytes.Length); $w.Write([UInt32]22); $w.Write($bytes); $w.Close(); $png.Dispose(); $bmp.Dispose()
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:winexe /optimize+ "/out:$Stage\AgentCraft.exe" "/win32icon:$ico" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Security.dll "$Dist\src\Launcher.cs"
if ($LASTEXITCODE -ne 0) { throw 'launcher compile failed' }

# --- 5. installer -------------------------------------------------------------------------------
Step 'building the installer (a few minutes: LZMA)'
New-Item -ItemType Directory -Force $Out | Out-Null
& $iscc /Q "$Dist\src\AgentCraft.iss"
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup failed' }
$exe = Get-Item "$Out\AgentCraft-Setup.exe"
"{0}  ({1:N0} MB)" -f $exe.FullName, ($exe.Length / 1MB)
