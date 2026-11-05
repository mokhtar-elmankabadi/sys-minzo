param([switch]$Remove)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
function Say($t, $err) { $i = 'Information'; if ($err) { $i = 'Error' }; [void][System.Windows.Forms.MessageBox]::Show($t, 'SYS Minzo', 'OK', $i, 'Button1', 'RtlReading, RightAlign') }
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA 'MinzoPrint\app'
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'SYS Minzo Print.lnk'
# stop any running copy
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*MinzoPrint.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
if ($Remove) {
  Remove-Item $lnk -Force -ErrorAction SilentlyContinue
  Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
  Say 'تم إيقاف برنامج الطباعة وإزالته من الجهاز.'
  exit 0
}
New-Item -ItemType Directory -Force -Path $dest | Out-Null
foreach ($f in 'MinzoPrint.ps1', 'start.vbs', 'config.json') { $p = Join-Path $src $f; if (Test-Path $p) { Copy-Item $p $dest -Force } }
Get-ChildItem -LiteralPath $dest | Unblock-File
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = 'wscript.exe'
$s.Arguments = '"' + (Join-Path $dest 'start.vbs') + '"'
$s.WorkingDirectory = $dest
$s.Save()
Start-Process wscript.exe -ArgumentList ('"' + (Join-Path $dest 'start.vbs') + '"')
# wait for it to answer
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try { $c = New-Object System.Net.Sockets.TcpClient; $c.Connect('127.0.0.1', 17777); $c.Close()
    Say "تم تثبيت برنامج الطباعة وهو شغّال دلوقتي.`n`nهيشتغل لوحده كل ما الجهاز يفتح.`nارجع للسيستم وافتح: الطابعات ← برنامج الطباعة."; exit 0 } catch {}
}
Say "البرنامج اتثبّت بس مش راضي يشتغل.`nابعت صورة من الملف ده:`n$env:LOCALAPPDATA\MinzoPrint\agent.log" $true
exit 2
