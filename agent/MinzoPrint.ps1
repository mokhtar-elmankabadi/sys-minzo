# Minzo Print Agent - silent printing for SYS Minzo
# Listens on 127.0.0.1 only. Accepts jobs only from the allowed site origins.
# Works on Windows PowerShell 5.1 (built into Windows 10/11). No install of anything else.
$ErrorActionPreference = 'Stop'
$Version = '1.0.0'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $env:LOCALAPPDATA 'MinzoPrint'
if ($env:MZ_DATA) { $DataDir = $env:MZ_DATA }
$JobDir = Join-Path $DataDir 'jobs'
New-Item -ItemType Directory -Force -Path $JobDir | Out-Null
$LogFile = Join-Path $DataDir 'agent.log'
$Fake = [bool]$env:MZ_FAKE   # test mode: writes jobs to files instead of printers

$Cfg = @{ port = 17777; origins = @('https://mokhtar-elmankabadi.github.io', 'http://localhost:8787', 'http://127.0.0.1:8787'); retries = 3; retryDelaySec = 8; keepDone = 200 }
$cfgFile = Join-Path $Root 'config.json'
if (Test-Path $cfgFile) {
  $c = Get-Content $cfgFile -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($p in $c.PSObject.Properties) { $Cfg[$p.Name] = $p.Value }
}

function Log($m) { try { Add-Content -Path $LogFile -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ' + $m) -Encoding UTF8 } catch {} }

# one agent at a time
$mutex = New-Object System.Threading.Mutex($false, 'Local\MinzoPrintAgent')
if (-not $mutex.WaitOne(0)) { Log 'already running'; exit 0 }

if (-not $Fake) {
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Printing;
public static class MzPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, IntPtr b, int n, out int w);
  public static void Raw(string printer, byte[] data, string title) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("PRINTER_NOT_FOUND");
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = title; di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di)) throw new Exception("PRINTER_REFUSED");
      try {
        StartPagePrinter(h);
        IntPtr p = Marshal.AllocCoTaskMem(data.Length);
        try { Marshal.Copy(data, 0, p, data.Length); int w; if (!WritePrinter(h, p, data.Length, out w) || w != data.Length) throw new Exception("PRINTER_WRITE_FAILED"); }
        finally { Marshal.FreeCoTaskMem(p); }
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
  public static void Images(string printer, List<byte[]> pages, string title, int copies, bool fitWidth) {
    List<Image> imgs = new List<Image>();
    foreach (byte[] b in pages) imgs.Add(Image.FromStream(new MemoryStream(b)));
    PrintDocument d = new PrintDocument();
    d.PrinterSettings.PrinterName = printer;
    if (!d.PrinterSettings.IsValid) throw new Exception("PRINTER_NOT_FOUND");
    d.DocumentName = title;
    d.PrintController = new StandardPrintController();
    d.DefaultPageSettings.Margins = new Margins(0, 0, 0, 0);
    if (copies > 1) d.PrinterSettings.Copies = (short)copies;
    int i = 0;
    d.PrintPage += delegate(object s, PrintPageEventArgs e) {
      Image im = imgs[i];
      RectangleF r = e.PageSettings.PrintableArea;
      float w = e.PageBounds.Width - r.X * 2; float hh = w * im.Height / im.Width;
      float maxH = e.PageBounds.Height - r.Y * 2;
      if (!fitWidth && hh > maxH) { hh = maxH; w = hh * im.Width / im.Height; }
      e.Graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;
      e.Graphics.DrawImage(im, 0, 0, w, hh);
      i++; e.HasMorePages = i < imgs.Count;
    };
    d.Print();
    foreach (Image im in imgs) im.Dispose();
  }
}
'@
}

function Get-Printers {
  if ($Fake) { return @(@{ name = 'Fake Receipt 80'; offline = $false; default = $true }, @{ name = 'Fake Label'; offline = $false; default = $false }) }
  $list = @()
  foreach ($p in (Get-CimInstance Win32_Printer)) {
    $off = [bool]$p.WorkOffline -or ($p.PrinterStatus -eq 7) -or ($p.ExtendedPrinterStatus -eq 7)
    $list += @{ name = $p.Name; offline = $off; default = [bool]$p.Default; port = $p.PortName }
  }
  return $list
}

