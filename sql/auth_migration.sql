-- ==========================================================
-- เพิ่มระบบล็อกอินจริง — รันไฟล์นี้ใน pgAdmin Query Tool
-- (เปิด Query Tool ที่ฐานข้อมูล sports_day แล้ววางไฟล์นี้ทั้งหมด กด Execute/F5)
-- ==========================================================

-- เปิดใช้งานฟังก์ชันเข้ารหัสรหัสผ่านของ PostgreSQL
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('student', 'admin')),
  student_id    TEXT REFERENCES students(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL
);

-- สร้างบัญชีให้นักศึกษาทุกคนที่มีอยู่แล้ว
-- username = รหัสนักศึกษา, รหัสผ่านตั้งต้น = รหัสนักศึกษาตัวเอง (เช่น 16573 / 16573)
-- แนะนำให้บอกนักศึกษาแต่ละคนไปเปลี่ยนรหัสผ่านทีหลัง
INSERT INTO users (username, password_hash, role, student_id, display_name)
SELECT id, crypt(id, gen_salt('bf')), 'student', id, name
FROM students;

-- สร้างบัญชีผู้ดูแลระบบ 1 บัญชี
-- username: admin   /   password: admin1234
-- (แนะนำให้เปลี่ยนรหัสผ่านนี้หลังติดตั้งเสร็จ ดูวิธีท้ายไฟล์นี้)
INSERT INTO users (username, password_hash, role, student_id, display_name)
VALUES ('admin', crypt('admin1234', gen_salt('bf')), 'admin', NULL, 'ผู้ดูแลระบบ');

-- ==========================================================
-- วิธีเปลี่ยนรหัสผ่านทีหลัง (รันเป็น query แยกใน pgAdmin เมื่อไหร่ก็ได้):
--
-- UPDATE users SET password_hash = crypt('รหัสผ่านใหม่', gen_salt('bf'))
-- WHERE username = 'ชื่อผู้ใช้ที่ต้องการเปลี่ยน';
-- ==========================================================
