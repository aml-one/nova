import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type InstallState = {
  installedAt: string;
};

export class InstallStateService {
  private readonly filePath = resolve(process.cwd(), "data", "state", "install-meta.json");

  ensureInitialized(): void {
    if (existsSync(this.filePath)) {
      return;
    }
    this.write({ installedAt: new Date().toISOString() });
  }

  getInstalledAt(): string {
    this.ensureInitialized();
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<InstallState>;
      const value = parsed.installedAt;
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    } catch {
      // ignore and rewrite
    }
    const fallback = new Date().toISOString();
    this.write({ installedAt: fallback });
    return fallback;
  }

  setInstalledAt(isoTime: string): void {
    this.write({ installedAt: isoTime });
  }

  private write(state: InstallState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(state, null, 2), "utf8");
  }
}
