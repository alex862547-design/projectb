import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET;

// หมายเหตุ: ห้ามใช้ toISOString() ตรงนี้ เพราะมันแปลงเป็น UTC ก่อน
// ถ้าเครื่อง server อยู่โซนเวลา UTC+7 (ไทย) จะทำให้วันที่เพี้ยนถอยหลังไป 1 วัน
const toDateStr = (d) => {
  if (!(d instanceof Date)) return d;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const mapMatch = (row) => ({
  id: row.id,
  sport: row.sport,
  teamA: row.team_a,
  teamB: row.team_b,
  date: toDateStr(row.date),
  time: row.time,
  venue: row.venue,
  status: row.status,
  scoreA: row.score_a,
  scoreB: row.score_b,
  note: row.note,
  round: row.round,
});

const mapNews = (row) => ({
  id: row.id,
  title: row.title,
  date: toDateStr(row.date),
  body: row.body,
});

const mapCheckin = (row) => ({
  id: row.id,
  studentId: row.student_id,
  matchId: row.match_id,
  time: row.time,
  date: toDateStr(row.date),
  status: row.status || "present",
});

const mapAttendanceMessage = (row) => ({
  id: row.id,
  studentId: row.student_id,
  date: toDateStr(row.date),
  senderRole: row.sender_role,
  senderName: row.sender_name,
  message: row.message,
  createdAt: row.created_at,
});

const mapEventDay = (row) => ({
  id: row.id,
  date: toDateStr(row.date),
  label: row.label,
});

const mapStudent = (row) => ({
  id: row.id,
  name: row.name,
  team: row.team,
  role: row.role,
  year: row.year,
  canCheckin: row.can_checkin,
});

/* ==================================================================
   AUTH: ต้องแนบ header  Authorization: Bearer <token>
   requiredRole = "admin" -> ต้องเป็นแอดมินเท่านั้นถึงจะผ่าน
   requiredRole = undefined -> แค่ต้องล็อกอินแล้ว (ไม่จำกัดบทบาท)
================================================================== */
function auth(requiredRole) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: "กรุณาเข้าสู่ระบบก่อน" });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      if (requiredRole && payload.role !== requiredRole) {
        return res.status(403).json({ message: "คุณไม่มีสิทธิ์ทำรายการนี้" });
      }
      req.user = payload;
      next();
    } catch {
      return res.status(401).json({ message: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" });
    }
  };
}

/* ---------------- AUTH ROUTES ---------------- */

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: "กรุณากรอกชื่อผู้ใช้และรหัสผ่าน" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE username = $1 AND password_hash = crypt($2, password_hash)`,
      [username, password]
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" });
    }
    const token = jwt.sign(
      { id: user.id, role: user.role, studentId: user.student_id },
      JWT_SECRET,
      { expiresIn: "8h" }
    );
    res.json({
      token,
      user: {
        role: user.role,
        studentId: user.student_id,
        name: user.display_name,
        username: user.username,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "เข้าสู่ระบบไม่สำเร็จ: " + err.message });
  }
});

app.get("/api/auth/me", auth(), async (req, res) => {
  const { rows } = await pool.query(
    "SELECT username, role, student_id, display_name FROM users WHERE id = $1",
    [req.user.id]
  );
  const u = rows[0];
  if (!u) return res.status(404).json({ message: "ไม่พบผู้ใช้" });
  res.json({ username: u.username, role: u.role, studentId: u.student_id, name: u.display_name });
});

/* ---------------- TEAMS (read-only) ---------------- */
app.get("/api/teams", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM teams ORDER BY id");
  res.json(rows);
});
// เฉพาะแอดมิน — แก้ไขชื่อ/สีของทีม (เช่น เปลี่ยน "สีเหลือง" เป็นชื่ออื่น)
app.patch("/api/teams/:id", auth("admin"), async (req, res) => {
  const { name, accent } = req.body;
  if (!name && !accent) {
    return res.status(400).json({ message: "ต้องระบุ name หรือ accent อย่างน้อย 1 อย่าง" });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE teams SET name = COALESCE($1, name), accent = COALESCE($2, accent) WHERE id = $3 RETURNING *`,
      [name || null, accent || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ message: "ไม่พบทีมนี้" });
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

