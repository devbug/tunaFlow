$ErrorActionPreference = "Stop"

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$TargetTriple = (& rustc --print host-tuple).Trim()
$DestDir = Join-Path $RootDir "src-tauri\binaries"
$DestPath = Join-Path $DestDir "rawq-$TargetTriple.exe"
$TargetDir = Join-Path $RootDir "src-tauri\target\rawq-sidecar"

$Candidates = @()
if ($env:RAWQ_SRC) {
  $Candidates += $env:RAWQ_SRC
} else {
  $Candidates += (Join-Path $RootDir "vendor\rawq")
  $Candidates += (Join-Path $RootDir "..\tunaDish\vendor\rawq")
  $Candidates += (Join-Path $RootDir "..\_research\_util\rawq")
}

$RawqSrcDir = $null
foreach ($candidate in $Candidates) {
  if (Test-Path (Join-Path $candidate "Cargo.toml")) {
    $RawqSrcDir = (Resolve-Path $candidate).Path
    break
  }
}

if (-not $RawqSrcDir) {
  Write-Error ("rawq source not found. Set RAWQ_SRC or place rawq at one of:`n  " + ($Candidates -join "`n  "))
}

Write-Host "[rawq] source: $RawqSrcDir"
Write-Host "[rawq] target: $TargetTriple"

New-Item -ItemType Directory -Force -Path $DestDir | Out-Null

cargo build --manifest-path (Join-Path $RawqSrcDir "Cargo.toml") --release --target-dir $TargetDir

Copy-Item (Join-Path $TargetDir "release\rawq.exe") $DestPath -Force

Write-Host "[rawq] installed sidecar: $DestPath"
