-- ==========================================================
-- เพิ่มปุ่ม "เช็คขาด" + ระบบข้อความระหว่างผู้เช็คชื่อกับนักศึกษา
-- รันไฟล์นี้ใน pgAdmin Query Tool (เลือกฐานข้อมูล sports_day ก่อน)
-- ==========================================================

-- เพิ่มสถานะให้ตาราง checkins แยก "มา" กับ "ขาด" ออกจากกัน
-- (ของเดิมทุกแถวถือว่า "มา" อยู่แล้ว จึงตั้งค่าเริ่มต้นเป็น 'present')
ALTER TABLE checkins ADD COLUMN status TEXT NOT NULL DEFAULT 'present';
-- ค่าที่ใช้ได้: 'present' (มา) หรือ 'absent' (ขาด)

-- ตารางข้อความสนทนา ผูกกับ (นักศึกษา, วันที่) หนึ่งวันคุยกันได้หลายข้อความ
CREATE TABLE attendance_messages (
  id SERIAL PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('checker', 'student')),
  sender_name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_attendance_messages_student_date ON attendance_messages (student_id, date);
