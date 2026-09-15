-- เพิ่ม index ให้คอลัมน์ที่ WHERE/JOIN บ่อยที่สุด เพื่อให้ query เร็วขึ้นเมื่อข้อมูลเช็คชื่อ/ข้อความสะสมมากขึ้น
-- ระหว่างงานจริง (ตอนนี้ตารางยังเล็ก ผลต่างอาจยังไม่รู้สึกชัด แต่ไม่มีข้อเสีย เป็นการเพิ่ม index ธรรมดา
-- ไม่กระทบข้อมูลเดิม ไม่ต้อง lock ตารางนาน) ใช้ IF NOT EXISTS กันรันซ้ำแล้ว error
CREATE INDEX IF NOT EXISTS idx_checkins_date ON checkins (date);
CREATE INDEX IF NOT EXISTS idx_checkins_student_id ON checkins (student_id);
CREATE INDEX IF NOT EXISTS idx_checkins_match_id ON checkins (match_id);
CREATE INDEX IF NOT EXISTS idx_students_team ON students (team);
CREATE INDEX IF NOT EXISTS idx_students_role ON students (role);
CREATE INDEX IF NOT EXISTS idx_attendance_messages_student_date ON attendance_messages (student_id, date);
