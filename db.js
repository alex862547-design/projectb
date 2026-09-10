import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

// ฐานข้อมูลคลาวด์ (Neon/Render ฯลฯ) จะมี sslmode=require ติดมาใน connection string เสมอ ต้องต่อผ่าน SSL
// ส่วนฐานข้อมูลในเครื่องหรือใน container เดียวกัน (localhost, หรือ service ชื่อ "db" ตอนรันด้วย Docker Compose)
// ไม่มี sslmode ติดมา จึงไม่ต้องเปิด SSL — เช็คจาก connection string เองแทนการเดาจากชื่อโฮสต์
const needsSSL = /sslmode=require/i.test(process.env.DATABASE_URL || "");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error:", err);
});
