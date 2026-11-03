import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const dbPath = fileURLToPath(new URL("../../bioscom.db", import.meta.url));
const db = new Database(dbPath);
const row = db.prepare("SELECT tree, version FROM group_inventory_docs WHERE group_id = ?").get("PKwJMGE33ZSg");
if (row === undefined) throw new Error("group not found");
const tree = JSON.parse(row.tree);
const freezer = (tree.deepFreezers ?? []).find((c) => c.id === "demo-deepfreezer");
if (freezer === undefined) {
  console.log("demo-deepfreezer not present");
} else {
  const stray = (freezer.shelves ?? []).find((s) => s.name === "test rack" && s.rackName === undefined);
  if (stray === undefined) {
    console.log("no stray shelf to normalize");
  } else {
    freezer.rackPositions = { ...(freezer.rackPositions ?? {}), C: 2 };
    stray.rackName = "C";
    stray.boxName = "1";
    db.prepare("UPDATE group_inventory_docs SET tree = ?, version = ? WHERE group_id = ?").run(
      JSON.stringify(tree),
      row.version + 1,
      "PKwJMGE33ZSg",
    );
    console.log("normalized stray 'test rack' → Rack C / Box 1");
  }
}
db.close();
