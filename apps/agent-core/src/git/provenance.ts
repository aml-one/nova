export type ChangeProvenance = {
  taskId: string;
  rationale: string;
  validationEvidence: string[];
};

export function formatCommitBody(provenance: ChangeProvenance): string {
  const lines = [
    `Task: ${provenance.taskId}`,
    `Rationale: ${provenance.rationale}`,
    "Validation:"
  ];
  for (const item of provenance.validationEvidence) {
    lines.push(`- ${item}`);
  }
  return lines.join("\n");
}
