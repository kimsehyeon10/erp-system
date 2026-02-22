const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "models", "database.json");

function readDB() {
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}

function writeDB(nextDB) {
  const data = JSON.stringify(nextDB, null, 2);
  
  // 🔒 파일 락을 사용한 안전한 쓰기 (동시성 제어)
  // proper-lockfile이 설치되지 않은 경우를 대비한 폴백
  try {
    const lockfile = require("proper-lockfile");
    const lockOptions = {
      stale: 10000,
      retries: {
        retries: 5,
        minTimeout: 50,
        maxTimeout: 200
      }
    };
    
    let release;
    try {
      release = lockfile.lockSync(DB_PATH, lockOptions);
      fs.writeFileSync(DB_PATH, data, "utf-8");
    } finally {
      if (release) release();
    }
  } catch (lockError) {
    // lockfile 미설치 시 일반 쓰기 (향후 npm install proper-lockfile --break-system-packages 권장)
    console.warn("⚠️  proper-lockfile not installed, using standard write (race condition risk)");
    fs.writeFileSync(DB_PATH, data, "utf-8");
  }
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
