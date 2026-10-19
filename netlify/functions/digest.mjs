// Weekday morning summary: each person's open and overdue steps.
// Runs on Netlify's scheduler. 13:00 UTC = 8:00 AM Central (daylight time),
// 7:00 AM Central (standard time). Change the cron below to move it.
import { admin, directory } from "../../src/admin.mjs";
import { digestFor, renderDigest, sendEmails } from "../../src/notify-core.mjs";

export default async () => {
  const { db, env } = admin();
  const [snap, people] = await Promise.all([db.collection("projects").where("archived", "==", false).get(), directory(db)]);
  const projects = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const today = new Date(Date.now() - 6 * 3600e3).toISOString().slice(0, 10); // Central-ish date
  const url = env("URL") || "";
  const emails = [];
  for (const [uid, items] of digestFor(projects, today)) {
    const u = people.get(uid);
    if (!u || !u.emailAlerts || !items.length) continue;
    emails.push({ to: u.email, ...renderDigest(items, url) });
  }
  if (emails.length) await sendEmails(emails, env);
  console.log(`Digest sent to ${emails.length} people.`);
};

export const config = { schedule: "0 13 * * 1-5" };
