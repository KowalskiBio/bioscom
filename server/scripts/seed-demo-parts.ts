import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const dbPath = fileURLToPath(new URL("../../bioscom.db", import.meta.url));
const GROUP_ID = process.env.GROUP_ID ?? "PKwJMGE33ZSg";
const DAY = 86_400_000;

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function ymd(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

const db = new Database(dbPath);

const instruments = [
  { id: "demo-inst-qt", name: "QuantStudio 5", description: "qPCR thermocycler, 96-well", location: "C05/209 bench 2", contactPerson: "K. Demo", contactEmail: "demo@local" },
  { id: "demo-inst-cfx", name: "CytoFLEX S", description: "Flow cytometer, 4-laser (V-B-R-YG)", location: "C05/112 cytometry bay", contactPerson: "K. Demo", contactEmail: "demo@local" },
  { id: "demo-inst-cent", name: "Centrifuge 5810 R", description: "Refrigerated benchtop centrifuge, swing-bucket", location: "C05/209 bench 5", contactPerson: "Demo Team", contactEmail: "demo@local" },
];

const bookings = [
  { instrument: "demo-inst-qt", offset: 0, start: "09:00", end: "12:00", user: "A. Novak", note: "SYBR run, housekeeping genes" },
  { instrument: "demo-inst-cfx", offset: 0, start: "13:00", end: "15:30", user: "K. Richter", note: "GFP transfection check" },
  { instrument: "demo-inst-cent", offset: 0, start: "16:00", end: "16:30", user: "Admin" },
  { instrument: "demo-inst-qt", offset: 1, start: "08:00", end: "10:00", user: "K. Richter", note: "melt curve follow-up" },
  { instrument: "demo-inst-cent", offset: 1, start: "10:30", end: "11:00", user: "A. Novak" },
  { instrument: "demo-inst-cfx", offset: -1, start: "15:00", end: "17:00", user: "Admin", note: "weekly calibration" },
];

const notices = [
  { title: "Demo content loaded", content: "Demo rooms, containers, typed materials and bookable machines were seeded for presentation purposes. Feel free to click through the Catalog.", category: "info", days: 0 },
  { title: "Deep freezer maintenance Fri 14:00", content: "DF-02 archive access will be restricted during the compressor swap.", category: "issue", days: 2 },
  { title: "Restock proposal: pipette tips", content: "Tip boxes 200 μL below par level across labs; propose a joint order next week.", category: "suggestion", days: 1 },
];

const run = db.transaction(() => {
  for (const inst of instruments) {
    db.prepare(
      "INSERT OR REPLACE INTO instruments (id, source, group_id, name, description, location, contact_person, contact_email, owner_lab_id, owner_lab_name) VALUES (?, 'shared', ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(inst.id, GROUP_ID, inst.name, inst.description, inst.location, inst.contactPerson, inst.contactEmail, GROUP_ID, "Test Lab");
  }
  for (const b of bookings) {
    const ts = Date.now() + b.offset * DAY;
    db.prepare(
      "INSERT INTO instrument_bookings (id, instrument_id, date, start_time, end_time, user_id, user_name, lab_name, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(genId("bk"), b.instrument, ymd(ts), b.start, b.end, "demo-user", b.user, "Test Lab", b.note ?? null);
  }
  for (const n of notices) {
    db.prepare(
      "INSERT INTO notices (id, scope, group_id, title, content, category, author_name, author_uid, author_lab, author_avatar, timestamp) VALUES (?, 'shared', ?, ?, ?, ?, ?, ?, ?, NULL, ?)",
    ).run(
      genId("nt"),
      GROUP_ID,
      n.title,
      n.content,
      n.category,
      "Demo User",
      "demo-bot",
      "Test Lab",
      Date.now() - n.days * DAY,
    );
  }
});
run();

const counts = {
  instruments: (db.prepare("SELECT COUNT(*) AS n FROM instruments").get() as { n: number }).n,
  bookings: (db.prepare("SELECT COUNT(*) AS n FROM instrument_bookings").get() as { n: number }).n,
  notices: (db.prepare("SELECT COUNT(*) AS n FROM notices").get() as { n: number }).n,
};
console.log("✔ instruments/bookings/notices seeded:", JSON.stringify(counts));
db.close();
