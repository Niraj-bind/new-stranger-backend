require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid') || { v4: () => 'id_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36) };
const { db, run, get, all, initDatabase } = require('./database');

const app = express();
const server = http.createServer(app);

// Configuration
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const JWT_SECRET = process.env.JWT_SECRET || 'connect_dating_secure_jwt_secret_2026';

// Middleware (Express 50MB limit for photo sharing)
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Socket.IO Setup
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingTimeout: 10000,
  pingInterval: 5000,
  transports: ['websocket', 'polling']
});

// Helper for generating unique IDs
function generateId(prefix = 'usr') {
  return `${prefix}_${Math.random().toString(36).substring(2, 8)}${Date.now().toString(36).substring(4)}`;
}

// Authentication Middleware
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  // Also support custom x-user-id header for simple resilience
  const fallbackUserId = req.headers['x-user-id'];

  if (!token && !fallbackUserId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await get('SELECT id, username, name, gender, age, city, profile_photo, bio, interests FROM users WHERE id = ?', [decoded.id]);
      if (!user) return res.status(401).json({ error: 'User not found' });
      req.user = user;
      return next();
    } catch (err) {
      // Fallback if token expired but fallback id exists
      if (fallbackUserId) {
        const user = await get('SELECT id, username, name, gender, age, city, profile_photo, bio, interests FROM users WHERE id = ?', [fallbackUserId]);
        if (user) {
          req.user = user;
          return next();
        }
      }
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
  }

  if (fallbackUserId) {
    const user = await get('SELECT id, username, name, gender, age, city, profile_photo, bio, interests FROM users WHERE id = ?', [fallbackUserId]);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    return next();
  }
}

// --------------------------------------------------------------------------
// HEALTH & INFO
// --------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.json({
    app: 'Connect',
    tagline: 'Completely Free Dating & Social Connection',
    status: 'online',
    platform: 'Render.com',
    environment: NODE_ENV,
    activeSockets: io.engine.clientsCount,
    timestamp: new Date().toISOString()
  });
});

// --------------------------------------------------------------------------
// 1. AUTHENTICATION & SETUP API
// --------------------------------------------------------------------------

// Register User (Must be 18+)
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, name, gender, age, city, profilePhoto, bio, interests } = req.body;

    if (!username || !password || !name || !gender || !age || !city) {
      return res.status(400).json({ error: 'All primary profile fields (username, password, name, gender, age, city) are required' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanAge = parseInt(age, 10);

    if (isNaN(cleanAge) || cleanAge < 18) {
      return res.status(400).json({ error: 'Users must be at least 18 years old.' });
    }

    // Check if username already exists
    const existing = await get('SELECT id FROM users WHERE username = ?', [cleanUsername]);
    if (existing) {
      return res.status(400).json({ error: 'Username already taken. Please choose another.' });
    }

    const userId = generateId('usr');
    const passwordHash = await bcrypt.hash(password, 10);
    const interestsJson = typeof interests === 'string' ? interests : JSON.stringify(interests || []);

    await run(`
      INSERT INTO users (id, username, password_hash, name, gender, age, city, profile_photo, bio, interests)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      userId,
      cleanUsername,
      passwordHash,
      name.trim(),
      gender,
      cleanAge,
      city.trim(),
      profilePhoto || '',
      bio ? bio.trim() : '',
      interestsJson
    ]);

    const createdUser = await get(`
      SELECT id, username, name, gender, age, city, profile_photo, bio, interests, created_at
      FROM users WHERE id = ?
    `, [userId]);

    const token = jwt.sign({ id: userId, username: cleanUsername }, JWT_SECRET, { expiresIn: '90d' });

    console.log(`[AUTH] Registered new user: ${cleanUsername} (${userId})`);
    return res.status(201).json({
      success: true,
      token,
      user: {
        ...createdUser,
        interests: JSON.parse(createdUser.interests || '[]')
      }
    });
  } catch (error) {
    console.error('[AUTH ERROR] Registration failed:', error);
    return res.status(500).json({ error: 'Registration failed: ' + error.message });
  }
});

// Login User
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const cleanUsername = username.trim().toLowerCase();
    const user = await get('SELECT * FROM users WHERE username = ?', [cleanUsername]);

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '90d' });

    console.log(`[AUTH] User logged in: ${user.username} (${user.id})`);
    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        gender: user.gender,
        age: user.age,
        city: user.city,
        profile_photo: user.profile_photo,
        bio: user.bio,
        interests: JSON.parse(user.interests || '[]'),
        created_at: user.created_at
      }
    });
  } catch (error) {
    console.error('[AUTH ERROR] Login failed:', error);
    return res.status(500).json({ error: 'Login failed: ' + error.message });
  }
});

// Get Current User Profile
app.get('/api/me', authenticateToken, async (req, res) => {
  const user = req.user;
  return res.json({
    success: true,
    user: {
      ...user,
      interests: typeof user.interests === 'string' ? JSON.parse(user.interests || '[]') : user.interests
    }
  });
});

// Update Profile
app.put('/api/profile', authenticateToken, async (req, res) => {
  try {
    const { name, city, bio, interests, profilePhoto } = req.body;
    const userId = req.user.id;

    const current = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!current) return res.status(404).json({ error: 'User not found' });

    const newName = name !== undefined ? name.trim() : current.name;
    const newCity = city !== undefined ? city.trim() : current.city;
    const newBio = bio !== undefined ? bio.trim() : current.bio;
    const newInterests = interests !== undefined
      ? (typeof interests === 'string' ? interests : JSON.stringify(interests))
      : current.interests;
    const newPhoto = profilePhoto !== undefined ? profilePhoto : current.profile_photo;

    await run(`
      UPDATE users
      SET name = ?, city = ?, bio = ?, interests = ?, profile_photo = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [newName, newCity, newBio, newInterests, newPhoto, userId]);

    const updated = await get('SELECT id, username, name, gender, age, city, profile_photo, bio, interests FROM users WHERE id = ?', [userId]);

    return res.json({
      success: true,
      user: {
        ...updated,
        interests: JSON.parse(updated.interests || '[]')
      }
    });
  } catch (error) {
    console.error('[PROFILE ERROR] Update failed:', error);
    return res.status(500).json({ error: 'Failed to update profile: ' + error.message });
  }
});

