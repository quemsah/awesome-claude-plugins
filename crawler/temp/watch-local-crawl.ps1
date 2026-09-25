param([string]$DatabasePath)

$ErrorActionPreference = 'Stop'
$tempRoot = $PSScriptRoot
$helperPath = Join-Path $tempRoot 'progress.mjs'

if (-not $DatabasePath) {
  $latest = Get-ChildItem -LiteralPath (Join-Path $tempRoot 'runs') -Filter 'catalog.sqlite' -Recurse -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $latest) { throw 'No local crawl database found under crawler/temp/runs.' }
  $DatabasePath = $latest.FullName
}
$DatabasePath = (Resolve-Path -LiteralPath $DatabasePath).Path
$previous = $null
$lastReportAt = $null

while ($true) {
  $raw = & node $helperPath $DatabasePath
  if ($LASTEXITCODE -ne 0) { throw 'Could not read crawl progress.' }
  $progress = ConvertFrom-Json -InputObject ($raw -join '')
  $now = Get-Date
  if ($null -eq $lastReportAt -or ($now - $lastReportAt).TotalMinutes -ge 5 -or $progress.status -ne 'running') {
    $delta = if ($null -eq $previous) {
      'first sample'
    } else {
      "change repos=$($progress.total - $previous.total), enriched=$($progress.enriched - $previous.enriched) since last report"
    }
    $events = if ($progress.events.Count) {
      ($progress.events | ForEach-Object { "$($_.phase):$($_.type)=$($_.count)" }) -join ', '
    } else {
      'none'
    }
    Write-Host "[$($now.ToString('yyyy-MM-dd HH:mm:ss'))] phase=$($progress.phase) status=$($progress.status) repos=$($progress.total) enriched=$($progress.enriched) pending=$($progress.pending) marketplace-counts=$($progress.marketplaceCounted); $delta; events=$events"
    $previous = $progress
    $lastReportAt = $now
  }
  if ($progress.status -ne 'running') { break }
  Start-Sleep -Seconds 10
}
