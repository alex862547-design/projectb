# projectb

ระบบจัดการกีฬาสีภายในวิทยาลัย — ฝั่ง backend (Express + PostgreSQL)

## เริ่มใช้งาน (development)
```bash
cp .env.example .env   # แล้วกรอกค่าให้ครบ (DATABASE_URL, JWT_SECRET)
npm install
npm run dev
```

## Deploy
ตั้ง environment variables ต่อไปนี้บนโฮสต์ (เช่น Render):
- `DATABASE_URL`
- `JWT_SECRET`
- `PORT` (โฮสต์ส่วนใหญ่กำหนดให้อัตโนมัติ)
