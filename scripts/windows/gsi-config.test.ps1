$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('roundsense-config-test-' + [guid]::NewGuid().ToString())
$oldLocalAppData = $env:LOCALAPPDATA
try {
  New-Item -ItemType Directory -Path $root | Out-Null
  $env:LOCALAPPDATA = Join-Path $root 'state'
  $cfg = Join-Path $root 'cfg'
  New-Item -ItemType Directory -Path $cfg | Out-Null
  $source = Join-Path $root 'source.cfg'
  $owned = Join-Path $cfg 'gamestate_integration_roundsense.cfg'
  $other = Join-Path $cfg 'gamestate_integration_mizar.cfg'
  $utf8 = New-Object Text.UTF8Encoding($false)
  $original = '"RoundSense v.0.1" { "uri" "http://127.0.0.1:3001/" "heartbeat" "60.0" }'
  $otherText = '"Mizar" { "uri" "http://127.0.0.1:3000/gsi" "auth" { "token" "secret-other-token" } }'
  [IO.File]::WriteAllText($owned, $original, $utf8)
  [IO.File]::WriteAllText($other, $otherText, $utf8)
  [IO.File]::WriteAllText($source, '"RoundSense v.0.1" { "uri" "http://127.0.0.1:3001/" "heartbeat" "1.0" "auth" { "token" "test-only-token" } }', $utf8)
  $tool = Join-Path $PSScriptRoot 'gsi-config.ps1'
  $steam = Join-Path $root 'steam'
  $library = Join-Path $root 'extra-library'
  $legacyCfg = Join-Path $steam 'steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg'
  $customCfg = Join-Path $library 'steamapps\common\Custom CS2\game\csgo\cfg'
  New-Item -ItemType Directory -Force -Path $legacyCfg, $customCfg | Out-Null
  [IO.File]::WriteAllText((Join-Path $steam 'steamapps\libraryfolders.vdf'), ('"libraryfolders" { "1" { "path" "' + $library.Replace('\', '\\') + '" } }'), $utf8)
  [IO.File]::WriteAllText((Join-Path $library 'steamapps\appmanifest_730.acf'), '"AppState" { "installdir" "Custom CS2" }', $utf8)
  $discovery = & $tool -Action Status -SteamDirectory $steam 6>&1 | Out-String
  if (-not $discovery.Contains([IO.Path]::GetFullPath($legacyCfg)) -or -not $discovery.Contains([IO.Path]::GetFullPath($customCfg))) { throw 'Steam library / legacy directory / appmanifest discovery failed.' }
  $output = & $tool -Action Status -CfgDirectory $cfg 6>&1 | Out-String
  if ($output -match 'secret-other-token') { throw 'Status exposed a token.' }
  & $tool -Action Install -CfgDirectory $cfg -Source $source
  & $tool -Action Install -CfgDirectory $cfg -Source $source
  $bytes = [IO.File]::ReadAllBytes($owned)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) { throw 'BOM introduced.' }
  & $tool -Action Restore -CfgDirectory $cfg
  if ([IO.File]::ReadAllText($owned) -ne $original) { throw 'Original config was not restored.' }
  if ([IO.File]::ReadAllText($other) -ne $otherText) { throw 'Other tool config changed.' }
  Remove-Item -LiteralPath $owned
  & $tool -Action Install -CfgDirectory $cfg -Source $source
  & $tool -Action Restore -CfgDirectory $cfg
  if (Test-Path -LiteralPath $owned) { throw 'Newly created config was not removed.' }
  if (-not (Test-Path -LiteralPath $other)) { throw 'Other tool config was removed.' }
  & $tool -Action Install -CfgDirectory $cfg -Source $source
  [IO.File]::AppendAllText($owned, '# changed')
  $rejected = $false
  try { & $tool -Action Restore -CfgDirectory $cfg } catch { $rejected = $true }
  if (-not $rejected) { throw 'External changes were overwritten.' }
  if ([IO.File]::ReadAllText($other) -ne $otherText) { throw 'Other tool config changed.' }
  Write-Host 'Config lifecycle tests passed: idempotent update, exact restore, BOM-free install, no token output, other-tool preservation, external-change protection.'
} finally {
  $env:LOCALAPPDATA = $oldLocalAppData
  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }
}
