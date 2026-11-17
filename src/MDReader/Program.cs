using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Windows;

namespace MDReader;

public static class Program
{
    static readonly string InstanceId = "MDReader-" + Environment.UserName;

    [STAThread]
    public static int Main(string[] args)
    {
        var files = args.Where(a => !a.StartsWith("--")).Select(SafeFullPath).Where(p => p != null).Cast<string>().ToArray();

        using var mutex = new Mutex(true, InstanceId + "-mutex", out bool isFirst);
        if (!isFirst && SendToRunningInstance(files))
            return 0;

        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        var window = new MainWindow(files);
        StartPipeServer(window);
        app.Run(window);
        return 0;
    }

    static string? SafeFullPath(string p)
    {
        try { return Path.GetFullPath(p.Trim('"')); } catch { return null; }
    }

    // A second launch (e.g. double-clicking another .md file) hands its files to the open window.
    static bool SendToRunningInstance(string[] files)
    {
        try
        {
            AllowSetForegroundWindow(-1);
            using var client = new NamedPipeClientStream(".", InstanceId + "-pipe", PipeDirection.Out);
            client.Connect(3000);
            using var writer = new StreamWriter(client);
            writer.Write(string.Join("\n", files));
            writer.Flush();
            return true;
        }
        catch { return false; }
    }

    static void StartPipeServer(MainWindow window)
    {
        var thread = new Thread(() =>
        {
            while (true)
            {
                try
                {
                    using var server = new NamedPipeServerStream(InstanceId + "-pipe", PipeDirection.In, 1);
                    server.WaitForConnection();
                    using var reader = new StreamReader(server);
                    var text = reader.ReadToEnd();
                    var paths = text.Split('\n', StringSplitOptions.RemoveEmptyEntries);
                    window.Dispatcher.BeginInvoke(() => window.OpenFromOtherInstance(paths));
                }
                catch { Thread.Sleep(200); }
            }
        }) { IsBackground = true, Name = "InstancePipe" };
        thread.Start();
    }

    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int dwProcessId);
}
