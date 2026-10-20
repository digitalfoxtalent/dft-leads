// Forwards to pitch@ that Gmail blocked (Tom, 20 Oct 2026). Every 10 minutes this finds Gmail's bounce notices for
// pitch@ and press@ in each team mailbox and puts a note in the forwarder's inbox with a link to build the pitch once
// they have checked the sender. It builds nothing itself: Gmail's block is only overridden by a person clicking.
// The logic lives in roster.js (pitchBounceSweep) next to the pitch build it hands over to.
// Refused unless it comes from Vercel's scheduler or carries CRON_SECRET. ?dry=1 reports what it would do, changing nothing.
import { isCron } from "./_reports/cron.js";
import { pitchBounceSweep } from "./roster.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (!isCron(req)) return res.status(404).json({ error: "Not found" });
  res.setHeader("Cache-Control", "no-store");
  try {
    return res.status(200).json(await pitchBounceSweep({ dry: String((req.query || {}).dry || "") === "1" }));
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e).slice(0, 300) });
  }
}
