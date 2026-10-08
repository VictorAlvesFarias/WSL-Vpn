# Waits for the FreeRDP window hosted by WSLg and brings it to the front. Prints OK or TIMEOUT.
#
# xfreerdp runs inside WSL2 and msrdc.exe (the WSLg host) draws its window on Windows. Since
# the session is launched from a separate process, the window is born visible and fullscreen
# but WITHOUT focus and BEHIND every other window: the user only sees a taskbar item and thinks
# RDP didn't open. SetForegroundWindow is blocked by the foreground lock; BringWindowToTop isn't,
# and a synthetic Alt tap releases the lock.
#
# The connection takes a few seconds (NLA, and FreeRDP tries Kerberos before falling back to
# NTLM), hence the polling loop instead of a single attempt.
param(
    [string]$Match = '',
    [int]$TimeoutSeconds = 120
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WslVpnWindow {
    delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int command);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

    public static IntPtr Find(string match) {
        IntPtr found = IntPtr.Zero;
        var text = new StringBuilder(512);
        EnumProc visit = (hWnd, lParam) => {
            text.Clear();
            GetWindowText(hWnd, text, 512);
            string title = text.ToString();
            if (title.Contains("FreeRDP") &&
                (match.Length == 0 || title.IndexOf(match, StringComparison.OrdinalIgnoreCase) >= 0)) {
                found = hWnd;
                return false;
            }
            return true;
        };
        EnumWindows(visit, IntPtr.Zero);
        GC.KeepAlive(visit);
        return found;
    }

    public static void Raise(IntPtr hWnd) {
        const int SW_SHOW = 5, SW_RESTORE = 9;
        const byte VK_MENU = 0x12;
        const uint KEYEVENTF_KEYUP = 0x0002;
        ShowWindow(hWnd, IsIconic(hWnd) ? SW_RESTORE : SW_SHOW);
        BringWindowToTop(hWnd);
        keybd_event(VK_MENU, 0, 0, UIntPtr.Zero);
        keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        SetForegroundWindow(hWnd);
    }
}
"@

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
    $hWnd = [WslVpnWindow]::Find($Match)
    if ($hWnd -ne [IntPtr]::Zero) {
        [WslVpnWindow]::Raise($hWnd)
        'OK'
        exit 0
    }
    Start-Sleep -Milliseconds 500
}
'TIMEOUT'
exit 1
