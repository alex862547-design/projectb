import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

// ฐานข้อมูลบน Render (หรือผู้ให้บริการคลาวด์อื่นๆ) ต้องต่อผ่าน SSL เสมอ
// ส่วน localhost ตอนพัฒนาเครื่องตัวเองไม่ต้องใช้ SSL จึงเช็คจาก connection string อัตโนมัติ
const isLocalDb = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "");

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocalDb ? false : { rejectUnauthorized: false },
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error:", err);
});
