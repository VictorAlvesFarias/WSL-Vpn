<#
.SYNOPSIS
  Turns on or off the use, by Windows, of the VPN running inside WSL2.
.DESCRIPTION
  Called by the app, ELEVATED (UAC). Only does the Windows part:
    - routes to the corporate networks with WSL2 as next hop;
    - NRPT rules so that only corporate domains use the company DNS.
  The Linux part (forwarding + NAT to ppp0) is 'vpn-helper gw-on'.

  Routes go to the ActiveStore: they vanish on reboot and are never persisted.
  NRPT rules are persistent, so they carry the $Tag comment and turning off removes
  everything with that comment.
.PARAMETER Action
  On or Off.
.PARAMETER WslIp
  IP of the WSL2 eth0 (On).
.PARAMETER Dns
  Corporate DNS servers, comma separated (On).
.PARAMETER Routes
  Networks routed through WSL2, separated by commas or spaces (On). May be empty with -Mode tudo.
.PARAMETER Suffixes
  Domains (.company) or exact host names resolved by the corporate DNS (On).
.PARAMETER Mode
  What goes through the tunnel (On):
    empresa  only the -Routes networks (the connection's tunnel targets);
    tudo     all IPv4 traffic (0.0.0.0/1 + 128.0.0.0/1). The local network and the home
             router DNS stay outside: their routes are more specific. The original default
             route is never touched.
.PARAMETER VpnHost
  VPN gateway (tudo). If its IP falls inside a range routed through the tunnel, it gets an
  exception route through the home router; otherwise the tunnel would try to go through itself.
.PARAMETER Result
  File where the result is written: the elevated process can't return its output to the app,
  which runs unelevated.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet("On", "Off")][string]$Action,
    [string]$WslIp = "",
    [string]$Dns = "",
    [string]$Routes = "",
    [string]$Suffixes = "",
    [ValidateSet("empresa", "tudo")][string]$Mode = "empresa",
    [string]$VpnHost = "",
    [Parameter(Mandatory)][string]$Result
)

$ErrorActionPreference = "Stop"
# Same tag and state folder as the original panel, so routes it created are still cleaned up.
$Tag = "vpnwsl-gateway"
$StateDir = Join-Path $env:ProgramData "vpnwsl"
$BypassFile = Join-Path $StateDir "gateway-bypass.txt"   # exception routes created
$out = New-Object System.Collections.Generic.List[string]

function Split-List ($text) { @($text -split '[\s,;]+' | Where-Object { $_ }) }

function ConvertTo-UInt32 ($ip) {
    [BitConverter]::ToUInt32(([Net.IPAddress]::Parse($ip).GetAddressBytes()[3..0]), 0)
}

function Test-InPrefix ($ip, $cidr) {
    $network, $bits = $cidr -split '/'
    $mask = if ([int]$bits -eq 0) { [uint32]0 } else { [uint32]([math]::Pow(2, 32) - [math]::Pow(2, 32 - [int]$bits)) }
    ((ConvertTo-UInt32 $ip) -band $mask) -eq ((ConvertTo-UInt32 $network) -band $mask)
}

function Remove-Gateway {
    # On the WSL interface Windows only has direct routes (no next hop).
    # Any route there with a NextHop was created by this script.
    $routes = @(Get-NetRoute -AddressFamily IPv4 -PolicyStore ActiveStore -ErrorAction SilentlyContinue |
        Where-Object { $_.InterfaceAlias -like 'vEthernet (WSL*' -and $_.NextHop -ne '0.0.0.0' })
    $routes | Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
    # Exception routes live on the physical interface: only the file says which they are.
    $exceptions = 0
    if (Test-Path $BypassFile) {
        foreach ($prefix in (Get-Content $BypassFile | Where-Object { $_ })) {
            Get-NetRoute -DestinationPrefix $prefix -PolicyStore ActiveStore -ErrorAction SilentlyContinue |
                Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
            $exceptions++
        }
        Remove-Item $BypassFile -Force
    }
    $rules = @(Get-DnsClientNrptRule | Where-Object { $_.Comment -eq $Tag })
    $rules | ForEach-Object { Remove-DnsClientNrptRule -Name $_.Name -Force }
    return ($routes.Count + $exceptions + $rules.Count)
}

