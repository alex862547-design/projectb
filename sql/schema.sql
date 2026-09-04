-- ==========================================================
-- ระบบจัดการกีฬาสีภายในวิทยาลัย — PostgreSQL schema
-- วิธีใช้: เปิด pgAdmin 4 -> สร้างฐานข้อมูลชื่อ sports_day ก่อน
-- (คลิกขวา Databases -> Create -> Database... -> ตั้งชื่อ sports_day)
-- แล้วคลิกขวาที่ฐานข้อมูล sports_day -> Query Tool -> วางไฟล์นี้ทั้งหมด -> กด Execute (F5)
-- ==========================================================

CREATE TABLE teams (
  id     TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  accent TEXT NOT NULL
);

CREATE TABLE students (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  team        TEXT NOT NULL REFERENCES teams(id),
  role        TEXT,
  can_checkin BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE matches (
  id       SERIAL PRIMARY KEY,
  sport    TEXT NOT NULL,
  team_a   TEXT NOT NULL REFERENCES teams(id),
  team_b   TEXT NOT NULL REFERENCES teams(id),
  date     DATE NOT NULL,
  time     TIME,
  venue    TEXT,
  status   TEXT NOT NULL DEFAULT 'กำหนดการ',
  score_a  INT,
  score_b  INT
);

CREATE TABLE news (
  id    SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  date  DATE NOT NULL DEFAULT CURRENT_DATE,
  body  TEXT
);

CREATE TABLE checkins (
  id         SERIAL PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  match_id   INT  NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  time       TEXT
);

-- ---------- ข้อมูลตั้งต้น (seed data) ----------

INSERT INTO teams (id, name, accent) VALUES
  ('red',    'สีแดง',    '#D6402D'),
  ('blue',   'สีน้ำเงิน', '#2C5EAA'),
  ('green',  'สีเขียว',  '#2F8F5B'),
  ('yellow', 'สีเหลือง', '#D69E1E');

INSERT INTO students (id, name, team, role) VALUES
  ('16573', 'ธนาวุฒิ แสงจันทร์',   'red',    'นักกีฬาฟุตบอล'),
  ('16036', 'กันต์ธร พิงพิทยากุล', 'blue',   'นักกีฬา esports'),
  ('16104', 'ปวีณา ศรีสุข',        'green',  'นักกีฬาวอลเลย์บอล'),
  ('16211', 'อรรถพล ทองดี',        'yellow', 'นักกีฬาแบดมินตัน'),
  ('16302', 'ศิริพร มั่นคง',       'red',    'ผู้เข้าร่วมทั่วไป');

INSERT INTO matches (sport, team_a, team_b, date, time, venue, status, score_a, score_b) VALUES
  ('ฟุตบอล',        'red',  'blue',   '2026-08-10', '09:00', 'สนามกีฬากลาง',       'กำหนดการ',     NULL, NULL),
  ('วอลเลย์บอล',     'green','yellow', '2026-08-10', '13:00', 'โรงยิม 1',            'กำหนดการ',     NULL, NULL),
  ('esports (ROV)', 'blue', 'green',  '2026-08-11', '10:00', 'ห้องคอมพิวเตอร์ 3',   'จบการแข่งขัน', 2,    1),
  ('แบดมินตัน',      'yellow','red',  '2026-08-11', '14:00', 'โรงยิม 2',            'จบการแข่งขัน', 1,    2);

INSERT INTO news (title, date, body) VALUES
  ('ประกาศเลื่อนเวลาแข่งขันฟุตบอลนัดเปิดสนาม', '2026-08-01', 'เนื่องจากสภาพอากาศ การแข่งขันฟุตบอลนัดแรกจะเริ่มเวลา 09:00 น. แทน 08:00 น.'),
  ('เปิดรับสมัครนักกีฬา esports เพิ่มเติม', '2026-07-28', 'แต่ละสีสามารถส่งรายชื่อนักกีฬา esports เพิ่มได้ที่ครูที่ปรึกษาโครงการ ภายในวันที่ 5 สิงหาคม');

INSERT INTO checkins (student_id, match_id, time) VALUES
  ('16573', 1, '08:45');
