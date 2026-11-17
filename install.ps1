# Installs MD Reader for the current user (no admin needed):
#  - copies MDReader.exe to %LOCALAPPDATA%\Programs\MD Reader
#  - adds a Start menu shortcut
#  - registers it for .md files ("Open with" + Settings > Default apps)
param([switch]$NoDefaultAppsPage)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
# Release zip: MDReader.exe sits next to this script. Source checkout: use/build dist\MDReader.exe.
$src = Join-Path $root 'MDReader.exe'
if (-not (Test-Path $src)) {
  $src = Join-Path $root 'dist\MDReader.exe'
  if (-not (Test-Path $src)) { & "$root\build.ps1" }
}
Unblock-File $src -ErrorAction SilentlyContinue

$installDir = Join-Path $env:LOCALAPPDATA 'Programs\MD Reader'
$exe = Join-Path $installDir 'MDReader.exe'
Get-Process MDReader -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force
New-Item -ItemType Directory -Force $installDir | Out-Null
Copy-Item $src $exe -Force

# Start menu shortcut
$lnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\MD Reader.lnk'
$sh = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sh.TargetPath = $exe
$sh.WorkingDirectory = $installDir
$sh.IconLocation = "$exe,0"
$sh.Description = 'Read and edit Markdown files'
$sh.Save()

# File association (per user)
$exts = '.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdwn', '.mdx'
$progId = 'MDReader.Markdown'
$classes = 'HKCU:\Software\Classes'
$cmd = "`"$exe`" `"%1`""

New-Item -Force "$classes\$progId" | Out-Null
Set-ItemProperty "$classes\$progId" '(default)' 'Markdown Document'
Set-ItemProperty "$classes\$progId" 'FriendlyTypeName' 'Markdown Document'
New-Item -Force "$classes\$progId\DefaultIcon" | Out-Null
Set-ItemProperty "$classes\$progId\DefaultIcon" '(default)' "`"$exe`",0"
New-Item -Force "$classes\$progId\shell\open\command" | Out-Null
Set-ItemProperty "$classes\$progId\shell\open\command" '(default)' $cmd

$app = "$classes\Applications\MDReader.exe"
New-Item -Force "$app\shell\open\command" | Out-Null
Set-ItemProperty "$app" 'FriendlyAppName' 'MD Reader'
Set-ItemProperty "$app\shell\open\command" '(default)' $cmd
New-Item -Force "$app\SupportedTypes" | Out-Null

$caps = 'HKCU:\Software\MDReader\Capabilities'
New-Item -Force "$caps\FileAssociations" | Out-Null
Set-ItemProperty $caps 'ApplicationName' 'MD Reader'
Set-ItemProperty $caps 'ApplicationDescription' 'A fast, clean Markdown reader and editor'
Set-ItemProperty $caps 'ApplicationIcon' "`"$exe`",0"

foreach ($e in $exts) {
  New-Item -Force "$classes\$e\OpenWithProgids" | Out-Null
  New-ItemProperty -Force "$classes\$e\OpenWithProgids" -Name $progId -Value '' -PropertyType String | Out-Null
  New-ItemProperty -Force "$app\SupportedTypes" -Name $e -Value '' -PropertyType String | Out-Null
  Set-ItemProperty "$caps\FileAssociations" $e $progId
  # give the extension a content type / perceived type if it has none
  if (-not (Get-ItemProperty "$classes\$e" -Name 'PerceivedType' -ErrorAction SilentlyContinue)) {
    Set-ItemProperty "$classes\$e" 'PerceivedType' 'text'
  }
}
New-Item -Force 'HKCU:\Software\RegisteredApplications' | Out-Null
Set-ItemProperty 'HKCU:\Software\RegisteredApplications' 'MD Reader' 'Software\MDReader\Capabilities'

# Uninstall entry (Settings > Apps)
$un = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MDReader'
New-Item -Force $un | Out-Null
Copy-Item "$root\uninstall.ps1" (Join-Path $installDir 'uninstall.ps1') -Force
Set-ItemProperty $un 'DisplayName' 'MD Reader'
Set-ItemProperty $un 'DisplayIcon' "`"$exe`",0"
Set-ItemProperty $un 'DisplayVersion' ((Get-Item $exe).VersionInfo.FileVersion)
Set-ItemProperty $un 'Publisher' 'MD Reader'
Set-ItemProperty $un 'InstallLocation' $installDir
Set-ItemProperty $un 'UninstallString' "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$installDir\uninstall.ps1`""
Set-ItemProperty $un 'NoModify' 1 -Type DWord
Set-ItemProperty $un 'NoRepair' 1 -Type DWord

# Tell Explorer associations changed
Add-Type -Namespace Win32 -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, int f, IntPtr a, IntPtr b);'
[Win32.Shell]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)

Write-Host "Installed to $exe" -ForegroundColor Green
Write-Host "Start menu: 'MD Reader'"
Write-Host ""
Write-Host "To make it the default for .md files: in the Settings page that opens, set .md (and .markdown) to MD Reader."
Write-Host "(Windows only lets you pick the default yourself; apps can't set it silently.)"
if (-not $NoDefaultAppsPage) { Start-Process 'ms-settings:defaultapps?registeredAppUser=MD%20Reader' }
