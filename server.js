const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Enable CORS for mobile and web connections
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json({ limit: '15mb' })); // Support for photo sharing payload

const PORT = process.env.PORT || 3000;

// Persistent Database storage (JSON file)
const DB_FILE = path.join(__dirname, 'database.json');
let db = { users: {}, friends: {}, requests: {} };

if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.error('Error loading database.json, starting with fresh store');
  }
}

function saveDb() {
  fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), () => {});
}

// -------------------------------------------------------------
// Health Check (For Render zero-downtime deployment check)
// -------------------------------------------------------------
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'New Stranger Backend API',
    platform: 'Render.com',
    onlineUsers: io.engine.clientsCount,
    timestamp: new Date().toISOString()
  });
});

// -------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------

// 1. REGISTER: Auto unique User ID generation
app.post('/api/register', (req, res) => {
  const { name, password, age, gender, orientation } = req.body;
  if (!name || !password) {
    return res.status(400).json({ error: 'Name and password are required' });
  }

  const uniqueNum = Math.floor(10000 + Math.random() * 90000);
  const userId = `stranger_${uniqueNum}`;

  db.users[userId] = {
    id: userId,
    name,
    password,
    age: parseInt(age) || 18,
    gender: gender || 'Other',
    orientation: orientation || 'Straight',
    createdAt: new Date().toISOString()
  };

  db.friends[userId] = [];
  db.requests[userId] = [];
  saveDb();

  return res.json({
    success: true,
    message: 'User registered successfully',
    userId,
    user: db.users[userId]
  });
});

// 2. LOGIN
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.users[username];

  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid User ID or Password' });
  }

  return res.json({
    success: true,
    message: 'Login successful',
    user: {
      id: user.id,
      name: user.name,
      gender: user.gender,
      orientation: user.orientation
    }
  });
});

// 3. STATS: Live online counters
app.get('/api/stats', (req, res) => {
  const liveCount = io.engine.clientsCount;
  const base = 12400 + liveCount;
  const males = Math.floor(base * 0.52);
  const females = base - males;

  return res.json({
    totalOnline: base,
    malesOnline: males,
    femalesOnline: females
  });
});

// 4. FRIEND REQUEST: Send request by User ID
app.post('/api/friends/request', (req, res) => {
  const { fromUserId, toUserId } = req.body;
  if (!toUserId) return res.status(400).json({ error: 'toUserId required' });

  if (!db.users[toUserId]) {
    return res.status(404).json({ error: 'Target User ID not found' });
  }

  db.requests[toUserId] = db.requests[toUserId] || [];
  if (!db.requests[toUserId].includes(fromUserId)) {
    db.requests[toUserId].push(fromUserId);
    saveDb();
  }

  return res.json({ success: true, message: `Request sent to ${toUserId}` });
});

// 5. ACCEPT REQUEST
app.post('/api/friends/accept', (req, res) => {
  const { userId, targetId } = req.body;

  db.requests[userId] = (db.requests[userId] || []).filter(id => id !== targetId);
  db.friends[userId] = db.friends[userId] || [];
  db.friends[targetId] = db.friends[targetId] || [];

  if (!db.friends[userId].includes(targetId)) db.friends[userId].push(targetId);
  if (!db.friends[targetId].includes(userId)) db.friends[targetId].push(userId);

  saveDb();
  return res.json({ success: true, friends: db.friends[userId] });
});

// 6. DECLINE REQUEST
app.post('/api/friends/decline', (req, res) => {
  const { userId, targetId } = req.body;
  db.requests[userId] = (db.requests[userId] || []).filter(id => id !== targetId);
  saveDb();
  return res.json({ success: true, message: 'Request declined' });
});

// 7. GET FRIENDS & REQUESTS
app.get('/api/friends/:userId', (req, res) => {
  const { userId } = req.params;
  return res.json({
    friends: db.friends[userId] || [],
    incomingRequests: db.requests[userId] || []
  });
});

// -------------------------------------------------------------
// REAL-TIME WEBSOCKETS (Random Matchmaking & Live Chat)
// -------------------------------------------------------------

let waitingQueue = [];

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  // Identify connected user ID
  socket.on('identify', (userId) => {
    socket.userId = userId;
  });

  // Find random match
  socket.on('find_match', () => {
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id && s.connected);

    if (waitingQueue.length > 0) {
      const partnerSocket = waitingQueue.shift();
      const roomId = `room_${socket.id}_${partnerSocket.id}`;

      socket.join(roomId);
      partnerSocket.join(roomId);

      socket.currentRoom = roomId;
      partnerSocket.currentRoom = roomId;

      socket.partnerId = partnerSocket.userId || 'Anonymous Stranger';
      partnerSocket.partnerId = socket.userId || 'Anonymous Stranger';

      socket.emit('match_found', { roomId, partnerName: partnerSocket.partnerId });
      partnerSocket.emit('match_found', { roomId, partnerName: socket.partnerId });
      console.log(`Matched ${socket.id} with ${partnerSocket.id}`);
    } else {
      waitingQueue.push(socket);
      socket.emit('waiting_for_match');
    }
  });

  // Send message inside Room (Text or Photo)
  socket.on('send_message', ({ roomId, text, imageBase64, isPhoto }) => {
    socket.to(roomId).emit('receive_message', {
      text,
      imageBase64,
      isPhoto: !!isPhoto,
      from: socket.userId || 'Stranger',
      timestamp: new Date().toISOString()
    });
  });

  // Leave / Skip Match (New Match button)
  socket.on('leave_match', () => {
    if (socket.currentRoom) {
      socket.to(socket.currentRoom).emit('partner_disconnected');
      socket.leave(socket.currentRoom);
      socket.currentRoom = null;
    }
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
  });

  // WebRTC Signaling for Friend Voice & Video Calls
  socket.on('call_user', ({ toUserId, signalData, callType }) => {
    io.emit(`call_incoming_${toUserId}`, {
      fromUserId: socket.userId,
      signalData,
      callType
    });
  });

  socket.on('answer_call', ({ toUserId, signalData }) => {
    io.emit(`call_accepted_${toUserId}`, { signalData });
  });

  socket.on('disconnect', () => {
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
    if (socket.currentRoom) {
      socket.to(socket.currentRoom).emit('partner_disconnected');
    }
    console.log('Socket disconnected:', socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 New Stranger Server running on port ${PORT}`);
});
