$log = Join-Path $PSScriptRoot 'usb-net-setup-result.txt'
function W($s) { $s | Out-File -FilePath $log -Append -Encoding utf8 }

W "start $(Get-Date -Format 'HH:mm:ss')"

$u = Get-NetAdapter | Where-Object { $_.InterfaceDescription -like '*Ncm*' -or $_.InterfaceDescription -like '*RNDIS*' } | Select-Object -First 1
if (-not $u) { W "USB NCM adapter not found"; exit 1 }
W "USB adapter: $($u.Name) ifIndex=$($u.ifIndex)"

# 1) 高接口度量：WiFi=30，USB=90 -> 实际流量走 WiFi，但 USB 仍被视为有路由
foreach ($af in @('IPv4','IPv6')) {
    try {
        Set-NetIPInterface -InterfaceIndex $u.ifIndex -AddressFamily $af -InterfaceMetric 90 -ErrorAction Stop
        W "$af interface metric = 90"
    } catch { W "$af metric fail: $($_.Exception.Message)" }
}

# 2) 恢复 USB 上的默认路由（Windows 需要它才会对 USB 接口做 NCSI 探测）
W ""
W "--- ensure default route on USB ---"
$gw = '192.168.66.1'
$has = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
       Where-Object { $_.InterfaceIndex -eq $u.ifIndex -and $_.NextHop -eq $gw }
if (-not $has) {
    try {
        New-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -InterfaceIndex $u.ifIndex -NextHop $gw -RouteMetric 90 -ErrorAction Stop | Out-Null
        W "added default route via $gw metric=90"
    } catch { W "add route fail: $($_.Exception.Message)" }
} else {
    W "default route already present"
}

# 3) 删除指向已断开网卡的幽灵路由
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

# 4) 关网卡节能（参数名在不同版本不同，逐个试）
foreach ($cmd in @(
    { Set-NetAdapterPowerManagement -Name $u.Name -AllowComputerToTurnOffDevice Disabled -NoRestart -ErrorAction Stop },
    { Set-NetAdapterPowerManagement -Name $u.Name -DisableWakeOnMagicPacket $false -NoRestart -ErrorAction Stop },
    { powercfg -setacvalueindex SCHEME_CURRENT 2a737441-1930-4402-8d77-b2bebba308a3 48e6b7a6-50f5-4782-a5d4-53bb8f07e226 0 }
)) {
    try { & $cmd; W "power setting ok"; break } catch { W "power setting skipped" }
}

W ""
W "--- final default routes ---"
Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | ForEach-Object {
    W ("  via {0} alias={1} routeMetric={2} if={3}" -f $_.NextHop, $_.InterfaceAlias, $_.RouteMetric, $_.InterfaceIndex)
}
W ""
W "--- interface metrics ---"
Get-NetIPInterface -AddressFamily IPv4 | Where-Object { $_.ConnectionState -eq 'Connected' } | ForEach-Object {
    W ("  {0} metric={1}" -f $_.InterfaceAlias, $_.InterfaceMetric)
}
W ""
W "--- route decision for 8.8.8.8 ---"
$r = Find-NetRoute -RemoteIPAddress '8.8.8.8' -ErrorAction SilentlyContinue | Select-Object -First 1
W ("  -> {0} via {1}" -f $r.InterfaceAlias, $r.NextHop)
W ""
W "--- connectivity profile ---"
Get-NetConnectionProfile | ForEach-Object { W ("  {0} ({1}) {2}" -f $_.Name, $_.InterfaceAlias, $_.IPv4Connectivity) }
W "DONE $(Get-Date -Format 'HH:mm:ss')"
