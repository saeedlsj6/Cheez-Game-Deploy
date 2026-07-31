const express = require('express');
const http = require('http');
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const DB_FILE = path.join(__dirname, 'cheez-db.json');

const SHOP_ITEMS = {
  cardBacks: [
    { id: 'classic', name: 'كلاسيكي', price: 0, pattern: '🧀', desc: 'التصميم الافتراضي' },
    { id: 'gold', name: 'ذهبي', price: 200, pattern: '👑', desc: 'أوراق ذهبية فاخرة' },
    { id: 'diamond', name: 'ألماس', price: 500, pattern: '💎', desc: 'تصميم ماسي لامع' },
    { id: 'fire', name: 'نار', price: 300, pattern: '🔥', desc: 'أوراق مشتعلة' },
    { id: 'royal', name: 'ملكي', price: 800, pattern: '⚜️', desc: 'تصميم القصور الملكية' },
    { id: 'arabic', name: 'عربي', price: 400, pattern: '🌙', desc: 'زخارف عربية أصيلة' }
  ],
  tables: [
    { id: 'green', name: 'أخضر كلاسيكي', price: 0, desc: 'طاولة كازينو الخضراء' },
    { id: 'wood', name: 'خشبي', price: 250, desc: 'طاولة خشب فاخرة' },
    { id: 'marble', name: 'رخامي', price: 600, desc: 'أرضية رخام أنيقة' },
    { id: 'night', name: 'ليلي', price: 400, desc: 'خلفية ليلية نجمية' },
    { id: 'goldtable', name: 'ذهبي', price: 1000, desc: 'طاولة ملكية ذهبية' },
    { id: 'ocean', name: 'محيط', price: 450, desc: 'أزرق المحيط الهادئ' }
  ]
};

const ONLINE_USERS = new Map();

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch(e) {}
  return { users: [], nextId: 1 };
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let db = loadDB();
if (!db.users) db = { users: [], nextId: 1 };

for (const u of db.users) {
  if (!u.coins) u.coins = 50;
  if (!u.friends) u.friends = [];
  if (!u.friendRequests) u.friendRequests = [];
  if (!u.owned) u.owned = { cardBacks: ['classic'], tables: ['green'] };
  if (!u.equipped) u.equipped = { cardBack: 'classic', table: 'green' };
  if (!u.invites) u.invites = [];
}
saveDB(db);

const userDB = {
  findByUsername: (u) => db.users.find(x => x.username.toLowerCase() === u.toLowerCase()),
  findById: (id) => db.users.find(x => x.id === id),
  create: (data) => {
    const user = {
      id: db.nextId++,
      username: data.username,
      password: data.password,
      profile_pic: 'default.png',
      cheez_count: 0,
      wins: 0,
      losses: 0,
      games_played: 0,
      total_points: 0,
      coins: 50,
      friends: [],
      friendRequests: [],
      owned: { cardBacks: ['classic'], tables: ['green'] },
      equipped: { cardBack: 'classic', table: 'green' },
      invites: [],
      ...data
    };
    db.users.push(user);
    saveDB(db);
    return user;
  },
  update: (id, updates) => {
    const idx = db.users.findIndex(x => x.id === id);
    if (idx >= 0) {
      db.users[idx] = { ...db.users[idx], ...updates };
      saveDB(db);
      return db.users[idx];
    }
    return null;
  },
  updateIncrement: (id, fields) => {
    const idx = db.users.findIndex(x => x.id === id);
    if (idx >= 0) {
      for (const [k, v] of Object.entries(fields)) {
        db.users[idx][k] = (db.users[idx][k] || 0) + v;
      }
      saveDB(db);
      return db.users[idx];
    }
    return null;
  },
  topWinners: (limit = 10) => [...db.users].sort((a,b) => (b.wins||0) - (a.wins||0)).slice(0, limit),
  publicUser: (u) => ({
    id: u.id, username: u.username, profile_pic: u.profile_pic,
    wins: u.wins || 0, losses: u.losses || 0, coins: u.coins || 0,
    cheez_count: u.cheez_count || 0, games_played: u.games_played || 0,
    online: ONLINE_USERS.has(u.id)
  })
};

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage, limits: { fileSize: 2 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/shop/items', (req, res) => {
  res.json(SHOP_ITEMS);
});

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ error: 'جميع الحقول مطلوبة' });
  if (!/^[a-zA-Z]{2,}$/.test(username)) return res.json({ error: 'اليوزر يجب أن يكون حرفين انجليزي على الأقل' });
  if (password.length < 4) return res.json({ error: 'كلمة المرور 4 أحرف على الأقل' });
  
  const exists = userDB.findByUsername(username);
  if (exists) return res.json({ error: 'اليوزر موجود مسبقاً' });
  
  const hash = bcrypt.hashSync(password, 10);
  const user = userDB.create({ username, password: hash });
  res.json({
    success: true,
    user: {
      id: user.id, username: user.username, profile_pic: 'default.png',
      coins: user.coins, owned: user.owned, equipped: user.equipped
    }
  });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ error: 'جميع الحقول مطلوبة' });
  
  const user = userDB.findByUsername(username);
  if (!user) return res.json({ error: 'اليوزر غير موجود' });
  if (!bcrypt.compareSync(password, user.password)) return res.json({ error: 'كلمة المرور خاطئة' });
  
  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      profile_pic: user.profile_pic,
      cheez_count: user.cheez_count || 0,
      wins: user.wins || 0,
      losses: user.losses || 0,
      games_played: user.games_played || 0,
      total_points: user.total_points || 0,
      coins: user.coins || 0,
      owned: user.owned || { cardBacks: ['classic'], tables: ['green'] },
      equipped: user.equipped || { cardBack: 'classic', table: 'green' }
    }
  });
});

