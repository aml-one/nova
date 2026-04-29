import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

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
    if (existsSync(dbSource)) {
      cpSync(dbSource, resolve(root, "data", "state", "nova.db"));
    }
    if (existsSync(configSource)) {
      cpSync(configSource, resolve(root, "config"), { recursive: true });
    }
    if (existsSync(skillsSource)) {
      cpSync(skillsSource, resolve(root, "skills"), { recursive: true });
    }
  }
}