try {
    if ($Action -eq "On") {
        # Everything that can fail (validation) happens BEFORE removing the current state:
        # a failure here leaves the gateway as it was.
        if ($WslIp -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { throw "IP do WSL invalido: '$WslIp'" }
        $prefixes = @(Split-List $Routes)
        # Global ("tudo") brings its own ranges; otherwise something is needed.
        if (-not $prefixes -and $Mode -eq "empresa") { throw "Nenhum destino para o tunel." }
        $companyCount = $prefixes.Count
        # Two halves instead of 0.0.0.0/0: they beat the default route by being more specific,
        # and turning off is just removing them - the home default route stays intact.
        if ($Mode -eq "tudo") { $prefixes = @($prefixes + "0.0.0.0/1" + "128.0.0.0/1") }

        $ifIndex = (Find-NetRoute -RemoteIPAddress $WslIp | Select-Object -First 1).InterfaceIndex
        $alias = (Get-NetIPInterface -InterfaceIndex $ifIndex -AddressFamily IPv4).InterfaceAlias
        if ($alias -notlike 'vEthernet (WSL*') { throw "O IP $WslIp nao esta na interface do WSL ($alias)." }

        # Always start from scratch: turning on twice, or switching modes, duplicates nothing.
        Remove-Gateway | Out-Null

        # Exception for the VPN gateway BEFORE the new routes: after them, the "normal" path to
        # it could already be the tunnel itself.
        if ($Mode -eq "tudo" -and $VpnHost) {
            $homeRoute = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -AddressFamily IPv4 |
                Where-Object { $_.InterfaceAlias -notlike 'vEthernet (WSL*' } |
                Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1
            $vpnIps = @(Resolve-DnsName $VpnHost -Type A -ErrorAction SilentlyContinue |
                Where-Object IPAddress | ForEach-Object IPAddress)
            # In "tudo" mode, without the exception the tunnel would take itself down: fatal.
            if ($Mode -eq "tudo" -and -not $vpnIps) { throw "Nao consegui resolver $VpnHost para criar a excecao." }
            foreach ($ip in $vpnIps) {
                if ($prefixes | Where-Object { Test-InPrefix $ip $_ }) {
                    New-NetRoute -DestinationPrefix "$ip/32" -InterfaceIndex $homeRoute.ifIndex `
                        -NextHop $homeRoute.NextHop -RouteMetric 1 -PolicyStore ActiveStore | Out-Null
                    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
                    Add-Content -Path $BypassFile -Value "$ip/32" -Encoding ascii
                    $out.Add("excecao: gateway da VPN $ip -> $($homeRoute.NextHop)")
                }
            }
        }

        foreach ($prefix in $prefixes) {
            New-NetRoute -DestinationPrefix $prefix -InterfaceIndex $ifIndex -NextHop $WslIp `
                -RouteMetric 5 -PolicyStore ActiveStore | Out-Null
        }
        if ($companyCount) { $out.Add("destinos: $companyCount -> $WslIp ($((Split-List $Routes) -join ', '))") }
        if ($Mode -eq "tudo") { $out.Add("todo o trafego -> $WslIp (rede local e DNS do roteador continuam em casa)") }

        $servers = Split-List $Dns
        $domains = Split-List $Suffixes
        if ($servers -and $domains) {
            foreach ($domain in $domains) {
                Add-DnsClientNrptRule -Namespace $domain -NameServers $servers -Comment $Tag
                $out.Add("DNS $domain -> $($servers -join ', ')")
            }
        } elseif ($domains) {
            $out.Add("AVISO: DNS corporativo nao detectado; nomes internos nao vao resolver.")
        }
    } else {
        $removed = Remove-Gateway
        $out.Add("$removed rota(s)/regra(s) de DNS removida(s)")
    }

    Clear-DnsClientCache
    Set-Content -Path $Result -Encoding utf8 -Value (@("OK") + $out)
    exit 0
} catch {
    Set-Content -Path $Result -Encoding utf8 -Value @("ERRO", "$($_.Exception.Message)")
    exit 1
}
