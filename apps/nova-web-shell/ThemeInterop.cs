using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace Nova.WebShell;

/// <summary>Makes the Win32 caption / immersive chrome follow Web UI light vs dark (next-themes <c>class="dark"</c> on <c>html</c>).</summary>
internal static class ThemeInterop
{
    private const int DwmwaUseImmersiveDarkMode = 20;
    private const int DwmwaUseImmersiveDarkModeBefore20h1 = 19;

    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int dwAttribute, ref int pvAttribute, int cbAttribute);

    public static void SetImmersiveDarkMode(Window window, bool useDarkMode)
    {
        var hwnd = new WindowInteropHelper(window).Handle;
        if (hwnd == IntPtr.Zero)
        {
            return;
        }

        var value = useDarkMode ? 1 : 0;
        if (DwmSetWindowAttribute(hwnd, DwmwaUseImmersiveDarkMode, ref value, sizeof(int)) != 0)
        {
            _ = DwmSetWindowAttribute(hwnd, DwmwaUseImmersiveDarkModeBefore20h1, ref value, sizeof(int));
        }
    }
}
