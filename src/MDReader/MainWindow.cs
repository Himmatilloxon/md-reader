using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace MDReader;

public sealed class MainWindow : Window
{
    const string AppHost = "https://app.mdr/";
    const string LocalHost = "https://local.mdr/";

    static readonly HashSet<string> MediaExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif", ".apng",
        ".mp4", ".webm", ".ogg", ".mp3", ".wav"
    };

    // Embedded resource names keep the OS path separator from %(RecursiveDir); normalize to URL form.
    static readonly Dictionary<string, string> WebAssets = Assembly.GetExecutingAssembly()
        .GetManifestResourceNames()
        .Where(n => n.StartsWith("wwwroot", StringComparison.Ordinal))
        .ToDictionary(n => n.Replace('\\', '/'), n => n, StringComparer.OrdinalIgnoreCase);

    readonly WebView2 web = new();
    readonly Settings settings = Settings.Load();
    readonly Dictionary<string, OpenFile> files = new(StringComparer.OrdinalIgnoreCase);
    readonly List<string> startupFiles;
    CoreWebView2? core;
    bool webReady;
    bool hasDirtyTabs;
    bool allowClose;

    sealed class OpenFile
    {
        public required string Path;
        public FileSystemWatcher? Watcher;
        public DispatcherTimer? Debounce;
        public string LastContent = "";
        public bool CrLf;
        public bool Bom;
    }

    public MainWindow(string[] args)
    {
        startupFiles = args.ToList();
        Title = "MD Reader";
        Icon = BitmapFrame.Create(new Uri("pack://application:,,,/Assets/app.ico"));
        MinWidth = 480;
        MinHeight = 320;
        var work = SystemParameters.WorkArea;
        Width = Math.Min(settings.Width, work.Width * 0.92);
        Height = Math.Min(settings.Height, work.Height * 0.92);
        if (settings.Left is double l && settings.Top is double t && IsOnScreen(l, t))
        {
            WindowStartupLocation = WindowStartupLocation.Manual;
            Left = l;
            Top = t;
        }
        else WindowStartupLocation = WindowStartupLocation.CenterScreen;
        if (settings.Maximized) WindowState = WindowState.Maximized;

        var dark = PrefersDark();
        Background = new System.Windows.Media.SolidColorBrush(dark
            ? System.Windows.Media.Color.FromRgb(0x16, 0x18, 0x1d)
            : System.Windows.Media.Colors.White);
        web.DefaultBackgroundColor = dark ? System.Drawing.Color.FromArgb(0x16, 0x18, 0x1d) : System.Drawing.Color.White;
        Content = web;

        SourceInitialized += (_, _) => SetDarkTitleBar(dark);
        Loaded += async (_, _) => await InitWebView();
        Closing += OnClosing;
        Activated += (_, _) => { if (core != null) web.Focus(); };
    }

    static bool IsOnScreen(double left, double top) =>
        left >= SystemParameters.VirtualScreenLeft - 50 &&
        top >= SystemParameters.VirtualScreenTop &&
        left < SystemParameters.VirtualScreenLeft + SystemParameters.VirtualScreenWidth - 100 &&
        top < SystemParameters.VirtualScreenTop + SystemParameters.VirtualScreenHeight - 100;

    bool PrefersDark()
    {
        var theme = settings.Ui["theme"]?.GetValue<string>() ?? "system";
        if (theme == "dark") return true;
        if (theme == "light") return false;
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("AppsUseLightTheme") is int v && v == 0;
        }
        catch { return false; }
    }

    async Task InitWebView()
    {
        try
        {
            var dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MDReader", "WebView2");
            var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
            await web.EnsureCoreWebView2Async(env);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this,
                "MD Reader needs the Microsoft Edge WebView2 Runtime.\n\nInstall it from https://go.microsoft.com/fwlink/p/?LinkId=2124703\n\n" + ex.Message,
                "MD Reader", MessageBoxButton.OK, MessageBoxImage.Error);
            allowClose = true;
            Close();
            return;
        }

        core = web.CoreWebView2;
        var s = core.Settings;
#if DEBUG
        s.AreDevToolsEnabled = true;
#else
        s.AreDevToolsEnabled = false;
