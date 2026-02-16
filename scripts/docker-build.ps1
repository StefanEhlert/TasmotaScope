# Docker Compose Build – setzt unter Windows den Docker-PATH und startet den Build.
# Nutzung: npm run docker:build  oder  .\scripts\docker-build.ps1

$dockerBin = "C:\Program Files\Docker\Docker\resources\bin"
if (Test-Path $dockerBin) {
    $env:Path = "$dockerBin;$env:Path"
}

Set-Location $PSScriptRoot\..
& docker compose build
exit $LASTEXITCODE
