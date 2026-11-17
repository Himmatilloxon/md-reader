using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace MDReader;

public sealed class Settings
{
    public static readonly string Dir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MDReader");
    static readonly string FilePath = Path.Combine(Dir, "settings.json");

    public List<string> Recent { get; set; } = new();
    public List<string> OpenFiles { get; set; } = new();
    public string? ActiveFile { get; set; }
    public JsonObject Ui { get; set; } = new();
    public double? Left { get; set; }
    public double? Top { get; set; }
    public double Width { get; set; } = 1200;
    public double Height { get; set; } = 820;
    public bool Maximized { get; set; }

    static readonly JsonSerializerOptions Options = new() { WriteIndented = true };

    public static Settings Load()
    {
        try
        {
            if (File.Exists(FilePath))
                return JsonSerializer.Deserialize<Settings>(File.ReadAllText(FilePath), Options) ?? new Settings();
        }
        catch { /* corrupt settings: start fresh */ }
        return new Settings();
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Dir);
            var tmp = FilePath + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(this, Options));
            File.Move(tmp, FilePath, true);
        }
        catch { /* best effort */ }
    }

    public void AddRecent(string path)
    {
        Recent.RemoveAll(p => string.Equals(p, path, StringComparison.OrdinalIgnoreCase));
        Recent.Insert(0, path);
        if (Recent.Count > 20) Recent.RemoveRange(20, Recent.Count - 20);
    }
}
