const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "models", "database.json");

function nowISO() {
  return new Date().toISOString();
}

function genId(prefix = "ID") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function ensureDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(
      DB_PATH,
      JSON.stringify(
        {
          users: [
            { username: "admin", password: "1234", role: "admin" },
            { username: "manager", password: "1234", role: "manager" },
            { username: "staff", password: "1234", role: "staff" },
          ],
          products: [],
          history: [],
        },
        null,
        2
      )
    );
  }
}

function migrate(db) {
  db.products = (db.products || []).map((p) => ({
    id: p.id || genId("P"),
    code: p.code,
    name: p.name,
    category: p.category || "미분류",
    qty: Number(p.qty || 0),
    price: Number(p.price || 0),
    safetyStock: Number(p.safetyStock || 10),

    unit: (p.unit || "EA").toUpperCase(),
    location: p.location || "",
    spec: p.spec || "",
    description: p.description || "",
    condition: p.condition === "used" ? "used" : "new",
    type: p.type === "bom" ? "bom" : "standard",
    barcode: p.barcode || "",
    bomItems: Array.isArray(p.bomItems) ? p.bomItems : [],

    updatedAt: p.updatedAt || nowISO(),
  }));

  db.history = db.history || [];
  db.users = db.users || [];

  return db;
}

function readDB() {
  ensureDB();
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return migrate(JSON.parse(raw));
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(migrate(db), null, 2));
}

module.exports = { readDB, writeDB, nowISO, genId };
