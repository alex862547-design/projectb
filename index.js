// Backend เดียวของทั้งระบบ (REST API) — ให้บริการทั้งฝั่งนักศึกษาและแอดมินในเว็บเดียวกัน (my-app/)
// ผ่าน endpoint /api/* ทั้งหมด แบ่งเป็นกลุ่มตามทรัพยากร (teams, roles, students, matches, news,
// event-days, checkins, attendance-messages) แต่ละกลุ่มมีทั้งเส้นทางที่ใครก็อ่านได้ (GET แบบ public)
// และเส้นทางที่ต้องล็อกอิน/เป็นแอดมินเท่านั้น (ผ่าน middleware au()) ต่อฐานข้อมูล PostgreSQL ตัวเดียว
// (db.js) เส้นทาง GET สาธารณะที่หน้าเว็บโพลใหม่ทุก 4 วิ (teams, roles, student-years, students, matches,
// news, event-days, checkins) มีแคชสั้นๆในหน่วยความจำ (getCached ด้านล่าง) กันคนใช้พร้อมกันหลายสิบ/หลายร้อย
// คนยิง query ซ้ำเดิมพร้อมกันทุกรอบโพล — endpoint ที่แก้ไขข้อมูลจะล้างแคชของตัวเองทันทีหลังบันทึกเสร็จเสมอ
import express from "express";
import cors from "cors";
import compression from "compression";
import jwt from "jsonwebtoken";
import { pool } from "./db.js";

const app = express();
app.use(cors());
app.use(compression());
app.use(express.json());

// กันเซิร์ฟเวอร์ทั้งตัวล่มถ้า query ไหนพลาด (เช่น pool หมด connection ตอนคนใช้พร้อมกันเยอะๆ จนต้องรอเกิน
// connectionTimeoutMillis ที่ตั้งไว้ใน db.js) — endpoint ส่วนใหญ่ในไฟล์นี้ไม่ได้ครอบ try/catch ไว้ ถ้า query
// พลาดแบบไม่มีใครจับ (unhandled rejection) Node เวอร์ชันใหม่จะ "ปิดโปรเซสทั้งตัวทันที" โดย default ซึ่งจะทำให้
// ทุกคนที่ใช้อยู่หลุดพร้อมกันและต้องรอ Render restart ใหม่ (แย่กว่าคำขอเดียวช้า/พังมาก) ดักไว้ตรงนี้แทน —
// แค่ log ไว้ ไม่ปิดโปรเซส ผลคือคำขอที่พลาดจริงๆอาจค้าง/ไม่ตอบกลับ (ฝั่งหน้าเว็บมี timeout/retry ของตัวเองอยู่แล้ว)
// แต่เซิร์ฟเวอร์ยังทำงานต่อให้คนอื่นใช้ได้ตามปกติ ไม่ใช่ทุกคนหลุดพร้อมกัน
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection (server ยังทำงานต่อ):", err);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (server ยังทำงานต่อ):", err);
});

// แคชสั้นๆในหน่วยความจำ (ไม่ใช้ Redis หรือบริการเสียเงินใดๆ) สำหรับ endpoint GET แบบ public ที่ข้อมูล
// เหมือนกันไม่ว่าใครเรียก — เก็บเป็น "Promise ที่กำลังโหลด" ไม่ใช่ข้อมูลที่โหลดเสร็จแล้ว เพื่อรวมคำขอที่เข้ามา
// พร้อมกันในช่วง TTL เดียวกันให้ยิง query จริงแค่ครั้งเดียว (request coalescing) ไม่ใช่แค่ลดจำนวนครั้งเฉยๆ
// ตั้ง TTL ไว้สั้นกว่ารอบโพลของหน้าเว็บ (4 วิ) มาก จึงไม่ทำให้ข้อมูลดูเก่าเกินไปแม้ไม่มีการล้างแคชเลย
const CACHE_TTL_MS = 3000;
const cacheStore = new Map(); // key -> { promise, expiresAt }
function getCached(key, loader) {
  const hit = cacheStore.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.promise;
  const promise = Promise.resolve().then(loader);
  promise.catch(() => cacheStore.delete(key)); // ไม่แคช error ไว้ ให้ลองใหม่ได้ทันทีในคำขอถัดไป
  cacheStore.set(key, { promise, expiresAt: Date.now() + CACHE_TTL_MS });
  return promise;
}
function invalidateCache(...keys) {
  keys.forEach((k) => cacheStore.delete(k));
}

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