app.post('/api/upload-pic', upload.single('pic'), (req, res) => {
  const { userId } = req.body;
  if (!req.file || !userId) return res.json({ error: 'بيانات غير كاملة' });
  userDB.update(parseInt(userId), { profile_pic: req.file.filename });
  res.json({ success: true, filename: req.file.filename });
});

app.get('/api/user/:id', (req, res) => {
  const u = userDB.findById(parseInt(req.params.id));
  if (!u) return res.json({ error: 'مستخدم غير موجود' });
  const user = {
    id: u.id, username: u.username, profile_pic: u.profile_pic,
    cheez_count: u.cheez_count || 0, wins: u.wins || 0,
    losses: u.losses || 0, games_played: u.games_played || 0,
    total_points: u.total_points || 0, coins: u.coins || 0,
    owned: u.owned, equipped: u.equipped, friends: u.friends,
    friendRequests: u.friendRequests
  };
  
  let achievements = [];
  if (user.games_played >= 3) {
    if (user.cheez_count >= 3 && user.losses >= user.wins * 2) achievements.push({ id: 'nakba', name: 'النكبة', desc: 'تقول تشيز وتخسر دايم', icon: '💀' });
    if (user.wins >= 5 && user.wins > user.losses * 2) achievements.push({ id: 'double', name: 'دبل جبن', desc: 'تفوز دايم', icon: '🧀' });
    if (user.games_played >= 3 && user.cheez_count === 0) achievements.push({ id: 'khawaf', name: 'الخواف', desc: 'مايسوي شي', icon: '🐔' });
  }
  user.achievements = achievements;
  res.json(user);
});

app.get('/api/leaderboard', (req, res) => {
  const rows = userDB.topWinners(10).map(u => ({
    id: u.id, username: u.username, profile_pic: u.profile_pic,
    wins: u.wins || 0, cheez_count: u.cheez_count || 0, games_played: u.games_played || 0,
    online: ONLINE_USERS.has(u.id)
  }));
  res.json(rows);
});

app.post('/api/friends/add', (req, res) => {
  const { myId, friendUsername } = req.body;
  const me = userDB.findById(parseInt(myId));
  const fr = userDB.findByUsername(friendUsername);
  if (!me || !fr) return res.json({ error: 'يوزر غير موجود' });
  if (me.id === fr.id) return res.json({ error: 'لا تضيف نفسك 😄' });
  if (me.friends.includes(fr.id)) return res.json({ error: 'هو بالفعل صديقك' });
  if (me.friendRequests.find(r => r.from === fr.id)) {
    // قبول تلقائي لو هو أرسل طلب لي
    me.friends.push(fr.id);
    fr.friends.push(me.id);
    me.friendRequests = me.friendRequests.filter(r => r.from !== fr.id);
    saveDB(db);
    notifyUser(fr.id, 'friend-accepted', me);
    return res.json({ success: true, added: true });
  }
  if (fr.friendRequests.find(r => r.from === me.id)) return res.json({ error: 'الطلب أرسل مسبقاً' });
  fr.friendRequests.push({ from: me.id, fromName: me.username, time: Date.now() });
  saveDB(db);
  notifyUser(fr.id, 'friend-request', { id: me.id, username: me.username, profile_pic: me.profile_pic });
  res.json({ success: true, sent: true });
});

app.post('/api/friends/accept', (req, res) => {
  const { myId, friendId } = req.body;
  const me = userDB.findById(parseInt(myId));
  const fr = userDB.findById(parseInt(friendId));
  if (!me || !fr) return res.json({ error: 'خطأ' });
  me.friendRequests = me.friendRequests.filter(r => r.from !== fr.id);
  if (!me.friends.includes(fr.id)) me.friends.push(fr.id);
  if (!fr.friends.includes(me.id)) fr.friends.push(me.id);
  saveDB(db);
  notifyUser(fr.id, 'friend-accepted', me);
  res.json({ success: true });
});

app.post('/api/friends/reject', (req, res) => {
  const { myId, friendId } = req.body;
  const me = userDB.findById(parseInt(myId));
  if (!me) return res.json({ error: 'خطأ' });
  me.friendRequests = me.friendRequests.filter(r => r.from !== parseInt(friendId));
  saveDB(db);
  res.json({ success: true });
});

app.post('/api/friends/remove', (req, res) => {
  const { myId, friendId } = req.body;
  const me = userDB.findById(parseInt(myId));
  const fr = userDB.findById(parseInt(friendId));
  if (!me) return res.json({ error: 'خطأ' });
  me.friends = me.friends.filter(x => x !== parseInt(friendId));
  if (fr) fr.friends = fr.friends.filter(x => x !== parseInt(myId));
  saveDB(db);
  res.json({ success: true });
});

app.get('/api/friends/list/:myId', (req, res) => {
  const me = userDB.findById(parseInt(req.params.myId));
  if (!me) return res.json([]);
  const list = me.friends.map(fid => {
    const u = userDB.findById(fid);
    return u ? userDB.publicUser(u) : null;
  }).filter(Boolean);
  const requests = me.friendRequests.map(r => {
    const u = userDB.findById(r.from);
    return u ? { id: u.id, username: u.username, profile_pic: u.profile_pic } : null;
  }).filter(Boolean);
  res.json({ friends: list, requests });
});

