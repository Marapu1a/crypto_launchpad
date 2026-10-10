param([string]$StateDirectory = "$env:USERPROFILE\.crypto-launchpad-watchdog")
$ErrorActionPreference = 'Stop'
$project = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$stateRoot = [System.IO.Path]::GetFullPath($StateDirectory)
New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
$configFile = Join-Path $stateRoot 'config.json'
if (Test-Path -LiteralPath $configFile) { throw 'Existing watchdog config: inspect before replacing' }
$config = @{
    schema = 'launchpad-local-watchdog-v1'
    stateDirectory = $stateRoot
    apiUrl = 'https://qianqi.site/v1/overview?limit=1'
    backups = @(
        @{id='qianqi';kind='native';directory="$env:USERPROFILE\.qianqi-backups";maxArchiveHours=30;maxPullHours=3},
        @{id='platform';kind='platform';directory="$env:USERPROFILE\.crypto-launchpad-backups";maxArchiveHours=9;maxPullHours=3}
    )
}
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configFile -Encoding UTF8
$node = (Get-Command node.exe).Source
$runner = Join-Path $project 'ops/watchdog/run.mjs'
$command = '"' + $node + '" "' + $runner + '" "' + $configFile + '"'
$vbs = 'Set runner = CreateObject("WScript.Shell")' + "`r`n" + 'WScript.Quit runner.Run("' + $command.Replace('"','""') + '", 0, True)' + "`r`n"
$launcher = Join-Path $stateRoot 'watch-hidden.vbs'
[System.IO.File]::WriteAllText($launcher,$vbs)
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wscript.exe" -Argument "//B //NoLogo `"$launcher`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$logon = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
if (Get-ScheduledTask -TaskName 'CryptoLaunchpad-Local-Watchdog' -ErrorAction SilentlyContinue) { throw 'Watchdog task already exists' }
Register-ScheduledTask -TaskName 'CryptoLaunchpad-Local-Watchdog' -Action $action -Trigger @($trigger,$logon) -Settings $settings -Principal $principal -Description 'External API reachability and SHA256/freshness of local backups; Windows notifications while logged in.' | Out-Null
Write-Output 'WATCHDOG_INSTALLED'
