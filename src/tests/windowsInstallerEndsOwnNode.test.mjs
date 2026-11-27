import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// An update can start while a Node process of the install folder has not left yet: the Mirror host, the
// learning host (a second host, a minute after launch and every ten minutes) and the Pi invocations all
// run `mirror-host\node\node.exe`. The installer then stops at "Error opening file for writing" in its
// default mode, or leaves the old node.exe in place without a word in the silent one. The installer ends
// those processes, and only those, before it writes its files.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const config = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const hooksPath = config.bundle.windows.nsis.installerHooks;
const hooks = hooksPath && existsSync(join(root, "src-tauri", hooksPath)) ? readFileSync(join(root, "src-tauri", hooksPath), "utf8") : "";

/** The PowerShell statement the hook runs, as PowerShell reads it (NSIS writes `$$` for a `$`). */
function hookCommand() {
  const line = hooks.split(/\r?\n/).find((candidate) => candidate.includes("nsExec::Exec")) ?? "";
  const quoted = /-Command "([^"]+)"/.exec(line);
  return quoted ? quoted[1].replaceAll("$$", "$") : "";
}

describe("The Windows installer ends the install folder's Node processes before writing", () => {
  it("is given its hooks by the configuration every Windows build reads", () => {
    expect(hooksPath).toBe("windows/installer-hooks.nsh");
    expect(hooks).toContain("!macro NSIS_HOOK_PREINSTALL");
    expect(config.bundle.windows.nsis.installerIcon).toBe("icons/icon.ico");
  });

  it("matches this install folder's Node by its full path and nothing by its name alone", () => {
    const command = hookCommand();
    expect(command).toContain("Join-Path $env:NAUTILUS_INSTALL_DIR 'mirror-host\\node\\node.exe'");
    expect(command).toContain("$_.ExecutablePath -eq $node");
    expect(hooks).toContain('SetEnvironmentVariable(t "NAUTILUS_INSTALL_DIR", t "$INSTDIR")');
    expect(hooks).not.toMatch(/taskkill|KillProcess/i);
  });

  it("reads the path through CIM, because the installer is a 32-bit process", () => {
    const command = hookCommand();
    expect(command).toContain("Get-CimInstance Win32_Process");
    // A 32-bit PowerShell cannot read the path of a 64-bit process through Get-Process: nothing matches.
    expect(command).not.toContain("Get-Process");
  });

  it("starts the system's own PowerShell and cannot hold the installation for ever", () => {
    expect(hooks).toContain('"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe"');
    expect(hooks).toMatch(/nsExec::Exec \/TIMEOUT=\d+ /);
  });

  const powershell32 = join(process.env.SystemRoot ?? "C:\\Windows", "SysWOW64", "WindowsPowerShell", "v1.0", "powershell.exe");
  it.skipIf(process.platform !== "win32" || !existsSync(powershell32))(
    "ends a Node running from the install folder, from a 32-bit PowerShell, and leaves another Node alone",
    async () => {
      const scratch = mkdtempSync(join(tmpdir(), "nautilus-installer-hook-"));
      const installed = join(scratch, "installed", "mirror-host", "node", "node.exe");
      const elsewhere = join(scratch, "elsewhere", "mirror-host", "node", "node.exe");
      for (const copy of [installed, elsewhere]) {
        mkdirSync(dirname(copy), { recursive: true });
        copyFileSync(process.execPath, copy);
      }
      const idle = ["-e", "setInterval(() => {}, 1000)"];
      const own = spawn(installed, idle, { stdio: "ignore" });
      const other = spawn(elsewhere, idle, { stdio: "ignore" });
      const ownLeft = new Promise((resolve) => own.once("exit", () => resolve(true)));
      try {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const ran = spawnSync(powershell32, ["-NoProfile", "-NonInteractive", "-Command", hookCommand()], {
          env: { ...process.env, NAUTILUS_INSTALL_DIR: join(scratch, "installed") },
          encoding: "utf8",
        });
        expect(ran.status, ran.stderr).toBe(0);
        expect(await Promise.race([ownLeft, new Promise((resolve) => setTimeout(() => resolve(false), 5000))])).toBe(true);
        expect(other.exitCode).toBeNull();
        expect(other.signalCode).toBeNull();
      } finally {
        own.kill();
        other.kill();
        await new Promise((resolve) => setTimeout(resolve, 500));
        rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      }
    },
    60000,
  );
});
