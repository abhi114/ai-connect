$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'src/cli.ts') setup @args
exit $LASTEXITCODE
