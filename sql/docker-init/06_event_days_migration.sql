-- ==========================================================
-- เพิ่มปฏิทินวันจัดกิจกรรม (event_days) และวันที่จริงของการเช็คชื่อ
-- รันไฟล์นี้ใน pgAdmin Query Tool (เลือกฐานข้อมูล sports_day ก่อน)
-- ==========================================================

-- ปฏิทินวันจัดกิจกรรม — แอดมินกำหนดผ่านหน้าเว็บ (เลือกวันที่จากปฏิทิน)
CREATE TABLE event_days (
  id    SERIAL PRIMARY KEY,
  date  DATE UNIQUE NOT NULL,
  label TEXT
);

-- เพิ่มคอลัมน์วันที่ให้ตาราง checkins (ของเดิมมีแค่เวลา ไม่มีวันที่)
ALTER TABLE checkins ADD COLUMN date DATE NOT NULL DEFAULT CURRENT_DATE;

-- แก้วันที่ของประวัติเช็คชื่อเดิมให้ตรงกับวันที่ของนัดแข่งขันที่ผูกอยู่ (ถ้ามี)
UPDATE checkins c
SET date = m.date
FROM matches m
WHERE c.match_id = m.id;

-- ใส่วันจัดกิจกรรมเริ่มต้นจากวันที่ของนัดแข่งขันที่มีอยู่แล้วในระบบ
INSERT INTO event_days (date, label)
SELECT DISTINCT date, NULL FROM matches
ON CONFLICT (date) DO NOTHING;
