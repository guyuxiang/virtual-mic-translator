# setup-audio.ps1 — install VB-Cable without hijacking the user's speakers.
#
# VB-Cable's installer sets "CABLE Input" as the default playback device, which
# silences the real speakers. This script:
#   1. records the current default multimedia playback (Render) device
#   2. installs VB-Cable silently
#   3. restores the recorded device as the default for all roles
#
# Called by the NSIS installer (build/installer.nsh). Safe to re-run.

param([string]$DriverDir = $PSScriptRoot)

$ErrorActionPreference = 'SilentlyContinue'
$svv      = Join-Path $DriverDir 'SoundVolumeView.exe'
$vbcable  = Join-Path $DriverDir 'VBCABLE_Setup_x64.exe'
$saveFile = Join-Path $DriverDir 'default-render.txt'

function Get-DefaultRenderId {
  if (-not (Test-Path $svv)) { return $null }
  $csv = Join-Path $env:TEMP 'vmt_audio.csv'
  Remove-Item $csv -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath $svv -ArgumentList "/scomma `"$csv`"" -Wait -WindowStyle Hidden
  Start-Sleep -Milliseconds 600
  if (-not (Test-Path $csv)) { return $null }
  $rows = Import-Csv $csv
  Remove-Item $csv -Force -ErrorAction SilentlyContinue
  # Prefer the default *Multimedia* render device; fall back to default Console.
  $dev = $rows | Where-Object {
    $_.Type -eq 'Device' -and $_.Direction -eq 'Render' -and $_.'Default Multimedia' -ne ''
  } | Select-Object -First 1
  if (-not $dev) {
    $dev = $rows | Where-Object {
      $_.Type -eq 'Device' -and $_.Direction -eq 'Render' -and $_.Default -ne ''
    } | Select-Object -First 1
  }
  if ($dev) { return $dev.'Command-Line Friendly ID' }
  return $null
}

# 1. Capture the device that is default BEFORE VB-Cable steals it.
$savedId = Get-DefaultRenderId
if ($savedId) { Set-Content -Path $saveFile -Value $savedId -Encoding ASCII }

# 2. Install VB-Cable silently.
if (Test-Path $vbcable) {
  Start-Process -FilePath $vbcable -ArgumentList '-i','-h' -Wait
  Start-Sleep -Seconds 2
}

# 3. Restore the original default playback device (all roles), so the user's
#    speakers keep working. CABLE Input stays installed but is no longer default.
if ($savedId -and (Test-Path $svv)) {
  Start-Process -FilePath $svv -ArgumentList "/SetDefault `"$savedId`" all" -Wait -WindowStyle Hidden
}
