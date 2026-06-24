# CRM System

客戶關係管理系統，使用 Next.js + TypeScript + SQLite 建構。

## 功能

- 使用者登入 / 註冊
- 聯絡人管理
- 公司管理
- 待辦事項 / 跟進提醒
- 備註 / 活動紀錄
- 儀表板統計

## 快速開始

```bash
npm install
npx prisma migrate dev
npx tsx prisma/seed.ts
npm run dev
```

開啟 [http://localhost:3000](http://localhost:3000)

### 示範帳號

- Email: `demo@crm.com`
- 密碼: `password123`

## 技術棧

- Next.js 16 (App Router)
- TypeScript
- Prisma + SQLite
- NextAuth.js
- Tailwind CSS
