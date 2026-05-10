using System.IO;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;

namespace Nova.WebShell;

public partial class MainWindow : Window
{
    /// <summary>
    /// Default when no config is present: macOS LaunchDaemon stack with
    /// <c>NOVA_WEB_HTTPS</c> + <c>NOVA_WEB_STANDARD_PORTS</c> (Web UI on 443). See docs/CURSOR_AGENT_ONBOARDING.md.
    /// Dev machines can set <c>NOVA_WEB_SHELL_START_URL</c> or override <c>StartUrl</c> in appsettings.
    /// </summary>
    private const string DefaultStartUrl = "https://nova";

    /// <summary>Approximates <c>apps/web/src/app/globals.css</c> <c>:root --surface</c> (H 220 S 100% L 99%).</summary>
    private static readonly Color LightChrome = Color.FromRgb(247, 251, 255);

    /// <summary>Approximates <c>.dark --surface</c> (H 225 S 22% L 17%).</summary>
    private static readonly Color DarkChrome = Color.FromRgb(38, 42, 52);

    private static readonly Color DarkForeground = Color.FromRgb(226, 232, 240);
    private static readonly Color LightForeground = Color.FromRgb(51, 65, 85);

    private static readonly string[] SettingsCandidates =
    [
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Nova",
            "WebShell",
            "appsettings.json"
        ),
        Path.Combine(AppContext.BaseDirectory, "appsettings.json")
    ];

    private Uri _homeUri = new(DefaultStartUrl, UriKind.Absolute);

    public MainWindow()
    {
        InitializeComponent();
        TrySetWindowIcon();
    }

    private void TrySetWindowIcon()
    {
        try
        {
            var iconPath = Path.Combine(AppContext.BaseDirectory, "images", "nova_icon.ico");
            if (!File.Exists(iconPath))
            {
                return;
            }

            Icon = BitmapFrame.Create(new Uri(iconPath, UriKind.Absolute));
        }
        catch
        {
            /* optional branding */
        }
    }

    private static string ReadStartUrl()
    {
        var fromEnv = Environment.GetEnvironmentVariable("NOVA_WEB_SHELL_START_URL")?.Trim();
        if (!string.IsNullOrEmpty(fromEnv) && Uri.TryCreate(fromEnv, UriKind.Absolute, out _))
        {
            return fromEnv;
        }

        foreach (var path in SettingsCandidates)
        {
            if (!File.Exists(path))
            {
                continue;
            }

            try
            {
                using var stream = File.OpenRead(path);
                using var doc = JsonDocument.Parse(stream);
                if (doc.RootElement.TryGetProperty("StartUrl", out var el))
                {
                    var s = el.GetString()?.Trim();
                    if (!string.IsNullOrEmpty(s) && Uri.TryCreate(s, UriKind.Absolute, out _))
                    {
                        return s;
                    }
                }
            }
            catch
            {
                /* fall through */
            }
        }

        return DefaultStartUrl;
    }

    private static string LoadThemeBridgeScript()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "WebUiThemeBridge.js");
        return File.Exists(path) ? File.ReadAllText(path) : """
(function(){if(window!==window.top)return;function p(){try{var d=document.documentElement.classList.contains("dark");window.chrome.webview.postMessage(JSON.stringify({type:"nova-theme",dark:d}));}catch(e){}}if(!window.__novaThemeBridge){window.__novaThemeBridge=1;p();new MutationObserver(p).observe(document.documentElement,{attributes:true,attributeFilter:["class"]});}})();
""";
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
        var start = ReadStartUrl();
        _homeUri = new Uri(start, UriKind.Absolute);
        StatusUrl.Text = start;
        ApplyChromeFromWebUi(false);

        try
        {
            await WebView.EnsureCoreWebView2Async();
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "WebView2 failed to start. Install the WebView2 Runtime from Microsoft, then reopen Nova.\n\n" + ex.Message,
                "Nova Web Shell",
                MessageBoxButton.OK,
                MessageBoxImage.Error
            );
            Close();
            return;
        }

        WebView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = true;
        WebView.CoreWebView2.Settings.IsStatusBarEnabled = false;
        WebView.CoreWebView2.Settings.IsWebMessageEnabled = true;

        WebView.CoreWebView2.WebMessageReceived += CoreWebView2_WebMessageReceived;
        WebView.CoreWebView2.NavigationCompleted += CoreWebView2_NavigationCompleted;

        WebView.CoreWebView2.DocumentTitleChanged += (_, _) =>
        {
            Dispatcher.Invoke(() => Title = string.IsNullOrEmpty(WebView.CoreWebView2.DocumentTitle) ? "Nova" : WebView.CoreWebView2.DocumentTitle);
        };
        WebView.CoreWebView2.NavigationStarting += (_, args) =>
        {
            Dispatcher.Invoke(() => StatusUrl.Text = args.Uri);
        };
        WebView.CoreWebView2.NewWindowRequested += (_, args) =>
        {
            args.Handled = true;
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = args.Uri,
                    UseShellExecute = true
                });
            }
            catch
            {
                /* ignore */
            }
        };

        WebView.Source = _homeUri;
    }

    private async void CoreWebView2_NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (!e.IsSuccess || WebView.CoreWebView2 == null)
        {
            return;
        }

        try
        {
            _ = await WebView.CoreWebView2.ExecuteScriptAsync(LoadThemeBridgeScript());
        }
        catch
        {
            /* ignore */
        }
    }

    private void CoreWebView2_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            var json = args.TryGetWebMessageAsString();
            if (string.IsNullOrEmpty(json))
            {
                return;
            }

            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.GetProperty("type").GetString() != "nova-theme")
            {
                return;
            }

            if (!root.TryGetProperty("dark", out var d) || d.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            {
                return;
            }

            var dark = d.GetBoolean();
            Dispatcher.Invoke(() => ApplyChromeFromWebUi(dark));
        }
        catch
        {
            /* ignore malformed messages */
        }
    }

    private void ApplyChromeFromWebUi(bool dark)
    {
        ThemeInterop.SetImmersiveDarkMode(this, dark);

        var bg = new SolidColorBrush(dark ? DarkChrome : LightChrome);
        Background = bg;
        ChromeHeader.Background = bg;
        TopMenu.Background = Brushes.Transparent;

        var fg = new SolidColorBrush(dark ? DarkForeground : LightForeground);
        TopMenu.Foreground = fg;
        StatusUrl.Foreground = fg;

        // WPF uses system menu colors for dropdown popups; override so dark mode stays readable.
        var menuPopupBg = new SolidColorBrush(dark ? Color.FromRgb(28, 32, 40) : Colors.White);
        var menuPopupFg = new SolidColorBrush(dark ? DarkForeground : LightForeground);
        var highlightBg = new SolidColorBrush(dark ? Color.FromRgb(59, 130, 246) : Color.FromRgb(219, 234, 254));
        var highlightFg = new SolidColorBrush(dark ? Color.FromRgb(248, 250, 252) : Color.FromRgb(30, 41, 59));

        TopMenu.Resources[SystemColors.MenuBarBrushKey] = bg;
        TopMenu.Resources[SystemColors.MenuBrushKey] = menuPopupBg;
        TopMenu.Resources[SystemColors.MenuTextBrushKey] = menuPopupFg;
        TopMenu.Resources[SystemColors.HighlightBrushKey] = highlightBg;
        TopMenu.Resources[SystemColors.HighlightTextBrushKey] = highlightFg;
    }

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.F5)
        {
            ReloadWeb();
            e.Handled = true;
        }
        else if (e.Key == Key.F12)
        {
            OpenDevTools();
            e.Handled = true;
        }
    }

    private void Reload_Click(object sender, RoutedEventArgs e) => ReloadWeb();

    private void ReloadWeb()
    {
        if (WebView.CoreWebView2 != null)
        {
            WebView.Reload();
        }
        else
        {
            WebView.Source = _homeUri;
        }
    }

    private void OpenDevTools()
    {
        if (WebView.CoreWebView2 == null)
        {
            return;
        }

        WebView.CoreWebView2.OpenDevToolsWindow();
    }

    private void Exit_Click(object sender, RoutedEventArgs e) => Close();

    private void DevTools_Click(object sender, RoutedEventArgs e) => OpenDevTools();

    private void About_Click(object sender, RoutedEventArgs e)
    {
        var paths = string.Join("\n", SettingsCandidates.Where(File.Exists));
        var msg =
            "Nova Web Shell loads your Next.js Web UI in Edge WebView2.\n\n" +
            "Updates: redeploy or restart the Web UI on your Nova host, then Reload (F5).\n\n" +
            "Start URL: environment NOVA_WEB_SHELL_START_URL, else first appsettings.json below, else default " +
            DefaultStartUrl +
            " (macOS service HTTPS on 443 — see docs/CURSOR_AGENT_ONBOARDING.md).\n\n" +
            "Title bar and menu colors follow the Web UI light/dark theme (next-themes).\n\n" +
            "Config files (first match wins after env):\n" +
            (paths.Length > 0 ? paths : "(none beside exe)");
        MessageBox.Show(msg, "About Nova Web Shell", MessageBoxButton.OK, MessageBoxImage.Information);
    }
}
