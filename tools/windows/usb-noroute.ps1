$log = Join-Path $PSScriptRoot 'usb-noroute-result.txt'
function W($s) { $s | Out-File -FilePath $log -Append -Encoding utf8 }

W "start $(Get-Date -Format 'HH:mm:ss')"

$u = Get-NetAdapter | Where-Object { $_.InterfaceDescription -like '*Ncm*' -or $_.InterfaceDescription -like '*RNDIS*' } | Select-Object -First 1
if (-not $u) { W "USB NCM adapter not found"; exit 1 }
W "USB adapter: $($u.Name) ifIndex=$($u.ifIndex)"

# 1) 删除 USB 网卡上的默认路由（保留 192.168.66.0/24 直连，状态页/SSH 仍可访问）
W ""
W "--- remove default route on USB ---"
$defs = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Where-Object { $_.InterfaceIndex -eq $u.ifIndex }
foreach ($d in $defs) {
    W "removing: via $($d.NextHop) metric=$($d.RouteMetric)"
    try {
        Remove-NetRoute -DestinationPrefix '0.0.0.0/0' -InterfaceIndex $u.ifIndex -NextHop $d.NextHop -Confirm:$false -ErrorAction Stop
        W "  removed OK"
    } catch { W "  remove fail: $($_.Exception.Message)" }
}

# 2) 删除指向已断开网卡的幽灵路由
W ""
W "--- remove ghost routes ---"
Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | ForEach-Object {
    $ad = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue
    if ($ad -and $ad.Status -ne 'Up' -and $_.InterfaceIndex -ne $u.ifIndex) {
        try {
            Remove-NetRoute -DestinationPrefix '0.0.0.0/0' -InterfaceIndex $_.InterfaceIndex -NextHop $_.NextHop -Confirm:$false -ErrorAction Stop
            W "removed ghost: $($_.NextHop) via $($_.InterfaceAlias)"
        } catch { W "ghost fail: $($_.Exception.Message)" }
    }
}

# 3) 关掉网卡节能
try {
    Set-NetAdapterPowerManagement -Name $u.Name -AllowComputerToTurnOffDevice Disabled -NoRestart -ErrorAction Stop
    W ""
    W "power-management disabled"
} catch { W "pwr fail: $($_.Exception.Message)" }

# 4) 抬高接口度量作为双保险
foreach ($af in @('IPv4','IPv6')) {
    try {
        Set-NetIPInterface -InterfaceIndex $u.ifIndex -AddressFamily $af -InterfaceMetric 90 -ErrorAction Stop
        W "$af metric=90"
    } catch { W "$af metric fail: $($_.Exception.Message)" }
}

W ""
W "--- final default routes ---"
Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | ForEach-Object {
    W ("  via {0} alias={1} metric={2} if={3}" -f $_.NextHop, $_.InterfaceAlias, $_.RouteMetric, $_.InterfaceIndex)
}
W ""
W "--- USB adapter remaining routes ---"
Get-NetRoute -AddressFamily IPv4 -InterfaceIndex $u.ifIndex -ErrorAction SilentlyContinue | ForEach-Object {
    W ("  {0} -> {1}" -f $_.DestinationPrefix, $_.NextHop)
}
W ""
W "--- connectivity profile ---"
Get-NetConnectionProfile | ForEach-Object { W ("  {0} ({1}) {2}" -f $_.Name, $_.InterfaceAlias, $_.IPv4Connectivity) }
W "DONE $(Get-Date -Format 'HH:mm:ss')"
