/**
 * The Windows computer-use helper: one warm process that reads JSON commands
 * on stdin and answers on stdout. Native calls only — SendInput for mouse and
 * keyboard, GDI for screenshots, UI Automation (cached FindAll) for element
 * trees — so an action costs milliseconds, not a process launch.
 *
 * C# 5 (the compiler Windows PowerShell 5.1 ships): no string interpolation,
 * no `?.`, no `out _`. Compiled once to a DLL in the runtime folder.
 */
export const HELPER_CSHARP = String.raw`
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

public static class HvComputer {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
  delegate bool EnumProc(IntPtr h, IntPtr l);

  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);

  static readonly List<AutomationElement> refs = new List<AutomationElement>();
  static readonly List<System.Windows.Rect> rects = new List<System.Windows.Rect>();
  static readonly HashSet<string> Interactive = new HashSet<string> { "button", "edit", "checkbox", "combobox", "listitem", "menuitem", "tabitem", "hyperlink", "radiobutton", "treeitem", "dataitem", "slider", "spinner", "splitbutton", "document", "list", "tree", "menubar" };

  public static void Run() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { SetProcessDPIAware(); }
    Console.InputEncoding = new UTF8Encoding(false);
    var stdout = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
    stdout.AutoFlush = true;
    var js = new JavaScriptSerializer();
    js.MaxJsonLength = int.MaxValue;
    stdout.WriteLine("{\"ready\":true}");
    string line;
    while ((line = Console.ReadLine()) != null) {
      object id = null;
      Dictionary<string, object> reply;
      try {
        var req = js.Deserialize<Dictionary<string, object>>(line);
        id = req["id"];
        var args = req.ContainsKey("args") && req["args"] is Dictionary<string, object> ? (Dictionary<string, object>)req["args"] : new Dictionary<string, object>();
        reply = new Dictionary<string, object> { { "id", id }, { "ok", true }, { "value", Dispatch((string)req["op"], args) } };
      } catch (Exception e) {
        reply = new Dictionary<string, object> { { "id", id }, { "ok", false }, { "error", (e.InnerException ?? e).Message } };
      }
      stdout.WriteLine(js.Serialize(reply));
    }
  }

  static int I(Dictionary<string, object> a, string k, int d) { return a.ContainsKey(k) && a[k] != null ? Convert.ToInt32(a[k]) : d; }
  static string S(Dictionary<string, object> a, string k) { return a.ContainsKey(k) && a[k] != null ? Convert.ToString(a[k]) : ""; }
  static int[] Ints(Dictionary<string, object> a, string k) {
    if (!a.ContainsKey(k) || a[k] == null) return new int[0];
    var list = new List<int>();
    foreach (var o in (IEnumerable)a[k]) list.Add(Convert.ToInt32(o));
    return list.ToArray();
  }

  static object Dispatch(string op, Dictionary<string, object> a) {
    switch (op) {
      case "screenshot": return Screenshot(a);
      case "move": SetCursorPos(I(a, "x", 0), I(a, "y", 0)); return true;
      case "click": Click(I(a, "x", 0), I(a, "y", 0), S(a, "button"), I(a, "count", 1)); return true;
      case "drag": Drag(I(a, "x1", 0), I(a, "y1", 0), I(a, "x2", 0), I(a, "y2", 0)); return true;
      case "scroll": Scroll(I(a, "x", -1), I(a, "y", -1), I(a, "dy", 0), I(a, "dx", 0)); return true;
      case "type": Type(S(a, "text")); return true;
      case "chord": Chord(Ints(a, "mods"), Ints(a, "keys")); return true;
      case "cursor": { POINT p; GetCursorPos(out p); return new Dictionary<string, object> { { "x", p.X }, { "y", p.Y } }; }
      case "windows": return Windows();
      case "focus": return Focus(new IntPtr(Convert.ToInt64(a["id"])));
      case "snapshot": return Snapshot(a);
      case "point": return Point(I(a, "ref", 0));
      case "setvalue": return SetValue(I(a, "ref", 0), S(a, "text"));
      case "screen": return new Dictionary<string, object> { { "width", GetSystemMetrics(0) }, { "height", GetSystemMetrics(1) } };
      default: throw new Exception("Unknown operation " + op);
    }
  }

  // ---------- input ----------
  static INPUT Mouse(uint flags, uint data) { var i = new INPUT(); i.type = 0; i.u.mi.dwFlags = flags; i.u.mi.mouseData = data; return i; }
  static INPUT Key(ushort vk, ushort scan, uint flags) { var i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; return i; }
  static void Send(List<INPUT> l) { if (l.Count > 0) SendInput((uint)l.Count, l.ToArray(), Marshal.SizeOf(typeof(INPUT))); }

  static void Click(int x, int y, string button, int count) {
    SetCursorPos(x, y);
    uint down = button == "right" ? 0x0008u : button == "middle" ? 0x0020u : 0x0002u;
    var l = new List<INPUT>();
    for (int i = 0; i < Math.Max(1, count); i++) { l.Add(Mouse(down, 0)); l.Add(Mouse(down << 1, 0)); }
    Send(l);
  }

  static void Drag(int x1, int y1, int x2, int y2) {
    SetCursorPos(x1, y1);
    Send(new List<INPUT> { Mouse(0x0002, 0) });
    const int steps = 12;
    for (int i = 1; i <= steps; i++) { SetCursorPos(x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps); Thread.Sleep(6); }
    Send(new List<INPUT> { Mouse(0x0004, 0) });
  }

  static void Scroll(int x, int y, int dy, int dx) {
    if (x >= 0 && y >= 0) SetCursorPos(x, y);
    var l = new List<INPUT>();
    if (dy != 0) l.Add(Mouse(0x0800, unchecked((uint)(-dy * 120))));
    if (dx != 0) l.Add(Mouse(0x1000, unchecked((uint)(dx * 120))));
    Send(l);
  }

  static void Type(string text) {
    var l = new List<INPUT>();
    foreach (char c in text) {
      if (c == '\r') continue;
      if (c == '\n') { l.Add(Key(0x0D, 0, 0)); l.Add(Key(0x0D, 0, 2)); continue; }
      l.Add(Key(0, (ushort)c, 0x0004)); l.Add(Key(0, (ushort)c, 0x0004 | 0x0002));
    }
    Send(l);
  }

  static uint Ext(int vk) { return (vk >= 33 && vk <= 46) || vk == 91 || vk == 92 ? 1u : 0u; }

  static void Chord(int[] mods, int[] keys) {
    var l = new List<INPUT>();
    foreach (var m in mods) l.Add(Key((ushort)m, 0, Ext(m)));
    foreach (var k in keys) { l.Add(Key((ushort)k, 0, Ext(k))); l.Add(Key((ushort)k, 0, Ext(k) | 2)); }
    for (int i = mods.Length - 1; i >= 0; i--) l.Add(Key((ushort)mods[i], 0, Ext(mods[i]) | 2));
    Send(l);
  }

  // ---------- screen ----------
  static object Screenshot(Dictionary<string, object> a) {
    int x = I(a, "x", 0), y = I(a, "y", 0);
    int w = I(a, "w", GetSystemMetrics(0)), h = I(a, "h", GetSystemMetrics(1));
    int maxW = I(a, "maxWidth", 1280);
    using (var bmp = new Bitmap(w, h, PixelFormat.Format24bppRgb)) {
      using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(x, y, 0, 0, new Size(w, h), CopyPixelOperation.SourceCopy);
      double scale = Math.Min(1.0, (double)maxW / w);
      int ow = Math.Max(1, (int)Math.Round(w * scale)), oh = Math.Max(1, (int)Math.Round(h * scale));
      Bitmap output = bmp;
      if (scale < 1) {
        output = new Bitmap(ow, oh, PixelFormat.Format24bppRgb);
        using (var g2 = Graphics.FromImage(output)) { g2.InterpolationMode = InterpolationMode.HighQualityBilinear; g2.DrawImage(bmp, 0, 0, ow, oh); }
      }
      var codec = ImageCodecInfo.GetImageEncoders().First(c => c.MimeType == "image/jpeg");
      var ps = new EncoderParameters(1);
      ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 72L);
      using (var ms = new MemoryStream()) {
        output.Save(ms, codec, ps);
        if (output != bmp) output.Dispose();
        return new Dictionary<string, object> { { "data", Convert.ToBase64String(ms.ToArray()) }, { "width", ow }, { "height", oh }, { "scale", scale }, { "left", x }, { "top", y } };
      }
    }
  }

  static object Windows() {
    var list = new List<object>();
    IntPtr fg = GetForegroundWindow();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true;
      int len = GetWindowTextLength(h);
      if (len == 0) return true;
      int cloaked;
      if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
      var sb = new StringBuilder(len + 1);
      GetWindowText(h, sb, sb.Capacity);
      RECT r; GetWindowRect(h, out r);
      uint pid; GetWindowThreadProcessId(h, out pid);
      string proc = "";
      try { proc = Process.GetProcessById((int)pid).ProcessName; } catch { }
      list.Add(new Dictionary<string, object> { { "id", h.ToInt64() }, { "title", sb.ToString() }, { "process", proc }, { "x", r.Left }, { "y", r.Top }, { "w", r.Right - r.Left }, { "h", r.Bottom - r.Top }, { "focused", h == fg }, { "minimized", IsIconic(h) } });
      return true;
    }, IntPtr.Zero);
    return list;
  }

  static object Focus(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    uint pid;
    uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    uint me = GetCurrentThreadId();
    AttachThreadInput(me, fgThread, true);
    BringWindowToTop(h);
    bool ok = SetForegroundWindow(h);
    AttachThreadInput(me, fgThread, false);
    return ok;
  }

  // ---------- UI Automation ----------
  static object Snapshot(Dictionary<string, object> a) {
    IntPtr h = a.ContainsKey("id") && a["id"] != null ? new IntPtr(Convert.ToInt64(a["id"])) : GetForegroundWindow();
    int max = I(a, "max", 250);
    var root = AutomationElement.FromHandle(h);
    var cr = new CacheRequest();
    cr.Add(AutomationElement.NameProperty);
    cr.Add(AutomationElement.ControlTypeProperty);
    cr.Add(AutomationElement.BoundingRectangleProperty);
    cr.Add(AutomationElement.IsEnabledProperty);
    cr.Add(AutomationElement.HasKeyboardFocusProperty);
    cr.Add(ValuePattern.ValueProperty);
    cr.Add(TogglePattern.ToggleStateProperty);
    AutomationElementCollection all;
    var cond = new AndCondition(new PropertyCondition(AutomationElement.IsOffscreenProperty, false), new PropertyCondition(AutomationElement.IsControlElementProperty, true));
    using (cr.Activate()) { all = root.FindAll(TreeScope.Descendants, cond); }
    refs.Clear(); rects.Clear();
    var sb = new StringBuilder();
    RECT wr; GetWindowRect(h, out wr);
    sb.Append("Window: \"").Append(root.Current.Name).Append("\" (").Append(wr.Right - wr.Left).Append('x').Append(wr.Bottom - wr.Top).Append(")\n");
    int shown = 0, skipped = 0;
    foreach (AutomationElement e in all) {
      var rect = (System.Windows.Rect)e.GetCachedPropertyValue(AutomationElement.BoundingRectangleProperty);
      if (rect.IsEmpty || rect.Width < 2 || rect.Height < 2) continue;
      var ct = (ControlType)e.GetCachedPropertyValue(AutomationElement.ControlTypeProperty);
      string kind = ct.ProgrammaticName.Replace("ControlType.", "").ToLowerInvariant();
      string name = (e.GetCachedPropertyValue(AutomationElement.NameProperty) as string ?? "").Replace("\r", " ").Replace("\n", " ").Trim();
      bool interactive = Interactive.Contains(kind);
      if (!interactive && name.Length == 0) continue;
      if (shown >= max) { skipped++; continue; }
      refs.Add(e); rects.Add(rect);
      sb.Append("- ").Append(kind);
      if (name.Length > 0) sb.Append(" \"").Append(name.Length > 100 ? name.Substring(0, 99) + "…" : name).Append('"');
      sb.Append(" [@c").Append(refs.Count).Append(']');
      var states = new List<string>();
      if (!(bool)e.GetCachedPropertyValue(AutomationElement.IsEnabledProperty)) states.Add("disabled");
      if ((bool)e.GetCachedPropertyValue(AutomationElement.HasKeyboardFocusProperty)) states.Add("focused");
      object toggle = e.GetCachedPropertyValue(TogglePattern.ToggleStateProperty, true);
      if (toggle is ToggleState && (ToggleState)toggle == ToggleState.On) states.Add("checked");
      if (states.Count > 0) sb.Append(" [").Append(string.Join(", ", states)).Append(']');
      object value = e.GetCachedPropertyValue(ValuePattern.ValueProperty, true);
      string v = value as string;
      if (!string.IsNullOrEmpty(v) && v != name) sb.Append(" value=\"").Append(v.Length > 120 ? v.Substring(0, 119) + "…" : v.Replace("\n", " ")).Append('"');
      sb.Append('\n');
      shown++;
    }
    if (skipped > 0) sb.Append("… ").Append(skipped).Append(" more element(s) not shown; use a screenshot or focus a smaller window\n");
    return sb.ToString();
  }

  static System.Windows.Rect RefRect(int r) {
    if (r < 1 || r > rects.Count) throw new Exception("Ref @c" + r + " is not in the last computer_snapshot. Take a new one.");
    return rects[r - 1];
  }

  static object Point(int r) {
    var rect = RefRect(r);
    return new Dictionary<string, object> { { "x", (int)(rect.X + rect.Width / 2) }, { "y", (int)(rect.Y + rect.Height / 2) } };
  }

  static object SetValue(int r, string text) {
    RefRect(r);
    var e = refs[r - 1];
    object pattern;
    if (e.TryGetCurrentPattern(ValuePattern.Pattern, out pattern) && !((ValuePattern)pattern).Current.IsReadOnly) {
      e.SetFocus();
      ((ValuePattern)pattern).SetValue(text);
      return "value";
    }
    var rect = rects[r - 1];
    Click((int)(rect.X + rect.Width / 2), (int)(rect.Y + rect.Height / 2), "left", 1);
    Thread.Sleep(30);
    Chord(new int[] { 0x11 }, new int[] { 0x41 });
    Type(text);
    return "typed";
  }
}
`

/** Starts the helper: compiles the C# once into a DLL next to the script, then loads it on every later start. */
export const helperScript = (dllPath: string): string => String.raw`$ErrorActionPreference = 'Stop'
$dll = '${dllPath.replace(/'/g, "''")}'
if (-not (Test-Path -LiteralPath $dll)) {
  $source = [IO.File]::ReadAllText([IO.Path]::ChangeExtension($dll, '.cs'))
  Add-Type -TypeDefinition $source -OutputAssembly $dll -OutputType Library -ReferencedAssemblies System.Drawing, System.Web.Extensions, UIAutomationClient, UIAutomationTypes, WindowsBase
}
Add-Type -LiteralPath $dll
[HvComputer]::Run()
`
