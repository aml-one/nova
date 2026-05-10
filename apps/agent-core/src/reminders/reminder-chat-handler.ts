import { PeopleRepository } from "../storage/repositories/people-repository.js";
import {
  cancelTimers,
  dismissReminder,
  insertReminder,
  insertTimer,
  listActiveTimers,
  listOpenReminders
} from "./reminder-repository.js";
import { enqueueOutboundMessage, pickOutboundForPerson } from "./reminder-outbound.js";
import { formatTimerRemaining, parseReminderOrTimerIntent } from "./reminder-timer-parse.js";

const people = new PeopleRepository();

function requesterLabelFor(userId: string): string {
  const p = people.getById(userId);
  const n = p?.displayName?.trim();
  return n || "Someone";
}

function resolveCrossTarget(targetToken: string):
  | { ok: true; person: import("../storage/repositories/people-repository.js").PersonRecord; dest: { channel: "signal" | "whatsapp"; recipient: string } }
  | { ok: false; message: string } {
  const matches = people.findPeopleByDisplayNameToken(targetToken);
  if (matches.length === 0) {
    return {
      ok: false,
      message: `I don’t have anyone named “${targetToken}” in People yet. Add them (or match their display name) in admin → People, then try again.`
    };
  }
  if (matches.length > 1) {
    const names = matches.map((m) => m.displayName ?? m.id).join(", ");
    return {
      ok: false,
      message: `I found more than one match for “${targetToken}”: ${names}. Use a unique display name in People or be more specific.`
    };
  }
  const person = matches[0];
  if (person.blocked || person.optedOut) {
    return {
      ok: false,
      message: `${person.displayName ?? targetToken} can’t receive reminders right now (blocked or opted out).`
    };
  }
  const dest = pickOutboundForPerson(person.id);
  if (!dest) {
    return {
      ok: false,
      message: `I know ${person.displayName ?? targetToken} in People, but they don’t have Signal or WhatsApp linked yet—add a phone / WhatsApp identity first.`
    };
  }
  return { ok: true, person, dest };
}

export function tryHandleReminderTimerChat(input: {
  text: string;
  userId: string;
  channel: "web" | "whatsapp" | "signal";
  channelReplyAddress?: string;
}): string | undefined {
  const parsed = parseReminderOrTimerIntent(input.text);
  if (!parsed) {
    return undefined;
  }
  if (input.channel === "web") {
    return "Reminders and kitchen timers work on Signal and WhatsApp so I can ping you (or another contact in People) when something is due.";
  }
  const recipient = input.channelReplyAddress?.trim();
  if (!recipient) {
    return undefined;
  }
  const ch = input.channel as "signal" | "whatsapp";
  const uid = input.userId;
  const byName = requesterLabelFor(uid);

  if (parsed.kind === "timer_status") {
    const timers = listActiveTimers(uid);
    if (timers.length === 0) {
      return "No active timer right now.";
    }
    const lines = timers.map((t) => {
      const name = (t.label ?? "Timer").trim() || "Timer";
      return `• ${name}: ${formatTimerRemaining(t.ends_at_ms)}`;
    });
    return ["Timers:", ...lines].join("\n");
  }

  if (parsed.kind === "timer_cancel") {
    const n = cancelTimers(uid);
    return n > 0 ? `Cancelled ${n} active timer(s).` : "There wasn’t an active timer to cancel.";
  }

  if (parsed.kind === "timer_set") {
    cancelTimers(uid);
    const endsAt = Date.now() + parsed.minutes * 60_000;
    insertTimer({
      userId: uid,
      channel: ch,
      recipient,
      label: parsed.label,
      endsAtMs: endsAt
    });
    return `Timer set for ${parsed.minutes} minute(s). I’ll message you when it’s up. (${formatTimerRemaining(endsAt)})`;
  }

  if (parsed.kind === "list") {
    const timers = listActiveTimers(uid);
    const reminders = listOpenReminders(uid);
    const tLines =
      timers.length === 0
        ? ["Timers: (none)"]
        : [
            "Timers:",
            ...timers.map((t) => {
              const name = (t.label ?? "Timer").trim() || "Timer";
              return `  • ${name} — ${formatTimerRemaining(t.ends_at_ms)}`;
            })
          ];
    const rLines =
      reminders.length === 0
        ? ["Reminders: (none open)"]
        : [
            "Reminders:",
            ...reminders.map((r) => {
              const when =
                r.fire_at_ms == null
                  ? "no date"
                  : `fires ${new Date(r.fire_at_ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`;
              const target =
                r.target_person_id && people.getById(r.target_person_id)?.displayName
                  ? ` → ${people.getById(r.target_person_id)!.displayName}`
                  : "";
              return `  • [${r.id.slice(0, 8)}]${target} ${r.body.slice(0, 100)} (${when})`;
            })
          ];
    return [...tLines, ...rLines].join("\n");
  }

  if (parsed.kind === "dismiss_reminder") {
    const ok = dismissReminder(uid, parsed.id);
    return ok ? "Got it — reminder cleared." : "I couldn’t find that reminder id.";
  }

  if (parsed.kind === "reminder_cross_immediate" || parsed.kind === "reminder_cross_scheduled") {
    const resolved = resolveCrossTarget(parsed.targetToken);
    if (!resolved.ok) {
      return resolved.message;
    }
    if (resolved.person.id === uid) {
      return "That’s you — use “remind me to …” for a note to yourself.";
    }
    const { dest, person } = resolved;
    const payload = `${byName} asked me to remind you: ${parsed.body}`;

    if (parsed.kind === "reminder_cross_immediate") {
      enqueueOutboundMessage(dest.channel, dest.recipient, payload);
      return `Done — I messaged ${person.displayName ?? parsed.targetToken}.`;
    }

    insertReminder({
      userId: uid,
      channel: dest.channel,
      recipient: dest.recipient,
      body: parsed.body,
      fireAtMs: parsed.fireAtMs,
      requestedByName: byName,
      targetPersonId: person.id
    });
    const when = new Date(parsed.fireAtMs).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    return `Scheduled — I’ll remind ${person.displayName ?? parsed.targetToken} around ${when}.`;
  }

  if (parsed.kind === "reminder_scheduled") {
    insertReminder({
      userId: uid,
      channel: ch,
      recipient,
      body: parsed.body,
      fireAtMs: parsed.fireAtMs
    });
    const when = new Date(parsed.fireAtMs).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    return `Noted — I’ll remind you around ${when}: ${parsed.body}`;
  }

  if (parsed.kind === "reminder_timeless") {
    insertReminder({
      userId: uid,
      channel: ch,
      recipient,
      body: parsed.body,
      fireAtMs: null
    });
    return `Saved (no alarm): ${parsed.body}. Say “list my reminders” anytime.`;
  }

  return undefined;
}
