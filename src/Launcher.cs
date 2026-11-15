// AgentCraft launcher: one click starts the Foreman (the agents) in the background and opens
// Minecraft through the bundled Prism Launcher instance.
//   AgentCraft.exe              start (first run, or Shift held: settings first)
//   AgentCraft.exe --settings   change mode / API key / project folder
//   AgentCraft.exe --stop       stop the Foreman
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

[assembly: System.Reflection.AssemblyTitle("AgentCraft")]
[assembly: System.Reflection.AssemblyProduct("AgentCraft")]
[assembly: System.Reflection.AssemblyVersion("0.1.0.0")]

static class Launcher
{
    const int Port = 7878;
    static string App = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
    static string Home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".agentcraft");
    static string SettingsFile = Path.Combine(Home, "launcher.cfg");
    static string LogDir = Path.Combine(App, "logs");

    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        string a = args.Length > 0 ? args[0].ToLowerInvariant() : "";
        try
        {
            if (a == "--stop") { StopForeman(null); return 0; }
            Settings s = Settings.Load();
            bool shift = (Control.ModifierKeys & Keys.Shift) == Keys.Shift;
            if (s == null || a == "--settings" || shift)
            {
                s = SettingsForm.Ask(s ?? new Settings());
                if (s == null) return 1;
                s.Save();
                if (a == "--settings") StopForeman(null);   // next start uses the new settings
            }
            return Start(s);
        }
        catch (Exception e)
        {
            MessageBox.Show(e.Message, "AgentCraft", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    static int Start(Settings s)
    {
        string backend = s.Mode == "apikey" ? "claude" : "sim";
        // a Foreman of the other mode holds the port: stop it so this mode can start
        string other = backend == "sim" ? "claude" : "sim";
        if (ForemanPid(other) > 0) StopForeman(other);

        if (!PortOpen())
        {
            using (Splash splash = new Splash("Starting the AgentCraft team..."))
            {
                splash.Show();
                Application.DoEvents();
                string log = StartForeman(s, backend);
                DateTime deadline = DateTime.Now.AddSeconds(120);
                while (!PortOpen())
                {
                    if (DateTime.Now > deadline || !ForemanStillStarting(backend, log))
                    {
                        splash.Close();
                        MessageBox.Show("The AgentCraft Foreman did not start.\n\nLast lines of " + log + ":\n\n" + Tail(log, 12),
                            "AgentCraft", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        return 1;
                    }
                    Application.DoEvents();
                    Thread.Sleep(300);
                }
            }
        }
        StartGame();
        return 0;
    }

    static string StartForeman(Settings s, string backend)
    {
        Directory.CreateDirectory(LogDir);
        Directory.CreateDirectory(Home);
        string log = Path.Combine(LogDir, "foreman-" + backend + ".log");
        string node = Path.Combine(App, @"runtime\node\node.exe");
        string args = "--import tsx src/main.ts --backend " + backend + " --profile " + backend +
                      " --home " + Q(Home) + " --port " + Port;
        if (backend == "claude" && !string.IsNullOrEmpty(s.Repo)) args += " --repo " + Q(s.Repo);
        if (s.Budget > 0) args += " --max-budget " + s.Budget.ToString(System.Globalization.CultureInfo.InvariantCulture);

        ProcessStartInfo psi = new ProcessStartInfo(Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe",
            "/d /s /c \"" + Q(node) + " " + args + " >> " + Q(log) + " 2>&1\"");
        psi.WorkingDirectory = Path.Combine(App, "foreman");
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        string path = Path.Combine(App, @"runtime\git\cmd") + ";" + Path.Combine(App, @"runtime\node") + ";" +
                      Environment.GetEnvironmentVariable("PATH");
        psi.EnvironmentVariables["PATH"] = path;
        psi.EnvironmentVariables["AGENTCRAFT_HOME"] = Home;
        psi.EnvironmentVariables.Remove("NODE_OPTIONS");
        if (backend == "claude")
        {
            psi.EnvironmentVariables["ANTHROPIC_API_KEY"] = s.ApiKey ?? "";
        }
        File.AppendAllText(log, "\r\n===== " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " AgentCraft launcher: starting the Foreman (" + backend + ")\r\n");
        Process.Start(psi);
        return log;
    }

    static bool ForemanStillStarting(string backend, string log)
    {
        // the Foreman exits early on a fatal start error; the log then ends with it
        string t = Tail(log, 3);
        return !Regex.IsMatch(t, @"(Error|error:|EADDRINUSE|Cannot find)", RegexOptions.None) || ForemanPid(backend) > 0;
    }

    static void StartGame()
    {
        string prism = Path.Combine(App, @"prism\prismlauncher.exe");
        ProcessStartInfo psi = new ProcessStartInfo(prism, "--launch AgentCraft");
        psi.WorkingDirectory = Path.Combine(App, "prism");
        psi.UseShellExecute = false;
        // the game inherits Prism's environment
        psi.EnvironmentVariables["AGENTCRAFT_PORT"] = Port.ToString();
        psi.EnvironmentVariables["AGENTCRAFT_MUTE"] = "0";
        psi.EnvironmentVariables["AGENTCRAFT_FOCUS"] = "1";
        psi.EnvironmentVariables["AGENTCRAFT_AUTOWORLD"] = "1";
        Process.Start(psi);
    }

    // --- Foreman process ---------------------------------------------------------------------

    static int ForemanPid(string profile)
    {
        string f = Path.Combine(Path.Combine(Home, profile), "foreman.json");
        if (!File.Exists(f)) return 0;
        try
        {
            Match m = Regex.Match(File.ReadAllText(f), "\"pid\"\\s*:\\s*(\\d+)");
            if (!m.Success) return 0;
            int pid = int.Parse(m.Groups[1].Value);
            Process p = Process.GetProcessById(pid);
            return p.ProcessName.ToLowerInvariant().StartsWith("node") ? pid : 0;
        }
        catch { return 0; }
    }

    static void StopForeman(string onlyProfile)
    {
        foreach (string profile in new[] { "sim", "claude" })
        {
            if (onlyProfile != null && profile != onlyProfile) continue;
            int pid = ForemanPid(profile);
            if (pid <= 0) continue;
            ProcessStartInfo psi = new ProcessStartInfo("taskkill.exe", "/T /F /PID " + pid);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            Process k = Process.Start(psi);
            k.WaitForExit(15000);
        }
        for (int i = 0; i < 30 && PortOpen(); i++) Thread.Sleep(200);
    }

    static bool PortOpen()
    {
        try
        {
            using (TcpClient c = new TcpClient())
            {
                IAsyncResult r = c.BeginConnect("127.0.0.1", Port, null, null);
                bool ok = r.AsyncWaitHandle.WaitOne(300) && c.Connected;
                return ok;
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
        public string Mode = "sim";      // sim | apikey
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
                if (k == "mode") s.Mode = v == "apikey" ? "apikey" : "sim";
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
            Text = "AgentCraft";
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
        RadioButton sim = new RadioButton(), api = new RadioButton();
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
            Text = "AgentCraft setup";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9.5f);
            ClientSize = new Size(520, 360);

            int y = 16;
            Controls.Add(Lbl("Who works in your studio?", 16, y, true)); y += 30;

            sim.Text = "Demo team: scripted agents, free, no account needed";
            sim.SetBounds(24, y, 480, 24); Controls.Add(sim); y += 28;
            api.Text = "Claude agents: real work on your code (Anthropic API key, billed per use)";
            api.SetBounds(24, y, 480, 24); Controls.Add(api); y += 36;

            Controls.Add(Lbl("Anthropic API key", 44, y, false)); y += 22;
            key.SetBounds(44, y, 450, 24); key.UseSystemPasswordChar = true; key.Text = s.ApiKey; Controls.Add(key); y += 28;
            LinkLabel get = new LinkLabel();
            get.Text = "Get a key at console.anthropic.com";
            get.SetBounds(44, y, 300, 20);
            get.LinkClicked += delegate { Process.Start("https://console.anthropic.com/settings/keys"); };
            Controls.Add(get); y += 30;

            Controls.Add(Lbl("Project folder (a git repository the agents work on; you can also add one in game)", 44, y, false)); y += 22;
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

            EventHandler sync = delegate { key.Enabled = repo.Enabled = browse.Enabled = budget.Enabled = get.Enabled = api.Checked; };
            sim.CheckedChanged += sync; api.CheckedChanged += sync;
            if (s.Mode == "apikey") api.Checked = true; else sim.Checked = true;
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
            s.Mode = api.Checked ? "apikey" : "sim";
            s.ApiKey = key.Text.Trim();
            s.Repo = repo.Text.Trim();
            double b;
            s.Budget = double.TryParse(budget.Text.Trim(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out b) && b > 0 ? b : 5;
            if (s.Mode == "apikey")
            {
                if (!s.ApiKey.StartsWith("sk-ant-"))
                {
                    MessageBox.Show(this, "Enter your Anthropic API key (it starts with sk-ant-).", "AgentCraft");
                    return;
                }
                if (s.Repo.Length > 0 && !Directory.Exists(Path.Combine(s.Repo, ".git")))
                {
                    MessageBox.Show(this, "The project folder must be the root of a git repository (it needs a .git folder).", "AgentCraft");
                    return;
                }
            }
            result = s;
            DialogResult = DialogResult.OK;
            Close();
        }
    }
}
