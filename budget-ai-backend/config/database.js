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
      input_json TEXT NULL,
      metrics_json JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_month_year (month, year)
    ) ENGINE=InnoDB
  `);

  return pool;
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