app.post('/api/shop/buy', (req, res) => {
  const { userId, type, itemId } = req.body;
  const u = userDB.findById(parseInt(userId));
  if (!u) return res.json({ error: 'خطأ' });
  const list = type === 'cardBack' ? SHOP_ITEMS.cardBacks : SHOP_ITEMS.tables;
  const item = list.find(x => x.id === itemId);
  if (!item) return res.json({ error: 'عنصر غير موجود' });
  const ownedKey = type === 'cardBack' ? 'cardBacks' : 'tables';
  if (u.owned[ownedKey].includes(itemId)) return res.json({ error: 'عندك هذا العنصر بالفعل' });
  if (u.coins < item.price) return res.json({ error: 'ذهب غير كافي' });
  u.coins -= item.price;
  u.owned[ownedKey].push(itemId);
  saveDB(db);
  res.json({ success: true, coins: u.coins, owned: u.owned });
});

app.post('/api/shop/equip', (req, res) => {
  const { userId, type, itemId } = req.body;
  const u = userDB.findById(parseInt(userId));
  if (!u) return res.json({ error: 'خطأ' });
  const ownedKey = type === 'cardBack' ? 'cardBacks' : 'tables';
  if (!u.owned[ownedKey].includes(itemId)) return res.json({ error: 'العنصر غير مملوك' });
  if (type === 'cardBack') u.equipped.cardBack = itemId;
  else u.equipped.table = itemId;
  saveDB(db);
  res.json({ success: true, equipped: u.equipped });
});

const ADMIN_SECRET = '909';
app.post('/api/admin/add-coins', (req, res) => {
  const { username, secret, amount } = req.body;
  if (!secret || String(secret) !== ADMIN_SECRET) return res.json({ error: 'رقم سري خاطئ' });
  const amt = parseInt(amount) || 0;
  if (amt <= 0 || !Number.isFinite(amt)) return res.json({ error: 'عدد العملات غير صحيح' });
  const u = userDB.findByUsername(username);
  if (!u) return res.json({ error: 'اليوزر غير موجود' });
  userDB.updateIncrement(u.id, { coins: amt });
  res.json({ success: true, username: u.username, newCoins: (u.coins || 0) + amt });
});

function notifyUser(userId, event, data) {
  const sId = ONLINE_USERS.get(userId);
  if (sId) io.to(sId).emit(event, data);
}

const rooms = new Map();
let aiCounter = 0;

const AI_NAMES = [
  { username: 'جبن_الكعك', pic: '🤖' },
  { username: 'تشيز_الأزرق', pic: '🧀' },
  { username: 'ملوك_الورق', pic: '👑' },
  { username: 'النمر_الأصفر', pic: '🐆' },
  { username: 'الذكاء_الخارق', pic: '🧠' },
  { username: 'مستر_الاناقة', pic: '🎩' },
  { username: 'المجنون_الصغير', pic: '🦊' }
];

