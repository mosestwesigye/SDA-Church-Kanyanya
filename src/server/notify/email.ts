/**
 * Outgoing email. Without a provider configured (local development) the
 * message is written to the server log instead of being sent.
 */
export type Email = { to: string; subject: string; text: string };

export async function sendEmail(msg: Email): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? "SDAK Church Manager <no-reply@example.org>";
  if (!key) {
    console.info(`[email:dev] to=${msg.to} subject="${msg.subject}"\n${msg.text}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: msg.to, subject: msg.subject, text: msg.text }),
  });
  if (!res.ok) throw new Error(`Email send failed: ${res.status}`);
}
