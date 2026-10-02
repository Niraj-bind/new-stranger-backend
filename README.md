# 🚀 New Stranger - Backend Server (Render.com)

Production Node.js + Express + Socket.IO server designed for 1-click deployment on Render.

---

## ⚡ Features
- **REST APIs**:
  - `POST /api/register` (Auto-generates unique `stranger_XXXXX` ID)
  - `POST /api/login` (Authentication)
  - `GET /api/stats` (Live online count)
  - `POST /api/friends/request` (Send request by User ID)
  - `POST /api/friends/accept` (Accept request)
  - `POST /api/friends/decline` (Decline request)
  - `GET /api/friends/:userId` (Fetch friends & incoming requests)
- **WebSockets (Socket.IO)**:
  - Random Matchmaking Queue (Pairs 2 live devices in real-time)
  - Text & Photo chat transmission
  - WebRTC signaling for Voice & Video calls

---

## 🌐 Deploy to Render.com

1. Push this `backend/` folder to a GitHub repository (e.g., `new-stranger-backend`).
2. Go to [Render Dashboard](https://dashboard.render.com).
3. Click **New +** -> **Web Service**.
4. Connect your GitHub repository.
5. Settings:
   - **Name**: `new-stranger-api`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: `Free`
6. Click **Deploy Web Service**.

Once deployed, Render gives you a live URL:
`https://new-stranger-api.onrender.com`

---

## 💻 Local Testing

```bash
cd D:\NewStranger\backend
npm install
npm start
```
Server runs on `http://localhost:3000`.
