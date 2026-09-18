-- ==========================================================
-- เพิ่มตาราง admin_messages — ระบบข้อความระหว่างนักศึกษากับแอดมินโดยตรง (คนละเรื่องกับ attendance_messages
-- ที่เป็นการคุยกับ "ผู้เช็คชื่อ" เรื่องการเช็คชื่อของวันหนึ่งๆ) แต่ละนักศึกษามีห้องแชทกับแอดมินได้ห้องเดียว
-- (ไม่ผูกกับวันที่ใดวันหนึ่ง) คุยกันได้หลายข้อความในห้องเดียวกันนั้น
-- รันไฟล์นี้ใน pgAdmin Query Tool / Supabase SQL editor (เลือกฐานข้อมูลที่ใช้งานจริงก่อน)
-- ==========================================================

CREATE TABLE IF NOT EXISTS admin_messages (
  id         SERIAL PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('admin', 'student')),
  sender_name TEXT NOT NULL,
  message    TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_messages_student ON admin_messages (student_id);
