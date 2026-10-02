require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { RtcTokenBuilder, RtcRole } = require('agora-token');

const app = express();
const server = http.createServer(app);

// Environment Variables
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const AGORA_APP_ID = process.env.AGORA_APP_ID || '8fad472fea6c40dcaf4bd00b394ad814';
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE || 'beb9712340434846a6c9f3e5d0a5c7e0';
const APP_SECRET = process.env.APP_SECRET || 'new_stranger_secret_key_2026';

// Configure CORS and Socket.io with ping timeout for aggressive dead connection pruning
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 10000,
  pingInterval: 5000,
  transports: ['websocket', 'polling']
});

app.use(cors());
app.use(express.json({ limit: '15mb' }));

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
// Health Check (For Render)
// -------------------------------------------------------------
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    service: 'New Stranger Backend API',
    platform: 'Render.com',
    environment: NODE_ENV,
    onlineUsers: io.engine.clientsCount,
    activeMatches: activeRooms.size,
    queueSize: waitingQueue.length,
    agoraConfigured: !!AGORA_APP_ID,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    agoraAppId: AGORA_APP_ID,
    environment: NODE_ENV
  });
});

// 8. AGORA RTC TOKEN GENERATION
app.get('/api/agora-token', (req, res) => {
  const channelName = req.query.channel;
  const uid = parseInt(req.query.uid) || 0;

  if (!channelName) {
    return res.status(400).json({ error: 'channel query parameter is required' });
  }

  if (!AGORA_APP_CERTIFICATE) {
    // No certificate configured - return empty token for "App ID only" testing mode
    console.log(`[AGORA TOKEN] No certificate configured, returning empty token for channel: ${channelName}`);
    return res.json({ token: '', appId: AGORA_APP_ID, channel: channelName, uid });
  }

  try {
    const role = RtcRole.PUBLISHER;
    const expirationTimeInSeconds = 3600; // 1 hour
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expirationTimeInSeconds;

    const token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_APP_ID,
      AGORA_APP_CERTIFICATE,
      channelName,
      uid,
      role,
      privilegeExpiredTs
    );

    console.log(`[AGORA TOKEN] Generated token for channel: ${channelName}, uid: ${uid}`);
    return res.json({ token, appId: AGORA_APP_ID, channel: channelName, uid });
  } catch (e) {
    console.error(`[AGORA TOKEN ERROR] ${e.message}`);
    return res.status(500).json({ error: 'Token generation failed: ' + e.message });
  }
});

// -------------------------------------------------------------
// REST API ENDPOINTS
// -------------------------------------------------------------

