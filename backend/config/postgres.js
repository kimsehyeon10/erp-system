const { Pool } = require("pg");

let pool = null;

function getPool() {
  if (pool) return pool;

  const config = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
      }
    : {
        host: process.env.PGHOST || "localhost",
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE || "erp",
        user: process.env.PGUSER || "erp",
        password: process.env.PGPASSWORD || "erp",
      };

  pool = new Pool(config);

  pool.on("error", (err) => {
    console.error("❌ PostgreSQL pool error:", err.message);
  });

  return pool;
}

function dbErrorMessage(err) {
  if (!err) return "Database error";
  if (err.code === "ECONNREFUSED") {
    return "PostgreSQL 연결에 실패했습니다. DB 컨테이너 실행 상태와 접속 정보(.env)를 확인하세요.";
  }
  if (err.code === "3D000") {
    return "데이터베이스를 찾을 수 없습니다. PGDATABASE 또는 DATABASE_URL을 확인하세요.";
  }
  if (err.code === "28P01") {
    return "PostgreSQL 인증에 실패했습니다. 사용자/비밀번호를 확인하세요.";
  }
  return `PostgreSQL 오류: ${err.message}`;
}

async function withTransaction(work) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function findUserIdByUsername(client, username) {
  if (!username) return null;
  const { rows } = await client.query(
    "SELECT id FROM users WHERE username = $1 LIMIT 1",
    [username]
  );
  return rows[0]?.id || null;
}

module.exports = {
  getPool,
  withTransaction,
  findUserIdByUsername,
  dbErrorMessage,
};
