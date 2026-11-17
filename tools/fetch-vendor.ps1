# Downloads the pinned front-end libraries from the npm registry and copies
# the needed files into src/MDReader/wwwroot/vendor. Run once; output is committed.
$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $root 'src\MDReader\wwwroot\vendor'
$tmp    = Join-Path ([IO.Path]::GetTempPath()) ("mdr-vendor-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force $tmp, $vendor | Out-Null

$packages = @(
  @{ name='markdown-it';              ver='14.1.0';  files=@{ 'dist/markdown-it.min.js'='markdown-it.min.js' } },
  @{ name='markdown-it-footnote';     ver='4.0.0';   files=@{ 'dist/markdown-it-footnote.min.js'='markdown-it-footnote.min.js' } },
  @{ name='dompurify';                ver='3.1.6';   files=@{ 'dist/purify.min.js'='purify.min.js' } },
  @{ name='@highlightjs/cdn-assets';  ver='11.9.0';  files=@{ 'highlight.min.js'='highlight.min.js'; 'styles/github.min.css'='hljs-light.css'; 'styles/github-dark.min.css'='hljs-dark.css' } },
  @{ name='katex';                    ver='0.16.9';  files=@{ 'dist/katex.min.js'='katex/katex.min.js'; 'dist/katex.min.css'='katex/katex.min.css'; 'dist/fonts'='katex/fonts' } },
  @{ name='mermaid';                  ver='10.9.1';  files=@{ 'dist/mermaid.min.js'='mermaid.min.js' } },
  @{ name='codemirror';               ver='5.65.16'; files=@{
      'lib/codemirror.js'='codemirror/codemirror.js'; 'lib/codemirror.css'='codemirror/codemirror.css';
      'mode/markdown/markdown.js'='codemirror/markdown.js'; 'mode/gfm/gfm.js'='codemirror/gfm.js';
      'mode/xml/xml.js'='codemirror/xml.js'; 'addon/mode/overlay.js'='codemirror/overlay.js';
      'addon/edit/continuelist.js'='codemirror/continuelist.js'; 'addon/search/searchcursor.js'='codemirror/searchcursor.js' } }
)

foreach ($p in $packages) {
  $short = ($p.name -split '/')[-1]
  $url = "https://registry.npmjs.org/$($p.name)/-/$short-$($p.ver).tgz"
  $dir = Join-Path $tmp ($short + '-' + $p.ver)
  New-Item -ItemType Directory -Force $dir | Out-Null
  $tgz = Join-Path $dir 'pkg.tgz'
  Write-Host "Downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $tgz -UseBasicParsing
  tar -xzf $tgz -C $dir
  foreach ($src in $p.files.Keys) {
    $from = Join-Path $dir ('package/' + $src)
    $to   = Join-Path $vendor $p.files[$src]
    New-Item -ItemType Directory -Force (Split-Path -Parent $to) | Out-Null
    if (Test-Path $from -PathType Container) {
      New-Item -ItemType Directory -Force $to | Out-Null
      Get-ChildItem $from -Filter *.woff2 | Copy-Item -Destination $to -Force
    } else { Copy-Item $from $to -Force }
  }
}
Remove-Item -Recurse -Force $tmp
Write-Host "Vendor files written to $vendor"
