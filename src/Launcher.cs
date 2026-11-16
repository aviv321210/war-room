// War Room launcher: one click starts the Foreman (the agents) and the studio server in the
// background, then opens the War Room window (Microsoft Edge in app mode, its own profile).
//   WarRoom.exe              start (first run, or Shift held: settings first)
//   WarRoom.exe --settings   change mode / API key / project folder
//   WarRoom.exe --stop       stop the agents and the studio server
// The agents keep working when the window is closed; "Stop War Room" (Start menu) ends them.
// Written for the .NET Framework 4 compiler (C# 5): no string interpolation or newer syntax.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyTitle("War Room")]
[assembly: System.Reflection.AssemblyProduct("War Room")]
[assembly: System.Reflection.AssemblyVersion("0.3.0.0")]

static class Launcher
{
    const string Title = "War Room";
    const int ForemanPort = 7878;
    const int StudioPort = 7880;
    static string App = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
    static string UserDir = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    static string Home = Path.Combine(UserDir, ".warroom");
    static string SettingsFile = Path.Combine(Home, "launcher.cfg");
    static string StudioState = Path.Combine(Home, "studio.json");
    static string LogDir = Path.Combine(App, "logs");
    static string WindowProfile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"WarRoom\window");

    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        string a = args.Length > 0 ? args[0].ToLowerInvariant() : "";
        try
        {
            if (a == "--stop") { StopStudio(); StopForeman(null); return 0; }
            MigrateOldSettings();
            Settings s = Settings.Load();
            bool shift = (Control.ModifierKeys & Keys.Shift) == Keys.Shift;
            if (s == null || a == "--settings" || shift)
            {
                s = SettingsForm.Ask(s ?? new Settings());
                if (s == null) return 1;
                s.Save();
                if (a == "--settings" || shift) StopForeman(null);   // the next start uses the new settings
            }
            return Start(s);
        }
        catch (Exception e)
        {
            MessageBox.Show(e.Message, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    // the earlier AgentCraft build kept its settings in ~/.agentcraft: carry the choices over once
    static void MigrateOldSettings()
    {
        string old = Path.Combine(Path.Combine(UserDir, ".agentcraft"), "launcher.cfg");
        if (File.Exists(SettingsFile) || !File.Exists(old)) return;
        try { Directory.CreateDirectory(Home); File.Copy(old, SettingsFile); } catch { /* start with the setup dialog */ }
    }

    static int Start(Settings s)
    {
        string backend = s.Mode == "sim" ? "sim" : "claude";
        // real agents on your own Claude sign-in: Claude Code's own sign-in first, in its own window and your browser
        if (s.Mode == "seat" && !PortOpen(ForemanPort) && !SignedIn())
        {
            MessageBox.Show("Your coding agents use your own Claude account.\n\nA console window opens now and takes you to the Claude sign-in in your browser. Come back here when it says you are signed in.", Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
            SignIn();
            if (!SignedIn())
            {
                MessageBox.Show("Not signed in to Claude, so the demo team works in your War Room this time.\n\nStart War Room with Shift held down to choose again.", Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
                backend = "sim";
            }
        }
        // a Foreman of the other mode holds the port: stop it so this mode can start
        string other = backend == "sim" ? "claude" : "sim";
        if (ForemanPid(other) > 0) StopForeman(other);

        string token = StudioToken();
        if (!PortOpen(ForemanPort) || token == null)
        {
            using (Splash splash = new Splash("Starting the War Room..."))
            {
                splash.Show();
                Application.DoEvents();
                if (!PortOpen(ForemanPort))
                {
                    string log = StartForeman(s, backend);
                    if (!WaitFor(delegate { return PortOpen(ForemanPort); }, 120, delegate { return ForemanStillStarting(backend, log); }))
                        return Fail(splash, "The agents (the Foreman) did not start.", log);
                }
                if (token == null)
                {
                    string log = StartStudio(s);
                    if (!WaitFor(delegate { return (token = StudioToken()) != null; }, 30, delegate { return !LogSays(log, @"(Error|in use|Cannot find)"); }))
                        return Fail(splash, "The War Room server did not start.", log);
                }
            }
        }
        OpenWindow("http://127.0.0.1:" + StudioPort + "/?t=" + token);
        return 0;
    }

    delegate bool Check();
    static bool WaitFor(Check done, int seconds, Check stillTrying)
    {
        DateTime deadline = DateTime.Now.AddSeconds(seconds);
        while (!done())
        {
            if (DateTime.Now > deadline || !stillTrying()) return false;
            Application.DoEvents();
            Thread.Sleep(300);
        }
        return true;
    }

    static int Fail(Form splash, string what, string log)
    {
        splash.Close();
        MessageBox.Show(what + "\n\nLast lines of " + log + ":\n\n" + Tail(log, 12), Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
        return 1;
    }

    // --- processes -----------------------------------------------------------------------------

    static ProcessStartInfo Hidden(string node, string args, string workDir, string log)
    {
        ProcessStartInfo psi = new ProcessStartInfo(Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe",
            "/d /s /c \"" + Q(node) + " " + args + " >> " + Q(log) + " 2>&1\"");
        psi.WorkingDirectory = workDir;
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.EnvironmentVariables["PATH"] = Path.Combine(App, @"runtime\git\cmd") + ";" + Path.Combine(App, @"runtime\node") + ";" +
                                           Environment.GetEnvironmentVariable("PATH");
        psi.EnvironmentVariables.Remove("NODE_OPTIONS");
        return psi;
    }

    static string NodeExe { get { return Path.Combine(App, @"runtime\node\node.exe"); } }

    // Claude Code as Anthropic ships it (it comes with the Foreman's packages). Signing in is its own "auth login":
    // the launcher never sees the password or the token, it only asks whether somebody is signed in.
    static string ClaudeExe { get { return Path.Combine(App, @"foreman\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe"); } }

    static ProcessStartInfo ClaudeCmd(string args, bool window)
    {
        ProcessStartInfo psi = new ProcessStartInfo(ClaudeExe, args);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = !window;
        psi.EnvironmentVariables.Remove("ANTHROPIC_API_KEY");
        psi.EnvironmentVariables.Remove("ANTHROPIC_AUTH_TOKEN");
        return psi;
    }

    static bool SignedIn()
    {
        if (!File.Exists(ClaudeExe)) return false;
        try
        {
            using (Process p = Process.Start(ClaudeCmd("auth status", false)))
            {
                if (!p.WaitForExit(20000)) { try { p.Kill(); } catch { } return false; }
                return p.ExitCode == 0;
            }
        }
        catch { return false; }
    }

    static void SignIn()
    {
        if (!File.Exists(ClaudeExe)) return;
        try { using (Process p = Process.Start(ClaudeCmd("auth login", true))) p.WaitForExit(600000); } catch { /* stays signed out */ }
    }

    static string StartForeman(Settings s, string backend)
    {
        Directory.CreateDirectory(LogDir);
        Directory.CreateDirectory(Home);
        string log = Path.Combine(LogDir, "foreman-" + backend + ".log");
        string args = "--import tsx src/main.ts --backend " + backend + " --profile " + backend +
                      " --home " + Q(Home) + " --port " + ForemanPort;
        if (backend == "claude" && !string.IsNullOrEmpty(s.Repo)) args += " --repo " + Q(s.Repo);
        if (s.Budget > 0) args += " --max-budget " + s.Budget.ToString(System.Globalization.CultureInfo.InvariantCulture);
        ProcessStartInfo psi = Hidden(NodeExe, args, Path.Combine(App, "foreman"), log);
        psi.EnvironmentVariables["AGENTCRAFT_HOME"] = Home;
        if (backend == "claude" && s.Mode == "seat")
        {
            // the Foreman's own switch for "use this person's Claude sign-in": no API key is passed on
            psi.Arguments = psi.Arguments.Replace(" --port " + ForemanPort, " --port " + ForemanPort + " --use-claude-login");
            psi.EnvironmentVariables.Remove("ANTHROPIC_API_KEY");
            psi.EnvironmentVariables.Remove("ANTHROPIC_AUTH_TOKEN");
        }
        else if (backend == "claude") psi.EnvironmentVariables["ANTHROPIC_API_KEY"] = s.ApiKey ?? "";
        File.AppendAllText(log, "\r\n===== " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " War Room launcher: starting the Foreman (" + backend + (s.Mode == "seat" && backend == "claude" ? ", Claude sign-in" : "") + ")\r\n");
        Process.Start(psi);
        return log;
    }

    static string StartStudio(Settings s)
    {
        Directory.CreateDirectory(LogDir);
        Directory.CreateDirectory(Home);
        string log = Path.Combine(LogDir, "studio.log");
        string args = Q(Path.Combine(App, @"studio\server.mjs")) + " --port " + StudioPort + " --foreman " + ForemanPort +
                      " --foreman-dir " + Q(Path.Combine(App, "foreman")) + " --state " + Q(StudioState);
        File.AppendAllText(log, "\r\n===== " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " War Room launcher: starting the studio server\r\n");
        ProcessStartInfo psi = Hidden(NodeExe, args, Path.Combine(App, "studio"), log);
        // the arena's agents: your Claude sign-in by default; with the API key mode they use that key
        if (s.Mode == "apikey" && !string.IsNullOrEmpty(s.ApiKey)) psi.EnvironmentVariables["ANTHROPIC_API_KEY"] = s.ApiKey;
        else { psi.EnvironmentVariables.Remove("ANTHROPIC_API_KEY"); psi.EnvironmentVariables.Remove("ANTHROPIC_AUTH_TOKEN"); }
        Process.Start(psi);
        return log;
    }

    // the studio server writes {pid, port, token} once it listens; null unless it is alive and answering
    static string StudioToken()
    {
        if (!File.Exists(StudioState)) return null;
        try
        {
            string j = File.ReadAllText(StudioState);
            Match t = Regex.Match(j, "\"token\"\\s*:\\s*\"([a-f0-9]+)\"");
            if (!t.Success || NodePid(j) == 0 || !PortOpen(StudioPort)) return null;
            return t.Groups[1].Value;
        }
        catch { return null; }
    }

    static void OpenWindow(string url)
    {
        string edge = FindEdge();
        if (edge == null)
        {
            Process.Start(url);   // no Edge: the default browser still works (the token is single-use per run)
            return;
        }
        Directory.CreateDirectory(WindowProfile);
        ProcessStartInfo psi = new ProcessStartInfo(edge,
            "--app=" + Q(url) + " --user-data-dir=" + Q(WindowProfile) + " --window-size=1440,900 --no-first-run --no-default-browser-check --autoplay-policy=no-user-gesture-required");
        psi.UseShellExecute = false;
        Process.Start(psi);
    }

    static string FindEdge()
    {
        foreach (RegistryKey root in new[] { Registry.CurrentUser, Registry.LocalMachine })
        {
            try
            {
                using (RegistryKey k = root.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"))
                {
                    string p = k == null ? null : k.GetValue("") as string;
                    if (!string.IsNullOrEmpty(p) && File.Exists(p)) return p;
                }
            }
            catch { /* try the next place */ }
        }
        foreach (string pf in new[] { Environment.GetEnvironmentVariable("ProgramFiles(x86)"), Environment.GetEnvironmentVariable("ProgramFiles") })
        {
            if (string.IsNullOrEmpty(pf)) continue;
            string p = Path.Combine(pf, @"Microsoft\Edge\Application\msedge.exe");
            if (File.Exists(p)) return p;
        }
        return null;
    }

    static bool ForemanStillStarting(string backend, string log)
    {
        // the Foreman exits early on a fatal start error; the log then ends with it
        return !LogSays(log, @"(Error|error:|EADDRINUSE|Cannot find)") || ForemanPid(backend) > 0;
    }

    static bool LogSays(string log, string pattern) { return Regex.IsMatch(Tail(log, 3), pattern); }

    static int NodePid(string json)
    {
        Match m = Regex.Match(json, "\"pid\"\\s*:\\s*(\\d+)");
        if (!m.Success) return 0;
        try
        {
            int pid = int.Parse(m.Groups[1].Value);
            return Process.GetProcessById(pid).ProcessName.ToLowerInvariant().StartsWith("node") ? pid : 0;
        }
        catch { return 0; }
    }

    static int ForemanPid(string profile)
    {
        string f = Path.Combine(Path.Combine(Home, profile), "foreman.json");
        try { return File.Exists(f) ? NodePid(File.ReadAllText(f)) : 0; }
        catch { return 0; }
    }

    static void Kill(int pid)
    {
        if (pid <= 0) return;
        ProcessStartInfo psi = new ProcessStartInfo("taskkill.exe", "/T /F /PID " + pid);
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        Process.Start(psi).WaitForExit(15000);
    }

    static void StopForeman(string onlyProfile)
    {
        foreach (string profile in new[] { "sim", "claude" })
            if (onlyProfile == null || profile == onlyProfile) Kill(ForemanPid(profile));
        for (int i = 0; i < 30 && PortOpen(ForemanPort); i++) Thread.Sleep(200);
    }

    static void StopStudio()
    {
        try { if (File.Exists(StudioState)) Kill(NodePid(File.ReadAllText(StudioState))); } catch { /* already gone */ }
        try { File.Delete(StudioState); } catch { /* not there */ }
    }

    static bool PortOpen(int port)
    {
        try
        {
            using (TcpClient c = new TcpClient())
            {
                IAsyncResult r = c.BeginConnect("127.0.0.1", port, null, null);
                return r.AsyncWaitHandle.WaitOne(300) && c.Connected;
            }
        }
        catch { return false; }
    }

    static string Q(string s) { return "\"" + s + "\""; }

    static string Tail(string file, int n)
    {
        try
        {
            using (FileStream fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            using (StreamReader r = new StreamReader(fs))
            {
                string[] lines = r.ReadToEnd().Split('\n');
                int from = Math.Max(0, lines.Length - n);
                return string.Join("\n", lines, from, lines.Length - from).Trim();
            }
        }
        catch { return ""; }
    }

    // --- settings ----------------------------------------------------------------------------

    internal class Settings
    {
        public string Mode = "sim";      // sim | seat | apikey
        public string ApiKey = "";
        public string Repo = "";
        public double Budget = 5;

        public static Settings Load()
        {
            if (!File.Exists(SettingsFile)) return null;
            Settings s = new Settings();
            foreach (string line in File.ReadAllLines(SettingsFile))
            {
                int i = line.IndexOf('=');
                if (i <= 0) continue;
                string k = line.Substring(0, i).Trim(), v = line.Substring(i + 1).Trim();
                if (k == "mode") s.Mode = v == "apikey" ? "apikey" : v == "seat" ? "seat" : "sim";
                else if (k == "repo") s.Repo = v;
                else if (k == "budget") double.TryParse(v, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out s.Budget);
                else if (k == "apikey" && v.Length > 0)
                {
                    // protected with Windows DPAPI: only this Windows user on this machine can read it
                    try { s.ApiKey = Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(v), null, DataProtectionScope.CurrentUser)); }
                    catch { s.ApiKey = ""; }
                }
            }
            return s;
        }

        public void Save()
        {
            Directory.CreateDirectory(Home);
            string enc = string.IsNullOrEmpty(ApiKey) ? "" :
                Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(ApiKey), null, DataProtectionScope.CurrentUser));
            File.WriteAllLines(SettingsFile, new[] {
                "mode=" + Mode, "apikey=" + enc, "repo=" + Repo,
                "budget=" + Budget.ToString(System.Globalization.CultureInfo.InvariantCulture) });
        }
    }

    class Splash : Form
    {
        public Splash(string text)
        {
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(360, 90);
            BackColor = Color.FromArgb(43, 33, 27);
            ShowInTaskbar = true;
            Text = Title;
            Label l = new Label();
            l.Text = text;
            l.ForeColor = Color.FromArgb(240, 230, 210);
            l.Font = new Font("Segoe UI", 11f);
            l.Dock = DockStyle.Fill;
            l.TextAlign = ContentAlignment.MiddleCenter;
            Controls.Add(l);
        }
    }

    class SettingsForm : Form
    {
        RadioButton sim = new RadioButton(), seat = new RadioButton(), api = new RadioButton();
        TextBox key = new TextBox(), repo = new TextBox(), budget = new TextBox();
        Settings result;

        public static Settings Ask(Settings current)
        {
            using (SettingsForm f = new SettingsForm(current))
            {
                return f.ShowDialog() == DialogResult.OK ? f.result : null;
            }
        }

        SettingsForm(Settings s)
        {
            Text = "War Room setup";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9.5f);
            ClientSize = new Size(540, 440);

            int y = 16;
            Controls.Add(Lbl("Who works at the desks of your War Room?", 16, y, true)); y += 30;

            sim.Text = "Demo team: scripted agents, free, no account needed";
            sim.SetBounds(24, y, 500, 24); Controls.Add(sim); y += 28;
            seat.Text = "Claude agents on your own Claude sign-in: real work on your code (your plan's usage)";
            seat.SetBounds(24, y, 510, 24); Controls.Add(seat); y += 28;
            api.Text = "Claude agents on an Anthropic API key: real work on your code (billed per use)";
            api.SetBounds(24, y, 500, 24); Controls.Add(api); y += 30;
            Label hint = Lbl("This is only about the coding agents. The arena game asks for your Claude sign-in inside the app.", 24, y, false);
            hint.ForeColor = Color.FromArgb(110, 100, 90); Controls.Add(hint); y += 30;

            Controls.Add(Lbl("Anthropic API key", 44, y, false)); y += 22;
            key.SetBounds(44, y, 450, 24); key.UseSystemPasswordChar = true; key.Text = s.ApiKey; Controls.Add(key); y += 28;
            LinkLabel get = new LinkLabel();
            get.Text = "Get a key at console.anthropic.com";
            get.SetBounds(44, y, 300, 20);
            get.LinkClicked += delegate { Process.Start("https://console.anthropic.com/settings/keys"); };
            Controls.Add(get); y += 30;

            Controls.Add(Lbl("Project folder (a git repository the agents work on; you can also add one later)", 44, y, false)); y += 22;
            repo.SetBounds(44, y, 360, 24); repo.Text = s.Repo; Controls.Add(repo);
            Button browse = new Button();
            browse.Text = "Browse...";
            browse.SetBounds(412, y - 1, 82, 26);
            browse.Click += delegate
            {
                using (FolderBrowserDialog d = new FolderBrowserDialog())
                {
                    d.Description = "Pick a git repository";
                    if (Directory.Exists(repo.Text)) d.SelectedPath = repo.Text;
                    if (d.ShowDialog(this) == DialogResult.OK) repo.Text = d.SelectedPath;
                }
            };
            Controls.Add(browse); y += 34;

            Controls.Add(Lbl("Spending cap per agent turn (USD)", 44, y + 3, false));
            budget.SetBounds(260, y, 70, 24);
            budget.Text = s.Budget.ToString(System.Globalization.CultureInfo.InvariantCulture);
            Controls.Add(budget); y += 44;

            Button ok = new Button(), cancel = new Button();
            ok.Text = "Start"; ok.SetBounds(316, y, 90, 30); ok.Click += OnOk;
            cancel.Text = "Cancel"; cancel.SetBounds(414, y, 90, 30); cancel.DialogResult = DialogResult.Cancel;
            Controls.Add(ok); Controls.Add(cancel);
            AcceptButton = ok; CancelButton = cancel;

            EventHandler sync = delegate { key.Enabled = get.Enabled = api.Checked; repo.Enabled = browse.Enabled = budget.Enabled = api.Checked || seat.Checked; };
            sim.CheckedChanged += sync; seat.CheckedChanged += sync; api.CheckedChanged += sync;
            if (s.Mode == "apikey") api.Checked = true; else if (s.Mode == "seat") seat.Checked = true; else sim.Checked = true;
            sync(null, null);
        }

        static Label Lbl(string text, int x, int y, bool bold)
        {
            Label l = new Label();
            l.Text = text;
            l.AutoSize = true;
            l.Location = new Point(x, y);
            if (bold) l.Font = new Font("Segoe UI", 11f, FontStyle.Bold);
            return l;
        }

        void OnOk(object sender, EventArgs e)
        {
            Settings s = new Settings();
            s.Mode = api.Checked ? "apikey" : seat.Checked ? "seat" : "sim";
            s.ApiKey = key.Text.Trim();
            s.Repo = repo.Text.Trim();
            double b;
            s.Budget = double.TryParse(budget.Text.Trim(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out b) && b > 0 ? b : 5;
            if (s.Mode != "sim")
            {
                if (s.Mode == "apikey" && !s.ApiKey.StartsWith("sk-ant-"))
                {
                    MessageBox.Show(this, "Enter your Anthropic API key (it starts with sk-ant-).", Title);
                    return;
                }
                if (s.Repo.Length > 0 && !Directory.Exists(Path.Combine(s.Repo, ".git")))
                {
                    MessageBox.Show(this, "The project folder must be the root of a git repository (it needs a .git folder).", Title);
                    return;
                }
            }
            result = s;
            DialogResult = DialogResult.OK;
            Close();
        }
    }
}
