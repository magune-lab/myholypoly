$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$version = "$($packageJson.version).0"
$outputRoot = Join-Path $projectRoot 'release-msix'
$unpacked = Join-Path $outputRoot 'win-unpacked'
$appx = Join-Path $outputRoot "myholypoly-windows-x64-$($packageJson.version).appx"
$localSigning = Join-Path $env:LOCALAPPDATA 'myholypoly-signing'

if (-not $env:CSC_LINK) {
  $env:CSC_LINK = Join-Path $localSigning 'magune-lab-code-signing.pfx'
}

if (-not $env:CSC_KEY_PASSWORD) {
  $passwordFile = Join-Path $localSigning 'pfx-password.xml'
  if (-not (Test-Path -LiteralPath $passwordFile)) {
    throw "Signing password was not found: $passwordFile"
  }
  $savedSecret = Import-Clixml -LiteralPath $passwordFile
  if ($savedSecret -is [System.Management.Automation.PSCredential]) {
    $env:CSC_KEY_PASSWORD = $savedSecret.GetNetworkCredential().Password
  } elseif ($savedSecret -is [System.Security.SecureString]) {
    $env:CSC_KEY_PASSWORD = [System.Net.NetworkCredential]::new('', $savedSecret).Password
  } else {
    throw 'Unsupported signing password format.'
  }
}

if (-not (Test-Path -LiteralPath $env:CSC_LINK)) {
  throw "Signing certificate was not found: $env:CSC_LINK"
}

$sdkBin = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Directory |
  Sort-Object Name -Descending |
  Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'x64\makeappx.exe') } |
  Select-Object -First 1
if (-not $sdkBin) {
  throw 'Windows SDK MakeAppx/SignTool was not found.'
}
$makeAppx = Join-Path $sdkBin.FullName 'x64\makeappx.exe'
$signTool = Join-Path $sdkBin.FullName 'x64\signtool.exe'

Push-Location $projectRoot
try {
  & pnpm exec electron-builder --win dir
  if ($LASTEXITCODE -ne 0) { throw 'electron-builder failed.' }

  Add-Type -AssemblyName System.Drawing
  $assets = Join-Path $unpacked 'Assets'
  New-Item -ItemType Directory -Force -Path $assets | Out-Null
  $sourceIcon = [System.Drawing.Image]::FromFile((Join-Path $projectRoot 'assets\myholypoly.png'))
  try {
    $sizes = @{
      'StoreLogo.png' = @(50, 50)
      'Square44x44Logo.png' = @(44, 44)
      'Square44x44Logo.targetsize-16_altform-unplated.png' = @(16, 16)
      'Square44x44Logo.targetsize-24_altform-unplated.png' = @(24, 24)
      'Square44x44Logo.targetsize-32_altform-unplated.png' = @(32, 32)
      'Square44x44Logo.targetsize-44_altform-unplated.png' = @(44, 44)
      'Square44x44Logo.targetsize-48_altform-unplated.png' = @(48, 48)
      'Square44x44Logo.targetsize-256_altform-unplated.png' = @(256, 256)
      'Square150x150Logo.png' = @(150, 150)
      'Wide310x150Logo.png' = @(310, 150)
    }
    foreach ($entry in $sizes.GetEnumerator()) {
      $bitmap = New-Object System.Drawing.Bitmap $entry.Value[0], $entry.Value[1]
      try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
          $graphics.Clear([System.Drawing.Color]::Transparent)
          $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
          $side = [Math]::Min($entry.Value[0], $entry.Value[1])
          $x = [int](($entry.Value[0] - $side) / 2)
          $y = [int](($entry.Value[1] - $side) / 2)
          $graphics.DrawImage($sourceIcon, $x, $y, $side, $side)
        } finally { $graphics.Dispose() }
        $bitmap.Save((Join-Path $assets $entry.Key), [System.Drawing.Imaging.ImageFormat]::Png)
      } finally { $bitmap.Dispose() }
    }
  } finally { $sourceIcon.Dispose() }

  $manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap rescap">
  <Identity Name="magune-lab.myholypoly" Publisher="CN=magune-lab" Version="$version" ProcessorArchitecture="x64" />
  <Properties><DisplayName>myholypoly</DisplayName><PublisherDisplayName>magune-lab</PublisherDisplayName><Logo>Assets\StoreLogo.png</Logo></Properties>
  <Resources><Resource Language="ko-kr" /></Resources>
  <Dependencies><TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26200.0" /></Dependencies>
  <Applications><Application Id="myholypoly" Executable="myholypoly.exe" EntryPoint="Windows.FullTrustApplication"><uap:VisualElements DisplayName="myholypoly" Description="e-POLY homework planner" BackgroundColor="transparent" Square44x44Logo="Assets\Square44x44Logo.png" Square150x150Logo="Assets\Square150x150Logo.png"><uap:DefaultTile Wide310x150Logo="Assets\Wide310x150Logo.png" /></uap:VisualElements></Application></Applications>
  <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
</Package>
"@
  Set-Content -LiteralPath (Join-Path $unpacked 'AppxManifest.xml') -Value $manifest -Encoding utf8
  if (Test-Path -LiteralPath $appx) { Remove-Item -LiteralPath $appx -Force }

  & $makeAppx pack /d $unpacked /p $appx /o
  if ($LASTEXITCODE -ne 0) { throw 'MakeAppx failed.' }
  & $signTool sign /fd SHA256 /f $env:CSC_LINK /p $env:CSC_KEY_PASSWORD $appx
  if ($LASTEXITCODE -ne 0) { throw 'SignTool failed.' }
  Write-Host "Created signed package: $appx"
} finally {
  Pop-Location
  $env:CSC_KEY_PASSWORD = $null
}
