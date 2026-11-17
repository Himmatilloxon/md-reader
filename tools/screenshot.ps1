# Captures the MD Reader main window to a PNG (used for visual testing).
param([string]$Out = "$env:TEMP\mdr-shot.png", [string]$Keys = "")
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
}
"@
[W]::SetProcessDPIAware() | Out-Null
$p = Get-Process MDReader -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
[W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 400
if ($Keys) { (New-Object -ComObject WScript.Shell).SendKeys($Keys); Start-Sleep -Milliseconds 1200 }
$r = New-Object W+RECT
[W]::DwmGetWindowAttribute($p.MainWindowHandle, 9, [ref]$r, 16) | Out-Null
$w = $r.R - $r.L; $h = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
"saved $Out ($w x $h)"
