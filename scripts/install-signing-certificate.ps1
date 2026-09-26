$ErrorActionPreference = 'Stop'

$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run PowerShell as Administrator, then run this script again.'
}

$certificate = Join-Path (Split-Path -Parent $PSScriptRoot) 'distribution\magune-lab.cer'
$installed = Import-Certificate -FilePath $certificate -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople'
Write-Host "Certificate installed: $($installed.Thumbprint)"
