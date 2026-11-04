import mysql from 'mysql2/promise'
import 'dotenv/config'

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'macaron_bakery',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  charset: 'utf8mb4',
  decimalNumbers: true,
})

export async function testDatabaseConnection() {
  const connection = await pool.getConnection()
  try {
    const [rows] = await connection.query('SELECT DATABASE() AS database_name, NOW() AS server_time')
    return rows[0]
  } finally {
    connection.release()
  }
}

export default pool
