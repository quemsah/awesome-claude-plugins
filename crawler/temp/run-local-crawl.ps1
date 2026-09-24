$ErrorActionPreference = 'Stop'

$tempRoot = $PSScriptRoot
$crawlerRoot = (Resolve-Path (Join-Path $tempRoot '..')).Path
$repoRoot = (Resolve-Path (Join-Path $crawlerRoot '..')).Path
$runsRoot = Join-Path $tempRoot 'runs'
$runName = 'run-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$runRoot = Join-Path $runsRoot $runName
$dbPath = Join-Path $runRoot 'catalog.sqlite'
$logPath = Join-Path $runRoot 'crawl.log'
$stderrPath = Join-Path $runRoot 'crawl-stderr.log'
$exportPath = Join-Path $runRoot 'export'
$cliPath = Join-Path $crawlerRoot 'dist/cli.js'
$comparePath = Join-Path $tempRoot 'compare-pilot.mjs'
$progressPath = Join-Path $tempRoot 'progress.mjs'

New-Item -ItemType Directory -Path $runRoot -Force | Out-Null

$baselineDb = Get-ChildItem -LiteralPath $runsRoot -Filter 'catalog.sqlite' -Recurse -File |
  Where-Object { $_.FullName -ne $dbPath } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
$baselineDurationMs = $null
if ($baselineDb) {
  $baselineRaw = & node $progressPath $baselineDb.FullName
  if ($LASTEXITCODE -eq 0) {
    $baseline = ConvertFrom-Json -InputObject ($baselineRaw -join '')
    if ($baseline.status -eq 'completed' -and $baseline.durationMs -gt 0) {
      $baselineDurationMs = [double]$baseline.durationMs
      Write-Host ("ETA baseline: {0} repos, {1:N1} hours from previous completed local crawl." -f $baseline.total, ($baselineDurationMs / 3600000))
    }
  }
}

function Write-ProgressSnapshot {
  if (-not (Test-Path -LiteralPath $dbPath -PathType Leaf)) {
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Progress snapshot unavailable; database is still starting."
    return
  }
  $raw = & node $progressPath $dbPath
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Progress snapshot unavailable yet."
    return
  }
  $progress = ConvertFrom-Json -InputObject ($raw -join '')
  $now = Get-Date
  $repoRate = $null
  $enrichedRate = $null
  $delta = 'first sample'
  if ($null -ne $script:previousProgress) {
    $sampleMinutes = [math]::Max(0.01, ($now - $script:previousProgressAt).TotalMinutes)
    $repoDelta = $progress.total - $script:previousProgress.total
    $enrichedDelta = $progress.enriched - $script:previousProgress.enriched
    $repoRate = [math]::Max(0, $repoDelta / $sampleMinutes)
    $enrichedRate = [math]::Max(0, $enrichedDelta / $sampleMinutes)
    $delta = "change repos=$repoDelta, enriched=$enrichedDelta; rates=$('{0:N1}' -f $repoRate)/min, $('{0:N1}' -f $enrichedRate)/min"
  }
  if ($progress.status -ne 'running') {
    $eta = if ($progress.status -eq 'completed') { 'complete' } else { 'n/a' }
  } elseif ($progress.phase -eq 'enrichment' -and $enrichedRate -gt 0) {
    $etaMinutes = $progress.pending / $enrichedRate
    $eta = "~$([math]::Floor($etaMinutes / 60))h $([math]::Floor($etaMinutes % 60))m (current enrichment rate)"
  } elseif ($null -ne $script:baselineDurationMs) {
    $etaMinutes = [math]::Max(0, ($script:baselineDurationMs - $progress.durationMs) / 60000)
    $eta = "~$([math]::Floor($etaMinutes / 60))h $([math]::Floor($etaMinutes % 60))m (previous-run baseline)"
  } else {
    $eta = 'n/a (waiting for a completed baseline)'
  }
  $eventSummary = if ($progress.events.Count) {
    ($progress.events | ForEach-Object { "$($_.phase):$($_.type)=$($_.count)" }) -join ', '
  } else {
    'none'
  }
  Write-Host "[$($now.ToString('yyyy-MM-dd HH:mm:ss'))] phase=$($progress.phase) status=$($progress.status) repos=$($progress.total) enriched=$($progress.enriched) pending=$($progress.pending) marketplace-counts=$($progress.marketplaceCounted); $delta; ETA=$eta; events=$eventSummary"
  $script:previousProgress = $progress
  $script:previousProgressAt = $now
}

