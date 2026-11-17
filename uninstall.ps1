# Removes MD Reader for the current user. Settings in %APPDATA%\MDReader are kept unless -Purge is given.
param([switch]$Purge)
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\MD Reader'
Get-Process MDReader -ErrorAction SilentlyContinue | Stop-Process -Force

$classes = 'HKCU:\Software\Classes'
foreach ($e in '.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdwn', '.mdx') {
  Remove-ItemProperty "$classes\$e\OpenWithProgids" -Name 'MDReader.Markdown' -ErrorAction SilentlyContinue
}
Remove-Item -Recurse -Force "$classes\MDReader.Markdown", "$classes\Applications\MDReader.exe", 'HKCU:\Software\MDReader',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MDReader' -ErrorAction SilentlyContinue
Remove-ItemProperty 'HKCU:\Software\RegisteredApplications' -Name 'MD Reader' -ErrorAction SilentlyContinue
Remove-Item -Force (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\MD Reader.lnk') -ErrorAction SilentlyContinue
if ($Purge) {
  Remove-Item -Recurse -Force (Join-Path $env:APPDATA 'MDReader'), (Join-Path $env:LOCALAPPDATA 'MDReader') -ErrorAction SilentlyContinue
}
# the running script may live inside the install dir; delete the rest after it exits
Start-Process cmd.exe -ArgumentList "/c timeout /t 2 >nul & rmdir /s /q `"$installDir`"" -WindowStyle Hidden
Write-Host 'MD Reader removed.'
