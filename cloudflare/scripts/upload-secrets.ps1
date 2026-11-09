# Upload the backend's LOCAL development .env values to Workers secrets.
# Run from cloudflare/ after npx wrangler login + initial deploy.
# Never prints secret values. Does not write them to GitHub or wrangler.jsonc.
param(
  [string]$EnvFile = (Join-Path $PSScriptRoot "..\..\design-engineer-backend\.env")
)
$ErrorActionPreference = "Stop"
$EnvFile = [IO.Path]::GetFullPath($EnvFile)
if (!(Test-Path $EnvFile)) { throw "File not found: $EnvFile" }
$values = @{}
foreach($line in [IO.File]::ReadAllLines($EnvFile)) {
  $row=$line.Trim()
  if (!$row -or $row.StartsWith("#")) { continue }
  $pair=$row.Split("=",2)
  if($pair.Count -ne 2) { continue }
  $key=$pair[0].Trim()
  $val=$pair[1].Trim()
  if(($val.StartsWith('"') -and $val.EndsWith('"')) -or
     ($val.StartsWith("'") -and $val.EndsWith("'"))) {
    $val=$val.Substring(1,$val.Length-2)
  }
  $values[$key]=$val
}
$required=@(
 "SUPABASE_URL",
 "SUPABASE_PUBLISHABLE_KEY",
 "SUPABASE_SERVICE_ROLE_KEY",
 "GITHUB_CLIENT_ID",
 "GITHUB_CLIENT_SECRET",
 "ENCRYPTION_KEY",
 "BACKEND_URL",
 "GATEWAY_SHARED_SECRET"
)
foreach($name in $required) {
  if (!$values.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($values[$name])) {
    throw "Missing required setting in .env: $name"
  }
}
if($values["BACKEND_URL"] -notmatch '^https://[^/]+\.workers\.dev/?$' -and
   $values["BACKEND_URL"] -notmatch '^https://[^/]+$') {
  throw "BACKEND_URL must be your publicly reachable HTTPS Worker URL."
}
if($values["GATEWAY_SHARED_SECRET"].Length -lt 32) {
  throw "GATEWAY_SHARED_SECRET must be at least 32 characters."
}
foreach($name in $required) {
  Write-Host "Setting Cloudflare Worker secret $name ..."
  # Wrangler's secret put accepts stdin; never pass keys as command-line args.
  $values[$name] | & npx wrangler secret put $name
  if($LASTEXITCODE -ne 0) { throw "Unable to save Worker secret: $name" }
}
Write-Host "Secret upload completed. Credentials never printed."
