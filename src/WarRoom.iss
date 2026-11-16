; War Room installer (Inno Setup 6). Built by build.ps1 from ..\stage\WarRoom.
; Per-user install (no admin rights): %LOCALAPPDATA%\WarRoom. Bundles Node, Git (MinGit), the
; Foreman and the studio app; the window is Microsoft Edge in app mode (already on Windows 10/11).

#define AppVersion "0.2.0"

[Setup]
; a new AppId: War Room is a separate product from the old Minecraft-based AgentCraft build
AppId={{B7E2C9D4-3F1A-4E6B-8D25-7A9C0F4E1B62}
AppName=War Room
AppVersion={#AppVersion}
AppPublisher=War Room (unofficial build)
DefaultDirName={localappdata}\WarRoom
DisableDirPage=yes
DefaultGroupName=War Room
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\out
OutputBaseFilename=WarRoom-Setup
SetupIconFile=..\stage\WarRoom\WarRoom.ico
UninstallDisplayIcon={app}\WarRoom.exe
Compression=lzma2/max
SolidCompression=yes
LZMANumBlockThreads=4
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=force

[Messages]
WelcomeLabel2=This installs War Room: a team of Claude agents working on your code, in a studio you can walk around, next to your coworkers' studios on the office network.%n%nStart with the free demo team, or use your own Anthropic API key for real work.

[Files]
Source: "..\stage\WarRoom\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autodesktop}\War Room"; Filename: "{app}\WarRoom.exe"
Name: "{group}\War Room"; Filename: "{app}\WarRoom.exe"
Name: "{group}\War Room settings"; Filename: "{app}\WarRoom.exe"; Parameters: "--settings"
Name: "{group}\Stop War Room"; Filename: "{app}\WarRoom.exe"; Parameters: "--stop"
Name: "{group}\Uninstall War Room"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\WarRoom.exe"; Description: "Start War Room now"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{app}\WarRoom.exe"; Parameters: "--stop"; Flags: runhidden; RunOnceId: "StopWarRoom"

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  // an update over a running install: stop the old agents and server first
  if FileExists(ExpandConstant('{app}\WarRoom.exe')) then
    Exec(ExpandConstant('{app}\WarRoom.exe'), '--stop', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Result := '';
end;
