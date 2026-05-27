# Builds GitHub Pages layout from minsugpt-6.html
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$src = Join-Path $root 'minsugpt-6.html'
$out = $root

$html = Get-Content $src -Raw -Encoding UTF8
if ($html -notmatch '(?s)<style>(.*?)</style>') { throw 'No style' }
$allCss = $Matches[1].Trim()
if ($html -notmatch '(?s)<body([^>]*)>(.*?)</body>') { throw 'No body' }
$bodyAttrs = $Matches[1]
$bodyInner = $Matches[2].Trim()
if ($html -notmatch '(?s)<script>\s*(.*?)\s*</script>\s*</body>') { throw 'No script' }
$allJs = $Matches[1].Trim()

$cssDir = Join-Path $out 'assets\css'
$jsDir = Join-Path $out 'assets\js'
$pagesDir = Join-Path $out 'pages'
$stubDir = Join-Path $out 'assets\js\stubs'
$partialDir = Join-Path $out 'partials\shell'
New-Item -ItemType Directory -Force -Path $cssDir, $jsDir, $pagesDir, $stubDir, $partialDir | Out-Null

$cssLines = $allCss -split "`n"
$chunkSize = [Math]::Ceiling($cssLines.Count / 5)
$cssNames = @('tokens', 'layout', 'sidebar', 'chat', 'modals')
for ($i = 0; $i -lt 5; $i++) {
  $start = $i * $chunkSize
  $end = [Math]::Min($cssLines.Count - 1, $start + $chunkSize - 1)
  if ($start -le $end) {
    ($cssLines[$start..$end] -join "`n") | Set-Content (Join-Path $cssDir ($cssNames[$i] + '.css')) -Encoding UTF8
  }
}

$guard = @'
if (!window.__MINSUGPT_BOOT__) {
  throw new Error("MinsuGPT: open index.html — this script cannot run alone.");
}
'@

($guard + "`r`n" + $allJs) | Set-Content (Join-Path $jsDir 'app.js') -Encoding UTF8

@'
if (!window.__MINSUGPT_BOOT__) { throw new Error("Load index.html first"); }
'@ | Set-Content (Join-Path $stubDir 'chat-fragment.js') -Encoding UTF8

@'
<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>Docs</title></head>
<body><p>Sub-page fragment. Use <a href="../index.html">index.html</a>.</p></body></html>
'@ | Set-Content (Join-Path $pagesDir 'docs.html') -Encoding UTF8

$bodyInner | Set-Content (Join-Path $partialDir 'body.html') -Encoding UTF8

$cssLinks = ''
Get-ChildItem $cssDir -Filter '*.css' | Sort-Object Name | ForEach-Object {
  $cssLinks += "  <link rel=`"stylesheet`" href=`"assets/css/$($_.Name)`">`r`n"
}

$index = @"
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
$cssLinks</head>
<body$bodyAttrs>
$bodyInner
  <script>window.__MINSUGPT_BOOT__=true;</script>
  <script src="assets/js/app.js"></script>
</body>
</html>
"@

$index | Set-Content (Join-Path $out 'index.html') -Encoding UTF8
'' | Set-Content (Join-Path $out '.nojekyll') -Encoding UTF8
Write-Host "Built index.html + assets/js/app.js"