function Send-Ip($hostName, $port, [byte[]]$data) {
  $c = New-Object System.Net.Sockets.TcpClient
  $ar = $c.BeginConnect($hostName, [int]$port, $null, $null)
  if (-not $ar.AsyncWaitHandle.WaitOne(4000)) { $c.Close(); throw 'PRINTER_UNREACHABLE' }
  $c.EndConnect($ar); $s = $c.GetStream(); $s.Write($data, 0, $data.Length); $s.Flush(); Start-Sleep -Milliseconds 200; $c.Close()
}

# ---------- queue ----------
$Jobs = New-Object System.Collections.ArrayList
function Save-Job($j) { $j | ConvertTo-Json -Depth 6 -Compress | Set-Content -Path (Join-Path $JobDir ($j.id + '.json')) -Encoding UTF8 }
function Load-Jobs {
  foreach ($f in (Get-ChildItem $JobDir -Filter *.json | Sort-Object Name)) {
    try { $o = Get-Content $f.FullName -Raw -Encoding UTF8 | ConvertFrom-Json; $h = @{}; foreach ($p in $o.PSObject.Properties) { $h[$p.Name] = $p.Value }
      if ($h.status -eq 'printing') { $h.status = 'waiting' }
      [void]$Jobs.Add($h) } catch { Remove-Item $f.FullName -Force }
  }
}
function Public-Job($j) { return @{ id = $j.id; title = $j.title; doc = $j.doc; printer = $j.printer; target = $j.target; status = $j.status; attempts = $j.attempts; error = $j.error; created = $j.created; done = $j.done; copies = $j.copies; pages = @($j.data).Count } }
function Trim-Done {
  $done = @($Jobs | Where-Object { $_.status -eq 'done' -or $_.status -eq 'cancelled' })
  if ($done.Count -gt $Cfg.keepDone) { $done | Select-Object -First ($done.Count - $Cfg.keepDone) | ForEach-Object { [void]$Jobs.Remove($_); Remove-Item (Join-Path $JobDir ($_.id + '.json')) -ErrorAction SilentlyContinue } }
  # finished jobs keep their record but drop the print data
  foreach ($j in $done) { if ($j.data) { $j.data = $null; Save-Job $j } }
}

function Print-One($j) {
  $target = $j.printer; $j.status = 'printing'; $j.attempts = [int]$j.attempts + 1
  if ($j.attempts -gt $Cfg.retries -and $j.fallback) { $target = $j.fallback; $j.target = $j.fallback }
  try {
    $pages = New-Object 'System.Collections.Generic.List[byte[]]'; foreach ($d in @($j.data)) { $pages.Add([Convert]::FromBase64String([string]$d)) }
    $copies = [Math]::Max(1, [int]$j.copies)
    if ($Fake) {
      if ($target -like '*OFFLINE*') { throw 'PRINTER_OFFLINE' }
      $i = 0; foreach ($b in $pages) { [IO.File]::WriteAllBytes((Join-Path $DataDir ('out-' + $j.id + '-' + $i + '.' + $j.mode)), $b); $i++ }
    } elseif ($j.ip) {
      $hp = $target.Split(':'); $port = 9100; if ($hp.Count -gt 1) { $port = [int]$hp[1] }
      for ($c = 0; $c -lt $copies; $c++) { foreach ($b in $pages) { Send-Ip $hp[0] $port $b } }
    } else {
      $p = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq $target }
      if (-not $p) { throw 'PRINTER_NOT_FOUND' }
      if ($p.WorkOffline -or $p.PrinterStatus -eq 7) { throw 'PRINTER_OFFLINE' }
      if ($j.mode -eq 'raw') { for ($c = 0; $c -lt $copies; $c++) { foreach ($b in $pages) { [MzPrint]::Raw($target, $b, [string]$j.title) } } }
      else { [MzPrint]::Images($target, $pages, [string]$j.title, $copies, [bool]$j.fitWidth) }
    }
    $j.status = 'done'; $j.error = $null; $j.done = (Get-Date).ToString('s')
    Log ('done ' + $j.id + ' ' + $target)
  } catch {
    $msg = $_.Exception.Message; if ($msg -notmatch '^PRINTER_') { $msg = 'PRINTER_ERROR: ' + $msg }
    $j.error = $msg; $j.nextTry = (Get-Date).AddSeconds($Cfg.retryDelaySec).ToString('o')
    $limit = $Cfg.retries; if ($j.fallback) { $limit = $Cfg.retries * 2 }
    if ($j.attempts -ge $limit) { $j.status = 'failed' } else { $j.status = 'waiting' }
    Log ('fail ' + $j.id + ' ' + $target + ' ' + $msg)
  }
  Save-Job $j
}