// --------------------------------------------------------------------------
// 2. DISCOVER SCREEN API (PAGINATED, OPPOSITE GENDER, STRICT BLOCK EXCLUSION)
// --------------------------------------------------------------------------
app.get('/api/profiles', authenticateToken, async (req, res) => {
  try {
    const currentUser = req.user;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    // Opposite Gender Determination
    const userGender = (currentUser.gender || 'Male').toLowerCase();
    const targetGender = userGender === 'male' ? 'Female' : 'Male';

    // Strict Block System Filter:
    // Exclude:
    // 1. Current user
    // 2. Users blocked by current user
    // 3. Users who have blocked current user
    const query = `
      SELECT id, name, gender, age, city, profile_photo, bio, interests, created_at
      FROM users
      WHERE gender = ?
        AND id != ?
        AND id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
        AND id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const countQuery = `
      SELECT COUNT(*) as total
      FROM users
      WHERE gender = ?
        AND id != ?
        AND id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
        AND id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
    `;

    const [rows, countRow] = await Promise.all([
      all(query, [targetGender, currentUser.id, currentUser.id, currentUser.id, limit, offset]),
      get(countQuery, [targetGender, currentUser.id, currentUser.id, currentUser.id])
    ]);

    const total = countRow ? countRow.total : 0;
    const hasMore = offset + rows.length < total;

    const profiles = rows.map((r) => ({
      id: r.id,
      name: r.name,
      gender: r.gender,
      age: r.age,
      city: r.city,
      profile_photo: r.profile_photo,
      bio: r.bio,
      interests: JSON.parse(r.interests || '[]'),
      created_at: r.created_at
    }));

    return res.json({
      success: true,
      page,
      limit,
      total,
      hasMore,
      targetGender,
      profiles
    });
  } catch (error) {
    console.error('[DISCOVER ERROR] Failed to fetch profiles:', error);
    return res.status(500).json({ error: 'Failed to fetch profiles: ' + error.message });
  }
});

// Get Full Profile
app.get('/api/profiles/:id', authenticateToken, async (req, res) => {
  try {
    const targetId = req.params.id;
    const currentUserId = req.user.id;

    // Check if blocked either way
    const isBlocked = await get(`
      SELECT 1 FROM blocks
      WHERE (blocker_id = ? AND blocked_id = ?)
         OR (blocker_id = ? AND blocked_id = ?)
    `, [currentUserId, targetId, targetId, currentUserId]);

    if (isBlocked) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const profile = await get(`
      SELECT id, name, gender, age, city, profile_photo, bio, interests, created_at
      FROM users WHERE id = ?
    `, [targetId]);

    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    return res.json({
      success: true,
      profile: {
        ...profile,
        interests: JSON.parse(profile.interests || '[]')
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch profile: ' + error.message });
  }
});

// --------------------------------------------------------------------------
// 3. CONVERSATIONS & DIRECT MESSAGING API (NO LIKES/MATCH GATES)
// --------------------------------------------------------------------------

// Helper to get or create a deterministic conversation ID
function getConversationId(u1, u2) {
  const sorted = [u1, u2].sort();
  return `conv_${sorted[0]}_${sorted[1]}`;
}

// Get All Active Conversations
app.get('/api/conversations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Fetch conversations where user is participant and neither participant has blocked the other
    const conversations = await all(`
      SELECT
        c.id as conversation_id,
        c.last_message_text,
        c.last_message_time,
        CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END as partner_id,
        u.name as partner_name,
        u.gender as partner_gender,
        u.age as partner_age,
        u.city as partner_city,
        u.profile_photo as partner_photo,
        (SELECT COUNT(*) FROM messages m
         WHERE m.conversation_id = c.id
           AND m.receiver_id = ?
           AND m.read_at IS NULL) as unread_count
      FROM conversations c
      JOIN users u ON u.id = (CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END)
      WHERE (c.user1_id = ? OR c.user2_id = ?)
        AND u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = ?)
        AND u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = ?)
      ORDER BY c.last_message_time DESC
    `, [userId, userId, userId, userId, userId, userId, userId]);

    return res.json({
      success: true,
      conversations
    });
  } catch (error) {
    console.error('[CONVERSATIONS ERROR]', error);
    return res.status(500).json({ error: 'Failed to fetch conversations: ' + error.message });
  }
});

// Get Messages in a Conversation
app.get('/api/conversations/:id/messages', authenticateToken, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userId = req.user.id;

    const conv = await get('SELECT * FROM conversations WHERE id = ?', [conversationId]);
    if (!conv || (conv.user1_id !== userId && conv.user2_id !== userId)) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const partnerId = conv.user1_id === userId ? conv.user2_id : conv.user1_id;

    // Verify block status
    const isBlocked = await get(`
      SELECT 1 FROM blocks
      WHERE (blocker_id = ? AND blocked_id = ?)
         OR (blocker_id = ? AND blocked_id = ?)
    `, [userId, partnerId, partnerId, userId]);

    if (isBlocked) {
      return res.status(403).json({ error: 'Conversation is inaccessible due to block' });
    }

    // Mark unread messages as read
    await run(`
      UPDATE messages
      SET read_at = CURRENT_TIMESTAMP
      WHERE conversation_id = ? AND receiver_id = ? AND read_at IS NULL
    `, [conversationId, userId]);

    const messages = await all(`
      SELECT id, conversation_id, sender_id, receiver_id, message_type, text, image_url, created_at, read_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `, [conversationId]);

    const partner = await get('SELECT id, name, gender, age, city, profile_photo FROM users WHERE id = ?', [partnerId]);

    return res.json({
      success: true,
      partner,
      messages
    });
  } catch (error) {
    console.error('[MESSAGES ERROR]', error);
    return res.status(500).json({ error: 'Failed to fetch messages: ' + error.message });
  }
});

// Send Message (Text or Photo)
app.post('/api/messages', authenticateToken, async (req, res) => {
  try {
    const senderId = req.user.id;
    const { receiverId, messageType, text, image } = req.body;

    if (!receiverId) {
      return res.status(400).json({ error: 'receiverId is required' });
    }

    if (senderId === receiverId) {
      return res.status(400).json({ error: 'Cannot send message to yourself' });
    }

    // STRICT BLOCK CHECK
    const isBlocked = await get(`
      SELECT 1 FROM blocks
      WHERE (blocker_id = ? AND blocked_id = ?)
         OR (blocker_id = ? AND blocked_id = ?)
    `, [senderId, receiverId, receiverId, senderId]);

    if (isBlocked) {
      return res.status(403).json({ error: 'Cannot send message: User has been blocked' });
    }

    const type = messageType === 'photo' ? 'photo' : 'text';
    const messageText = type === 'photo' ? (text || '📷 Sent a photo') : (text || '').trim();
    const imageUrl = type === 'photo' ? (image || '') : null;

    if (type === 'text' && !messageText) {
      return res.status(400).json({ error: 'Message text cannot be empty' });
    }

    const convId = getConversationId(senderId, receiverId);
    const sorted = [senderId, receiverId].sort();
    const user1 = sorted[0];
    const user2 = sorted[1];

    // Ensure conversation exists
    await run(`
      INSERT INTO conversations (id, user1_id, user2_id, last_message_text, last_message_time)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user1_id, user2_id) DO UPDATE SET
        last_message_text = excluded.last_message_text,
        last_message_time = CURRENT_TIMESTAMP
    `, [convId, user1, user2, messageText]);

    const msgId = generateId('msg');
    await run(`
      INSERT INTO messages (id, conversation_id, sender_id, receiver_id, message_type, text, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [msgId, convId, senderId, receiverId, type, messageText, imageUrl]);

    const insertedMessage = await get('SELECT * FROM messages WHERE id = ?', [msgId]);

    // Broadcast Real-time event via Socket.IO to receiver's room
    io.to(`user_${receiverId}`).emit('new_message', {
      message: insertedMessage,
      sender: {
        id: req.user.id,
        name: req.user.name,
        profile_photo: req.user.profile_photo
      }
    });

    return res.status(201).json({
      success: true,
      message: insertedMessage
    });
  } catch (error) {
    console.error('[SEND MESSAGE ERROR]', error);
    return res.status(500).json({ error: 'Failed to send message: ' + error.message });
  }
});

