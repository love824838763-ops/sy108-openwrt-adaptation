$log = Join-Path $PSScriptRoot 'wifi-priority-result.txt'
function W($s) { $s | Out-File -FilePath $log -Append -Encoding utf8 }

W "start $(Get-Date -Format 'HH:mm:ss')"

$targets = Get-NetAdapter -IncludeHidden | Where-Object {
    $_.InterfaceDescription -like '*Ncm*' -or $_.InterfaceDescription -like '*RNDIS*'
}
foreach ($t in $targets) {
    W "TARGET ifIndex=$($t.ifIndex) name=$($t.Name)"
    # 关闭网卡节能（-Name 而非 -InterfaceIndex）
    try {
        Set-NetAdapterPowerManagement -Name $t.Name -AllowComputerToTurnOffDevice Disabled -NoRestart -ErrorAction Stop
        W "  power-management disabled"
    } catch { W "  pwr fail: $($_.Exception.Message)" }
    foreach ($af in 'IPv4','IPv6') {
        try {
            Set-NetIPInterface -InterfaceIndex $t.ifIndex -AddressFamily $af -InterfaceMetric 60 -ErrorAction Stop
            W "  $af metric=60"
        } catch { W "  $af fail: $($_.Exception.Message)" }
    }
}

# 删除指向已断开网卡的幽灵默认路由
W ""
W "--- ghost routes removal ---"
Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | ForEach-Object {
    $ad = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue
    if ($ad -and $ad.Status -ne 'Up') {
        try {
            Remove-NetRoute -DestinationPrefix '0.0.0.0/0' -InterfaceIndex $_.InterfaceIndex -NextHop $_.NextHop -Confirm:$false -ErrorAction Stop
            W "removed ghost: $($_.NextHop) via $($_.InterfaceAlias) (status=$($ad.Status))"
        } catch { W "ghost remove fail ($($_.NextHop)): $($_.Exception.Message)" }
    } else {
        W "keep: $($_.NextHop) via $($_.InterfaceAlias) (status=$($ad.Status))"
    }
}

W ""
W "--- final default routes ---"
Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' | ForEach-Object {
    W ("  via {0} alias={1} metric={2} if={3}" -f $_.NextHop, $_.InterfaceAlias, $_.RouteMetric, $_.InterfaceIndex)
}
W ""
W "--- final metrics ---"
Get-NetIPInterface -AddressFamily IPv4 | Where-Object { $_.ConnectionState -eq 'Connected' } | ForEach-Object {
    W ("  {0} metric={1}" -f $_.InterfaceAlias, $_.InterfaceMetric)
}
W ""
W "--- route decision ---"
foreach ($ip in @('8.8.8.8','www.baidu.com','www.google.com')) {
    $r = Find-NetRoute -RemoteIPAddress $ip -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($r) { W ("  {0} -> {1} via {2}" -f $ip, $r.InterfaceAlias, $r.NextHop) }
    else { W ("  {0} -> (no route)" -f $ip) }
}
W "DONE $(Get-Date -Format 'HH:mm:ss')"