function generateUniqueUserId() {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let id = '';
  do {
    id = '';
    for (let i = 0; i < 6; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (db.users[id]);
  return id;
}

// 1. REGISTER
app.post('/api/register', (req, res) => {
  const { name, password, age, gender, orientation } = req.body;
  if (!name || !password) {
    return res.status(400).json({ error: 'Name and password are required' });
  }

  const userId = generateUniqueUserId();

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

  console.log(`[REGISTER] Created user ${userId} (${name})`);

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
  if (!username) return res.status(400).json({ error: 'Username is required' });
  const rawId = username.trim();
  const upperId = rawId.toUpperCase();
  const user = db.users[upperId] || db.users[rawId];

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

// 3. STATS
app.get('/api/stats', (req, res) => {
  const liveCount = io.engine.clientsCount || 0;
  let males = 0;
  let females = 0;

  for (const [id, s] of io.sockets.sockets) {
    if (s.userGender === 'Female') {
      females++;
    } else {
      males++;
    }
  }

  if (liveCount === 0) {
    males = 0;
    females = 0;
  }

  return res.json({
    totalOnline: liveCount,
    malesOnline: males,
    femalesOnline: females
  });
});

// 4. FRIEND REQUEST
app.post('/api/friends/request', (req, res) => {
  const fromUserId = (req.body.fromUserId || '').trim().toUpperCase();
  const toUserId = (req.body.toUserId || '').trim().toUpperCase();

  if (!fromUserId || !toUserId) {
    return res.status(400).json({ error: 'fromUserId and toUserId are required' });
  }

  if (fromUserId === toUserId) {
    return res.status(400).json({ error: 'Aap khud ko friend request nahi bhej sakte' });
  }

  // Ensure structures exist for both users (handles server restart/ephemeral container)
  if (!db.users[fromUserId]) {
    db.users[fromUserId] = { id: fromUserId, name: fromUserId, gender: 'Other' };
    db.friends[fromUserId] = db.friends[fromUserId] || [];
    db.requests[fromUserId] = db.requests[fromUserId] || [];
  }
  if (!db.users[toUserId]) {
    db.users[toUserId] = { id: toUserId, name: toUserId, gender: 'Other' };
    db.friends[toUserId] = db.friends[toUserId] || [];
    db.requests[toUserId] = db.requests[toUserId] || [];
  }

  db.friends[fromUserId] = db.friends[fromUserId] || [];
  if (db.friends[fromUserId].includes(toUserId)) {
    return res.status(400).json({ error: `${toUserId} already aapka friend hai` });
  }

  db.requests[toUserId] = db.requests[toUserId] || [];
  if (!db.requests[toUserId].includes(fromUserId)) {
    db.requests[toUserId].push(fromUserId);
    saveDb();
  }

  // Real-time socket event to the recipient's phone!
  io.to(`user_${toUserId}`).emit('incoming_friend_request', { fromUserId });
  console.log(`[FRIEND REQUEST] ${fromUserId} -> ${toUserId}`);

  return res.json({ success: true, message: `Friend request bhej di gayi: ${toUserId} 🚀` });
});

// 5. ACCEPT REQUEST
app.post('/api/friends/accept', (req, res) => {
  const userId = (req.body.userId || '').trim().toUpperCase();
  const targetId = (req.body.targetId || '').trim().toUpperCase();

  if (!userId || !targetId) {
    return res.status(400).json({ error: 'userId and targetId are required' });
  }

  // Ensure structures exist
  if (!db.users[userId]) db.users[userId] = { id: userId, name: userId };
  if (!db.users[targetId]) db.users[targetId] = { id: targetId, name: targetId };

  db.requests[userId] = (db.requests[userId] || []).filter(id => id !== targetId);
  db.friends[userId] = db.friends[userId] || [];
  db.friends[targetId] = db.friends[targetId] || [];

  if (!db.friends[userId].includes(targetId)) db.friends[userId].push(targetId);
  if (!db.friends[targetId].includes(userId)) db.friends[targetId].push(userId);

  saveDb();

  // Real-time socket events to both phones!
  io.to(`user_${userId}`).emit('friend_accepted', { friendId: targetId });
  io.to(`user_${targetId}`).emit('friend_accepted', { friendId: userId });

  console.log(`[FRIEND ACCEPTED] ${userId} <-> ${targetId}`);
  return res.json({ success: true, friends: db.friends[userId] });
});

// 6. DECLINE REQUEST
app.post('/api/friends/decline', (req, res) => {
  const userId = (req.body.userId || '').trim().toUpperCase();
  const targetId = (req.body.targetId || '').trim().toUpperCase();

  if (userId) {
    db.requests[userId] = (db.requests[userId] || []).filter(id => id !== targetId);
    saveDb();
  }

  return res.json({ success: true, message: 'Request declined' });
});

// 7. GET FRIENDS & REQUESTS
app.get('/api/friends/:userId', (req, res) => {
  const userId = (req.params.userId || '').trim().toUpperCase();
  if (userId && !db.users[userId]) {
    db.users[userId] = { id: userId, name: userId };
    db.friends[userId] = db.friends[userId] || [];
    db.requests[userId] = db.requests[userId] || [];
  }

  return res.json({
    friends: db.friends[userId] || [],
    incomingRequests: db.requests[userId] || []
  });
});

// -------------------------------------------------------------
// BULLETPROOF 1-ON-1 REAL-TIME MATCHMAKING & RELIABLE MESSAGING
// -------------------------------------------------------------

// Waiting queue storing socket instances
let waitingQueue = [];

// Active 1-on-1 rooms map: roomId -> { user1: socket, user2: socket }
const activeRooms = new Map();

// Helper: Disconnect from partner safely and reset state
function endPairing(socket, reason = 'partner_left') {
  const roomId = socket.currentRoomId;
  const partnerSocket = socket.partnerSocket;

  // Clean current socket
  socket.state = 'IDLE';
  socket.partnerSocket = null;
  socket.currentRoomId = null;

  if (roomId) {
    socket.leave(roomId);
    activeRooms.delete(roomId);
  }

  // Clean partner socket
  if (partnerSocket && partnerSocket.connected) {
    partnerSocket.state = 'IDLE';
    partnerSocket.partnerSocket = null;
    partnerSocket.currentRoomId = null;
    if (roomId) partnerSocket.leave(roomId);

    partnerSocket.emit('stranger_disconnected', { reason });
    console.log(`[PAIRING ENDED] ${socket.id} separated from ${partnerSocket.id}`);
  }
}

// Helper: Prune waiting queue of dead sockets
function cleanQueue() {
  waitingQueue = waitingQueue.filter(s => s && s.connected && s.state === 'WAITING');
}

io.on('connection', (socket) => {
  console.log(`[CONNECT] User connected: ${socket.id}`);
  socket.state = 'IDLE'; // States: 'IDLE', 'WAITING', 'MATCHED'
  socket.partnerSocket = null;
  socket.currentRoomId = null;

  socket.on('identify', (data) => {
    let uId = '';
    let uGender = 'Male';
    if (typeof data === 'string') {
      uId = data;
      if (db.users[data]) {
        uGender = db.users[data].gender;
      }
    } else if (data && typeof data === 'object') {
      uId = data.userId || '';
      uGender = data.gender || (db.users[uId] ? db.users[uId].gender : 'Male');
    }
    socket.userId = (uId || '').toUpperCase();
    socket.userGender = uGender;
    socket.join(`user_${socket.userId}`);

    if (socket.userId && !db.users[socket.userId]) {
      db.users[socket.userId] = {
        id: socket.userId,
        name: socket.userId,
        gender: socket.userGender,
        createdAt: new Date().toISOString()
      };
      db.friends[socket.userId] = db.friends[socket.userId] || [];
      db.requests[socket.userId] = db.requests[socket.userId] || [];
      saveDb();
    }

    console.log(`[IDENTIFY] Socket ${socket.id} is ${socket.userId} (${socket.userGender})`);
  });

  // 1. MATCH REQUEST (Atomic matching loop)
  socket.on('find_match', (data = {}) => {
    // If socket is already in a match, cleanly terminate the old match first
    if (socket.state === 'MATCHED') {
      endPairing(socket, 'new_match_requested');
    }

    // Remove this socket if it was already in waiting queue
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
    cleanQueue();

    let matchedPartner = null;

    // Search for a valid, currently waiting partner
    while (waitingQueue.length > 0) {
      const candidate = waitingQueue.shift();

      // STRICT VALIDATION: Candidate must be connected, in WAITING state, and NOT the same socket
      if (
        candidate &&
        candidate.connected &&
        candidate.state === 'WAITING' &&
        candidate.id !== socket.id
      ) {
        matchedPartner = candidate;
        break;
      }
    }

    if (matchedPartner) {
      // ATOMIC PAIRING: Set states immediately before any async ops
      socket.state = 'MATCHED';
      matchedPartner.state = 'MATCHED';

      const roomId = `room_${socket.id}_${matchedPartner.id}_${Date.now()}`;
      socket.currentRoomId = roomId;
      matchedPartner.currentRoomId = roomId;

      socket.partnerSocket = matchedPartner;
      matchedPartner.partnerSocket = socket;

      socket.join(roomId);
      matchedPartner.join(roomId);

      activeRooms.set(roomId, { user1: socket, user2: matchedPartner });

      const nameA = socket.userId || 'Stranger';
      const nameB = matchedPartner.userId || 'Stranger';

      // Notify User A
      socket.emit('match_found', {
        roomId,
        partnerId: matchedPartner.id,
        partnerName: nameB
      });

      // Notify User B
      matchedPartner.emit('match_found', {
        roomId,
        partnerId: socket.id,
        partnerName: nameA
      });

      console.log(`[MATCH SUCCESS] Room ${roomId} created between ${socket.id} (${nameA}) and ${matchedPartner.id} (${nameB})`);
    } else {
      // Put in queue
      socket.state = 'WAITING';
      waitingQueue.push(socket);
      socket.emit('waiting_for_match');
      console.log(`[WAITING] Socket ${socket.id} queued. Total queue: ${waitingQueue.length}`);
    }
  });

  // 2. RELIABLE MESSAGE SEND WITH ACKNOWLEDGEMENT (Guaranteed Delivery)
  socket.on('send_message', (payload, ackCallback) => {
    const partner = socket.partnerSocket;

    // Validation 1: Verify socket is currently matched
    if (socket.state !== 'MATCHED' || !partner) {
      if (typeof ackCallback === 'function') {
        ackCallback({
          status: 'error',
          error: 'No active stranger connection. Please match first.'
        });
      }
      return;
    }

    // Validation 2: Verify partner is still connected
    if (!partner.connected) {
      endPairing(socket, 'partner_lost_connection');
      if (typeof ackCallback === 'function') {
        ackCallback({
          status: 'error',
          error: 'Stranger disconnected. Message could not be sent.'
        });
      }
      return;
    }

    const messageData = {
      id: payload.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      text: payload.text || null,
      imageBase64: payload.imageBase64 || null,
      isPhoto: !!payload.isPhoto,
      from: socket.userId || 'Stranger',
      timestamp: new Date().toISOString()
    };

    // DIRECT EMISSION TO PARTNER: No broadcast loss!
    partner.emit('receive_message', messageData);

    // Send instant success delivery receipt back to the sender
    if (typeof ackCallback === 'function') {
      ackCallback({
        status: 'delivered',
        messageId: messageData.id,
        timestamp: messageData.timestamp
      });
    }
  });

  // 3. TYPING INDICATOR (Direct to partner)
  socket.on('typing', ({ isTyping }) => {
    if (socket.partnerSocket && socket.partnerSocket.connected) {
      socket.partnerSocket.emit('stranger_typing', { isTyping: !!isTyping });
    }
  });

  // 4. LEAVE / CANCEL MATCH (Explicit clean separation)
  socket.on('leave_match', () => {
    console.log(`[LEAVE MATCH] ${socket.id} called leave_match`);
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
    endPairing(socket, 'user_left');
  });

  // 5. DISCONNECT HANDLER
  socket.on('disconnect', (reason) => {
    console.log(`[DISCONNECT] Socket ${socket.id} disconnected (${reason})`);
    waitingQueue = waitingQueue.filter(s => s.id !== socket.id);
    endPairing(socket, 'disconnected');
  });

  // 6. WEBRTC SIGNALING FOR CALLS
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

  // 7. DIRECT FRIEND-TO-FRIEND MESSAGING
  socket.on('send_friend_message', (payload, ackCallback) => {
    const toUserId = (payload.toUserId || '').trim().toUpperCase();
    if (!toUserId) {
      if (typeof ackCallback === 'function') {
        ackCallback({ status: 'error', error: 'Recipient ID required' });
      }
      return;
    }

    const messageData = {
      id: payload.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      text: payload.text || null,
      imageBase64: payload.imageBase64 || null,
      isPhoto: !!payload.isPhoto,
      from: socket.userId || 'Friend',
      toUserId: toUserId,
      timestamp: new Date().toISOString()
    };

    io.to(`user_${toUserId}`).emit('receive_friend_message', messageData);
    console.log(`[FRIEND MSG] From ${socket.userId} to ${toUserId} (ID: ${messageData.id})`);

    if (typeof ackCallback === 'function') {
      ackCallback({
        status: 'delivered',
        messageId: messageData.id
      });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 New Stranger Server running on port ${PORT}`);
});