#endif
        s.AreBrowserAcceleratorKeysEnabled = false;
        s.IsStatusBarEnabled = false;
        s.IsZoomControlEnabled = false;
        s.IsPinchZoomEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.IsPasswordAutosaveEnabled = false;

        core.AddWebResourceRequestedFilter(AppHost + "*", CoreWebView2WebResourceContext.All);
        core.AddWebResourceRequestedFilter(LocalHost + "*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += OnWebResourceRequested;
        core.WebMessageReceived += OnWebMessage;
        core.NavigationStarting += OnNavigationStarting;
        core.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
        core.NavigationCompleted += (_, _) => web.Focus();
        core.Navigate(AppHost + "index.html");
    }

    // ---------------------------------------------------------------- resources

    void OnWebResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var uri = new Uri(e.Request.Uri);
        try
        {
            if (e.Request.Uri.StartsWith(AppHost, StringComparison.OrdinalIgnoreCase))
            {
                var name = "wwwroot/" + Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/'));
                var stream = WebAssets.TryGetValue(name, out var resName)
                    ? Assembly.GetExecutingAssembly().GetManifestResourceStream(resName)
                    : null;
                e.Response = stream == null
                    ? core!.Environment.CreateWebResourceResponse(null, 404, "Not Found", "")
                    : core!.Environment.CreateWebResourceResponse(stream, 200, "OK",
                        $"Content-Type: {MimeType(name)}\nCache-Control: no-cache");
            }
            else
            {
                var query = System.Web.HttpUtility.ParseQueryString(uri.Query);
                var path = query["p"];
                if (string.IsNullOrEmpty(path) || !MediaExtensions.Contains(Path.GetExtension(path)) || !File.Exists(path))
                {
                    e.Response = core!.Environment.CreateWebResourceResponse(null, 404, "Not Found", "");
                    return;
                }
                var bytes = File.ReadAllBytes(path);
                e.Response = core!.Environment.CreateWebResourceResponse(new MemoryStream(bytes), 200, "OK",
                    $"Content-Type: {MimeType(path)}\nCache-Control: no-cache");
            }
        }
        catch
        {
            e.Response = core!.Environment.CreateWebResourceResponse(null, 500, "Error", "");
        }
    }

    static string MimeType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".json" => "application/json",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".bmp" => "image/bmp",
        ".ico" => "image/x-icon",
        ".avif" => "image/avif",
        ".apng" => "image/apng",
        ".woff2" => "font/woff2",
        ".woff" => "font/woff",
        ".ttf" => "font/ttf",
        ".mp4" => "video/mp4",
        ".webm" => "video/webm",
        ".ogg" => "audio/ogg",
        ".mp3" => "audio/mpeg",
        ".wav" => "audio/wav",
        _ => "application/octet-stream"
    };

    void OnNavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (e.Uri.StartsWith(AppHost, StringComparison.OrdinalIgnoreCase)) return;
        e.Cancel = true;
        // A file dropped somewhere the page didn't catch it.
        if (e.Uri.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
        {
            try { OpenPath(new Uri(e.Uri).LocalPath, null, true); } catch { }
            return;
        }
        OpenExternal(e.Uri);
    }

    // ---------------------------------------------------------------- messaging

    void Post(object message)
    {
        if (core == null) return;
        core.PostWebMessageAsJson(JsonSerializer.Serialize(message));
    }

    void Reply(JsonElement msg, bool ok, object? extra = null)
    {
        var rid = msg.TryGetProperty("rid", out var r) ? r.GetInt32() : 0;
        if (rid == 0) return;
        var node = JsonSerializer.SerializeToNode(extra ?? new { })!.AsObject();
        node["type"] = "reply";
        node["rid"] = rid;
        node["ok"] = ok;
        core?.PostWebMessageAsJson(node.ToJsonString());
    }

    static string Str(JsonElement msg, string name) =>
        msg.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() ?? "" : "";

    void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        JsonElement msg;
        try { msg = JsonDocument.Parse(e.WebMessageAsJson).RootElement; }
        catch { return; }

        switch (Str(msg, "type"))
        {
            case "ready": SendInit(); break;
            case "open": ShowOpenDialog(); break;
            case "openPath": OpenPath(Str(msg, "path"), Str(msg, "anchor"), true); break;
            case "drop":
                if (e.AdditionalObjects != null)
                    foreach (var o in e.AdditionalObjects)
                        if (o is CoreWebView2File f) OpenPath(f.Path, null, true);
                break;
            case "save": Save(msg, Str(msg, "path"), Str(msg, "content")); break;
            case "saveAs": SaveAs(msg, Str(msg, "content"), Str(msg, "name")); break;
            case "export": Export(msg, Str(msg, "content"), Str(msg, "name")); break;
            case "reload": Reload(Str(msg, "path"), msg); break;
            case "close": Unwatch(Str(msg, "path")); break;
            case "session":
                settings.OpenFiles = msg.GetProperty("files").EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x != "").ToList();
                settings.ActiveFile = Str(msg, "active");
                settings.Save(); // persist right away so a crash/kill doesn't lose open tabs
                break;
            case "ui":
                settings.Ui = JsonNode.Parse(msg.GetProperty("ui").GetRawText())!.AsObject();
                settings.Save();
                break;
            case "theme": ApplyTheme(msg.GetProperty("dark").GetBoolean()); break;
            case "dirty": hasDirtyTabs = msg.GetProperty("value").GetBoolean(); break;
            case "external": OpenExternal(Str(msg, "url")); break;
            case "reveal": RevealInExplorer(Str(msg, "path")); break;
            case "removeRecent":
                settings.Recent.RemoveAll(p => string.Equals(p, Str(msg, "path"), StringComparison.OrdinalIgnoreCase));
                settings.Save();
                SendRecent();
                break;
            case "clearRecent": settings.Recent.Clear(); settings.Save(); SendRecent(); break;
            case "title": Title = Str(msg, "title"); break;
            case "closeNow": allowClose = true; Close(); break;
            case "log": Log(Str(msg, "message")); break;
        }
    }

    void SendInit()
    {
        webReady = true;
        var toOpen = startupFiles.Count > 0 ? startupFiles : settings.OpenFiles;
        var docs = new List<object>();
        foreach (var path in toOpen)
        {
            var doc = LoadFile(path, false);
            if (doc != null) docs.Add(doc);
        }
        var active = startupFiles.Count > 0 ? startupFiles[^1] : settings.ActiveFile;
        Post(new { type = "init", ui = settings.Ui, recent = ExistingRecent(), files = docs, active });
        startupFiles.Clear();
        settings.Save();
    }

    List<string> ExistingRecent() => settings.Recent.Where(File.Exists).ToList();
    void SendRecent() => Post(new { type = "recent", recent = ExistingRecent() });

    public void OpenFromOtherInstance(string[] paths)
    {
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        Topmost = true;
        Topmost = false;
        web.Focus();
        if (!webReady) { startupFiles.AddRange(paths); return; }
        foreach (var p in paths) OpenPath(p, null, true);
    }

    // ---------------------------------------------------------------- files

    void ShowOpenDialog()
    {
        var dlg = new Microsoft.Win32.OpenFileDialog
        {
            Title = "Open Markdown file",
            Filter = "Markdown files|*.md;*.markdown;*.mdown;*.mkd;*.mkdn;*.mdx;*.mdwn;*.txt|All files|*.*",
            Multiselect = true,
        };
        var last = settings.Recent.FirstOrDefault();
        if (last != null && Directory.Exists(Path.GetDirectoryName(last))) dlg.InitialDirectory = Path.GetDirectoryName(last);
        if (dlg.ShowDialog(this) == true)
            foreach (var f in dlg.FileNames) OpenPath(f, null, true);
    }

    void OpenPath(string path, string? anchor, bool focus)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        try { path = Path.GetFullPath(path); } catch { return; }
        if (Directory.Exists(path)) { OpenExternal(path); return; }
        var doc = LoadFile(path, true);
        if (doc == null) return;
        Post(new { type = "opened", file = doc, anchor, focus });
        SendRecent();
    }

    object? LoadFile(string path, bool reportErrors)
    {
        try
        {
            path = Path.GetFullPath(path);
            var (content, bom) = ReadText(path);
            Watch(path, content, bom);
            settings.AddRecent(path);
            return new { path, content };
        }
        catch (Exception ex)
        {
            if (reportErrors) Post(new { type = "error", message = $"Could not open {Path.GetFileName(path)}: {ex.Message}" });
            settings.Recent.RemoveAll(p => string.Equals(p, path, StringComparison.OrdinalIgnoreCase));
            return null;
        }
    }

    static (string text, bool bom) ReadText(string path)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        var bytes = new byte[fs.Length];
        fs.ReadExactly(bytes);
        bool bom = bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF;
        string text;
        if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE) text = Encoding.Unicode.GetString(bytes, 2, bytes.Length - 2);
        else if (bytes.Length >= 2 && bytes[0] == 0xFE && bytes[1] == 0xFF) text = Encoding.BigEndianUnicode.GetString(bytes, 2, bytes.Length - 2);
        else
        {
            try { text = new UTF8Encoding(false, true).GetString(bytes, bom ? 3 : 0, bytes.Length - (bom ? 3 : 0)); }
            catch (DecoderFallbackException) { text = Encoding.Latin1.GetString(bytes); }
        }
        return (text, bom);
    }

    void Watch(string path, string content, bool bom)
    {
        if (!files.TryGetValue(path, out var f))
        {
            f = new OpenFile { Path = path };
            files[path] = f;
            try
            {
                var w = new FileSystemWatcher(Path.GetDirectoryName(path)!, Path.GetFileName(path))
                {
                    NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size,
                };
                FileSystemEventHandler h = (_, _) => Dispatcher.BeginInvoke(() => QueueCheck(path));
                w.Changed += h;
                w.Created += h;
                w.Deleted += h;
                w.Renamed += (_, _) => Dispatcher.BeginInvoke(() => QueueCheck(path));
                w.EnableRaisingEvents = true;
                f.Watcher = w;
            }
            catch { /* network paths etc. may not support watching */ }
        }
        f.LastContent = content;
        f.CrLf = content.Contains("\r\n");
        f.Bom = bom;
    }

    void QueueCheck(string path)
    {
        if (!files.TryGetValue(path, out var f)) return;
        f.Debounce ??= new DispatcherTimer(TimeSpan.FromMilliseconds(250), DispatcherPriority.Normal, (_, _) =>
        {
            f.Debounce!.Stop();
            CheckFile(f);
        }, Dispatcher);
        f.Debounce.Stop();
        f.Debounce.Start();
    }

    void CheckFile(OpenFile f)
    {
        if (!File.Exists(f.Path)) { Post(new { type = "deleted", path = f.Path }); return; }
        try
        {
            var (content, bom) = ReadText(f.Path);
            if (content == f.LastContent) return;
            f.LastContent = content;
            f.CrLf = content.Contains("\r\n");
            f.Bom = bom;
            Post(new { type = "changed", path = f.Path, content });
        }
        catch (IOException) { QueueCheck(f.Path); } // file still being written
        catch { }
    }

    void Unwatch(string path)
    {
        if (!files.Remove(path, out var f)) return;
        f.Debounce?.Stop();
        f.Watcher?.Dispose();
    }

    void Reload(string path, JsonElement msg)
    {
        try
        {
            var (content, bom) = ReadText(path);
            Watch(path, content, bom);
            Reply(msg, true, new { content });
        }
        catch (Exception ex) { Reply(msg, false, new { error = ex.Message }); }
    }

    void Save(JsonElement msg, string path, string content)
    {
        if (string.IsNullOrEmpty(path)) { SaveAs(msg, content, "Untitled.md"); return; }
        try
        {
            files.TryGetValue(path, out var f);
            bool crlf = f?.CrLf ?? false, bom = f?.Bom ?? false;
            var text = content.Replace("\r\n", "\n");
            if (crlf) text = text.Replace("\n", "\r\n");
            if (f != null) f.LastContent = text; // suppress our own change notification
            File.WriteAllText(path, text, new UTF8Encoding(bom));
            Watch(path, text, bom);
            Reply(msg, true, new { path });
        }
        catch (Exception ex)
        {
            Reply(msg, false, new { error = ex.Message });
            Post(new { type = "error", message = $"Could not save: {ex.Message}" });
        }
    }

    void SaveAs(JsonElement msg, string content, string name)
    {
        var dlg = new Microsoft.Win32.SaveFileDialog
        {
            Title = "Save Markdown file",
            Filter = "Markdown|*.md|Text|*.txt|All files|*.*",
            DefaultExt = ".md",
            FileName = string.IsNullOrEmpty(name) ? "Untitled.md" : name,
        };
        var last = settings.Recent.FirstOrDefault();
        if (last != null && Directory.Exists(Path.GetDirectoryName(last))) dlg.InitialDirectory = Path.GetDirectoryName(last);
        if (dlg.ShowDialog(this) != true) { Reply(msg, false, new { cancelled = true }); return; }
        var path = dlg.FileName;
        try
        {
            var text = content.Replace("\r\n", "\n"); // new files use LF, like most Markdown tooling
            File.WriteAllText(path, text, new UTF8Encoding(false));
            Watch(path, text, false);
            settings.AddRecent(path);
            Reply(msg, true, new { path });
            SendRecent();
        }
        catch (Exception ex)
        {
            Reply(msg, false, new { error = ex.Message });
            Post(new { type = "error", message = $"Could not save: {ex.Message}" });
        }
    }

    void Export(JsonElement msg, string content, string name)
    {
        var dlg = new Microsoft.Win32.SaveFileDialog
        {
            Title = "Export as HTML",
            Filter = "HTML page|*.html",
            DefaultExt = ".html",
            FileName = name,
        };
        if (dlg.ShowDialog(this) != true) { Reply(msg, false, new { cancelled = true }); return; }
        try
        {
            File.WriteAllText(dlg.FileName, content, new UTF8Encoding(false));
            Reply(msg, true, new { path = dlg.FileName });
        }
        catch (Exception ex)
        {
            Reply(msg, false, new { error = ex.Message });
            Post(new { type = "error", message = $"Could not export: {ex.Message}" });
        }
    }

    // ---------------------------------------------------------------- shell

    // Local files linked from a document open in their default app only if they are
    // passive documents; anything else (executables, scripts...) is just shown in Explorer.
    static readonly HashSet<string> SafeOpenExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif", ".tif", ".tiff",
        ".txt", ".log", ".csv", ".tsv", ".json", ".xml", ".yaml", ".yml", ".toml", ".ini",
        ".docx", ".doc", ".xlsx", ".xls", ".pptx", ".ppt", ".odt", ".ods", ".odp", ".rtf",
        ".mp4", ".webm", ".mkv", ".mov", ".mp3", ".wav", ".ogg", ".flac", ".m4a", ".zip", ".7z",
    };

    static void OpenExternal(string target)
    {
        if (string.IsNullOrWhiteSpace(target)) return;
        try
        {
            if (Uri.TryCreate(target, UriKind.Absolute, out var u) && !u.IsFile)
            {
                if (u.Scheme is "http" or "https" or "mailto")
                    Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
                return; // never hand other URI schemes to the shell
            }
            var path = u?.IsFile == true ? u.LocalPath : target;
            if (Directory.Exists(path))
                Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\""));
            else if (File.Exists(path) && SafeOpenExtensions.Contains(Path.GetExtension(path)))
                Process.Start(new ProcessStartInfo(path) { UseShellExecute = true });
            else
                RevealInExplorer(path);
        }
        catch { }
    }

    static void RevealInExplorer(string path)
    {
        if (!File.Exists(path)) return;
        try { Process.Start("explorer.exe", $"/select,\"{path}\""); } catch { }
    }

    void ApplyTheme(bool dark)
    {
        SetDarkTitleBar(dark);
        Background = new System.Windows.Media.SolidColorBrush(dark
            ? System.Windows.Media.Color.FromRgb(0x16, 0x18, 0x1d)
            : System.Windows.Media.Colors.White);
    }

    void SetDarkTitleBar(bool dark)
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd == IntPtr.Zero) return;
        int value = dark ? 1 : 0;
        DwmSetWindowAttribute(hwnd, 20, ref value, sizeof(int));
    }

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    [Conditional("DEBUG")]
    static void Log(string text)
    {
        try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "mdreader-debug.log"), $"{DateTime.Now:HH:mm:ss} {text}{Environment.NewLine}"); } catch { }
    }

    // ---------------------------------------------------------------- closing

    void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        if (!allowClose && hasDirtyTabs && core != null)
        {
            e.Cancel = true;
            Post(new { type = "requestClose" });
            return;
        }
        settings.Maximized = WindowState == WindowState.Maximized;
        var bounds = RestoreBounds;
        if (!bounds.IsEmpty)
        {
            settings.Left = bounds.Left;
            settings.Top = bounds.Top;
            settings.Width = bounds.Width;
            settings.Height = bounds.Height;
        }
        settings.Save();
        foreach (var f in files.Values) f.Watcher?.Dispose();
    }
}
