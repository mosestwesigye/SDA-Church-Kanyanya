/**
 * Outgoing SMS through Africa's Talking (widely used in Uganda). Without a
 * provider configured outside production, the message is written to the
 * server log with the number masked (never the full phone number).
 */
export type Sms = { to: string; text: string };

export const maskPhone = (e164: string) => e164.replace(/^(\+\d{3})\d+(\d{3})$/, "$1•••••$2");

/** Test hook: captures messages instead of sending them. */
export const smsOutbox: Sms[] = [];

export async function sendSms(msg: Sms): Promise<void> {
  const username = process.env.AT_USERNAME;
  const apiKey = process.env.AT_API_KEY;
  if (process.env.NODE_ENV === "test" || process.env.VITEST) {
    smsOutbox.push(msg);
    return;
  }
  if (!username || !apiKey) {
    if (process.env.NODE_ENV === "production" && process.env.SMS_DEV_LOG !== "1") throw new Error("SMS provider is not configured (AT_USERNAME / AT_API_KEY).");
    console.info(`[sms:dev] to=${maskPhone(msg.to)}\n${msg.text}`);
    return;
  }
  const host = username === "sandbox" ? "api.sandbox.africastalking.com" : "api.africastalking.com";
  const body = new URLSearchParams({ username, to: msg.to, message: msg.text });
  if (process.env.AT_SENDER_ID) body.set("from", process.env.AT_SENDER_ID);
  const res = await fetch(`https://${host}/version1/messaging`, {
    method: "POST",
    headers: { apiKey, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`SMS send failed: ${res.status}`);
}
