type OutcomeSummary = {
  totalRuns: number;
  failures: number;
  topFailingTasks: string[];
};

export function summarizeOutcomes(tasks: string[], successes: boolean[]): OutcomeSummary {
  const counts = new Map<string, number>();
  successes.forEach((ok, index) => {
    if (!ok) {
      const task = tasks[index] ?? "unknown";
      counts.set(task, (counts.get(task) ?? 0) + 1);
    }
  });
  const topFailingTasks = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([task]) => task);
  return {
    totalRuns: successes.length,
    failures: successes.filter((item) => !item).length,
    topFailingTasks
  };
}

export function generateImprovementPrompt(summary: OutcomeSummary): string {
  if (summary.failures <= 0) {
    return `No changes needed. Runs observed: ${summary.totalRuns}.`;
  }
  const focus = summary.topFailingTasks.length > 0 ? summary.topFailingTasks.join(", ") : "general reliability";
  return `Detected ${summary.failures}/${summary.totalRuns} failures. Focus improvement on: ${focus}.`;
}
