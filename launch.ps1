$ErrorActionPreference = "SilentlyContinue"

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = "http://localhost:4287"

function Test-ServerUp {
    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 1
        return $resp.StatusCode -eq 200
    } catch {
        return $false
    }
}

if (-not (Test-ServerUp)) {
    Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $projectDir -WindowStyle Hidden

    $tries = 0
    while (-not (Test-ServerUp) -and $tries -lt 40) {
        Start-Sleep -Milliseconds 500
        $tries++
    }
}

Start-Process $url
