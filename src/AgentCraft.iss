; AgentCraft installer (Inno Setup 6). Built by build.ps1 from ..\stage\AgentCraft.
; Per-user install (no admin rights): %LOCALAPPDATA%\AgentCraft.

#define AppVersion "0.1.0"

[Setup]
AppId={{6F3C2B1A-5D4E-4A8B-9C7F-AC0A6E1D2B30}
AppName=AgentCraft
AppVersion={#AppVersion}
AppPublisher=AgentCraft (unofficial build)
DefaultDirName={localappdata}\AgentCraft
DisableDirPage=yes
DefaultGroupName=AgentCraft
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\out
OutputBaseFilename=AgentCraft-Setup
SetupIconFile=..\stage\AgentCraft\AgentCraft.ico
UninstallDisplayIcon={app}\AgentCraft.exe
Compression=lzma2/max
SolidCompression=yes
LZMANumBlockThreads=4
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=force

[Messages]
WelcomeLabel2=This installs AgentCraft: a team of Claude agents working on your code inside a Minecraft studio.%n%nYou need your own Minecraft: Java Edition account. The first time the game opens, Prism Launcher asks you to sign in with Microsoft.

[Files]
Source: "..\stage\AgentCraft\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[INI]
; Java paths are absolute, so they are written at install time (forward slashes: Prism's ini parser treats \ as an escape)
Filename: "{app}\prism\instances\AgentCraft\instance.cfg"; Section: "General"; Key: "JavaPath"; String: "{code:JavaPath}"
Filename: "{app}\prism\prismlauncher.cfg"; Section: "General"; Key: "JavaPath"; String: "{code:JavaPath}"
; Prism re-asks about Java when the host name changed since its last run; pre-set it so its first-run
; wizard only shows the Microsoft sign-in
Filename: "{app}\prism\prismlauncher.cfg"; Section: "General"; Key: "LastHostname"; String: "{code:HostName}"

[Icons]
Name: "{autodesktop}\AgentCraft"; Filename: "{app}\AgentCraft.exe"
Name: "{group}\AgentCraft"; Filename: "{app}\AgentCraft.exe"
Name: "{group}\AgentCraft settings"; Filename: "{app}\AgentCraft.exe"; Parameters: "--settings"
Name: "{group}\Stop AgentCraft agents"; Filename: "{app}\AgentCraft.exe"; Parameters: "--stop"
Name: "{group}\Uninstall AgentCraft"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\AgentCraft.exe"; Description: "Start AgentCraft now"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{app}\AgentCraft.exe"; Parameters: "--stop"; Flags: runhidden; RunOnceId: "StopForeman"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
function JavaPath(Param: String): String;
begin
  Result := ExpandConstant('{app}\runtime\jre\bin\javaw.exe');
  StringChangeEx(Result, '\', '/', True);
end;

function HostName(Param: String): String;
begin
  if not RegQueryStringValue(HKLM, 'SYSTEM\CurrentControlSet\Services\Tcpip\Parameters', 'Hostname', Result) then
    Result := GetComputerNameString();
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  // an update over a running install: stop the old Foreman first
  if FileExists(ExpandConstant('{app}\AgentCraft.exe')) then
    Exec(ExpandConstant('{app}\AgentCraft.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Result := '';
end;
