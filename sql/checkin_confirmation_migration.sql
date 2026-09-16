-- ==========================================================
-- เพิ่มตาราง checkin_confirmations — ให้ผู้เช็คชื่อ "ยืนยัน" ได้ว่าข้อมูลเช็คชื่อของสี+ตำแหน่ง+วันที่หนึ่งๆ
-- เช็คครบถูกต้องแล้ว (คนละเรื่องกับ checkins ที่เป็นแค่รายการเช็คชื่อ/เช็คขาดของนักศึกษาแต่ละคน) ยืนยันซ้ำ
-- ได้เรื่อยๆ ถ้าแก้ไขข้อมูลเพิ่มทีหลัง (อัปเดตแค่ confirmed_by_id/confirmed_at) ไม่ต้องลบแล้วสร้างใหม่
-- รันไฟล์นี้ใน pgAdmin Query Tool (เลือกฐานข้อมูล sports_day ก่อน)
-- ==========================================================

CREATE TABLE IF NOT EXISTS checkin_confirmations (
  id              SERIAL PRIMARY KEY,
  team            TEXT NOT NULL REFERENCES teams(id),
  role            TEXT NOT NULL,
  date            DATE NOT NULL,
  confirmed_by_id INT REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (team, role, date)
);
