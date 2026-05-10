import { formatWorldClocks } from "../../apps/agent-core/src/execution/world-clocks.js";

/**
 * Instant multi-zone clock readout (no shell). Used automatically in chat when the skill is enabled;
 * this `run` entry is for diagnostics or future tooling.
 */
const timeAndDateSkill = {
  manifest: {
    id: "time-and-date",
    name: "Time & date (world clocks)",
    description:
      "Returns synchronized wall times for Greece/Athens (Nova home), London, Hungary, Miami (US Eastern), and China/Shanghai. " +
      "Ask e.g. “What time is it in Greece and London?” or “world clocks”. " +
      "Override Nova’s calendar home with NOVA_HOME_TIMEZONE (IANA id, default Europe/Athens).",
    permissions: [] as string[]
  },
  async run(): Promise<{ summary: string }> {
    return { summary: formatWorldClocks() };
  }
};

export default timeAndDateSkill;