function Next-Job {
  $now = Get-Date
  foreach ($j in $Jobs) { if ($j.status -eq 'waiting' -and (-not $j.nextTry -or [datetime]::Parse($j.nextTry) -le $now)) { return $j } }
  return $null
}

# ---------- http ----------
function Send-Resp($stream, $code, $obj, $origin) {
  $body = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 6 -Compress))
  $reason = @{ 200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 413 = 'Too Large'; 500 = 'Error' }[$code]
  $h = "HTTP/1.1 $code $reason`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`n"
  if ($origin) { $h += "Access-Control-Allow-Origin: $origin`r`nVary: Origin`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: content-type`r`nAccess-Control-Allow-Private-Network: true`r`nAccess-Control-Max-Age: 600`r`n" }
  $hb = [Text.Encoding]::ASCII.GetBytes($h + "`r`n")
  $stream.Write($hb, 0, $hb.Length); if ($code -ne 204) { $stream.Write($body, 0, $body.Length) }; $stream.Flush()
}

function Read-Req($client) {
  $client.ReceiveTimeout = 5000; $s = $client.GetStream(); $buf = New-Object byte[] 65536; $ms = New-Object IO.MemoryStream; $hdrEnd = -1
  while ($hdrEnd -lt 0) {
    $n = $s.Read($buf, 0, $buf.Length); if ($n -le 0) { return $null }; $ms.Write($buf, 0, $n)
    $txt = [Text.Encoding]::ASCII.GetString($ms.ToArray()); $hdrEnd = $txt.IndexOf("`r`n`r`n")
    if ($ms.Length -gt 65536 -and $hdrEnd -lt 0) { return $null }
  }
  $all = $ms.ToArray(); $head = [Text.Encoding]::ASCII.GetString($all, 0, $hdrEnd); $lines = $head -split "`r`n"
  $first = $lines[0].Split(' '); $hd = @{}
  foreach ($l in $lines[1..($lines.Count - 1)]) { $i = $l.IndexOf(':'); if ($i -gt 0) { $hd[$l.Substring(0, $i).Trim().ToLower()] = $l.Substring($i + 1).Trim() } }
  $len = 0; if ($hd['content-length']) { $len = [int]$hd['content-length'] }
  if ($len -gt 25MB) { return @{ method = $first[0]; path = $first[1]; headers = $hd; tooLarge = $true } }
  $body = New-Object IO.MemoryStream; $start = $hdrEnd + 4; $body.Write($all, $start, $all.Length - $start)
  while ($body.Length -lt $len) { $n = $s.Read($buf, 0, $buf.Length); if ($n -le 0) { break }; $body.Write($buf, 0, $n) }
  return @{ method = $first[0]; path = $first[1].Split('?')[0]; headers = $hd; body = [Text.Encoding]::UTF8.GetString($body.ToArray()); stream = $s }
}