/* ---------------- ROLES (ตำแหน่ง/ประเภทกีฬา) ---------------- */
app.get("/api/roles", async (req, res) => {
  const { rows } = await pool.query("SELECT name FROM roles ORDER BY id");
  res.json(rows.map((r) => r.name));
});

// เฉพาะแอดมินเท่านั้นที่เพิ่มตำแหน่งใหม่ได้
app.post("/api/roles", auth("admin"), async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ message: "กรุณาระบุชื่อตำแหน่ง" });
  }
  try {
    await pool.query(
      "INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING",
      [name.trim()]
    );
    const { rows } = await pool.query("SELECT name FROM roles ORDER BY id");
    res.status(201).json(rows.map((r) => r.name));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// เฉพาะแอดมินเท่านั้นที่ลบตำแหน่งได้ — ลบไม่ได้ถ้ายังมีนักศึกษาใช้ตำแหน่งนี้อยู่ (กันข้อมูลนักศึกษาพัง)
app.delete("/api/roles/:name", auth("admin"), async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  try {
    const { rows: inUse } = await pool.query("SELECT COUNT(*) FROM students WHERE role = $1", [name]);
    if (Number(inUse[0].count) > 0) {
      return res.status(400).json({ message: `ลบไม่ได้ เพราะมีนักศึกษา ${inUse[0].count} คนใช้ตำแหน่งนี้อยู่` });
    }
    await pool.query("DELETE FROM roles WHERE name = $1", [name]);
    const { rows } = await pool.query("SELECT name FROM roles ORDER BY id");
    res.json(rows.map((r) => r.name));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

/* ---------------- STUDENT YEARS (ชั้นปี) ---------------- */
app.get("/api/student-years", async (req, res) => {
  const { rows } = await pool.query("SELECT label FROM student_years ORDER BY id");
  res.json(rows.map((r) => r.label));
});

// เฉพาะแอดมินเท่านั้นที่เพิ่มชั้นปีใหม่ได้
app.post("/api/student-years", auth("admin"), async (req, res) => {
  const { label } = req.body;
  if (!label || !label.trim()) {
    return res.status(400).json({ message: "กรุณาระบุชื่อชั้นปี" });
  }
  try {
    await pool.query(
      "INSERT INTO student_years (label) VALUES ($1) ON CONFLICT (label) DO NOTHING",
      [label.trim()]
    );
    const { rows } = await pool.query("SELECT label FROM student_years ORDER BY id");
    res.status(201).json(rows.map((r) => r.label));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// เฉพาะแอดมินเท่านั้นที่ลบชั้นปีได้ — ลบไม่ได้ถ้ายังมีนักศึกษาอยู่ชั้นปีนี้ (กันข้อมูลนักศึกษาพัง)
app.delete("/api/student-years/:label", auth("admin"), async (req, res) => {
  const label = decodeURIComponent(req.params.label);
  try {
    const { rows: inUse } = await pool.query("SELECT COUNT(*) FROM students WHERE year = $1", [label]);
    if (Number(inUse[0].count) > 0) {
      return res.status(400).json({ message: `ลบไม่ได้ เพราะมีนักศึกษา ${inUse[0].count} คนอยู่ชั้นปีนี้` });
    }
    await pool.query("DELETE FROM student_years WHERE label = $1", [label]);
    const { rows } = await pool.query("SELECT label FROM student_years ORDER BY id");
    res.json(rows.map((r) => r.label));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

/* ---------------- STUDENTS ---------------- */

// จำกัดจำนวนนักศึกษาต่อสีตามประเภทตำแหน่ง:
// - "นักกีฬา..." (ตำแหน่งที่ผูกกับกีฬาใดกีฬาหนึ่ง) ได้สีละไม่เกิน 10 คน
// - "หัวหน้าสี" ได้สีละไม่เกิน 1 คน
// - ตำแหน่งอื่นๆ (กองเชียร์, เจ้าหน้าที่ทีม ฯลฯ) ไม่จำกัดจำนวน
function roleLimitFor(role) {
  if (!role) return null;
  if (role.startsWith("นักกีฬา")) return 10;
  if (role === "หัวหน้าสี") return 1;
  return null;
}

async function assertRoleLimit(team, role, excludeId) {
  const limit = roleLimitFor(role);
  if (!limit || !team) return; // ตำแหน่งนี้ไม่มีข้อจำกัด
  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM students WHERE team = $1 AND role = $2${excludeId ? " AND id <> $3" : ""}`,
    excludeId ? [team, role, excludeId] : [team, role]
  );
  if (Number(rows[0].count) >= limit) {
    const { rows: teamRows } = await pool.query("SELECT name FROM teams WHERE id = $1", [team]);
    const teamName = teamRows[0]?.name || team;
    const err = new Error(`${teamName}มี "${role}" ครบ ${limit} คนแล้ว ไม่สามารถเพิ่มได้อีก`);
    err.status = 400;
    throw err;
  }
}

app.get("/api/students", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM students ORDER BY id");
  res.json(rows.map(mapStudent));
});

app.post("/api/students", auth("admin"), async (req, res) => {
  const { id, name, team, role, year } = req.body;
  if (!id || !name || !team) {
    return res.status(400).json({ message: "ต้องระบุ id, name, team" });
  }
  try {
    await assertRoleLimit(team, role, null);
    const { rows } = await pool.query(
      "INSERT INTO students (id, name, team, role, year) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [id, name, team, role || null, year || null]
    );
    // สร้างบัญชีล็อกอินให้นักศึกษาคนใหม่อัตโนมัติ (username/รหัสผ่านตั้งต้น = รหัสนักศึกษา)
    await pool.query(
      `INSERT INTO users (username, password_hash, role, student_id, display_name)
       VALUES ($1, crypt($1, gen_salt('bf')), 'student', $1, $2)`,
      [id, name]
    );
    res.status(201).json(mapStudent(rows[0]));
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
});

// แอดมินแก้ได้ทุกฟิลด์ของนักศึกษาคนไหนก็ได้
// นักศึกษาที่มีสิทธิ์เช็คชื่อ (can_checkin) แก้ได้แค่ฟิลด์ "role" (ตำแหน่ง/กีฬา)
// และแก้ได้เฉพาะนักศึกษาในสังกัดสีเดียวกับตัวเองเท่านั้น
app.put("/api/students/:id", auth(), async (req, res) => {
  let { name, team, role, canCheckin, year } = req.body;

  if (req.user.role === "admin") {
    // ไม่ต้องทำอะไรเพิ่ม ใช้ค่าที่ส่งมาได้ทุกฟิลด์
  } else if (req.user.role === "student") {
    const { rows: meRows } = await pool.query(
      "SELECT team, can_checkin FROM students WHERE id = $1",
      [req.user.studentId]
    );
    const me = meRows[0];
    if (!me || !me.can_checkin) {
      return res.status(403).json({ message: "คุณไม่มีสิทธิ์แก้ไขข้อมูลนักศึกษา" });
    }
    const { rows: targetRows } = await pool.query(
      "SELECT team FROM students WHERE id = $1",
      [req.params.id]
    );
    const target = targetRows[0];
    if (!target) return res.status(404).json({ message: "ไม่พบนักศึกษา" });
    if (target.team !== me.team) {
      return res.status(403).json({ message: "แก้ไขได้เฉพาะนักศึกษาในสังกัดสีเดียวกันเท่านั้น" });
    }
    // จำกัดสิทธิ์: แก้ได้แค่ตำแหน่ง/กีฬา ห้ามแก้ชื่อ สี ชั้นปี หรือสิทธิ์เช็คชื่อ
    name = null;
    team = null;
    canCheckin = null;
    year = null;
  } else {
    return res.status(403).json({ message: "ไม่มีสิทธิ์เข้าถึง" });
  }

  try {
    const { rows: curRows } = await pool.query("SELECT team, role FROM students WHERE id = $1", [req.params.id]);
    const current = curRows[0];
    if (!current) return res.status(404).json({ message: "ไม่พบนักศึกษา" });

    const resolvedTeam = team ?? current.team;
    const resolvedRole = role ?? current.role;
    await assertRoleLimit(resolvedTeam, resolvedRole, req.params.id);

    const { rows } = await pool.query(
      `UPDATE students
       SET name = COALESCE($1, name),
           team = COALESCE($2, team),
           role = COALESCE($3, role),
           can_checkin = COALESCE($4, can_checkin),
           year = COALESCE($5, year)
       WHERE id = $6 RETURNING *`,
      [name ?? null, team ?? null, role ?? null, canCheckin ?? null, year ?? null, req.params.id]
    );
    res.json(mapStudent(rows[0]));
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
});

app.delete("/api/students/:id", auth("admin"), async (req, res) => {
  await pool.query("DELETE FROM students WHERE id = $1", [req.params.id]);
  res.status(204).end();
});

/* ---------------- MATCHES ---------------- */
app.get("/api/matches", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM matches ORDER BY date, time");
  res.json(rows.map(mapMatch));
});

app.post("/api/matches", auth("admin"), async (req, res) => {
  const { sport, teamA, teamB, date, time, venue, round } = req.body;
  if (!sport || !teamA || !teamB || !date) {
    return res.status(400).json({ message: "ต้องระบุ sport, teamA, teamB, date" });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO matches (sport, team_a, team_b, date, time, venue, status, round)
       VALUES ($1,$2,$3,$4,$5,$6,'กำหนดการ',$7) RETURNING *`,
      [sport, teamA, teamB, date, time || null, venue || null, round || "รอบรองชนะเลิศ"]
    );
    res.status(201).json(mapMatch(rows[0]));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put("/api/matches/:id", auth("admin"), async (req, res) => {
  const { scoreA, scoreB, status, note, round, date, time, venue, teamA, teamB } = req.body;
  const { rows } = await pool.query(
    `UPDATE matches
     SET score_a = COALESCE($1, score_a),
         score_b = COALESCE($2, score_b),
         status  = COALESCE($3, status),
         note    = COALESCE($4, note),
         round   = COALESCE($5, round),
         date    = COALESCE($6, date),
         time    = COALESCE($7, time),
         venue   = COALESCE($8, venue),
         team_a  = COALESCE($9, team_a),
         team_b  = COALESCE($10, team_b)
     WHERE id = $11 RETURNING *`,
    [scoreA ?? null, scoreB ?? null, status ?? null, note ?? null, round ?? null, date ?? null, time ?? null, venue ?? null, teamA ?? null, teamB ?? null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ message: "ไม่พบรายการแข่งขัน" });
  res.json(mapMatch(rows[0]));
});

app.delete("/api/matches/:id", auth("admin"), async (req, res) => {
  await pool.query("DELETE FROM matches WHERE id = $1", [req.params.id]);
  res.status(204).end();
});

/* ---------------- NEWS ---------------- */
app.get("/api/news", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM news ORDER BY date DESC, id DESC");
  res.json(rows.map(mapNews));
});

app.post("/api/news", auth("admin"), async (req, res) => {
  const { title, body } = req.body;
  if (!title) return res.status(400).json({ message: "ต้องระบุ title" });
  const { rows } = await pool.query(
    "INSERT INTO news (title, body) VALUES ($1,$2) RETURNING *",
    [title, body || null]
  );
  res.status(201).json(mapNews(rows[0]));
});

app.delete("/api/news/:id", auth("admin"), async (req, res) => {
  await pool.query("DELETE FROM news WHERE id = $1", [req.params.id]);
  res.status(204).end();
});

/* ---------------- EVENT DAYS (ปฏิทินวันจัดกิจกรรม) ---------------- */
app.get("/api/event-days", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM event_days ORDER BY date");
  res.json(rows.map(mapEventDay));
});

// เฉพาะแอดมินเท่านั้นที่กำหนดวันจัดกิจกรรมได้ (เลือกวันที่ผ่านปฏิทินในหน้าเว็บ)
// รองรับทั้งเพิ่มทีละวัน (date) และเพิ่มหลายวันพร้อมกัน (dates: string[], เช่น เลือกช่วงวันที่)
app.post("/api/event-days", auth("admin"), async (req, res) => {
  const { date, dates, label } = req.body;
  const list = Array.isArray(dates) && dates.length > 0 ? dates : date ? [date] : [];
  if (list.length === 0) return res.status(400).json({ message: "กรุณาเลือกวันที่" });
  try {
    for (const d of list) {
      await pool.query(
        "INSERT INTO event_days (date, label) VALUES ($1,$2) ON CONFLICT (date) DO NOTHING",
        [d, label || null]
      );
    }
    const { rows } = await pool.query("SELECT * FROM event_days ORDER BY date");
    res.status(201).json(rows.map(mapEventDay));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// แก้ไขวันที่/ชื่อวันของวันจัดกิจกรรมที่มีอยู่แล้ว
app.put("/api/event-days/:id", auth("admin"), async (req, res) => {
  const { date, label } = req.body;
  if (!date) return res.status(400).json({ message: "กรุณาเลือกวันที่" });
  try {
    await pool.query("UPDATE event_days SET date = $1, label = $2 WHERE id = $3", [
      date,
      label || null,
      req.params.id,
    ]);
    const { rows } = await pool.query("SELECT * FROM event_days ORDER BY date");
    res.json(rows.map(mapEventDay));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete("/api/event-days/:id", auth("admin"), async (req, res) => {
  await pool.query("DELETE FROM event_days WHERE id = $1", [req.params.id]);
  const { rows } = await pool.query("SELECT * FROM event_days ORDER BY date");
  res.json(rows.map(mapEventDay));
});

/* ---------------- CHECKINS ---------------- */
app.get("/api/checkins", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM checkins ORDER BY id");
  res.json(rows.map(mapCheckin));
});

// ตรวจสอบว่า req.user มีสิทธิ์ "เช็คชื่อ/เช็คขาด/ส่งข้อความ" แทนนักศึกษาคนนี้ได้หรือไม่
// - ตัวเองเช็ค/เขียนถึงตัวเองได้เสมอ
// - แอดมินทำได้กับทุกคน
// - นักศึกษาที่มีสิทธิ์ can_checkin ทำได้เฉพาะเพื่อนในสังกัดสีเดียวกัน
async function assertCanActOnStudent(req, res, studentId) {
  if (req.user.role === "student" && studentId === req.user.studentId) return true;
  if (req.user.role === "admin") return true;

  if (req.user.role !== "student") {
    res.status(403).json({ message: "คุณไม่มีสิทธิ์ทำรายการนี้" });
    return false;
  }

  const { rows: meRows } = await pool.query(
    "SELECT team, can_checkin FROM students WHERE id = $1",
    [req.user.studentId]
  );
  const me = meRows[0];
  if (!me || !me.can_checkin) {
    res.status(403).json({ message: "คุณไม่ได้รับสิทธิ์ให้เช็คชื่อ กรุณาติดต่อผู้ดูแลระบบ" });
    return false;
  }

  const { rows: targetRows } = await pool.query("SELECT team FROM students WHERE id = $1", [studentId]);
  const target = targetRows[0];
  if (!target) {
    res.status(404).json({ message: "ไม่พบนักศึกษาคนนี้" });
    return false;
  }
  if (target.team !== me.team) {
    res.status(403).json({ message: "ทำรายการได้เฉพาะนักศึกษาในสังกัดสีเดียวกันเท่านั้น" });
    return false;
  }
  return true;
}

// ต้องล็อกอินก่อนถึงจะเช็คชื่อได้
// นักศึกษาเช็คชื่อได้เฉพาะถ้าตัวเองได้รับสิทธิ์ (can_checkin) และเช็คได้เฉพาะคนในสีเดียวกันเท่านั้น
// แอดมินเช็คชื่อได้ทุกคน (ไม่ติดข้อจำกัดสี)
app.post("/api/checkins", auth(), async (req, res) => {
  const { studentId, matchId, time, status } = req.body;
  if (!studentId) {
    return res.status(400).json({ message: "ต้องระบุ studentId" });
  }
  const finalStatus = status === "absent" ? "absent" : "present";

  const allowed = await assertCanActOnStudent(req, res, studentId);
  if (!allowed) return;

  try {
    // บันทึก "วันที่จริงตอนนี้" ลงไปด้วย (ไม่ใช่แค่เวลา) เพื่อให้ดูปฏิทินย้อนหลังได้
    const { rows } = await pool.query(
      "INSERT INTO checkins (student_id, match_id, time, date, status) VALUES ($1,$2,$3, CURRENT_DATE, $4) RETURNING *",
      [studentId, matchId ?? null, time || null, finalStatus]
    );
    res.status(201).json(mapCheckin(rows[0]));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

/* ---------------- ATTENDANCE MESSAGES (สนทนาเรื่องการเช็คชื่อ/เช็คขาด) ---------------- */
// ดูข้อความของนักศึกษาคนหนึ่งในวันหนึ่ง — เจ้าตัว, ผู้มีสิทธิ์เช็คชื่อในสีเดียวกัน, หรือแอดมินเท่านั้นที่ดูได้
app.get("/api/attendance-messages", auth(), async (req, res) => {
  const { studentId, date } = req.query;
  if (!studentId || !date) {
    return res.status(400).json({ message: "ต้องระบุ studentId และ date" });
  }
  const allowed = await assertCanActOnStudent(req, res, studentId);
  if (!allowed) return;

  const { rows } = await pool.query(
    "SELECT * FROM attendance_messages WHERE student_id = $1 AND date = $2 ORDER BY id",
    [studentId, date]
  );

  // เจ้าตัวเปิดดูข้อความของตัวเอง = ถือว่าอ่านข้อความฝั่งผู้เช็คชื่อ (checker) ในวันนี้แล้วทั้งหมด
  if (req.user.role === "student" && studentId === req.user.studentId) {
    await pool.query(
      "UPDATE attendance_messages SET is_read = TRUE WHERE student_id = $1 AND date = $2 AND sender_role = 'checker' AND is_read = FALSE",
      [studentId, date]
    );
  }

  res.json(rows.map(mapAttendanceMessage));
});

// จำนวนข้อความใหม่ (ที่ผู้เช็คชื่อส่งมา แต่เจ้าตัวยังไม่ได้เปิดอ่าน) ใช้โชว์เลขแดงที่แถบ "ประวัติของฉัน"
app.get("/api/attendance-messages/unread-count", auth(), async (req, res) => {
  if (req.user.role !== "student" || !req.user.studentId) {
    return res.json({ count: 0 });
  }
  const { rows } = await pool.query(
    "SELECT COUNT(*)::int AS count FROM attendance_messages WHERE student_id = $1 AND sender_role = 'checker' AND is_read = FALSE",
    [req.user.studentId]
  );
  res.json({ count: rows[0]?.count || 0 });
});

// ส่งข้อความใหม่ในวันนั้นๆ — ถ้าคนส่งคือเจ้าตัว sender_role = "student" มิฉะนั้นเป็น "checker"
app.post("/api/attendance-messages", auth(), async (req, res) => {
  const { studentId, date, message } = req.body;
  if (!studentId || !date || !message || !message.trim()) {
    return res.status(400).json({ message: "ต้องระบุ studentId, date และข้อความ" });
  }
  const allowed = await assertCanActOnStudent(req, res, studentId);
  if (!allowed) return;

  const senderRole = req.user.role === "student" && studentId === req.user.studentId ? "student" : "checker";

  const { rows: userRows } = await pool.query("SELECT display_name FROM users WHERE id = $1", [req.user.id]);
  const senderName = userRows[0]?.display_name || "ไม่ทราบชื่อ";

  try {
    const { rows } = await pool.query(
      `INSERT INTO attendance_messages (student_id, date, sender_role, sender_name, message)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [studentId, date, senderRole, senderName, message.trim()]
    );
    res.status(201).json(mapAttendanceMessage(rows[0]));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Sports Day API กำลังทำงานที่ http://localhost:${PORT}`);
});
