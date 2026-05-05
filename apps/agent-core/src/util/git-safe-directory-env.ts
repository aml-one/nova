/**
 * LaunchDaemons often run Git as root while the checkout is owned by a normal user.
 * Git >= 2.35 refuses that unless `safe.directory` includes the repo (CVE-2022-24765).
 * Setting it only for this subprocess avoids requiring a manual `git config --global`.
 */
export function gitSafeDirectoryEnvForRepo(repoRoot: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: repoRoot
  };
}
