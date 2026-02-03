const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "models", "database.json");

function readDB() {
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}

function writeDB(nextDB) {
  fs.writeFileSync(DB_PATH, JSON.stringify(nextDB, null, 2), "utf-8");
}

function nowISO() {
  return new Date().toISOString();
}

function genId(prefix = "ID") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

module.exports = {
  readDB,
  writeDB,
  nowISO,
  genId,
  DB_PATH,
};
