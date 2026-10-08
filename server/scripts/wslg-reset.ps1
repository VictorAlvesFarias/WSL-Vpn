# Restarts the WSLg graphics host (msrdc.exe) and waits for the new one. Prints OK or TIMEOUT.
#
# msrdc.exe can end up creating windows that it never paints - it happens after it crashes
# and is relaunched (sleep/resume, display changes). Restarting it is the fix: WSLGd brings it
# back in ~1s without stopping the VM or the VPN. The "/wslg" filter leaves alone the msrdc of
# other Windows Remote Desktop clients.
$find = {
    Get-CimInstance Win32_Process -Filter "Name='msrdc.exe'" |
        Where-Object { $_.CommandLine -like '*/wslg*' }
}
$old = @(& $find | ForEach-Object { $_.ProcessId })
$old | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
for ($i = 0; $i -lt 40; $i++) {
    if (& $find | Where-Object { $old -notcontains $_.ProcessId }) { 'OK'; exit 0 }
    Start-Sleep -Milliseconds 500
}
'TIMEOUT'; exit 1
