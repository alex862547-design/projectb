# projectb

ระบบจัดการกีฬาสีภายในวิทยาลัย — ฝั่ง backend (Express + PostgreSQL)

## เริ่มใช้งาน (development)
สร้างไฟล์ `.env` เอง (ไม่มีไฟล์ตัวอย่างในนี้) ใส่ตัวแปรต่อไปนี้:
```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/sports_day
PORT=4000
JWT_SECRET=ตั้งเป็นข้อความสุ่มยาวๆ เอง
```
แล้วรัน:
```bash
npm install
npm run dev
```

## Deploy
ตั้ง environment variables ต่อไปนี้บนโฮสต์ (เช่น Render):
- `DATABASE_URL`
- `JWT_SECRET`
- `PORT` (โฮสต์ส่วนใหญ่กำหนดให้อัตโนมัติ)

## รันด้วย Docker
มี `Dockerfile` ในตัวสำหรับ build image ของ backend เดี่ยวๆ ได้:
```bash
docker build -t sports-day-api .
docker run -p 4000:4000 --env-file .env sports-day-api
```
แต่ backend ต้องมี PostgreSQL ให้ต่อด้วยเสมอ — ถ้าต้องการรันครบทั้งระบบ (frontend + backend + database) พร้อมกันในคำสั่งเดียว
ให้ใช้ `docker-compose.yml` ที่อยู่ในโฟลเดอร์แม่ (ระดับเดียวกับ `my-app/` และ `server/`) แทน:
```bash
cd ..
docker compose up --build
```