function Handle($client) {
  $r = Read-Req $client; if (-not $r) { return }
  $s = $client.GetStream(); $origin = $r.headers['origin']
  $okOrigin = $null; if ($origin -and ($Cfg.origins -contains $origin)) { $okOrigin = $origin }
  if ($origin -and -not $okOrigin) { Send-Resp $s 403 @{ error = 'ORIGIN_NOT_ALLOWED' } $null; return }
  if ($r.method -eq 'OPTIONS') { Send-Resp $s 204 @{} $okOrigin; return }
  if ($r.tooLarge) { Send-Resp $s 413 @{ error = 'TOO_LARGE' } $okOrigin; return }
  # writes must come from the site (a browser always sends Origin on POST)
  if ($r.method -eq 'POST' -and -not $okOrigin) { Send-Resp $s 403 @{ error = 'ORIGIN_REQUIRED' } $null; return }
  $b = $null; if ($r.body) { try { $b = $r.body | ConvertFrom-Json } catch { Send-Resp $s 400 @{ error = 'BAD_JSON' } $okOrigin; return } }
  switch ($r.path) {
    '/status' {
      $q = @{ waiting = @($Jobs | Where-Object { $_.status -eq 'waiting' -or $_.status -eq 'printing' }).Count; failed = @($Jobs | Where-Object { $_.status -eq 'failed' }).Count }
      Send-Resp $s 200 @{ ok = $true; app = 'minzo-print'; version = $Version; computer = $env:COMPUTERNAME; printers = @(Get-Printers); queue = $q } $okOrigin
    }
    '/jobs' { $l = @($Jobs | Select-Object -Last 60 | ForEach-Object { Public-Job $_ }); [array]::Reverse($l); Send-Resp $s 200 @{ jobs = $l } $okOrigin }
    '/print' {
      if (-not $b -or -not $b.printer -or -not $b.data) { Send-Resp $s 400 @{ error = 'BAD_JOB' } $okOrigin; return }
      $mode = 'raw'; if ($b.mode -eq 'image') { $mode = 'image' }
      $j = @{ id = (Get-Date).ToString('yyyyMMddHHmmssfff') + '-' + (Get-Random -Maximum 9999); title = [string]$b.title; doc = [string]$b.doc; printer = [string]$b.printer; target = [string]$b.printer
        fallback = [string]$b.fallback; ip = [bool]$b.ip; mode = $mode; fitWidth = ($b.fitWidth -ne $false); copies = [Math]::Min(9, [Math]::Max(1, [int]$b.copies)); data = @($b.data)
        status = 'waiting'; attempts = 0; error = $null; created = (Get-Date).ToString('s'); done = $null; nextTry = $null }
      if (-not $j.title) { $j.title = 'SYS Minzo' }
      [void]$Jobs.Add($j); Save-Job $j
      Send-Resp $s 200 @{ id = $j.id } $okOrigin
    }
    '/jobs/retry' { $j = $Jobs | Where-Object { $_.id -eq $b.id } | Select-Object -First 1
      if (-not $j -or -not $j.data) { Send-Resp $s 404 @{ error = 'JOB_NOT_FOUND' } $okOrigin; return }
      $j.status = 'waiting'; $j.attempts = 0; $j.nextTry = $null; $j.target = $j.printer; Save-Job $j; Send-Resp $s 200 @{ ok = $true } $okOrigin }
    '/jobs/cancel' { $j = $Jobs | Where-Object { $_.id -eq $b.id } | Select-Object -First 1
      if (-not $j) { Send-Resp $s 404 @{ error = 'JOB_NOT_FOUND' } $okOrigin; return }
      if ($j.status -ne 'done') { $j.status = 'cancelled'; $j.data = $null; Save-Job $j }; Send-Resp $s 200 @{ ok = $true } $okOrigin }
    '/jobs/clear' { @($Jobs | Where-Object { $_.status -eq 'done' -or $_.status -eq 'cancelled' }) | ForEach-Object { [void]$Jobs.Remove($_); Remove-Item (Join-Path $JobDir ($_.id + '.json')) -ErrorAction SilentlyContinue }
      Send-Resp $s 200 @{ ok = $true } $okOrigin }
    default { Send-Resp $s 404 @{ error = 'NOT_FOUND' } $okOrigin }
  }
}

Load-Jobs
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, [int]$Cfg.port)
$listener.Start()
Log ("started v$Version on 127.0.0.1:" + $Cfg.port)
$lastTrim = Get-Date
while ($true) {
  try {
    if ($listener.Pending()) {
      $client = $listener.AcceptTcpClient()
      try { Handle $client } catch { Log ('http ' + $_.Exception.Message) } finally { $client.Close() }
      continue
    }
    $j = Next-Job
    if ($j) { Print-One $j; continue }
    if (((Get-Date) - $lastTrim).TotalMinutes -ge 10) { Trim-Done; $lastTrim = Get-Date }
    Start-Sleep -Milliseconds 60
  } catch { Log ('loop ' + $_.Exception.Message); Start-Sleep -Milliseconds 500 }
}
