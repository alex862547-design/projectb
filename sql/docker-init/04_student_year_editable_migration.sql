-- ==========================================================
-- เปลี่ยนฟิลด์ "ชั้นปี" จากตัวเลขคงที่ (1-4) ให้เป็นรายการที่แอดมินแก้ไข/เพิ่มเองได้
-- เหมือนกับระบบ "ตำแหน่ง/ประเภทกีฬา" (ตาราง roles)
-- รันไฟล์นี้ใน pgAdmin Query Tool (เลือกฐานข้อมูล sports_day ก่อน)
-- ==========================================================

CREATE TABLE IF NOT EXISTS student_years (
  id    SERIAL PRIMARY KEY,
  label TEXT UNIQUE NOT NULL
);

INSERT INTO student_years (label) VALUES
  ('ปีที่ 1'),
  ('ปีที่ 2'),
  ('ปีที่ 3'),
  ('ปีที่ 4')
ON CONFLICT (label) DO NOTHING;

-- แปลงคอลัมน์ students.year จากตัวเลขให้เป็นข้อความ "ปีที่ N" (คงค่าที่มีอยู่แล้วไว้)
ALTER TABLE students ALTER COLUMN year TYPE TEXT USING ('ปีที่ ' || year::text);

-- เผื่อมีนักศึกษาบางคนมีค่าชั้นปีอื่นอยู่แล้วที่ไม่ตรงกับ 4 ค่าเริ่มต้น ให้ดึงมาใส่ในลิสต์ด้วย
INSERT INTO student_years (label)
SELECT DISTINCT year FROM students WHERE year IS NOT NULL AND year <> ''
ON CONFLICT (label) DO NOTHING;
