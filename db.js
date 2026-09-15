// จุดเดียวที่ต่อกับฐานข้อมูล PostgreSQL — export ตัวแปร `pool` ตัวเดียวให้ index.js เรียก
// pool.query(...) ใช้กับทุก endpoint ไม่มีไฟล์อื่นต่อฐานข้อมูลตรงๆ นอกจากไฟล์นี้
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

// ฐานข้อมูลคลาวด์ (Neon/Render ฯลฯ) จะมี sslmode=require ติดมาใน connection string เสมอ ต้องต่อผ่าน SSL
// ส่วนฐานข้อมูลในเครื่องหรือใน container เดียวกัน (localhost, หรือ service ชื่อ "db" ตอนรันด้วย Docker Compose)
// ไม่มี sslmode ติดมา จึงไม่ต้องเปิด SSL — เช็คจาก connection string เองแทนการเดาจากชื่อโฮสต์
const needsSSL = /sslmode=require/i.test(process.env.DATABASE_URL || "");

// ตั้งค่า pool ให้รับโหลดพร้อมกันได้มากขึ้นและไม่ค้างรอไม่มีกำหนดเวลา:
// - max: ยกจาก default (10) เป็น 20 — connection string ที่ใช้จริง (NEON_DATABASE_URL) ต่อผ่าน Neon pooled
//   endpoint (มี "-pooler" ในชื่อโฮสต์ ใช้ PgBouncer ข้างหลัง) จึงรองรับ connection จำนวนนี้ได้สบายๆ
// - connectionTimeoutMillis: ถ้า pool เต็มจริงๆ ให้ query โยน error ภายใน 8 วิ ดีกว่าค้างรอไม่มีกำหนด (default
//   คือ 0 = รอตลอดไป) เพราะฝั่งหน้าเว็บ (App.jsx) ดัก catch error ของรอบ poll ไว้เฉยๆอยู่แล้ว ไม่กระทบผู้ใช้
//   ที่เห็นแค่รอบอัปเดตนั้นถูกข้ามไปเฉยๆ แล้วรอบถัดไปจะลองใหม่เอง
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error:", err);
});
