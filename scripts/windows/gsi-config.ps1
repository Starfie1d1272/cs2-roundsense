[CmdletBinding()]
param(
  [ValidateSet('Status', 'Install', 'Restore')][string]$Action = 'Status',
  [string]$CfgDirectory,
  [string]$Source,
  [string]$SteamDirectory
)
$ErrorActionPreference = 'Stop'
# Only this basename is owned by RoundSense. Other GSI files are read for
# endpoint diagnostics, never overwritten, moved, disabled, or deleted.
$OwnedName = 'gamestate_integration_roundsense.cfg'
$StateRoot = Join-Path $env:LOCALAPPDATA 'RoundSense\gsi-backups'

function Get-CfgDirectories {
  if ($CfgDirectory) {
    $resolved = [IO.Path]::GetFullPath($CfgDirectory)
    if (-not (Test-Path -LiteralPath $resolved -PathType Container)) { throw 'CfgDirectory does not exist.' }
    return @($resolved)
  }
  $roots = @()
  if ($SteamDirectory) {
    if (-not (Test-Path -LiteralPath $SteamDirectory -PathType Container)) { throw 'SteamDirectory does not exist.' }
    $roots += [IO.Path]::GetFullPath($SteamDirectory)
  } else {
    foreach ($key in @('HKCU:\Software\Valve\Steam', 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam')) {
      if (Test-Path $key) {
        $entry = Get-ItemProperty $key
        foreach ($value in @($entry.SteamPath, $entry.InstallPath)) { if ($value) { $roots += $value } }
      }
    }
  }
  $libraries = @($roots)
  foreach ($root in $roots) {
    $vdf = Join-Path $root 'steamapps\libraryfolders.vdf'
    if (Test-Path -LiteralPath $vdf) {
      $content = [IO.File]::ReadAllText($vdf)
      foreach ($match in [regex]::Matches($content, '"path"\s+"([^"\r\n]+)"')) { $libraries += $match.Groups[1].Value.Replace('\\', '\') }
    }
  }
  $directories = @()
  foreach ($library in ($libraries | Select-Object -Unique)) {
    $names = @('Counter-Strike 2', 'Counter-Strike Global Offensive')
    $manifest = Join-Path $library 'steamapps\appmanifest_730.acf'
    if (Test-Path -LiteralPath $manifest) {
      $match = [regex]::Match([IO.File]::ReadAllText($manifest), '"installdir"\s+"([^"\r\n]+)"')
      # Steam installdir is one folder name, never an arbitrary path.
      if ($match.Success -and $match.Groups[1].Value -notmatch '[/\\:]' -and $match.Groups[1].Value -notin @('.', '..')) { $names = @($match.Groups[1].Value) }
    }
    foreach ($name in $names) {
      $path = Join-Path (Join-Path $library ('steamapps\common\' + $name)) 'game\csgo\cfg'
      if (Test-Path -LiteralPath $path -PathType Container) { $directories += [IO.Path]::GetFullPath($path) }
    }
  }
  return @($directories | Select-Object -Unique)
}
function Get-Endpoint([string]$path) {
  $content = [IO.File]::ReadAllText($path)
  $match = [regex]::Match($content, '"uri"\s+"([^"\r\n]+)"')
  if (-not $match.Success) { return '(endpoint unavailable)' }
  $uri = $null
  if (-not [Uri]::TryCreate($match.Groups[1].Value, [UriKind]::Absolute, [ref]$uri)) { return '(invalid endpoint)' }
  # Userinfo and query may contain secrets; report the origin/path only.
  return $uri.GetLeftPart([UriPartial]::Authority).Replace($uri.UserInfo + '@', '') + $uri.AbsolutePath
}
function Get-StatePath([string]$directory) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($directory.ToLowerInvariant()))).Replace('-', '') }
  finally { $sha.Dispose() }
  return Join-Path $StateRoot ($hash + '.json')
}
$directories = @(Get-CfgDirectories)
if (-not $directories.Count) { throw 'CS2 cfg directory not found. Pass -CfgDirectory explicitly.' }
foreach ($directory in $directories) {
  Write-Host "CS2 cfg: $directory"
  foreach ($file in Get-ChildItem -LiteralPath $directory -Filter 'gamestate_integration_*.cfg' -File) {
    $owner = if ($file.Name -eq $OwnedName) { 'RoundSense (managed)' } else { 'Other tool (unchanged)' }
    Write-Host ("  {0} | {1} | {2}" -f $file.Name, $owner, (Get-Endpoint $file.FullName))
  }
}
if ($Action -eq 'Status') { return }
if ($directories.Count -ne 1) { throw 'Multiple CS2 installations found. Pass -CfgDirectory to choose one.' }
$directory = $directories[0]
$destination = Join-Path $directory $OwnedName
$statePath = Get-StatePath $directory
$utf8 = New-Object Text.UTF8Encoding($false)
if ($Action -eq 'Restore') {
  if (-not (Test-Path -LiteralPath $statePath)) { throw 'No managed installation to restore.' }
  $state = [IO.File]::ReadAllText($statePath) | ConvertFrom-Json
  if (-not (Test-Path -LiteralPath $destination)) { throw 'Managed file is missing; no files changed.' }
  if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $state.installedHash) { throw 'Managed file changed after installation; preserve it before restoring.' }
  if ($state.originalBackup) { Copy-Item -LiteralPath $state.originalBackup -Destination $destination -Force }
  else { Remove-Item -LiteralPath $destination }
  Remove-Item -LiteralPath $statePath
  Write-Host 'Restored the previous RoundSense config. Other GSI files are unchanged.'
  return
}
if (-not $Source -or -not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw 'Install requires -Source pointing to the generated cfg.' }
$content = [IO.File]::ReadAllText([IO.Path]::GetFullPath($Source))
if ($content -notmatch '^"RoundSense v\.' -or $content -notmatch '"heartbeat"\s+"1\.0"') { throw 'Generate a current HUD config with pnpm hud --cfg-out <path> first.' }
$endpoint = [regex]::Match($content, '"uri"\s+"(http://127\.0\.0\.1:\d+/)"')
if (-not $endpoint.Success -or $content -notmatch '"token"\s+"[^"\r\n]+"') { throw 'Expected an authenticated loopback RoundSense config.' }
foreach ($file in Get-ChildItem -LiteralPath $directory -Filter 'gamestate_integration_*.cfg' -File) {
  if ($file.Name -ne $OwnedName -and (Get-Endpoint $file.FullName).StartsWith(([Uri]$endpoint.Groups[1].Value).GetLeftPart([UriPartial]::Authority) + '/')) {
    Write-Warning ("{0} also targets the RoundSense endpoint. It is unchanged; disable that old config manually if it belongs to a retired tool." -f $file.Name)
  }
}
New-Item -ItemType Directory -Force -Path $StateRoot | Out-Null
$backup = $null
if (Test-Path -LiteralPath $destination) {
  if ([IO.File]::ReadAllText($destination) -notmatch '^"RoundSense v\.') { throw 'The reserved filename contains an unrecognized config. No files changed.' }
  $backup = Join-Path $StateRoot (([guid]::NewGuid().ToString()) + '.cfg')
  Copy-Item -LiteralPath $destination -Destination $backup
}
# Preserve the pre-first-install backup across idempotent reinstallation.
$original = $backup
if (Test-Path -LiteralPath $statePath) {
  $previous = [IO.File]::ReadAllText($statePath) | ConvertFrom-Json
  if ((Test-Path -LiteralPath $destination) -and (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $previous.installedHash) { throw 'Managed config changed externally; no files changed.' }
  $original = $previous.originalBackup
}
$temp = $destination + '.' + [guid]::NewGuid().ToString() + '.tmp'
[IO.File]::WriteAllText($temp, $content, $utf8)
Move-Item -LiteralPath $temp -Destination $destination -Force
$state = @{ originalBackup = $original; installedHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash }
[IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json), $utf8)
Write-Host 'RoundSense HUD config installed (UTF-8 without BOM). Restart CS2 to load it.'
Write-Host 'Other GSI configurations are unchanged. The token was not printed.'
