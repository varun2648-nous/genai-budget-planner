const mysql = require("mysql2/promise");

const DB_HOST = process.env.DB_HOST || "localhost";
const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_USER = process.env.DB_USER || "root";
const DB_PASSWORD = process.env.DB_PASSWORD || "";
const DB_NAME = process.env.DB_NAME || "budget_reports";

let pool;

async function initDatabase() {
  const bootstrap = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    multipleStatements: true
  });

  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
  await bootstrap.end();

  pool = mysql.createPool({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: true,
    multipleStatements: true
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      month VARCHAR(20) NOT NULL,
      year INT NOT NULL,
      report_index INT NOT NULL,
      income DECIMAL(12,2),
      fixed_expenses DECIMAL(12,2),
      variable_expenses DECIMAL(12,2),
      savings_rate DECIMAL(5,2),
      expense_ratio DECIMAL(5,2),
      emergency_fund_months INT,
      discretionary_ratio DECIMAL(5,2),
      ai_summary TEXT,
      ai_recommendations TEXT,
      ai_summary_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      ai_summary_error TEXT NULL,
      index_status VARCHAR(20) NOT NULL DEFAULT 'pending',
      index_error TEXT NULL,
      llm_provider VARCHAR(50) NULL,
      embedding_provider VARCHAR(50) NULL,
      input_json TEXT NULL,
      metrics_json JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_month_year (month, year)
    ) ENGINE=InnoDB
  `);

  await ensureColumn(pool, "reports", "ai_summary_status", "VARCHAR(20) NOT NULL DEFAULT 'pending'");
  await ensureColumn(pool, "reports", "ai_summary_error", "TEXT NULL");
  await ensureColumn(pool, "reports", "index_status", "VARCHAR(20) NOT NULL DEFAULT 'pending'");
  await ensureColumn(pool, "reports", "index_error", "TEXT NULL");
  await ensureColumn(pool, "reports", "llm_provider", "VARCHAR(50) NULL");
  await ensureColumn(pool, "reports", "embedding_provider", "VARCHAR(50) NULL");

  return pool;
}

async function ensureColumn(pool, tableName, columnName, definition) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS total
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [DB_NAME, tableName, columnName]
  );

  if (Number(rows?.[0]?.total || 0) > 0) {
    return;
  }

  await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
}

function getPool() {
  if (!pool) {
    throw new Error("Database pool not initialized. Call initDatabase() first.");
  }

  return pool;
}

module.exports = {
  initDatabase,
  getPool
};