function createAIPlayer() {
  const info = AI_NAMES[aiCounter % AI_NAMES.length];
  aiCounter++;
  const fakeId = 900000 + aiCounter;
  const fakePic = `ai_${aiCounter}.svg`;
  const picData = `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><circle cx="25" cy="25" r="25" fill="#${['e7c36a','148550','c0392b','8e44ad','2980b9','d35400'][aiCounter%6]}"/><text x="25" y="34" font-size="26" text-anchor="middle">${info.pic}</text></svg>`).toString('base64')}`;
  return {
    id: fakeId,
    socketId: null,
    username: info.username,
    profile_pic: picData,
    cards: [],
    isHost: false,
    isAI: true,
    hasSeenInitial: true,
    memory: { knownCards: {}, seenOpponent: {}, gameHistory: [] }
  };
}

function aiKnownTotal(player) {
  let sum = 0, unknown = 0;
  for (let i = 0; i < 4; i++) {
    const c = player.cards[i];
    if (!c) continue;
    const known = player.memory.knownCards[i];
    if (known) sum += cardValue(known);
    else { sum += 6; unknown++; }
  }
  return { sum, unknown };
}

function findHighestCardIndex(player) {
  let idx = -1, maxVal = -1;
  for (let i = 0; i < 4; i++) {
    const c = player.cards[i];
    if (!c) continue;
    const known = player.memory.knownCards[i];
    const v = known ? cardValue(known) : 6;
    if (v > maxVal) { maxVal = v; idx = i; }
  }
  return idx;
}

function findLowestCardIndex(player) {
  let idx = -1, minVal = 99;
  for (let i = 0; i < 4; i++) {
    const c = player.cards[i];
    if (!c) continue;
    const known = player.memory.knownCards[i];
    const v = known ? cardValue(known) : 6;
    if (v < minVal) { minVal = v; idx = i; }
  }
  return idx;
}

function createDeck() {
  const suits = ['♠', '♣', '♥', '♦'];
  const values = [
    { v: 'A', label: 'A' },
    { v: '2', label: '2' },
    { v: '3', label: '3' },
    { v: '4', label: '4' },
    { v: '5', label: '5' },
    { v: '6', label: '6' },
    { v: '7', label: '7' },
    { v: '8', label: '8' },
    { v: '9', label: '9' },
    { v: '10', label: '10' },
    { v: 'J', label: 'J' },
    { v: 'Q', label: 'Q' },
    { v: 'K', label: 'K' }
  ];
  const deck = [];
  for (let d = 0; d < 2; d++) {
    for (const s of suits) {
      for (const v of values) {
        deck.push({
          suit: s, value: v.v, id: Math.random().toString(36).slice(2),
          isFace: ['J','Q','K'].includes(v.v)
        });
      }
    }
  }
  const jokers = [
    { suit: '🃏', value: 'JOKER', id: Math.random().toString(36).slice(2), isFace: true, isJoker: true },
    { suit: '🃏', value: 'JOKER', id: Math.random().toString(36).slice(2), isFace: true, isJoker: true }
  ];
  for (const j of jokers) deck.push(j);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(card) {
  if (!card) return 0;
  if (card.isJoker) return -1;
  if (card.value === 'A') return 1;
  if (card.value === 'J') return 11;
  if (card.value === 'Q') return 12;
  if (card.value === 'K') return (card.suit === '♥' || card.suit === '♦') ? 13 : 0;
  return parseInt(card.value);
}

function publicPlayer(player) {
  return {
    id: player.id,
    username: player.username,
    profile_pic: player.profile_pic,
    cardsCount: player.cards.filter(c => c).length,
    isHost: player.isHost
  };
}

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUser = null;

  socket.on('join-lobby', (user) => {
    currentUser = user;
    ONLINE_USERS.set(user.id, socket.id);
    io.emit('user-online', { id: user.id, online: true });
    const roomList = [];
    for (const [id, room] of rooms) {
      if (!room.gameStarted) {
        roomList.push({
          id, name: room.name, host: room.host.username,
          players: room.players.map(publicPlayer),
          maxPlayers: room.maxPlayers, hasPassword: !!room.password
        });
      }
    }
    socket.emit('lobby-rooms', roomList);
    io.emit('lobby-update', roomList);
  });

  socket.on('invite-friend', ({ friendId, roomId, roomName, password }) => {
    if (!currentUser) return;
    const fr = userDB.findById(parseInt(friendId));
    if (!fr) return;
    const room = rooms.get(roomId);
    notifyUser(friendId, 'room-invite', {
      fromId: currentUser.id, fromName: currentUser.username,
      fromPic: currentUser.profile_pic,
      roomId, roomName: room?.name || roomName,
      hasPassword: !!(room?.password || password),
      roomPassword: room?.password || password || null,
      time: Date.now()
    });
  });

  socket.on('create-room', ({ name, password, maxPlayers, user }) => {
    currentUser = user;
    const roomId = Math.random().toString(36).slice(2, 8);
    const player = {
      id: user.id, socketId: socket.id, username: user.username,
      profile_pic: user.profile_pic, cards: [], isHost: true,
      hasSeenInitial: false
    };
    rooms.set(roomId, {
      id: roomId, name, password: password || null,
      maxPlayers: Math.min(8, Math.max(2, maxPlayers || 4)),
      host: player, players: [player],
      deck: [], discard: [], gameStarted: false,
      currentTurn: 0, cheezDeclarer: null,
      finalRound: false, roundEnded: false,
      burnState: null, actionState: null
    });
    currentRoom = roomId;
    socket.join(roomId);
    socket.emit('room-joined', { roomId, players: rooms.get(roomId).players.map(publicPlayer), isHost: true, config: rooms.get(roomId) });
    broadcastRoomList();
  });

  socket.on('join-room', ({ roomId, password, user }) => {
    currentUser = user;
    const room = rooms.get(roomId);
    if (!room) return socket.emit('error-msg', 'الغرفة غير موجودة');
    if (room.gameStarted) return socket.emit('error-msg', 'اللعبة بدأت');
    if (room.players.length >= room.maxPlayers) return socket.emit('error-msg', 'الغرفة ممتلئة');
    if (room.password && room.password !== password) return socket.emit('error-msg', 'كلمة المرور خاطئة');
    
    const player = {
      id: user.id, socketId: socket.id, username: user.username,
      profile_pic: user.profile_pic, cards: [], isHost: false,
      hasSeenInitial: false
    };
    room.players.push(player);
    currentRoom = roomId;
    socket.join(roomId);
    
    const playersInfo = room.players.map(publicPlayer);
    socket.emit('room-joined', { roomId, players: playersInfo, isHost: false, config: room });
    io.to(roomId).emit('player-joined', playersInfo);
    broadcastRoomList();
  });

  socket.on('leave-room', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) { currentRoom = null; return; }
    
    room.players = room.players.filter(p => p.socketId !== socket.id);
    
    if (room.players.length === 0) {
      rooms.delete(currentRoom);
    } else {
      if (room.host.socketId === socket.id) {
        const nonAI = room.players.find(p => !p.isAI);
        room.host = nonAI || room.players[0];
        room.host.isHost = true;
        room.host.socketId = room.host.socketId;
      }
      if (room.gameStarted) {
        io.to(currentRoom).emit('player-left', room.players.map(publicPlayer));
      } else {
        io.to(currentRoom).emit('player-joined', room.players.map(publicPlayer));
      }
    }
    currentRoom = null;
    socket.leave(currentRoom || '');
    broadcastRoomList();
  });

  socket.on('add-ai', () => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    const requester = room.players.find(p => p.socketId === socket.id);
    if (!requester || !requester.isHost) return socket.emit('error-msg', 'فقط المضيف يضيف AI');
    if (room.gameStarted) return socket.emit('error-msg', 'اللعبة بدأت');
    if (room.players.length >= room.maxPlayers) return socket.emit('error-msg', 'الغرفة ممتلئة');
    
    const ai = createAIPlayer();
    room.players.push(ai);
    
    io.to(currentRoom).emit('player-joined', room.players.map(publicPlayer));
    io.to(currentRoom).emit('chat-message', { username: 'النظام', text: `🤖 تمت إضافة ${ai.username} كـ لاعب AI`, time: Date.now(), isSys: true });
    broadcastRoomList();
  });

  socket.on('remove-ai', ({ aiId }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    const requester = room.players.find(p => p.socketId === socket.id);
    if (!requester || !requester.isHost) return socket.emit('error-msg', 'فقط المضيف يزيل AI');
    if (room.gameStarted) return socket.emit('error-msg', 'اللعبة بدأت');
    
    room.players = room.players.filter(p => p.id !== aiId);
    io.to(currentRoom).emit('player-joined', room.players.map(publicPlayer));
    broadcastRoomList();
  });

  socket.on('start-game', () => {
    const room = rooms.get(currentRoom);
    if (!room || !room.players.find(p => p.socketId === socket.id)?.isHost) return;
    if (room.players.length < 2) return socket.emit('error-msg', 'لازم لاعبين على الأقل');
    
    room.deck = createDeck();
    room.discard = [];
    room.gameStarted = true;
    room.currentTurn = Math.floor(Math.random() * room.players.length);
    room.cheezDeclarer = null;
    room.finalRound = false;
    room.roundEnded = false;
    room.burnState = null;
    room.actionState = null;
    
    for (const p of room.players) {
      p.cards = [];
      for (let i = 0; i < 4; i++) p.cards.push(room.deck.pop());
      p.hasSeenInitial = false;
      if (p.isAI) {
        p.memory = { knownCards: {}, seenOpponent: {}, gameHistory: [] };
        const a = Math.floor(Math.random() * 4);
        let b = Math.floor(Math.random() * 4);
        while (b === a) b = Math.floor(Math.random() * 4);
        p.memory.knownCards[a] = p.cards[a];
        p.memory.knownCards[b] = p.cards[b];
        p.hasSeenInitial = true;
      }
    }
    
    io.to(currentRoom).emit('game-started', {
      players: room.players.map(publicPlayer),
      currentTurn: room.currentTurn,
      deckCount: room.deck.length,
      discardCount: room.discard.length
    });
    
    for (const p of room.players) {
      if (!p.isAI) io.to(p.socketId).emit('initial-cards', { cards: p.cards.map((c, i) => ({ index: i, id: c.id })) });
    }
    
    broadcastRoomList();
    
    setTimeout(() => doAITurnIfNeeded(room), 1500);
  });

  socket.on('peek-initial', ({ indices }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || player.hasSeenInitial) return;
    
    const revealed = indices.slice(0, 2).map(i => ({ index: i, card: player.cards[i] }));
    socket.emit('initial-peek', revealed);
  });

  function emitDeckCount(room) {
    if (!room) return;
    io.to(room.id).emit('deck-count', { deck: room.deck.length, discard: room.discard.length });
  }

  socket.on('draw-card', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.roundEnded) return;
    const player = room.players[room.currentTurn];
    if (!player || player.socketId !== socket.id) return;
    if (room.actionState || room.burnState) return;
    
    if (room.deck.length === 0) {
      const top = room.discard.pop();
      room.deck = room.discard.reverse();
      room.discard = top ? [top] : [];
    }
    
    const card = room.deck.pop();
    socket.emit('card-drawn', card);
    emitDeckCount(room);
  });

  socket.on('replace-card', ({ cardIndex, drawnCard }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.roundEnded) return;
    if (room.burnState) return;
    const player = room.players[room.currentTurn];
    if (!player || player.socketId !== socket.id) return;
    if (!drawnCard) return;
    
    const oldCard = player.cards[cardIndex];
    player.cards[cardIndex] = drawnCard;
    room.discard.push(oldCard);
    
    io.to(currentRoom).emit('card-replaced', {
      playerId: player.id, cardIndex, discard: oldCard
    });
    
    emitDeckCount(room);
    endTurn(room);
  });

  socket.on('discard-card', ({ card }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.roundEnded) return;
    const player = room.players[room.currentTurn];
    if (!player || player.socketId !== socket.id) return;
    if (!card) return;
    if (room.burnState) return;
    
    room.discard.push(card);
    io.to(currentRoom).emit('card-discarded', { playerId: player.id, card });
    
    emitDeckCount(room);
    const isAction = ['7', '8', '10'].includes(card.value);
    if (isAction) {
      room.actionState = { card: card, playerId: player.id };
      if (card.value === '7') {
        socket.emit('action-7-prompt');
      } else if (card.value === '8') {
        socket.emit('action-8-prompt', {
          players: room.players.filter(p => p.id !== player.id).map(p => ({ id: p.id, username: p.username }))
        });
      } else if (card.value === '10') {
        socket.emit('action-10-prompt', {
          players: room.players.filter(p => p.id !== player.id).map(p => ({ id: p.id, username: p.username }))
        });
      }
    } else {
      room.burnState = {
        value: card.value,
        initiatorId: player.id,
        burners: new Set()
      };
      io.to(currentRoom).emit('burn-start', { value: card.value, initiatorId: player.id });
      
      setTimeout(() => {
        if (room.burnState) {
          room.burnState = null;
          io.to(currentRoom).emit('burn-end');
          endTurn(room);
        }
      }, 10000);
    }
  });

  socket.on('action-7-execute', ({ cardIndex }) => {
    const room = rooms.get(currentRoom);
    if (!room || !room.actionState || room.actionState.card.value !== '7') return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || player.id !== room.actionState.playerId) return;
    
    const card = player.cards[cardIndex];
    socket.emit('action-7-result', { cardIndex, card });
    room.actionState = null;
    endTurn(room);
  });

  socket.on('action-8-execute', ({ targetId, cardIndex }) => {
    const room = rooms.get(currentRoom);
    if (!room || !room.actionState || room.actionState.card.value !== '8') return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || player.id !== room.actionState.playerId) return;
    
    const target = room.players.find(p => p.id === targetId);
    if (!target) return;
    
    const card = target.cards[cardIndex];
    socket.emit('action-8-result', { targetId, cardIndex, card });
    room.actionState = null;
    endTurn(room);
  });

  socket.on('action-10-execute', ({ myCardIndex, targetId, targetCardIndex }) => {
    const room = rooms.get(currentRoom);
    if (!room || !room.actionState || room.actionState.card.value !== '10') return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || player.id !== room.actionState.playerId) return;
    
    const target = room.players.find(p => p.id === targetId);
    if (!target) return;
    
    const temp = player.cards[myCardIndex];
    player.cards[myCardIndex] = target.cards[targetCardIndex];
    target.cards[targetCardIndex] = temp;
    
    socket.emit('action-10-done');
    io.to(currentRoom).emit('action-10-notify', { playerId: player.id, targetId });
    room.actionState = null;
    endTurn(room);
  });

  socket.on('burn-attempt', ({ cardIndex }) => {
    const room = rooms.get(currentRoom);
    if (!room || !room.burnState) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;
    if (player.id === room.burnState.initiatorId) return;
    if (room.burnState.burners.has(player.id)) return;
    
    room.burnState.burners.add(player.id);
    const card = player.cards[cardIndex];
    if (!card) return;
    
    if (card.value === room.burnState.value) {
      player.cards[cardIndex] = null;
      room.discard.push(card);
      io.to(currentRoom).emit('burn-success', {
        playerId: player.id, cardIndex, card,
        remaining: player.cards.filter(c => c).length
      });
      emitDeckCount(room);
    } else {
      io.to(currentRoom).emit('burn-fail', {
        playerId: player.id, cardIndex, card
      });
    }
  });

  socket.on('declare-cheez', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.roundEnded || room.finalRound) return;
    const player = room.players[room.currentTurn];
    if (!player || player.socketId !== socket.id) return;
    if (room.actionState || room.burnState) return;
    
    room.cheezDeclarer = player.id;
    room.finalRound = true;
    room.finalRoundCount = room.players.length - 1;
    
    if (player.id < 900000) userDB.updateIncrement(player.id, { cheez_count: 1 });
    
    io.to(currentRoom).emit('cheez-declared', { playerId: player.id });
  });

  function doAITurnIfNeeded(room) {
    if (!room || room.roundEnded || !room.gameStarted) return;
    const player = room.players[room.currentTurn];
    if (!player || !player.isAI) return;
    if (room.actionState || room.burnState) return;
    setTimeout(() => doAITurn(room), 900 + Math.random() * 800);
  }

  function aiDrawFromDeck(room) {
    if (room.deck.length === 0) {
      const top = room.discard.pop();
      room.deck = room.discard.reverse();
      room.discard = top ? [top] : [];
    }
    return room.deck.pop();
  }

  function doAITurn(room) {
    if (!room || room.roundEnded) return;
    const ai = room.players[room.currentTurn];
    if (!ai || !ai.isAI) return;

    // 1. هل يعلن تشيز؟
    const { sum: knownSum, unknown } = aiKnownTotal(ai);
    const cardCount = ai.cards.filter(c=>c).length;
    const avgUnknown = unknown > 0 ? 5 : 0;
    const estTotal = knownSum + avgUnknown;

    if (!room.finalRound && !room.cheezDeclarer) {
      const cardsLeft = (room.players.length * 4) - room.players.reduce((s,p)=>s+p.cards.filter(c=>c).length, 0);
      const roundsLeft = Math.max(4, Math.ceil(cardsLeft / room.players.length));
      const shouldDeclare = (estTotal <= 7 && unknown <= 1) || (estTotal <= 10 && roundsLeft < 3 && cardCount <= 3);
      if (shouldDeclare && Math.random() < 0.75) {
        // يعلن تشيز ثم يبدأ دوره عادي
        room.cheezDeclarer = ai.id;
        room.finalRound = true;
        room.finalRoundCount = room.players.length - 1;
        if (ai.id > 900000) {
          // AI: نحفظ في القاعدة بشكل صحيح: لا يوجد له user حقيقي، نخلي الإحصاء فقط لو كان مستخدم حقيقي
          // لا نقوم بشيء
        } else {
          userDB.updateIncrement(ai.id, { cheez_count: 1 });
        }
        io.to(room.id).emit('cheez-declared', { playerId: ai.id });
      }
    }

    // 2. يسحب ورقة
    const drawn = aiDrawFromDeck(room);
    const drawnV = cardValue(drawn);

    // 3. قرر: استبدل أعلى ورقة عنده إذا كانت الورقة المسحوبة أفضل، أو ارفعها
    const highestIdx = findHighestCardIndex(ai);
    const highestKnown = highestIdx >= 0 && ai.memory.knownCards[highestIdx] ? cardValue(ai.memory.knownCards[highestIdx]) : 10;
    const estimatedHighest = highestIdx >= 0 ? highestKnown : 10;

    let replaceIndex = -1;
    if (drawnV < estimatedHighest) {
      replaceIndex = highestIdx;
    } else if (['7','8','10'].includes(drawn.value)) {
      // ارفع الورقة عشان ننفذ الأكشن
      replaceIndex = -1;
    } else if (unknown > 0 && drawnV <= 6) {
      // جرب استبدل ورقة غير معروفة لو القيمة جيدة
      for (let i = 0; i < 4; i++) {
        if (ai.cards[i] && !ai.memory.knownCards[i]) { replaceIndex = i; break; }
      }
    }

    if (replaceIndex >= 0) {
      // استبدال
      const old = ai.cards[replaceIndex];
      ai.cards[replaceIndex] = drawn;
      ai.memory.knownCards[replaceIndex] = drawn;
      if (old) room.discard.push(old);
      io.to(room.id).emit('card-replaced', { playerId: ai.id, cardIndex: replaceIndex, discard: old });
      emitDeckCount(room);
      setTimeout(() => endTurn(room), 600);
      return;
    }

    // إلغاء: رمي الورقة المسحوبة
    room.discard.push(drawn);
    io.to(room.id).emit('card-discarded', { playerId: ai.id, card: drawn });
    emitDeckCount(room);

    const actionCard = drawn;
    if (['7','8','10'].includes(actionCard.value)) {
      // نفذ الأكشن
      room.actionState = { card: actionCard, playerId: ai.id };
      setTimeout(() => {
        if (actionCard.value === '7') {
          // شوف ورقة من أوراقك اللي ما تعرفها
          let pickIdx = -1;
          for (let i = 0; i < 4; i++) {
            if (ai.cards[i] && !ai.memory.knownCards[i]) { pickIdx = i; break; }
          }
          if (pickIdx < 0) pickIdx = findHighestCardIndex(ai);
          if (pickIdx >= 0) ai.memory.knownCards[pickIdx] = ai.cards[pickIdx];
          room.actionState = null;
          setTimeout(() => endTurn(room), 700);
        } else if (actionCard.value === '8') {
          // شوف ورقة من لاعب آخر - اختيار لاعب يحتمله مجموع عالي أو ورقة معينة
          const targets = room.players.filter(p => p.id !== ai.id && p.cards.filter(c=>c).length > 0);
          if (targets.length > 0) {
            const t = targets[Math.floor(Math.random()*targets.length)];
            const valid = [];
            for (let i = 0; i < 4; i++) if (t.cards[i]) valid.push(i);
            if (valid.length > 0) {
              const pick = valid[Math.floor(Math.random()*valid.length)];
              ai.memory.seenOpponent[t.id + '_' + pick] = t.cards[pick];
              ai.memory.seenOpponent['last_'+t.id] = { index: pick, card: t.cards[pick] };
            }
          }
          room.actionState = null;
          setTimeout(() => endTurn(room), 700);
        } else if (actionCard.value === '10') {
          // تبديل: ابحث عن ورقة قليلّة عند خصم وتبادلها مع أعلى ورقة عندك
          const targets = room.players.filter(p => p.id !== ai.id && p.cards.filter(c=>c).length > 0);
          let bestSwap = null;
          let bestGain = 0;
          for (const t of targets) {
            for (let ti = 0; ti < 4; ti++) {
              if (!t.cards[ti]) continue;
              const seenInfo = ai.memory.seenOpponent[t.id + '_' + ti];
              const tVal = seenInfo ? cardValue(seenInfo) : 6;
              // قارن مع أعلى ورقة عندنا
              for (let mi = 0; mi < 4; mi++) {
                if (!ai.cards[mi]) continue;
                const myVal = ai.memory.knownCards[mi] ? cardValue(ai.memory.knownCards[mi]) : 6;
                const gain = myVal - tVal;
                if (gain > bestGain && (seenInfo || myVal >= 9)) {
                  bestGain = gain;
                  bestSwap = { target: t, ti, mi, targetCard: t.cards[ti], myCard: ai.cards[mi] };
                }
              }
            }
          }
          if (bestSwap && bestGain > 0) {
            const t = bestSwap.target;
            ai.cards[bestSwap.mi] = bestSwap.targetCard;
            t.cards[bestSwap.ti] = bestSwap.myCard;
            ai.memory.knownCards[bestSwap.mi] = bestSwap.targetCard;
            io.to(room.id).emit('action-10-notify', { playerId: ai.id, targetId: t.id });
          } else {
            // تبديل عشوائي مع خصم عشوائي
            if (targets.length > 0) {
              const t = targets[Math.floor(Math.random()*targets.length)];
              const validT = [];
              for (let i = 0; i < 4; i++) if (t.cards[i]) validT.push(i);
              const validM = [];
              for (let i = 0; i < 4; i++) if (ai.cards[i]) validM.push(i);
              if (validT.length && validM.length) {
                const ti = validT[Math.floor(Math.random()*validT.length)];
                const mi = validM[Math.floor(Math.random()*validM.length)];
                const temp = ai.cards[mi];
                ai.cards[mi] = t.cards[ti];
                t.cards[ti] = temp;
                delete ai.memory.knownCards[mi];
                io.to(room.id).emit('action-10-notify', { playerId: ai.id, targetId: t.id });
              }
            }
          }
          room.actionState = null;
          setTimeout(() => endTurn(room), 900);
        }
      }, 800);
    } else {
      // ورقة عادية -> ابدأ الحرق
      room.burnState = { value: drawn.value, initiatorId: ai.id, burners: new Set() };
      io.to(room.id).emit('burn-start', { value: drawn.value, initiatorId: ai.id });
      // AI آخرين يحاولون الحرق فوراً
      setTimeout(() => {
        const burnerList = room.players.filter(p => p.id !== ai.id && p.isAI);
        for (const bAI of burnerList) {
          if (room.burnState && !room.burnState.burners.has(bAI.id)) {
            // هل يعرف AI ورقة بنفس القيمة؟
            for (let i = 0; i < 4; i++) {
              const k = bAI.memory.knownCards[i];
              if (k && k.value === drawn.value && bAI.cards[i]) {
                room.burnState.burners.add(bAI.id);
                const card = bAI.cards[i];
                bAI.cards[i] = null;
                room.discard.push(card);
                io.to(room.id).emit('burn-success', { playerId: bAI.id, cardIndex: i, card, remaining: bAI.cards.filter(c=>c).length });
                emitDeckCount(room);
                break;
              }
            }
          }
        }
      }, 1200);
      
      setTimeout(() => {
        if (room.burnState) {
          room.burnState = null;
          io.to(room.id).emit('burn-end');
        }
        endTurn(room);
      }, 5000);
    }
  }

  function endTurn(room) {
    if (room.finalRound) {
      room.finalRoundCount--;
      if (room.finalRoundCount <= 0) {
        endRound(room);
        return;
      }
    }
    room.currentTurn = (room.currentTurn + 1) % room.players.length;
    
    if (room.finalRound && room.players[room.currentTurn].id === room.cheezDeclarer) {
      endRound(room);
      return;
    }
    
    io.to(room.id).emit('turn-change', { currentTurn: room.currentTurn });
    doAITurnIfNeeded(room);
  }

  function endRound(room) {
    room.roundEnded = true;
    const scores = room.players.map(p => ({
      playerId: p.id,
      username: p.username,
      profile_pic: p.profile_pic,
      cards: p.cards.filter(c => c),
      total: p.cards.reduce((sum, c) => sum + (c ? cardValue(c) : 0), 0)
    }));
    
    const cheezPlayer = scores.find(s => s.playerId === room.cheezDeclarer);
    let results = scores.map(s => ({ ...s, finalScore: s.total }));
    
    if (cheezPlayer) {
      const others = scores.filter(s => s.playerId !== room.cheezDeclarer);
      const minOthers = Math.min(...others.map(s => s.total));
      
      if (cheezPlayer.total <= minOthers) {
        results = results.map(s => s.playerId === room.cheezDeclarer ? { ...s, finalScore: 0 } : s);
      } else {
        const allTotal = scores.reduce((sum, s) => sum + s.total, 0);
        results = results.map(s => s.playerId === room.cheezDeclarer ? { ...s, finalScore: allTotal } : s);
      }
    }
    
    for (const r of results) {
      if (r.playerId >= 900000) {
        const minScore = Math.min(...results.map(x => x.finalScore));
        const isWinner = r.finalScore === minScore && results.filter(x => x.finalScore === minScore).length === 1;
        r.isWinner = isWinner;
        continue;
      }
      const user = userDB.findById(r.playerId);
      if (!user) continue;
      
      const minScore = Math.min(...results.map(x => x.finalScore));
      const isWinner = r.finalScore === minScore && results.filter(x => x.finalScore === minScore).length === 1;
      
      const coinReward = isWinner ? (30 + room.players.length * 5) : 5;
      
      userDB.updateIncrement(r.playerId, {
        games_played: 1,
        wins: isWinner ? 1 : 0,
        losses: isWinner ? 0 : 1,
        total_points: r.finalScore,
        coins: coinReward
      });
      r.isWinner = isWinner;
      r.coinsEarned = coinReward;
    }
    
    io.to(room.id).emit('round-ended', { results });
    
    room.gameStarted = false;
    room.cheezDeclarer = null;
    room.finalRound = false;
    room.roundEnded = false;
    broadcastRoomList();
  }

  socket.on('chat-message', (msg) => {
    if (!currentRoom || !currentUser) return;
    io.to(currentRoom).emit('chat-message', {
      username: currentUser.username,
      text: msg,
      time: Date.now()
    });
  });

  socket.on('disconnect', () => {
    if (currentUser) {
      ONLINE_USERS.delete(currentUser.id);
      io.emit('user-online', { id: currentUser.id, online: false });
    }
    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.players = room.players.filter(p => p.socketId !== socket.id);
        if (room.players.length === 0) {
          rooms.delete(currentRoom);
        } else {
          if (room.host.socketId === socket.id) {
            const nonAI = room.players.find(p => !p.isAI);
            room.host = nonAI || room.players[0];
            room.host.isHost = true;
          }
          if (room.gameStarted) {
            io.to(currentRoom).emit('player-left', room.players.map(publicPlayer));
          } else {
            io.to(currentRoom).emit('player-joined', room.players.map(publicPlayer));
          }
        }
      }
    }
    broadcastRoomList();
  });
});

function broadcastRoomList() {
  const roomList = [];
  for (const [id, room] of rooms) {
    if (!room.gameStarted) {
      roomList.push({
        id, name: room.name, host: room.host?.username || '',
        players: room.players.map(publicPlayer),
        maxPlayers: room.maxPlayers, hasPassword: !!room.password
      });
    }
  }
  io.emit('lobby-update', roomList);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🟢 تشيز شغالة على http://localhost:${PORT}`);
});
