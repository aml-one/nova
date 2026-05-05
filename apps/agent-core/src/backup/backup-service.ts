import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export class BackupService {
  async createBackup(): Promise<string> {
    const root = process.cwd();
    const backupDir = resolve(root, "data", "backups", `backup-${Date.now()}`);
    mkdirSync(backupDir, { recursive: true });
    const dbPath = resolve(root, "data", "state", "nova.db");
    const configPath = resolve(root, "config");
    const skillsPath = resolve(root, "skills");
    if (existsSync(dbPath)) {
      cpSync(dbPath, resolve(backupDir, "nova.db"));
    }
    const stateDir = resolve(root, "data", "state");
    const stateSidecars = ["learning-log.json", "curiosity-store.json", "install-meta.json"] as const;
    for (const name of stateSidecars) {
      const full = resolve(stateDir, name);
      if (existsSync(full)) {
        cpSync(full, resolve(backupDir, name));
      }
    }
    if (existsSync(configPath)) {
      cpSync(configPath, resolve(backupDir, "config"), { recursive: true });
    }
    if (existsSync(skillsPath)) {
      cpSync(skillsPath, resolve(backupDir, "skills"), { recursive: true });
    }
    return backupDir;
  }

  async restoreBackup(backupPath: string): Promise<void> {
    const root = process.cwd();
    const dbSource = resolve(backupPath, "nova.db");
    const configSource = resolve(backupPath, "config");
    const skillsSource = resolve(backupPath, "skills");
    const stateDestDir = resolve(root, "data", "state");
    mkdirSync(stateDestDir, { recursive: true });
    if (existsSync(dbSource)) {
      cpSync(dbSource, resolve(stateDestDir, "nova.db"));
    }
    const sidecars = ["learning-log.json", "curiosity-store.json", "install-meta.json"] as const;
    for (const name of sidecars) {
      const src = resolve(backupPath, name);
      if (existsSync(src)) {
        const dest = resolve(stateDestDir, name);
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(src, dest);
      }
    }
    if (existsSync(configSource)) {
      cpSync(configSource, resolve(root, "config"), { recursive: true });
    }
    if (existsSync(skillsSource)) {
      cpSync(skillsSource, resolve(root, "skills"), { recursive: true });
    }
  }
}
