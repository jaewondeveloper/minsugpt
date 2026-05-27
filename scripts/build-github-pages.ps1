# Builds GitHub Pages from minsugpt-6.html (UI source of truth)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $root 'minsugpt-6.html'
$appDir = Join-Path $root 'app'
$cssDir = Join-Path $appDir 'assets\css'
$jsDir = Join-Path $appDir 'assets\js'
$partialDir = Join-Path $appDir 'partials'

$html = Get-Content $src -Raw -Encoding UTF8
if ($html -notmatch '(?s)<style>(.*?)</style>') { throw 'No style block' }
$allCss = $Matches[1].Trim()
if ($html -notmatch '(?s)<body([^>]*)>(.*?)</body>') { throw 'No body' }
$bodyAttrs = $Matches[1]
$bodyInner = $Matches[2].Trim()
$bodyInner = [regex]::Replace($bodyInner, '(?s)\s*<script>.*?</script>\s*$', '').Trim()
if ($html -notmatch '(?s)<script>\s*(.*?)\s*</script>\s*</body>') { throw 'No script' }
$allJs = $Matches[1].Trim()

New-Item -ItemType Directory -Force -Path $cssDir, $jsDir, $partialDir | Out-Null

# CSS: core + responsive (keeps @media blocks intact)
if ($allCss -match '(?s)(.*?)/\* @css responsive \*/(.*)') {
  $Matches[1].Trim() | Set-Content (Join-Path $cssDir 'core.css') -Encoding UTF8
  ('/* @css responsive */' + "`r`n" + $Matches[2].Trim()) | Set-Content (Join-Path $cssDir 'responsive.css') -Encoding UTF8
} else {
  $allCss | Set-Content (Join-Path $cssDir 'core.css') -Encoding UTF8
}

# HTML partials
$partialNames = @('mobile', 'sidebar', 'main', 'modals')
$pattern = '(?s)<!-- MINSU_PARTIAL:(\w+) -->\s*'
$segments = [regex]::Split($bodyInner, $pattern)
for ($i = 1; $i -lt $segments.Length; $i += 2) {
  $name = $segments[$i]
  $content = $segments[$i + 1]
  if ($name -in $partialNames) {
    $content.Trim() | Set-Content (Join-Path $partialDir "$name.html") -Encoding UTF8
  }
}

$assembledBody = ''
foreach ($name in $partialNames) {
  $p = Join-Path $partialDir "$name.html"
  if (Test-Path $p) {
    $assembledBody += (Get-Content $p -Raw -Encoding UTF8).Trim() + "`r`n`r`n"
  }
}

# JS modules (safe marker split)
$guard = @'
if (!window.__MINSUGPT_BOOT__) {
  throw new Error("MinsuGPT: load app/index.html — this module cannot run alone.");
}
'@
$jsParts = [regex]::Split($allJs, '/\* @js [a-z]+ \*/')
$jsNames = @('01-core.js', '02-messages.js', '03-stream-boot.js')
for ($j = 0; $j -lt $jsParts.Length; $j++) {
  $slice = $jsParts[$j].Trim()
  if (-not $slice) { continue }
  $fname = if ($j -lt $jsNames.Length) { $jsNames[$j] } else { "04-extra-$j.js" }
  ($guard + "`r`n" + $slice) | Set-Content (Join-Path $jsDir $fname) -Encoding UTF8
}

# app/index.html — real UI
$cssLinks = @(
  '  <link rel="stylesheet" href="assets/css/core.css">'
  '  <link rel="stylesheet" href="assets/css/responsive.css">'
) -join "`r`n"

$jsScripts = "  <script>window.__MINSUGPT_BOOT__=true;</script>`r`n"
Get-ChildItem $jsDir -Filter '*.js' | Sort-Object Name | ForEach-Object {
  $jsScripts += "  <script src=`"assets/js/$($_.Name)`"></script>`r`n"
}

$appIndex = @"
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>MinsuGPT</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script src="https://code.iconify.design/iconify-icon/1.0.8/iconify-icon.min.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Google+Sans:ital,opsz,wght@0,17..18,400..700;1,17..18,400..700&display=swap" rel="stylesheet">
$cssLinks
</head>
<body$bodyAttrs>
$assembledBody
$jsScripts</body>
</html>
"@

$appIndex | Set-Content (Join-Path $appDir 'index.html') -Encoding UTF8

# Root index.html — iframe shell only (save page shows blank shell)
$shell = @'
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>MinsuGPT</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #ffffff; }
    iframe { border: 0; width: 100%; height: 100%; display: block; }
  </style>
</head>
<body>
  <iframe src="app/index.html" title="MinsuGPT" allow="clipboard-write"></iframe>
</body>
</html>
'@
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $root 'index.html'), $shell, $utf8NoBom)

# 404 page (keep in sync with 404.html — UTF-8 without BOM)
$notFoundPath = Join-Path $root '404.html'
if (-not (Test-Path $notFoundPath)) {
  throw 'Missing 404.html template in repo root'
}

'' | Set-Content (Join-Path $root '.nojekyll') -Encoding UTF8

# Remove legacy root bundle (caused broken mobile/desktop CSS)
$legacyCss = Join-Path $root 'assets\css'
$legacyJs = Join-Path $root 'assets\js\app.js'
if (Test-Path $legacyCss) { Remove-Item $legacyCss -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path $legacyJs) { Remove-Item $legacyJs -Force -ErrorAction SilentlyContinue }
$legacyShell = Join-Path $root 'partials\shell'
if (Test-Path $legacyShell) { Remove-Item $legacyShell -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host 'Built: index.html (iframe), app/index.html + partials/assets'