// checked_by_name/checked_by_student_id/checked_by_role มาจาก LEFT JOIN กับ users ตรง query ที่เรียกใช้ฟังก์ชันนี้
// (ไม่ได้อยู่ในตาราง checkins เอง) เป็น null ทั้งหมดถ้าแถวนี้ไม่มีคนบันทึกไว้ว่าใครเช็ค (ข้อมูลเก่าก่อนมีฟีเจอร์นี้)
const mapCheckin = (row) => ({
  id: row.id,
  studentId: row.student_id,
  matchId: row.match_id,
  time: row.time,
  date: toDateStr(row.date),
  status: row.status || "present",
  checkedBy: row.checked_by_id
    ? {
        name: row.checked_by_name,
        code: row.checked_by_role === "admin" ? null : row.checked_by_student_id,
        isAdmin: row.checked_by_role === "admin",
      }
    : null,
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
// ใช้โดย: หน้า Login.jsx (login) และ App.jsx ตอนเปิดแอปเช็คว่ามี token เดิมค้างอยู่ไหม (me)

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
// ใช้โดย: Badge.jsx/teamById() (ทุกที่ในเว็บที่โชว์สีทีม), กล่อง "สีทีมที่มีในระบบ" ในหน้าแอดมิน AdminStudents.jsx
app.get("/api/teams", async (req, res) => {
  try {
    const rows = await getCached("teams", async () => (await pool.query("SELECT * FROM teams ORDER BY id")).rows);
    res.json(rows);
  } catch {
    res.status(503).json({ message: "เซิร์ฟเวอร์กำลังมีคนใช้งานหนาแน่น กรุณาลองใหม่อีกครั้ง" });
  }
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
    invalidateCache("teams");
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

/* ---------------- ROLES (ตำแหน่ง/ประเภทกีฬา) ---------------- */
// ใช้โดย: กล่อง "ตำแหน่ง/ประเภทกีฬาที่มีในระบบ" ในหน้าแอดมิน AdminStudents.jsx, dropdown ตำแหน่งตอนเพิ่ม/แก้นักศึกษา
app.get("/api/roles", async (req, res) => {
  try {
    const rows = await getCached("roles", async () => (await pool.query("SELECT name FROM roles ORDER BY id")).rows);
    res.json(rows.map((r) => r.name));
  } catch {
    res.status(503).json({ message: "เซิร์ฟเวอร์กำลังมีคนใช้งานหนาแน่น กรุณาลองใหม่อีกครั้ง" });
  }
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
    invalidateCache("roles");
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
    invalidateCache("roles");
    const { rows } = await pool.query("SELECT name FROM roles ORDER BY id");
    res.json(rows.map((r) => r.name));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

/* ---------------- STUDENT YEARS (ชั้นปี) ---------------- */
// ใช้โดย: กล่อง "ชั้นปีที่มีในระบบ" ในหน้าแอดมิน AdminStudents.jsx, dropdown ชั้นปีตอนเพิ่ม/แก้นักศึกษา
app.get("/api/student-years", async (req, res) => {
  try {
    const rows = await getCached("student-years", async () => (await pool.query("SELECT label FROM student_years ORDER BY id")).rows);
    res.json(rows.map((r) => r.label));
  } catch {
    res.status(503).json({ message: "เซิร์ฟเวอร์กำลังมีคนใช้งานหนาแน่น กรุณาลองใหม่อีกครั้ง" });
  }
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
    invalidateCache("student-years");
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
    invalidateCache("student-years");
    const { rows } = await pool.query("SELECT label FROM student_years ORDER BY id");
    res.json(rows.map((r) => r.label));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

/* ---------------- STUDENTS ---------------- */
// ใช้โดย: หน้าแอดมิน AdminStudents.jsx (เพิ่ม/แก้/ลบ/มอบสิทธิ์เช็คชื่อ) และหน้า TeamRoles.jsx ฝั่งนักศึกษา
// (เจ้าหน้าที่ทีมแก้ตำแหน่งเพื่อนได้) รวมถึงทุกหน้าที่ต้องโชว์รายชื่อ/ค้นหานักศึกษา

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
  try {
    const rows = await getCached("students", async () => (await pool.query("SELECT * FROM students ORDER BY id")).rows);
    res.json(rows.map(mapStudent));
  } catch {
    res.status(503).json({ message: "เซิร์ฟเวอร์กำลังมีคนใช้งานหนาแน่น กรุณาลองใหม่อีกครั้ง" });
  }
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
    invalidateCache("students");
    res.status(201).json(mapStudent(rows[0]));
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
});

// แอดมินแก้ได้ทุกฟิลด์ของนักศึกษาคนไหนก็ได้
// เฉพาะนักศึกษาที่เป็น "หัวหน้าสี" และมีสิทธิ์เช็คชื่อ (can_checkin) เท่านั้นที่แก้ฟิลด์ "role" (ตำแหน่ง/กีฬา)
// ของคนอื่นได้ (นักศึกษาที่มีสิทธิ์เช็คชื่อตำแหน่งอื่นๆ ไม่มีสิทธิ์นี้แล้ว) และแก้ได้เฉพาะคนในสังกัดสีเดียวกันเท่านั้น
app.put("/api/students/:id", auth(), async (req, res) => {
  let { name, team, role, canCheckin, year } = req.body;

  if (req.user.role === "admin") {
    // ไม่ต้องทำอะไรเพิ่ม ใช้ค่าที่ส่งมาได้ทุกฟิลด์
  } else if (req.user.role === "student") {
    const { rows: meRows } = await pool.query(
      "SELECT team, role, can_checkin FROM students WHERE id = $1",
      [req.user.studentId]
    );
    const me = meRows[0];
    if (!me || !me.can_checkin) {
      return res.status(403).json({ message: "คุณไม่มีสิทธิ์แก้ไขข้อมูลนักศึกษา" });
    }
    if (me.role !== "หัวหน้าสี") {
      return res.status(403).json({ message: "เฉพาะหัวหน้าสีเท่านั้นที่ปรับตำแหน่งของนักศึกษาคนอื่นได้" });
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
    invalidateCache("students");
    res.json(mapStudent(rows[0]));
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
});

app.delete("/api/students/:id", auth("admin"), async (req, res) => {
  await pool.query("DELETE FROM students WHERE id = $1", [req.params.id]);
  invalidateCache("students");
  res.status(204).end();
});

/* ---------------- MATCHES ---------------- */
// ใช้โดย: หน้าแอดมิน AdminMatches.jsx (สร้าง/แก้ผลแข่ง), Bracket.jsx + MatchSchedule.jsx ฝั่งนักศึกษา
// (โชว์สายการแข่งขัน), Standings.jsx (นับแชมป์), UserCheckin.jsx (หาแมตช์วันนี้ของกีฬาที่จะเช็คชื่อ)
app.get("/api/matches", async (req, res) => {
  try {
    const rows = await getCached("matches", async () => (await pool.query("SELECT * FROM matches ORDER BY date, time")).rows);
    res.json(rows.map(mapMatch));
  } catch {
    res.status(503).json({ message: "เซิร์ฟเวอร์กำลังมีคนใช้งานหนาแน่น กรุณาลองใหม่อีกครั้ง" });
  }
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
    invalidateCache("matches");
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
  invalidateCache("matches");
  res.json(mapMatch(rows[0]));
});

app.delete("/api/matches/:id", auth("admin"), async (req, res) => {
  await pool.query("DELETE FROM matches WHERE id = $1", [req.params.id]);
  invalidateCache("matches");
  res.status(204).end();
});

/* ---------------- NEWS ---------------- */
// ใช้โดย: หน้าแอดมิน AdminNews.jsx (ประกาศ/ลบข่าว), UserHome.jsx + GuestHome.jsx (โชว์ข่าวล่าสุด), TodaySummary.jsx
app.get("/api/news", async (req, res) => {
  try {
    const rows = await getCached("news", async () => (await pool.query("SELECT * FROM news ORDER BY date DESC, id DESC")).rows);
    res.json(rows.map(mapNews));
  } catch {
    res.status(503).json({ message: "เซิร์ฟเวอร์กำลังมีคนใช้งานหนาแน่น กรุณาลองใหม่อีกครั้ง" });
  }
});

app.post("/api/news", auth("admin"), async (req, res) => {
  const { title, body } = req.body;
  if (!title) return res.status(400).json({ message: "ต้องระบุ title" });
  const { rows } = await pool.query(
    "INSERT INTO news (title, body) VALUES ($1,$2) RETURNING *",
    [title, body || null]
  );
  invalidateCache("news");
  res.status(201).json(mapNews(rows[0]));
});

app.delete("/api/news/:id", auth("admin"), async (req, res) => {
  await pool.query("DELETE FROM news WHERE id = $1", [req.params.id]);
  invalidateCache("news");
  res.status(204).end();
});

/* ---------------- EVENT DAYS (ปฏิทินวันจัดกิจกรรม) ---------------- */
// ใช้โดย: หน้าแอดมิน AdminEventDays.jsx (กำหนดวัน) และปฏิทินในหน้า UserHistory.jsx ฝั่งนักศึกษา
// (ตัดสินว่าวันไหนควรนับว่ามา/ขาด/ยังไม่เริ่ม)
app.get("/api/event-days", async (req, res) => {
  try {
    const rows = await getCached("event-days", async () => (await pool.query("SELECT * FROM event_days ORDER BY date")).rows);
    res.json(rows.map(mapEventDay));
  } catch {
    res.status(503).json({ message: "เซิร์ฟเวอร์กำลังมีคนใช้งานหนาแน่น กรุณาลองใหม่อีกครั้ง" });
  }
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
    invalidateCache("event-days");
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
    invalidateCache("event-days");
    const { rows } = await pool.query("SELECT * FROM event_days ORDER BY date");
    res.json(rows.map(mapEventDay));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete("/api/event-days/:id", auth("admin"), async (req, res) => {
  await pool.query("DELETE FROM event_days WHERE id = $1", [req.params.id]);
  invalidateCache("event-days");
  const { rows } = await pool.query("SELECT * FROM event_days ORDER BY date");
  res.json(rows.map(mapEventDay));
});

/* ---------------- CHECKINS ---------------- */
// ใช้โดย: หน้า UserCheckin.jsx (เจ้าหน้าที่ทีมกดเช็คชื่อ/เช็คขาดเพื่อนในสี), UserHistory.jsx (โชว์ประวัติ),
// TodaySummary.jsx (นับจำนวนเช็คชื่อวันนี้), AttendanceThreadModal.jsx (โชว์ชื่อ+รหัสผู้เช็คชื่อในหัวหน้าต่างข้อความ)
const CHECKINS_WITH_CHECKER_SQL = `
  SELECT c.*, u.display_name AS checked_by_name, u.student_id AS checked_by_student_id, u.role AS checked_by_role
  FROM checkins c
  LEFT JOIN users u ON u.id = c.checked_by_id
`;

app.get("/api/checkins", async (req, res) => {
  try {
    const rows = await getCached("checkins", async () => (await pool.query(`${CHECKINS_WITH_CHECKER_SQL} ORDER BY c.id`)).rows);
    res.json(rows.map(mapCheckin));
  } catch {
    res.status(503).json({ message: "เซิร์ฟเวอร์กำลังมีคนใช้งานหนาแน่น กรุณาลองใหม่อีกครั้ง" });
  }
});

// ตรวจสอบว่า req.user มีสิทธิ์ "เช็คชื่อ/เช็คขาด/ส่งข้อความ" แทนนักศึกษาคนนี้ได้หรือไม่
// - ตัวเองเช็ค/เขียนถึงตัวเองได้เสมอ
// - แอดมินทำได้กับทุกคน
// - "หัวหน้าสี" ที่มีสิทธิ์ can_checkin ทำได้กับทุกตำแหน่งในสีเดียวกัน (คุมทั้งสี)
// - นักศึกษาที่มีสิทธิ์ can_checkin ตำแหน่งอื่นๆ ทำได้เฉพาะคนในสีเดียวกัน "และ" ตำแหน่ง/กีฬาเดียวกับตัวเองเท่านั้น
async function assertCanActOnStudent(req, res, studentId) {
  if (req.user.role === "student" && studentId === req.user.studentId) return true;
  if (req.user.role === "admin") return true;

  if (req.user.role !== "student") {
    res.status(403).json({ message: "คุณไม่มีสิทธิ์ทำรายการนี้" });
    return false;
  }

  const { rows: meRows } = await pool.query(
    "SELECT team, role, can_checkin FROM students WHERE id = $1",
    [req.user.studentId]
  );
  const me = meRows[0];
  if (!me || !me.can_checkin) {
    res.status(403).json({ message: "คุณไม่ได้รับสิทธิ์ให้เช็คชื่อ กรุณาติดต่อผู้ดูแลระบบ" });
    return false;
  }

  const { rows: targetRows } = await pool.query("SELECT team, role FROM students WHERE id = $1", [studentId]);
  const target = targetRows[0];
  if (!target) {
    res.status(404).json({ message: "ไม่พบนักศึกษาคนนี้" });
    return false;
  }
  if (target.team !== me.team) {
    res.status(403).json({ message: "ทำรายการได้เฉพาะนักศึกษาในสังกัดสีเดียวกันเท่านั้น" });
    return false;
  }
  if (me.role !== "หัวหน้าสี" && target.role !== me.role) {
    res.status(403).json({ message: "ทำรายการได้เฉพาะนักศึกษาในตำแหน่ง/กีฬาเดียวกับคุณเท่านั้น" });
    return false;
  }
  return true;
}

// ต้องล็อกอินก่อนถึงจะเช็คชื่อได้
// นักศึกษาเช็คชื่อได้เฉพาะถ้าตัวเองได้รับสิทธิ์ (can_checkin) และเช็คได้เฉพาะคนในสีเดียวกันเท่านั้น
// แอดมินเช็คชื่อได้ทุกคน (ไม่ติดข้อจำกัดสี)
// ส่ง `date` มาด้วยได้ (YYYY-MM-DD) เพื่อเช็คชื่อ "ย้อนหลัง" — ต้องไม่เกินวันนี้ (เช็คล่วงหน้าอนาคตไม่ได้)
// ไม่ส่งมาก็ยังใช้วันนี้ตามเดิม (ตรวจสอบวันที่ฝั่ง server เอง ไม่เชื่อวันที่จากเครื่องผู้ใช้ที่ตั้งผิดได้)
app.post("/api/checkins", auth(), async (req, res) => {
  const { studentId, matchId, time, status, date } = req.body;
  if (!studentId) {
    return res.status(400).json({ message: "ต้องระบุ studentId" });
  }
  const finalStatus = status === "absent" ? "absent" : "present";

  let finalDate = null; // null -> ให้ query ใช้ CURRENT_DATE
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: "รูปแบบวันที่ไม่ถูกต้อง" });
    }
    const { rows: nowRows } = await pool.query("SELECT CURRENT_DATE AS today");
    if (date > toDateStr(nowRows[0].today)) {
      return res.status(400).json({ message: "เช็คชื่อล่วงหน้าไม่ได้ เลือกได้แค่วันนี้หรือวันที่ผ่านมาแล้ว" });
    }
    finalDate = date;
  }

  const allowed = await assertCanActOnStudent(req, res, studentId);
  if (!allowed) return;

  try {
    // checked_by_id = req.user.id เก็บไว้ว่าใครเป็นคนกดเช็คให้ (ตัวเอง/เจ้าหน้าที่ทีม/แอดมิน) เอาไว้โชว์ในหน้าต่างข้อความทีหลัง
    const { rows } = await pool.query(
      "INSERT INTO checkins (student_id, match_id, time, date, status, checked_by_id) VALUES ($1,$2,$3, COALESCE($4, CURRENT_DATE), $5, $6) RETURNING id",
      [studentId, matchId ?? null, time || null, finalDate, finalStatus, req.user.id]
    );
    invalidateCache("checkins");
    const { rows: withChecker } = await pool.query(`${CHECKINS_WITH_CHECKER_SQL} WHERE c.id = $1`, [rows[0].id]);
    res.status(201).json(mapCheckin(withChecker[0]));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ยกเลิกรายการเช็คชื่อ/เช็คขาดที่บันทึกผิด — ใช้สิทธิ์เดียวกับตอนเช็คชื่อ (ตัวเอง/แอดมิน/เจ้าหน้าที่ทีมในสีเดียวกัน)
// ลบแล้วนักศึกษาคนนั้นกลับไปสถานะ "ยังไม่เช็คชื่อ" ทันที ทำให้เช็คใหม่ได้เลยโดยไม่ต้องรอแอดมิน
app.delete("/api/checkins/:id", auth(), async (req, res) => {
  const { rows } = await pool.query("SELECT student_id FROM checkins WHERE id = $1", [req.params.id]);
  const record = rows[0];
  if (!record) return res.status(404).json({ message: "ไม่พบรายการเช็คชื่อนี้" });

  const allowed = await assertCanActOnStudent(req, res, record.student_id);
  if (!allowed) return;

  await pool.query("DELETE FROM checkins WHERE id = $1", [req.params.id]);
  invalidateCache("checkins");
  res.json({ ok: true });
});

// แอดมินแก้ไขรายการเช็คชื่อ/เช็คขาดที่บันทึกไว้แล้วได้ (เช่น เช็คผิดสถานะ, เวลาผิด, วันที่ผิด) ใช้ในหน้า
// "จัดการเช็คชื่อ" (AdminCheckins.jsx) — เฉพาะแอดมินเท่านั้น ผู้เช็คชื่อทั่วไปแก้ของที่เช็คไปแล้วไม่ได้ ต้อง
// ยกเลิก (DELETE) แล้วเช็คใหม่เอง
app.put("/api/checkins/:id", auth("admin"), async (req, res) => {
  const { status, time, date } = req.body;
  const { rows } = await pool.query(
    `UPDATE checkins
     SET status = COALESCE($1, status),
         time   = COALESCE($2, time),
         date   = COALESCE($3, date)
     WHERE id = $4 RETURNING id`,
    [status ?? null, time ?? null, date ?? null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ message: "ไม่พบรายการเช็คชื่อนี้" });
  invalidateCache("checkins");
  const { rows: withChecker } = await pool.query(`${CHECKINS_WITH_CHECKER_SQL} WHERE c.id = $1`, [rows[0].id]);
  res.json(mapCheckin(withChecker[0]));
});

/* ---------------- ATTENDANCE MESSAGES (สนทนาเรื่องการเช็คชื่อ/เช็คขาด) ---------------- */
// ใช้โดย: AttendanceThreadModal.jsx (ป็อปอัปแชท เปิดจาก UserCheckin.jsx และ UserHistory.jsx),
// MessageInboxModal.jsx (กล่องข้อความรวมทุกห้องแชท ใช้ /threads กับ /checker-unread-count)
// unread-count ใช้โชว์เลขแดงที่แท็บ "ประวัติของฉัน" (ฝั่งนักศึกษา) ส่วน checker-unread-count ใช้โชว์เลขแดงที่ปุ่ม
// "กล่องข้อความ" กับแท็บ "เช็คชื่อกิจกรรม" (ฝั่งผู้เช็คชื่อ) ใน Shell.jsx (ผ่าน App.jsx)
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

  // เปิดห้องแชทนี้ = ถือว่าอ่านข้อความทุกฝั่งในห้องนี้แล้ว (ไม่แยกฝั่งตาม role ผู้เปิด) เพราะถ้าคนคนเดียวกัน
  // เป็นทั้ง "นักศึกษา" (เจ้าของ record) และ "ผู้เช็คชื่อ" (เช็คชื่อตัวเองในฐานะเพื่อนร่วมทีม) เช่น เจ้าหน้าที่ทีม
  // เช็คชื่อตัวเอง — ถ้าแยกอ่านแค่ฝั่งเดียวตาม role จะมีข้อความอีกฝั่ง (ที่ตัวเองส่งในบทบาทนักศึกษา) ค้างเป็น
  // unread ตลอดไปเพราะไม่มีใคร "อีกคน" มาเปิดอ่านให้ (เจอบั๊กนี้จริง: เลขแดงในกล่องข้อความไม่หายแม้เปิดดูแล้ว)
  await pool.query(
    "UPDATE attendance_messages SET is_read = TRUE WHERE student_id = $1 AND date = $2 AND is_read = FALSE",
    [studentId, date]
  );

  res.json(rows.map(mapAttendanceMessage));
});

// รายชื่อวันที่ที่มีข้อความอยู่จริงของนักศึกษาคนหนึ่ง (ไม่สนว่าอ่านแล้วหรือยัง) ใช้แสดงสัญลักษณ์ "มีข้อความ"
// บนช่องปฏิทินหน้า "ประวัติของฉัน" (UserHistory.jsx) ให้ตรงกับความเป็นจริง แทนการเดาว่ามีข้อความจากแค่ว่า
// วันนั้นมีการเช็คชื่อ/เช็คขาด (ซึ่งส่วนใหญ่ไม่มีข้อความคุยกันจริงๆ)
app.get("/api/attendance-messages/dates", auth(), async (req, res) => {
  const { studentId } = req.query;
  if (!studentId) {
    return res.status(400).json({ message: "ต้องระบุ studentId" });
  }
  const allowed = await assertCanActOnStudent(req, res, studentId);
  if (!allowed) return;

  const { rows } = await pool.query(
    "SELECT DISTINCT date FROM attendance_messages WHERE student_id = $1",
    [studentId]
  );
  res.json(rows.map((r) => toDateStr(r.date)));
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

// รายชื่อ "ห้องแชท" (นักศึกษา 1 คน x วันที่ 1 วัน = 1 ห้อง) ทั้งหมดที่ผู้เช็คชื่อคนนี้เข้าถึงได้ — แอดมินเห็นทุกคน
// หัวหน้าสีเห็นทุกตำแหน่งในสีเดียวกัน ส่วนคนอื่นเห็นแค่คนในสีเดียวกัน "และ" ตำแหน่งเดียวกับตัวเองเท่านั้น (ตรงกับ
// ขอบเขตที่เช็คชื่อได้จริงใน assertCanActOnStudent กันไม่ให้กล่องข้อความโชว์ห้องที่กดเข้าไปแล้วจะโดนปฏิเสธ)
// เรียงจากข้อความล่าสุดก่อน พร้อมตัวอย่างข้อความล่าสุด+จำนวนที่ยังไม่อ่าน — ใช้โดย: MessageInboxModal.jsx
app.get("/api/attendance-messages/threads", auth(), async (req, res) => {
  let teamFilter = "";
  const params = [];
  if (req.user.role === "admin") {
    // แอดมินเห็นทุกห้องแชท ไม่ต้องกรองสี/ตำแหน่ง
  } else if (req.user.role === "student" && req.user.studentId) {
    const { rows: meRows } = await pool.query("SELECT team, role, can_checkin FROM students WHERE id = $1", [req.user.studentId]);
    const me = meRows[0];
    if (!me || !me.can_checkin) {
      return res.status(403).json({ message: "คุณไม่ได้รับสิทธิ์ให้เช็คชื่อ กรุณาติดต่อผู้ดูแลระบบ" });
    }
    if (me.role === "หัวหน้าสี") {
      teamFilter = "AND s.team = $1";
      params.push(me.team);
    } else {
      teamFilter = "AND s.team = $1 AND s.role = $2";
      params.push(me.team, me.role);
    }
  } else {
    return res.status(403).json({ message: "คุณไม่มีสิทธิ์เข้าดูกล่องข้อความนี้" });
  }

  const { rows } = await pool.query(
    `
    WITH thread AS (
      SELECT student_id, date, MAX(created_at) AS last_at
      FROM attendance_messages
      GROUP BY student_id, date
    )
    SELECT t.student_id, t.date, t.last_at, s.name AS student_name,
      lm.message AS last_message, lm.sender_role AS last_sender_role,
      COALESCE(uc.unread, 0)::int AS unread_count
    FROM thread t
    JOIN students s ON s.id = t.student_id
    JOIN LATERAL (
      SELECT message, sender_role FROM attendance_messages
      WHERE student_id = t.student_id AND date = t.date
      ORDER BY created_at DESC, id DESC LIMIT 1
    ) lm ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS unread FROM attendance_messages
      WHERE student_id = t.student_id AND date = t.date AND sender_role = 'student' AND is_read = FALSE
    ) uc ON true
    WHERE 1=1 ${teamFilter}
    ORDER BY t.last_at DESC
    LIMIT 200
    `,
    params
  );

  res.json(
    rows.map((r) => ({
      studentId: r.student_id,
      studentName: r.student_name,
      date: toDateStr(r.date),
      lastMessage: r.last_message,
      lastSenderRole: r.last_sender_role,
      lastAt: r.last_at,
      unreadCount: r.unread_count,
    }))
  );
});

// จำนวนข้อความที่นักศึกษาตอบกลับมาแล้วผู้เช็คชื่อยังไม่ได้เปิดอ่าน รวมทุกห้องแชทที่เข้าถึงได้ (แอดมิน = ทั้งหมด,
// หัวหน้าสี = ทั้งสีตัวเอง, คนอื่น = เฉพาะสีและตำแหน่งเดียวกับตัวเอง) โชว์เลขแดงที่ปุ่ม "กล่องข้อความ" และแท็บ "เช็คชื่อกิจกรรม"
app.get("/api/attendance-messages/checker-unread-count", auth(), async (req, res) => {
  if (req.user.role === "admin") {
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS count FROM attendance_messages WHERE sender_role = 'student' AND is_read = FALSE"
    );
    return res.json({ count: rows[0]?.count || 0 });
  }
  if (req.user.role === "student" && req.user.studentId) {
    const { rows: meRows } = await pool.query("SELECT team, role, can_checkin FROM students WHERE id = $1", [req.user.studentId]);
    const me = meRows[0];
    if (!me || !me.can_checkin) return res.json({ count: 0 });
    const scopeFilter = me.role === "หัวหน้าสี" ? "" : "AND s.role = $2";
    const params = me.role === "หัวหน้าสี" ? [me.team] : [me.team, me.role];
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM attendance_messages m
       JOIN students s ON s.id = m.student_id
       WHERE m.sender_role = 'student' AND m.is_read = FALSE AND s.team = $1 ${scopeFilter}`,
      params
    );
    return res.json({ count: rows[0]?.count || 0 });
  }
  res.json({ count: 0 });
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