Push-Location $crawlerRoot
try {
  Write-Host 'Building crawler...'
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Crawler build failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

$envNames = @(
  'DB_PATH', 'PUBLISH_ENABLED', 'GITHUB_READ_TOKEN', 'GITHUB_PUBLISH_TOKEN',
  'GITHUB_REPOSITORY', 'GITHUB_BRANCH', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
  'RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_SERVICE_ID'
)
$previousEnv = @{}
foreach ($name in $envNames) { $previousEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }

$crawlExitCode = 1
$process = $null
$script:previousProgress = $null
$script:previousProgressAt = $null
$script:baselineDurationMs = $baselineDurationMs
try {
  foreach ($name in $envNames) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
  $env:DB_PATH = $dbPath
  $env:PUBLISH_ENABLED = 'false'

  $secureToken = Read-Host 'Enter GitHub read token (input is hidden)' -AsSecureString
  if ($secureToken.Length -eq 0) { $secureToken.Dispose(); throw 'GitHub read token is required.' }
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
  try {
    $env:GITHUB_READ_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    Write-Host "Starting local crawl; database: $dbPath"
    $nodePath = (Get-Command node.exe).Source
    $process = Start-Process -FilePath $nodePath -ArgumentList "`"$cliPath`" crawl --dry-run" -WorkingDirectory $crawlerRoot -PassThru -NoNewWindow -RedirectStandardOutput $logPath -RedirectStandardError $stderrPath
    Write-ProgressSnapshot
    $lastProgressAt = Get-Date
    while ($true) {
      $process.Refresh()
      if ($process.HasExited) { break }
      if (((Get-Date) - $lastProgressAt).TotalSeconds -ge 30) {
        Write-ProgressSnapshot
        $lastProgressAt = Get-Date
      }
      Start-Sleep -Seconds 5
    }
    $process.WaitForExit()
    $crawlExitCode = $process.ExitCode
    Write-ProgressSnapshot
  } finally {
    Remove-Item -LiteralPath 'Env:GITHUB_READ_TOKEN' -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    $secureToken.Dispose()
  }

  if ($crawlExitCode -ne 0) { throw "Crawl failed with exit code $crawlExitCode. See $logPath" }

  $runId = $null
  foreach ($line in Get-Content -LiteralPath $logPath) {
    try {
      $entry = ConvertFrom-Json -InputObject $line -ErrorAction Stop
      if ($entry.status -eq 'draft' -and $entry.runId) { $runId = $entry.runId }
    } catch {
      # Ignore non-JSON progress lines in the CLI log.
    }
  }
  if (-not $runId) { throw "Crawl completed without a draft run ID. See $logPath" }

  Write-Host "Exporting draft for run $runId..."
  & node $cliPath export --run-id $runId --output-dir $exportPath 2>&1 | Tee-Object -FilePath $logPath -Append
  if ($LASTEXITCODE -ne 0) { throw "Draft export failed. See $logPath" }

  Write-Host 'Comparing the draft with the checked-in files...'
  & node $comparePath $repoRoot $exportPath $runRoot
  if ($LASTEXITCODE -ne 0) { throw "Comparison failed for $runRoot" }

  Write-Host "Local draft is ready: $runRoot"
  Write-Host "Review: $(Join-Path $runRoot 'comparison.md')"
} finally {
  if ($null -ne $process) {
    $process.Refresh()
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
  }
  foreach ($name in $envNames) {
    $value = $previousEnv[$name]
    if ($null -eq $value) {
      Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    } else {
      Set-Item -Path "Env:$name" -Value $value
    }
  }
}
