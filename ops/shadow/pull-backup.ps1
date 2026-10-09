param(
  [Parameter(Mandatory=$true)][string]$SshKey,
  [Parameter(Mandatory=$true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$sshArgs = @('-i',$SshKey,'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10')
$name = (& ssh -n @sshArgs root@201.51.22.244 'cat /var/backups/crypto-launchpad/latest').Trim()
if ($LASTEXITCODE -ne 0 -or $name -notmatch '^\d{8}T\d{6}Z\.tar\.gz$') { throw 'Cannot resolve verified backup name' }
$target = Join-Path $Destination $name
& scp @sshArgs "root@201.51.22.244:/var/backups/crypto-launchpad/$name.sha256" "$target.sha256"
if ($LASTEXITCODE -ne 0) { throw 'Backup checksum download failed' }
$expected = ((Get-Content -Raw -LiteralPath "$target.sha256").Trim() -split '\s+')[0]
if ($expected -notmatch '^[0-9a-fA-F]{64}$') { throw 'Invalid checksum' }
if (!(Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $expected) {
  & scp @sshArgs "root@201.51.22.244:/var/backups/crypto-launchpad/$name" "$target.partial"
  if ($LASTEXITCODE -ne 0) { throw 'Backup download failed' }
  if ((Get-FileHash -LiteralPath "$target.partial" -Algorithm SHA256).Hash -ne $expected) { throw 'Backup checksum mismatch' }
  Move-Item -LiteralPath "$target.partial" -Destination $target -Force
}
@{atUtc=[DateTime]::UtcNow.ToString('o');archive=$name;sha256=$expected;status='VERIFIED'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Destination 'last-pull.json')
Write-Output "VERIFIED $name"
