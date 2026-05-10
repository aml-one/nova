/**
 * Reminder + kitchen timer behavior is implemented in agent-core (`reminders/` + orchestrator)
 * so it survives restarts: timers store `ends_at_ms` in SQLite; the daemon compares wall clock to that instant.
 *
 * This skill entry exists for discovery, reload, and optional `run()` diagnostics.
 */
const remindersAndTimersSkill = {
  manifest: {
    id: "reminders-and-timers",
    name: "Reminders & timers",
    description:
      "Self reminders (“remind me tomorrow…”, “remind me in 20 minutes…”), cross-person reminders to anyone in People with Signal/WhatsApp " +
      "(e.g. “please remind Anita to do the dishes” — Nova texts Anita on your behalf), egg timers (persisted as end timestamps), list/cancel. " +
      "Requires People entries with outbound identities.",
    permissions: [] as string[]
  },
  async run(): Promise<{ hint: string }> {
    return {
      hint: "Say things like “remind me in 15 minutes to stretch”, “set a timer for 45 minutes”, or “please remind Sam that the call moved to 3pm” in Signal/WhatsApp."
    };
  }
};

export default remindersAndTimersSkill;
