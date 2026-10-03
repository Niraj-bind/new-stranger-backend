const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'connect.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[DB] Failed to connect to SQLite database:', err.message);
  } else {
    console.log('[DB] Connected to SQLite database at:', DB_PATH);
  }
});

// Helper for promise-based queries
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// Initialize tables
async function initDatabase() {
  // 1. Users Table
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      gender TEXT NOT NULL,
      age INTEGER NOT NULL,
      city TEXT NOT NULL,
      profile_photo TEXT,
      bio TEXT,
      interests TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Conversations Table
  await run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user1_id TEXT NOT NULL,
      user2_id TEXT NOT NULL,
      last_message_text TEXT,
      last_message_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user1_id, user2_id)
    )
  `);

  // 3. Messages Table
  await run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      receiver_id TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text',
      text TEXT,
      image_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      read_at DATETIME,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id)
    )
  `);

  // 4. Blocks Table (STRICT BLOCK SYSTEM)
  await run(`
    CREATE TABLE IF NOT EXISTS blocks (
      blocker_id TEXT NOT NULL,
      blocked_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (blocker_id, blocked_id)
    )
  `);

  console.log('[DB] All tables initialized successfully.');
  await seedInitialProfilesIfEmpty();
}

// Seed realistic profile discovery items so the app is immediately alive and discoverable for both Male & Female users
async function seedInitialProfilesIfEmpty() {
  const row = await get('SELECT COUNT(*) as count FROM users');
  if (row && row.count > 0) return;

  console.log('[DB] Seeding initial discovery profiles...');
  const bcrypt = require('bcryptjs');
  const dummyPasswordHash = await bcrypt.hash('connect123', 10);

  const initialProfiles = [
    // Female Profiles
    {
      id: 'usr_fem_01',
      username: 'priya_delhi',
      name: 'Priya Sharma',
      gender: 'Female',
      age: 24,
      city: 'Delhi',
      bio: 'Coffee lover, wanderer, and music enthusiast. Looking for genuine conversations and good vibes ✨',
      interests: JSON.stringify(['Coffee', 'Music', 'Travel', 'Photography']),
      profile_photo: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=600&auto=format&fit=crop&q=80'
    },
    {
      id: 'usr_fem_02',
      username: 'anjali_chd',
      name: 'Anjali Verma',
      gender: 'Female',
      age: 25,
      city: 'Chandigarh',
      bio: 'Architect by day, painter by night. Tell me your favorite travel destination! 🎨',
      interests: JSON.stringify(['Art', 'Architecture', 'Travel', 'Books']),
      profile_photo: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&auto=format&fit=crop&q=80'
    },
    {
      id: 'usr_fem_03',
      username: 'neha_jaipur',
      name: 'Neha Kapoor',
      gender: 'Female',
      age: 22,
      city: 'Jaipur',
      bio: 'Loves traditional crafts, indie cinema, and evening walks in the pink city 🌸',
      interests: JSON.stringify(['Movies', 'Food', 'Culture', 'Music']),
      profile_photo: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=600&auto=format&fit=crop&q=80'
    },
    {
      id: 'usr_fem_04',
      username: 'riya_noida',
      name: 'Riya Sen',
      gender: 'Female',
      age: 27,
      city: 'Noida',
      bio: 'Tech enthusiast, yoga practitioner, and foodie. Let’s connect and talk about life.',
      interests: JSON.stringify(['Tech', 'Fitness', 'Yoga', 'Food']),
      profile_photo: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=600&auto=format&fit=crop&q=80'
    },
    {
      id: 'usr_fem_05',
      username: 'sneha_mumbai',
      name: 'Sneha Patel',
      gender: 'Female',
      age: 26,
      city: 'Mumbai',
      bio: 'Marine Drive sunsets & chai. Passionate about photography & storytelling 📸',
      interests: JSON.stringify(['Photography', 'Sunsets', 'Chai', 'Travel']),
      profile_photo: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=600&auto=format&fit=crop&q=80'
    },
    {
      id: 'usr_fem_06',
      username: 'pooja_bangalore',
      name: 'Pooja Nair',
      gender: 'Female',
      age: 23,
      city: 'Bengaluru',
      bio: 'Product designer living between filter coffee and road trips ☕🚗',
      interests: JSON.stringify(['Design', 'Coffee', 'Road Trips', 'Music']),
      profile_photo: 'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=600&auto=format&fit=crop&q=80'
    },

    // Male Profiles
    {
      id: 'usr_male_01',
      username: 'rohit_mumbai',
      name: 'Rohit Mehta',
      gender: 'Male',
      age: 26,
      city: 'Mumbai',
      bio: 'Software engineer who loves weekend trekking, acoustic guitar & indie music 🎸',
      interests: JSON.stringify(['Trekking', 'Guitar', 'Coding', 'Music']),
      profile_photo: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=600&auto=format&fit=crop&q=80'
    },
    {
      id: 'usr_male_02',
      username: 'arjun_delhi',
      name: 'Arjun Malhotra',
      gender: 'Male',
      age: 28,
      city: 'Delhi',
      bio: 'Fitness fanatic, foodie, and entrepreneur. Let’s grab a cup of coffee and talk business & dreams ☕',
      interests: JSON.stringify(['Fitness', 'Coffee', 'Business', 'Travel']),
      profile_photo: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=600&auto=format&fit=crop&q=80'
    },
    {
      id: 'usr_male_03',
      username: 'vikram_pune',
      name: 'Vikram Joshi',
      gender: 'Male',
      age: 25,
      city: 'Pune',
      bio: 'Passionate about photography, mountain roads, and deep conversations 🏔️',
      interests: JSON.stringify(['Photography', 'Mountains', 'Biking', 'Art']),
      profile_photo: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=600&auto=format&fit=crop&q=80'
    },
    {
      id: 'usr_male_04',
      username: 'sameer_kolkata',
      name: 'Sameer Das',
      gender: 'Male',
      age: 27,
      city: 'Kolkata',
      bio: 'Writer, book lover, and cafe explorer. Always up for engaging discussions on literature & art.',
      interests: JSON.stringify(['Books', 'Writing', 'Art', 'Coffee']),
      profile_photo: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=600&auto=format&fit=crop&q=80'
    },
    {
      id: 'usr_male_05',
      username: 'karan_hyd',
      name: 'Karan Reddy',
      gender: 'Male',
      age: 24,
      city: 'Hyderabad',
      bio: 'Tech enthusiast, badminton player & traveler. Searching for meaningful social connections 🏸',
      interests: JSON.stringify(['Badminton', 'Tech', 'Travel', 'Gaming']),
      profile_photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&auto=format&fit=crop&q=80'
    }
  ];

  for (const p of initialProfiles) {
    await run(
      `INSERT INTO users (id, username, password_hash, name, gender, age, city, bio, interests, profile_photo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.id, p.username, dummyPasswordHash, p.name, p.gender, p.age, p.city, p.bio, p.interests, p.profile_photo]
    );
  }
  console.log('[DB] Seeded initial discovery profiles successfully.');
}

module.exports = {
  db,
  run,
  get,
  all,
  initDatabase
};
