/**
 * Builds the SMS/WhatsApp body Nova sends to the *recipient* of an admin relay (`/tell` or NL "tell X to …").
 * - Opens with the recipient’s name (clear who the DM is for).
 * - Rewrites "talking to you" / "keep talking to you" when the sender was addressing Nova, so the third party isn’t confused.
 * - Special-cases common “keep chatting with Nova for practice” nudges into clear wording (with first-person “I”
 *   referring to the sender, right after “&lt;Sender&gt; asked me to tell you to …”).
 */
export function formatAdminRelayPayload(input: {
  recipientDisplayName: string;
  senderDisplayName: string;
  rawMessage: string;
  relationshipConfirmed: boolean;
}): string {
  const recipient = input.recipientDisplayName.trim() || "there";
  const sender = input.senderDisplayName.trim() || "Someone";
  const senderFirst = sender.split(/\s+/)[0] ?? sender;
  const body = polishRelayBodyForThirdParty(input.rawMessage.trim(), senderFirst);

  if (input.relationshipConfirmed) {
    return `${recipient}, ${sender} asked me to remind you:\n\n${body}`;
  }
  return `${recipient}, ${sender} asked me to tell you to ${body}`;
}

function polishRelayBodyForThirdParty(raw: string, senderFirst: string): string {
  let t = raw.replace(/\s*\.+\s*(:?\)+|☺|😊|🙂)*\s*$/gi, "").trim();
  const compact = t.replace(/\s+/g, " ").toLowerCase();

  const isKeepTalkingPracticeNudge =
    (/keep\s+talking\s+to\s+you/.test(compact) || /keep\s+talking\s+with\s+you/.test(compact)) &&
    (/practice|social\s+skill|conversation/.test(compact) || /skill/.test(compact));

  if (isKeepTalkingPracticeNudge) {
    // "I" = the sender (named in the outer sentence) asking Anita for more chat with Nova.
    return "please keep the conversation going! I definitely need all the practice I can get.";
  }

  t = t.replace(/\bkeep talking to you\b/gi, "please keep the conversation going with Nova");
  t = t.replace(/\btalking to you\b/gi, "talking with Nova");
  t = t.replace(/\bso you can\b/gi, `so ${senderFirst} can`);
  return t;
}
