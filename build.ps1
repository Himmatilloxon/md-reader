# Builds a single-file MDReader.exe into .\dist
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
dotnet publish "$root\src\MDReader\MDReader.csproj" -c Release -o "$root\dist" -nologo
if ($LASTEXITCODE -ne 0) { throw "Build failed" }
Get-ChildItem "$root\dist" -Exclude MDReader.exe | Remove-Item -Recurse -Force
Write-Host "`nBuilt $root\dist\MDReader.exe" -ForegroundColor Green