// --------------------------------------------------------------------------
// 4. STRICT BLOCK SYSTEM API (DATABASE ENFORCED)
// --------------------------------------------------------------------------

// Block a user
app.post('/api/blocks', authenticateToken, async (req, res) => {
  try {
    const blockerId = req.user.id;
    const { blockedId } = req.body;

    if (!blockedId) {
      return res.status(400).json({ error: 'blockedId is required' });
    }

    if (blockerId === blockedId) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }

    await run(`
      INSERT OR IGNORE INTO blocks (blocker_id, blocked_id)
      VALUES (?, ?)
    `, [blockerId, blockedId]);

    // Real-time notification to close any open active chat
    io.to(`user_${blockedId}`).emit('user_blocked', { blockerId });
    io.to(`user_${blockerId}`).emit('user_blocked', { blockedId });

    console.log(`[BLOCK] User ${blockerId} blocked ${blockedId}`);
    return res.json({
      success: true,
      message: 'User blocked successfully'
    });
  } catch (error) {
    console.error('[BLOCK ERROR]', error);
    return res.status(500).json({ error: 'Failed to block user: ' + error.message });
  }
});

// Unblock a user
app.delete('/api/blocks/:id', authenticateToken, async (req, res) => {
  try {
    const blockerId = req.user.id;
    const blockedId = req.params.id;

    await run(`
      DELETE FROM blocks
      WHERE blocker_id = ? AND blocked_id = ?
    `, [blockerId, blockedId]);

    console.log(`[UNBLOCK] User ${blockerId} unblocked ${blockedId}`);
    return res.json({
      success: true,
      message: 'User unblocked successfully'
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to unblock user: ' + error.message });
  }
});

// Get Blocked Users List
app.get('/api/blocks', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const blockedUsers = await all(`
      SELECT b.blocked_id as id, u.name, u.city, u.profile_photo, b.created_at as blocked_at
      FROM blocks b
      JOIN users u ON u.id = b.blocked_id
      WHERE b.blocker_id = ?
      ORDER BY b.created_at DESC
    `, [userId]);

    return res.json({
      success: true,
      blockedUsers
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch blocked users: ' + error.message });
  }
});

// --------------------------------------------------------------------------
// 5. SOCKET.IO REAL-TIME COMMUNICATION
// --------------------------------------------------------------------------
io.on('connection', (socket) => {
  console.log(`[SOCKET CONNECT] ${socket.id}`);

  socket.on('identify', (userId) => {
    if (userId) {
      const cleanId = String(userId).trim();
      socket.userId = cleanId;
      socket.join(`user_${cleanId}`);
      console.log(`[SOCKET IDENTIFY] User ${cleanId} joined room user_${cleanId}`);
    }
  });

  socket.on('typing', ({ receiverId, isTyping }) => {
    if (socket.userId && receiverId) {
      io.to(`user_${receiverId}`).emit('partner_typing', {
        senderId: socket.userId,
        isTyping: !!isTyping
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`[SOCKET DISCONNECT] ${socket.id} (${socket.userId || 'guest'})`);
  });
});

// Start Server
initDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`  CONNECT BACKEND SERVER RUNNING         `);
    console.log(`  Port: ${PORT} | Env: ${NODE_ENV}       `);
    console.log(`=========================================`);
  });
}).catch((err) => {
  console.error('[DB FATAL] Failed to initialize database:', err);
  process.exit(1);
});
