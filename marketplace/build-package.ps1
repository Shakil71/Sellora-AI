# =============================================================================
# Sellora AI - builds every CodeCanyon upload file into marketplace\dist\upload
#
#   powershell -ExecutionPolicy Bypass -File marketplace\build-package.ps1
#
# The application ZIP is made with "git archive" from the last commit (HEAD), so
# it never contains .env, node_modules, build output, logs or uploads. Commit
# first; -AllowDirty builds anyway (uncommitted changes are NOT included).
# Needs Git and Google Chrome or Microsoft Edge (renders the preview images).
# =============================================================================
param([switch]$AllowDirty)
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $root
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$git = (Get-Command git -ErrorAction SilentlyContinue).Source
if (-not $git) { $git = @("$env:ProgramFiles\Git\cmd\git.exe", "${env:ProgramFiles(x86)}\Git\cmd\git.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1 }
if (-not $git) { throw 'Git is needed: install Git for Windows.' }
if (-not $AllowDirty -and (& $git status --porcelain)) {
  throw 'Uncommitted changes: commit them first, because the ZIP is built from the last commit (or pass -AllowDirty).'
}

$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw 'Google Chrome or Microsoft Edge is needed to render the preview images.' }
$tar = "$env:SystemRoot\System32\tar.exe"

$dist = Join-Path $root 'marketplace\dist'
$tmp = Join-Path $dist 'tmp'
$pkgName = "Sellora-AI-v$version"
$pkg = Join-Path $dist $pkgName
$upload = Join-Path $dist 'upload'
$shots = Join-Path $dist 'screenshots'
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
foreach ($d in $tmp, "$pkg\Documentation\assets", "$pkg\Licensing", $upload, $shots) { New-Item -ItemType Directory -Force $d | Out-Null }

function FileUrl([string]$path) { 'file:///' + ($path -replace '\\', '/') }

# Renders a page to a PNG of exactly $w x $h pixels. Each render gets its own
# browser profile, and helper processes left behind are stopped afterwards.
function Render([string]$url, [string]$out, [int]$w, [int]$h) {
  $userDir = Join-Path $tmp ('profile-' + [guid]::NewGuid().ToString('N'))
  $argList = @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--allow-file-access-from-files', '--force-device-scale-factor=1',
    "--user-data-dir=`"$userDir`"", "--window-size=$w,$h", "--screenshot=`"$out`"", "`"$url`"")
  $p = Start-Process -FilePath $browser -ArgumentList $argList -WindowStyle Hidden -PassThru
  if (-not $p.WaitForExit(60000)) { $p.Kill() }
  Get-CimInstance Win32_Process -Filter "name='chrome.exe' or name='msedge.exe'" |
    Where-Object { $_.CommandLine -like "*$userDir*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if (-not (Test-Path $out)) { throw "Could not render $url" }
}

Write-Host "Building Sellora AI v$version"

# 1. Application source -------------------------------------------------------
Write-Host '  sellora-ai.zip (from git HEAD)'
& $git archive --format=zip --prefix=sellora-ai/ -o "$pkg\sellora-ai.zip" HEAD
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }

# 2. Screenshots (product screenshots shipped with the web app) ------------------
Write-Host '  screenshots'
$list = [ordered]@{
  '01-dashboard' = 'dashboard-light'; '02-inbox' = 'inbox-light'; '03-orders' = 'orders-light'
  '04-pipeline' = 'pipeline-light'; '05-automation' = 'workflow-light'; '06-analytics' = 'analytics-light'
  '07-dashboard-dark' = 'dashboard-dark'; '08-inbox-dark' = 'inbox-dark'; '09-orders-dark' = 'orders-dark'
  '10-pipeline-dark' = 'pipeline-dark'; '11-automation-dark' = 'workflow-dark'; '12-analytics-dark' = 'analytics-dark'
  '13-mobile-inbox' = 'mobile-inbox-light'; '14-mobile-inbox-dark' = 'mobile-inbox-dark'
}
foreach ($name in $list.Keys) {
  $src = Join-Path $root "apps\web\public\marketing\$($list[$name]).webp"
  $w, $h = if ($name -like '*mobile*') { 780, 1688 } else { 1920, 1200 }
  $page = Join-Path $tmp "$name.html"
  "<!doctype html><html><body style=`"margin:0;overflow:hidden`"><img src=`"$(FileUrl $src)`" style=`"display:block;width:${w}px;height:${h}px`"></body></html>" |
    Set-Content -Encoding UTF8 $page
  Render (FileUrl $page) (Join-Path $shots "$name.png") $w $h
}

# 3. Documentation and licensing -------------------------------------------------
Write-Host '  Documentation, Licensing, README.txt'
(Get-Content marketplace\documentation\index.html -Raw -Encoding UTF8).Replace('{{VERSION}}', $version) |
  Set-Content -Encoding UTF8 "$pkg\Documentation\index.html"
Copy-Item "$shots\01-dashboard.png" "$pkg\Documentation\assets\dashboard.png"
Copy-Item "$shots\02-inbox.png" "$pkg\Documentation\assets\inbox.png"
Copy-Item "$shots\03-orders.png" "$pkg\Documentation\assets\orders.png"
Copy-Item docs\Sellora-AI-Installation-Guide.docx "$pkg\Documentation\"
Copy-Item LICENSE.md, docs\THIRD_PARTY_LICENSES.md "$pkg\Licensing\"
(Get-Content marketplace\README.txt -Raw).Replace('{{VERSION}}', $version).Replace("`r`n", "`n").Replace("`n", "`r`n") |
  Set-Content -Encoding ASCII -NoNewline "$pkg\README.txt"

# 4. Preview images ----------------------------------------------------------------
Write-Host '  thumbnail and inline preview'
Render (FileUrl "$root\marketplace\preview\thumbnail.html") "$upload\thumbnail-80x80.png" 80 80
Render (FileUrl "$root\marketplace\preview\inline.html") "$upload\inline-preview-590x300.png" 590 300

# 5. Upload ZIPs (Windows tar.exe writes standard ZIP files) -------------------------
Write-Host '  ZIP files'
& $tar -a -c -f "$upload\$pkgName.zip" -C $dist $pkgName
& $tar -a -c -f "$upload\screenshots.zip" -C $shots (Get-ChildItem $shots -Filter *.png).Name
Copy-Item marketplace\listing\description.html "$upload\item-description.html"

Remove-Item -Recurse -Force $tmp
Write-Host ''
Write-Host "Done. Upload files in $upload :"
Get-ChildItem $upload | ForEach-Object { '  {0,-34} {1,8:N0} KB' -f $_.Name, ($_.Length / 1KB) }
