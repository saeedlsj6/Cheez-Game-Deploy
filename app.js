const socket = io();

let currentUser = null;
let currentRoomId = null;
let isHost = false;
let players = [];
let myCards = [];
let drawnCard = null;
let replaceModeActive = false;
let currentTurn = -1;
let burnActive = false;
let burnTimer = null;
let burnAttempted = false;
let initialPeekSelected = [];
let actionState = null;
let passwordRoomJoinId = null;
let cheezDeclaredBy = null;
let peekCountdownTimer = null;

const DEFAULT_PIC = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA1MCA1MCI+PGNpcmNsZSBjeD0iMjUiIGN5PSIyNSIgcj0iMjUiIGZpbGw9IiMxNDg1NTAiLz48dGV4dCB4PSIyNSIgeT0iMzMiIGZvbnQtc2l6ZT0iMjUiIHRleHQtYW5jaG9yPSJtaWRkbGUiPvCfkqk8L3RleHQ+PC9zdmc+';

// ============ AUTH ============
document.querySelectorAll('#auth-screen .tab').forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll('#auth-screen .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#auth-screen .tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab + '-form').classList.add('active');
  };
});

async function doLogin() {
  const u = document.getElementById('login-username').value.trim();
  const p = document.getElementById('login-password').value;
  const err = document.getElementById('login-error');
  err.textContent = '';
  
  if (!u || !p) return err.textContent = 'املأ جميع الحقول';
  
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ username: u, password: p })
    });
    const data = await res.json();
    if (data.error) return err.textContent = data.error;
    
    currentUser = data.user;
    localStorage.setItem('cheez_user', JSON.stringify(currentUser));
    enterLobby();
  } catch(e) { err.textContent = 'خطأ في الشبكة'; }
}

async function doRegister() {
  const u = document.getElementById('reg-username').value.trim();
  const p = document.getElementById('reg-password').value;
  const err = document.getElementById('reg-error');
  err.textContent = '';
  
  if (!u || !p) return err.textContent = 'املأ جميع الحقول';
  if (!/^[a-zA-Z]{2,}$/.test(u)) return err.textContent = 'اليوزر يجب أن يكون حرفين إنجليزية على الأقل';
  if (p.length < 4) return err.textContent = 'كلمة المرور 4 أحرف على الأقل';
  
  try {
    const res = await fetch('/api/register', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ username: u, password: p })
    });
    const data = await res.json();
    if (data.error) return err.textContent = data.error;
    
    currentUser = data.user;
    localStorage.setItem('cheez_user', JSON.stringify(currentUser));
    enterLobby();
  } catch(e) { err.textContent = 'خطأ في الشبكة'; }
}

function logout() {
  currentUser = null;
  localStorage.removeItem('cheez_user');
  leaveRoom();
  showScreen('auth-screen');
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ============ LOBBY ============
async function preloadShopItems() {
  if (SHOP_CACHE) return;
  try {
    const res = await fetch('/api/shop/items');
    SHOP_CACHE = await res.json();
    SHOP_CACHE.cardBacks.forEach(it => SHOP_PATTERNS_CACHE.cardBacks[it.id] = it);
    SHOP_CACHE.tables.forEach(it => SHOP_PATTERNS_CACHE.tables[it.id] = it);
  } catch(e) {}
}

async function enterLobby() {
  detectDevice();
  showScreen('lobby-screen');
  document.getElementById('lobby-username').textContent = currentUser.username;
  document.getElementById('lobby-user-pic').src = picUrl(currentUser.profile_pic);
  document.getElementById('lobby-wins').textContent = currentUser.wins || 0;
  document.getElementById('lobby-cheez').textContent = currentUser.cheez_count || 0;
  document.getElementById('lobby-coins').textContent = currentUser.coins || 0;
  await preloadShopItems();
  applyUserSkin();
  socket.emit('join-lobby', currentUser);
  refreshFriends();
}

// ============ DEVICE DETECTION + SKINS ============
function detectDevice() {
  const ua = navigator.userAgent || navigator.vendor || window.opera;
  const mobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua.toLowerCase()) || window.innerWidth < 850;
  document.body.classList.toggle('is-mobile', mobile);
  document.body.classList.toggle('is-desktop', !mobile);
  if (mobile) document.querySelector('meta[name="viewport"]')?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
}
window.addEventListener('resize', () => {
  clearTimeout(window._drt);
  window._drt = setTimeout(detectDevice, 200);
});

let SHOP_PATTERNS_CACHE = { cardBacks: {}, tables: {} };

function getBackPattern() {
  return currentUser?.equipped?.cardBack || 'classic';
}
function getTableTheme() {
  return currentUser?.equipped?.table || 'green';
}
function getBackIcon() {
  const id = getBackPattern();
  return SHOP_PATTERNS_CACHE.cardBacks[id]?.pattern || '🧀';
}
function applyUserSkin() {
  if (!currentUser) return;
  document.body.className = document.body.className.replace(/table-\w+/g, '').replace(/is-mobile|is-desktop/g, '').trim();
  document.body.classList.add('table-' + getTableTheme());
  detectDevice();
  // Update the deck card preview in center if game screen
  const deckCard = document.querySelector('.deck-card');
  if (deckCard) {
    deckCard.className = 'card ' + cardBackClasses() + ' deck-card';
    deckCard.innerHTML = `<div class="card-pattern">${getBackIcon()}</div>`;
  }
}

function cardBackClasses() {
  return 'card-back pat-' + getBackPattern();
}
function renderCardBackHTML() {
  return `<div class="card-pattern">${getBackIcon()}</div>`;
}

// ============ FRIENDS ============
let FRIENDS_CACHE = { friends: [], requests: [] };

function showFriends() {
  openModal('friends-modal');
  switchFriendTab('list');
  refreshFriends();
}
function switchFriendTab(t) {
  document.querySelectorAll('#friends-modal .tab').forEach(x => x.classList.toggle('active', x.dataset.ftab === t));
  document.querySelectorAll('.ftab-content').forEach(x => x.classList.toggle('active', x.id === 'ftab-' + t));
}
async function refreshFriends() {
  if (!currentUser) return;
  try {
    const res = await fetch('/api/friends/list/' + currentUser.id);
    const d = await res.json();
    FRIENDS_CACHE = d;
    // badge
    const n = (d.requests || []).length;
    document.getElementById('friend-req-badge').style.display = n > 0 ? 'inline-block' : 'none';
    document.getElementById('friend-req-badge').textContent = n;
    const rt = document.getElementById('friend-req-tab');
    if (rt) { rt.style.display = n > 0 ? 'inline-block' : 'none'; rt.textContent = n; }
    // list
    const fl = document.getElementById('friends-list');
    if (!d.friends || d.friends.length === 0) {
      fl.innerHTML = `<div class="empty-friends"><div class="icon">👥</div><p>لا يوجد أصدقاء بعد.<br>أضف صديق باليوزر الإنجليزي!</p></div>`;
    } else {
      fl.innerHTML = d.friends.map(f => `
        <div class="friend-row">
          <img src="${picUrl(f.profile_pic)}" onerror="this.src='${DEFAULT_PIC}'">
          <div class="friend-info">
            <div class="friend-name">${escapeHtml(f.username)} <span class="online-dot ${f.online ? '' : 'off'}"></span></div>
            <div class="friend-meta">🏆 ${f.wins||0} فوز | 🎮 ${f.games_played||0} لعبة | ${f.online ? '🟢 متصل الآن' : '⚪ غير متصل'}</div>
          </div>
          <div class="friend-actions">
            ${f.online ? `<button class="btn-primary small" onclick="inviteFriendToRoom(${f.id}, '${escapeHtml(f.username)}')">🎮 دعوة للعب</button>` : ''}
            <button class="btn-danger small" onclick="removeFriend(${f.id})">❌</button>
          </div>
        </div>
      `).join('');
    }
    // requests
    const rl = document.getElementById('friend-requests-list');
    if (!d.requests || d.requests.length === 0) {
      rl.innerHTML = `<div class="empty-friends"><div class="icon">📥</div><p>لا توجد طلبات صداقة جديدة</p></div>`;
    } else {
      rl.innerHTML = d.requests.map(r => `
        <div class="friend-row">
          <img src="${picUrl(r.profile_pic)}" onerror="this.src='${DEFAULT_PIC}'">
          <div class="friend-info">
            <div class="friend-name">${escapeHtml(r.username)}</div>
            <div class="friend-meta">يريد أن يصبح صديقك</div>
          </div>
          <div class="request-actions">
            <button class="accept-btn" onclick="acceptFriend(${r.id})">✔️ قبول</button>
            <button class="reject-btn" onclick="rejectFriend(${r.id})">✖️ رفض</button>
          </div>
        </div>
      `).join('');
    }
  } catch(e) {}
}
async function addFriend() {
  const u = document.getElementById('add-friend-user').value.trim();
  const err = document.getElementById('add-friend-err');
  err.textContent = '';
  if (!u) return err.textContent = 'أدخل اليوزر';
  try {
    const res = await fetch('/api/friends/add', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ myId: currentUser.id, friendUsername: u })
    });
    const d = await res.json();
    if (d.error) return err.textContent = d.error;
    toast(d.sent ? '📨 أرسل الطلب بنجاح!' : '✅ أضفت الصديق بنجاح!', 'success');
    document.getElementById('add-friend-user').value = '';
    refreshFriends();
  } catch(e) { err.textContent = 'خطأ'; }
}
async function acceptFriend(fid) {
  await fetch('/api/friends/accept', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ myId: currentUser.id, friendId: fid })
  });
  toast('✅ تم قبول الصداقة!', 'success');
  refreshFriends();
}
async function rejectFriend(fid) {
  await fetch('/api/friends/reject', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ myId: currentUser.id, friendId: fid })
  });
  refreshFriends();
}
async function removeFriend(fid) {
  if (!confirm('تأكيد حذف الصديق؟')) return;
  await fetch('/api/friends/remove', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ myId: currentUser.id, friendId: fid })
  });
  toast('✅ تم الحذف', 'info');
  refreshFriends();
}
let pendingInviteAfterJoin = null;

function inviteFriendToRoom(fid, name) {
  if (!currentRoomId) {
    const roomName = `غرفة ${currentUser.username} و ${name}`;
    const password = Math.random().toString(36).slice(2, 7);
    pendingInviteAfterJoin = { friendId: fid, name, password, roomName };
    socket.emit('create-room', { name: roomName, password, maxPlayers: 4, user: currentUser });
    toast('🏠 جاري إنشاء غرفة خاصة...', 'info');
    return;
  }
  socket.emit('invite-friend', { friendId: fid, roomId: currentRoomId, roomName: document.getElementById('room-name').textContent });
  toast(`📨 دعوة أُرسلت إلى ${name}`, 'success');
}

// socket friend events
socket.on('friend-request', (u) => {
  toast(`📩 طلب صداقة جديد من ${u.username}`, 'info');
  refreshFriends();
});
socket.on('friend-accepted', (u) => {
  toast(`💚 ${u.username} قبل صداقتك!`, 'success');
  refreshFriends();
});
socket.on('room-invite', (inv) => {
  const passInfo = inv.roomPassword 
    ? `\n🔑 كلمة المرور: ${inv.roomPassword}`
    : (inv.hasPassword ? '\n(الغرفة بكلمة مرور - اسأل صديقك)' : '');
  if (!confirm(`${inv.fromName} يدعوك للعب في غرفة "${inv.roomName}"\n\nهل تريد الانضمام الآن؟${passInfo}`)) return;
  if (inv.roomPassword) {
    socket.emit('join-room', { roomId: inv.roomId, password: inv.roomPassword, user: currentUser });
  } else {
    tryJoinRoom(inv.roomId, inv.hasPassword, inv.roomName);
  }
});
socket.on('user-online', ({id, online}) => {
  if (document.getElementById('friends-modal').classList.contains('active')) refreshFriends();
});

// ============ SHOP ============
let SHOP_CACHE = null;
let SHOP_TAB = 'back';

async function showShop() {
  if (!SHOP_CACHE) {
    const res = await fetch('/api/shop/items');
    SHOP_CACHE = await res.json();
  }
  document.getElementById('shop-coins').textContent = currentUser.coins || 0;
  openModal('shop-modal');
  switchShopTab(SHOP_TAB);
}
function switchShopTab(t) {
  SHOP_TAB = t;
  document.querySelectorAll('#shop-modal .tab').forEach(x => x.classList.toggle('active', x.dataset.stab === t));
  renderShopItems();
}
function renderShopItems() {
  const list = SHOP_TAB === 'back' ? SHOP_CACHE.cardBacks : SHOP_CACHE.tables;
  const ownedKey = SHOP_TAB === 'back' ? 'cardBacks' : 'tables';
  const equipKey = SHOP_TAB === 'back' ? 'cardBack' : 'table';
  const type = SHOP_TAB === 'back' ? 'cardBack' : 'table';
  const grid = document.getElementById('shop-grid');
  
  grid.innerHTML = list.map(item => {
    const owned = currentUser.owned?.[ownedKey]?.includes(item.id);
    const equipped = currentUser.equipped?.[equipKey] === item.id;
    let preview = '';
    if (SHOP_TAB === 'back') {
      preview = `<div class="card card-back pat-${item.id}" style="width:60px;height:84px;"><div class="card-pattern">${item.pattern}</div></div>`;
    } else {
      preview = `<div style="width:100%;height:100%;border-radius:8px;" class="preview-table table-${item.id}"></div>`;
    }
    return `<div class="shop-item ${SHOP_TAB==='back'?'card':''}">
      <div class="shop-item-preview">${preview}</div>
      <div class="shop-item-name">${item.name}</div>
      <div class="shop-item-desc">${item.desc}</div>
      <div class="shop-item-price ${item.price===0?'free':''}">${item.price === 0 ? '🎁 مجاني' : '💰 ' + item.price}</div>
      ${owned ? 
        `<button class="shop-equip-btn ${equipped?'equipped':''}" ${equipped?'disabled':''} onclick="equipItem('${type}','${item.id}', this)">
          ${equipped ? 'مُفعّل' : 'تفعيل'}
        </button>` :
        `<button class="shop-buy-btn" ${(currentUser.coins||0) < item.price ? 'disabled' : ''} onclick="buyItem('${type}','${item.id}', ${item.price}, this)">
          ${(currentUser.coins||0) < item.price ? '💸 غير كافي' : '🛒 شراء'}
        </button>`
      }
    </div>`;
  }).join('');
}
async function buyItem(type, itemId, price, btn) {
  btn.disabled = true;
  const res = await fetch('/api/shop/buy', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ userId: currentUser.id, type, itemId })
  });
  const d = await res.json();
  if (d.error) { btn.disabled = false; return toast(d.error, 'error'); }
  currentUser.coins = d.coins;
  currentUser.owned = d.owned;
  localStorage.setItem('cheez_user', JSON.stringify(currentUser));
  document.getElementById('lobby-coins').textContent = currentUser.coins;
  document.getElementById('shop-coins').textContent = currentUser.coins;
  toast('🎉 تم الشراء بنجاح!', 'success');
  renderShopItems();
}
async function equipItem(type, itemId, btn) {
  btn.disabled = true;
  const res = await fetch('/api/shop/equip', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ userId: currentUser.id, type, itemId })
  });
  const d = await res.json();
  if (d.error) { btn.disabled = false; return toast(d.error, 'error'); }
  currentUser.equipped = d.equipped;
  localStorage.setItem('cheez_user', JSON.stringify(currentUser));
  applyUserSkin();
  toast('✅ تم التفعيل!', 'success');
  renderShopItems();
}

socket.on('lobby-rooms', renderRooms);
socket.on('lobby-update', renderRooms);

function renderRooms(list) {
  const el = document.getElementById('rooms-list');
  if (!list || list.length === 0) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🎪</div><p>لا توجد غرف حالياً، أنشئ غرفتك الآن!</p></div>`;
    return;
  }
  el.innerHTML = list.map(room => `
    <div class="room-card" onclick="tryJoinRoom('${room.id}', ${room.hasPassword}, '${room.name}')">
      ${room.hasPassword ? '<div class="lock-icon">🔒</div>' : ''}
      <div class="room-card-name">${escapeHtml(room.name)}</div>
      <div class="room-card-host">${escapeHtml(room.host)}</div>
      <div class="room-card-players">
        <div class="avatars-row">
          ${room.players.slice(0, 4).map(p => `<img src="${picUrl(p.profile_pic)}" onerror="this.src='${DEFAULT_PIC}'">`).join('')}
        </div>
        <div class="count-badge">${room.players.length}/${room.maxPlayers}</div>
      </div>
    </div>
  `).join('');
}

function showCreateRoom() { openModal('create-room-modal'); }

function createRoom() {
  const name = document.getElementById('new-room-name').value.trim() || 'غرفة تشيز';
  const max = parseInt(document.getElementById('new-room-max').value);
  const pass = document.getElementById('new-room-pass').value.trim();
  
  socket.emit('create-room', { name, password: pass, maxPlayers: max, user: currentUser });
  closeModal('create-room-modal');
}

function tryJoinRoom(roomId, hasPass, roomName) {
  if (hasPass) {
    passwordRoomJoinId = roomId;
    document.getElementById('pass-room-name').textContent = roomName;
    document.getElementById('join-room-pass').value = '';
    document.getElementById('join-pass-error').textContent = '';
    openModal('password-modal');
  } else {
    socket.emit('join-room', { roomId, password: '', user: currentUser });
  }
}

function confirmJoinWithPass() {
  const pass = document.getElementById('join-room-pass').value;
  const err = document.getElementById('join-pass-error');
  if (!pass) return err.textContent = 'أدخل كلمة المرور';
  socket.emit('join-room', { roomId: passwordRoomJoinId, password: pass, user: currentUser });
}

// ============ ROOM ============
socket.on('room-joined', ({ roomId, players: pls, isHost: host, config }) => {
  currentRoomId = roomId;
  isHost = host;
  players = pls;
  document.getElementById('room-name').textContent = config.name;
  document.getElementById('players-max').textContent = config.maxPlayers;
  showRoomScreen();
  renderRoomPlayers();

  if (pendingInviteAfterJoin) {
    const p = pendingInviteAfterJoin;
    pendingInviteAfterJoin = null;
    setTimeout(() => {
      socket.emit('invite-friend', { friendId: p.friendId, roomId, roomName: p.roomName, password: p.password });
      toast(`📨 دعوة أُرسلت إلى ${p.name} (كلمة المرور: ${p.password})`, 'success');
    }, 700);
  }
});

socket.on('player-joined', (pls) => {
  players = pls;
  renderRoomPlayers();
});

function showRoomScreen() {
  showScreen('room-screen');
  document.getElementById('host-controls').style.display = isHost ? 'block' : 'none';
  document.getElementById('guest-controls').style.display = isHost ? 'none' : 'block';
  document.getElementById('chat-messages').innerHTML = '';
  addChatSys('تم دخول الغرفة');
}

function renderRoomPlayers() {
  const max = parseInt(document.getElementById('players-max').textContent);
  const el = document.getElementById('players-list');
  document.getElementById('players-count').textContent = players.length;
  let html = '';
  for (let i = 0; i < max; i++) {
    const p = players[i];
    if (p) {
      const isAI = p.id >= 900000;
      html += `<div class="player-slot filled ${isAI && isHost ? 'ai-player' : ''}" ${isAI && isHost ? `onclick="removeAIById(${p.id})"` : ''}>
        <img src="${picUrl(p.profile_pic)}" onerror="this.src='${DEFAULT_PIC}'">
        <div class="player-slot-name">${escapeHtml(p.username)}</div>
        ${p.isHost ? '<div class="host-badge">👑 مقدم</div>' : ''}
        ${isAI ? '<div class="ai-badge">🤖 لاعب AI</div>' : ''}
      </div>`;
    } else {
      html += `<div class="player-slot">
        <div class="slot-empty-icon">➕</div>
        <div class="slot-empty-text">فارغ</div>
      </div>`;
    }
  }
  el.innerHTML = html;
}

function addAI() { socket.emit('add-ai'); }
function removeAI() {
  const lastAI = [...players].reverse().find(p => p.id >= 900000);
  if (lastAI) socket.emit('remove-ai', { aiId: lastAI.id });
  else toast('لا يوجد لاعبين AI', 'info');
}
function removeAIById(id) { socket.emit('remove-ai', { aiId: id }); }

function leaveRoom() {
  if (currentRoomId) {
    socket.emit('leave-room');
    currentRoomId = null;
    drawnCard = null;
    replaceModeActive = false;
    burnActive = false;
    burnAttempted = false;
    isBurnInitiator = false;
    peekLocked = false;
    cheezDeclaredBy = null;
    if (burnTimer) clearInterval(burnTimer);
    document.getElementById('drawn-panel').classList.remove('active', 'moved-away');
    document.getElementById('replace-hint').style.display = 'none';
    document.body.classList.remove('replace-mode-on', 'burn-mode-on');
  }
  if (currentUser) enterLobby();
}

function startGame() {
  socket.emit('start-game');
}

socket.on('error-msg', (msg) => { toast(msg, 'error'); });

// ============ CHAT ============
function sendChat() {
  const inp = document.getElementById('chat-input');
  const msg = inp.value.trim();
  if (!msg) return;
  socket.emit('chat-message', msg);
  inp.value = '';
}

function sendGameChat() {
  const inp = document.getElementById('game-chat-input');
  const msg = inp.value.trim();
  if (!msg) return;
  socket.emit('chat-message', msg);
  inp.value = '';
}

socket.on('chat-message', (data) => {
  addChatMsg(data, 'chat-messages');
  addChatMsg(data, 'game-chat-messages');
});

function addChatMsg({ username, text, isSys }, id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (isSys) return addChatSys(text, id);
  const d = document.createElement('div');
  d.className = 'chat-msg';
  d.innerHTML = `<span class="chat-user">${escapeHtml(username)}:</span> <span class="chat-text">${escapeHtml(text)}</span>`;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}

function addChatSys(text, id = 'chat-messages') {
  const el = document.getElementById(id);
  if (!el) return;
  const d = document.createElement('div');
  d.className = 'chat-msg sys';
  d.textContent = 'ℹ️ ' + text;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}

function toggleChat() {
  document.getElementById('chat-panel').classList.toggle('active');
}

// ============ GAME ============
socket.on('game-started', ({ players: pls, currentTurn: turn, deckCount, discardCount }) => {
  currentTurn = turn;
  players = pls;
  cheezDeclaredBy = null;
  drawnCard = null;
  replaceModeActive = false;
  burnActive = false;
  burnAttempted = false;
  peekLocked = false;
  if (burnTimer) clearInterval(burnTimer);
  document.body.classList.remove('replace-mode-on', 'burn-mode-on');
  
  showScreen('game-screen');
  document.getElementById('chat-panel').classList.remove('active');
  document.getElementById('discard-card').innerHTML = '<div class="empty-pile">فارغ</div>';
  document.getElementById('cheez-badge').style.display = 'none';
  document.getElementById('drawn-panel').classList.remove('active', 'moved-away');
  document.getElementById('replace-hint').style.display = 'none';
  
  const deckCard = document.querySelector('.deck-card');
  if (deckCard) {
    deckCard.className = 'card ' + cardBackClasses() + ' deck-card';
    deckCard.innerHTML = renderCardBackHTML();
  }
  if (typeof deckCount === 'number') {
    document.getElementById('deck-count').textContent = deckCount;
  }
  
  addChatSys('🎮 بدأت اللعبة!', 'game-chat-messages');
});

// Deck count updates
socket.on('deck-count', ({ deck, discard }) => {
  document.getElementById('deck-count').textContent = deck || 0;
});

socket.on('initial-cards', ({ cards }) => {
  myCards = cards.map(c => ({ ...c, revealedToMe: false, index: c.index }));
  showInitialPeek();
});

function showInitialPeek() {
  initialPeekSelected = [];
  document.getElementById('peek-left').textContent = 2;
  document.getElementById('peek-timer-info').style.display = 'none';
  const el = document.getElementById('peek-cards');
  el.innerHTML = myCards.map((c, i) => `
    <div class="card ${cardBackClasses()} selectable" data-idx="${i}" onclick="togglePeek(${i})" id="peek-${i}">
      ${renderCardBackHTML()}
    </div>
  `).join('');
  openModal('initial-peek-modal');
}

function finishInitialPeek() {
  let t = 5;
  const info = document.getElementById('peek-timer-info');
  info.style.display = 'block';
  document.getElementById('peek-countdown').textContent = t;
  document.getElementById('peek-left').textContent = 0;
  document.querySelectorAll('#peek-cards .card').forEach(c => c.classList.remove('selectable'));
  
  if (peekCountdownTimer) clearInterval(peekCountdownTimer);
  peekCountdownTimer = setInterval(() => {
    t--;
    document.getElementById('peek-countdown').textContent = Math.max(0, t);
    if (t <= 0) {
      clearInterval(peekCountdownTimer);
      peekCountdownTimer = null;
      socket.emit('peek-initial', { indices: initialPeekSelected });
      closeModal('initial-peek-modal');
      setTimeout(() => {
        initialPeekSelected.forEach(i => {
          if (myCards[i]) myCards[i].revealedToMe = false;
          if (myCards[i]) myCards[i]._peekedAndHidden = true;
        });
        renderMyCards();
        renderTurn();
        renderOpponents();
        updateDeckCount();
      }, 200);
    }
  }, 1000);
}

let peekLocked = false;
function togglePeek(idx) {
  if (peekCountdownTimer || peekLocked) return;
  const pos = initialPeekSelected.indexOf(idx);
  if (pos >= 0) {
    if (peekLocked) return;
    initialPeekSelected.splice(pos, 1);
    if (myCards[idx]) myCards[idx].revealedToMe = false;
    const cardEl = document.getElementById(`peek-${idx}`);
    cardEl.className = 'card ' + cardBackClasses() + ' selectable';
    cardEl.innerHTML = renderCardBackHTML();
  } else if (initialPeekSelected.length < 2) {
    initialPeekSelected.push(idx);
    if (myCards[idx]) myCards[idx].revealedToMe = true;
    const cardEl = document.getElementById(`peek-${idx}`);
    cardEl.classList.add('selected');
    const c = myCards[idx];
    if (c && typeof c.suit !== 'undefined') {
      renderCardData(cardEl, c, true);
    } else {
      cardEl.classList.add('card-loading');
    }
    socket.emit('peek-initial', { indices: initialPeekSelected });
  }
  document.getElementById('peek-left').textContent = Math.max(0, 2 - initialPeekSelected.length);

  if (initialPeekSelected.length === 2 && !peekCountdownTimer) {
    function _waitForBothThenStart() {
      const ready = initialPeekSelected.every(i => {
        const c = myCards[i];
        return c && typeof c.suit !== 'undefined' && c.suit;
      });
      if (!ready) {
        setTimeout(_waitForBothThenStart, 80);
        return;
      }
      initialPeekSelected.forEach(i => {
        const cardEl = document.getElementById(`peek-${i}`);
        if (cardEl && myCards[i]) {
          cardEl.classList.remove('card-loading');
          renderCardData(cardEl, myCards[i], true);
        }
      });
      peekLocked = true;
      document.querySelectorAll('#peek-cards .card').forEach(c => c.classList.remove('selectable'));
      setTimeout(finishInitialPeek, 400);
    }
    _waitForBothThenStart();
  }
}

socket.on('initial-peek', (revealed) => {
  revealed.forEach(({ index, card }) => {
    if (!card) return;
    const wasPeekedAndHidden = myCards[index] && myCards[index]._peekedAndHidden;
    myCards[index] = { ...card, index, revealedToMe: initialPeekSelected.includes(index) };
    if (wasPeekedAndHidden) {
      myCards[index].revealedToMe = false;
    }
    if (initialPeekSelected.includes(index) && !wasPeekedAndHidden) {
      const el = document.getElementById(`peek-${index}`);
      if (el) renderCardData(el, card, true);
    }
  });
  renderMyCards();
});

function renderTurn() {
  const player = players[currentTurn];
  if (!player) return;
  const isMine = player.id === currentUser.id;
  document.getElementById('turn-indicator').textContent = 'دور: ' + (isMine ? 'أنت 👈' : player.username);
  
  document.querySelectorAll('.player-slot').forEach(s => s.classList.remove('turn'));
  const slot = document.querySelectorAll('.player-slot')[currentTurn];
  if (slot) slot.classList.add('turn');
  
  const canDo = isMine && !drawnCard && !burnActive && !actionState;
  document.getElementById('cheez-btn').disabled = !canDo;
}

function renderMyCards() {
  const el = document.getElementById('my-cards');
  el.innerHTML = myCards.map((c, i) => {
    if (!c) return `<div class="card empty" data-idx="${i}"></div>`;
    const canSelect = !!(drawnCard && replaceModeActive);
    const shown = c.revealedToMe;
    const classes = ['card'];
    if (!shown && !c.revealedPublicly) classes.push(cardBackClasses());
    if (c.revealedPublicly) classes.push('revealed');
    if (canSelect) classes.push('selectable');
    if (drawnCard && !replaceModeActive && !burnActive) classes.push('dimmed');
    if (c._burnFail) classes.push('burn-fail');
    if (c._burnSuccess) classes.push('burn-success');
    return `<div class="${classes.join(' ')}" 
      data-idx="${i}" onclick="onClickMyCard(${i})" id="mycard-${i}">
      ${shown || c.revealedPublicly ? renderCardInner(c) : renderCardBackHTML()}
    </div>`;
  }).join('');
  
  myCards.forEach((c, i) => {
    if (c && (c.revealedPublicly || c.revealedToMe)) {
      const el = document.getElementById(`mycard-${i}`);
      if (el) el.classList.add(c.suit === '♥' || c.suit === '♦' ? 'red' : 'black');
    }
  });
}

function onClickMyCard(idx) {
  if (burnActive && isBurnInitiator) {
    return;
  }
  if (burnActive && !burnAttempted) {
    if (!myCards[idx]) return;
    burnAttempted = true;
    socket.emit('burn-attempt', { cardIndex: idx });
    document.body.classList.remove('burn-mode-on');
    renderMyCards();
    return;
  }
  if (burnActive && burnAttempted) {
    return;
  }
  if (drawnCard && replaceModeActive && myCards[idx]) {
    socket.emit('replace-card', { cardIndex: idx, drawnCard });
    drawnCard = null;
    replaceModeActive = false;
    document.body.classList.remove('replace-mode-on');
    document.getElementById('drawn-panel').classList.remove('active', 'moved-away');
    document.getElementById('replace-hint').style.display = 'none';
    renderMyCards();
  } else if (drawnCard && !replaceModeActive) {
    toast('اختر أولاً: 🔄 استبدل أو 🔥 ارفعها من لوحة الاختيار', 'info');
  }
}

function cancelDraw() {
  if (!drawnCard) return;
  if (confirm('سيتم التخلص من الورقة المسحوبة (رفعها للحذف). متأكد؟')) {
    discardDrawn();
  }
}

async function adminAddCoins() {
  const username = document.getElementById('admin-user').value.trim();
  const secret = document.getElementById('admin-secret').value;
  const amount = parseInt(document.getElementById('admin-amount').value);
  const err = document.getElementById('admin-err');
  err.textContent = '';
  if (!username || !secret || !amount) return (err.textContent = 'املأ كل الحقول');
  try {
    const res = await fetch('/api/admin/add-coins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, secret, amount })
    });
    const d = await res.json();
    if (d.error) return (err.textContent = d.error);
    toast(`✅ أضيف ${amount} ذهب لـ ${d.username}! الرصيد الجديد: ${d.newCoins}`, 'success');
    document.getElementById('admin-user').value = '';
    document.getElementById('admin-secret').value = '';
    if (currentUser && currentUser.username.toLowerCase() === username.toLowerCase()) {
      currentUser.coins = d.newCoins;
      localStorage.setItem('cheez_user', JSON.stringify(currentUser));
    }
    document.getElementById('shop-coins').textContent = (currentUser && currentUser.username.toLowerCase() === username.toLowerCase()) ? d.newCoins : (currentUser?.coins || 0);
    document.getElementById('lobby-coins').textContent = (currentUser && currentUser.username.toLowerCase() === username.toLowerCase()) ? d.newCoins : (currentUser?.coins || 0);
  } catch (e) {
    err.textContent = 'خطأ في الشبكة';
  }
}

function renderOpponents() {
  const el = document.getElementById('opponents-area');
  const others = players.filter(p => p.id !== currentUser.id);
  const myIdx = players.findIndex(p => p.id === currentUser.id);
  const sorted = [];
  for (let i = 1; i < players.length; i++) {
    const p = players[(myIdx + i) % players.length];
    if (p) sorted.push({ p, idx: (myIdx + i) % players.length });
  }
  
  const oppCardTemplate = `<div class="card ${cardBackClasses()}">${renderCardBackHTML()}</div>`;
  el.innerHTML = sorted.map(({ p, idx }) => `
    <div class="opponent-card ${idx === currentTurn ? 'my-turn' : ''} ${cheezDeclaredBy === p.id ? 'declared-cheez' : ''}">
      <div class="opp-info">
        <img src="${picUrl(p.profile_pic)}" onerror="this.src='${DEFAULT_PIC}'">
        <div>
          <div class="opp-name">${escapeHtml(p.username)} ${p.id >= 900000 ? '🤖' : ''}</div>
          ${cheezDeclaredBy === p.id ? '<div class="opp-cheez-tag">🧀 تشيز!</div>' : ''}
        </div>
      </div>
      <div class="opp-cards" id="oppcards-${idx}">
        ${Array(Math.max(0, p.cardsCount)).fill(oppCardTemplate).join('')}
      </div>
    </div>
  `).join('');
}

function updateDeckCount() {
  // handled by deck-count socket event
}

socket.on('turn-change', ({ currentTurn: t }) => {
  currentTurn = t;
  renderTurn();
  renderOpponents();
});

function drawCard() {
  const player = players[currentTurn];
  if (!player || player.id !== currentUser.id) return toast('ليس دورك', 'error');
  if (drawnCard) return toast('لديك ورقة مسحوبة بالفعل', 'error');
  if (burnActive || actionState) return;
  socket.emit('draw-card');
}

socket.on('card-drawn', (card) => {
  drawnCard = card;
  replaceModeActive = false;
  const el = document.getElementById('drawn-card');
  renderCardData(el, card, true);
  let typeText = '';
  if (card.isJoker) typeText = '🎭 جوكر';
  else if (['7', '8', '10'].includes(card.value)) {
    const desc = card.value === '7' ? 'شوف ورقتك' : card.value === '8' ? 'تجسس على خصم' : 'تبادل أوراق';
    typeText = `⚡ ورقة أكشن ${card.value} — ${desc}`;
  } else {
    typeText = `📋 ${card.value}${card.suit}`;
  }
  document.getElementById('drawn-type').textContent = typeText;
  document.getElementById('replace-hint').style.display = 'none';
  document.getElementById('drawn-panel').classList.add('active');
  document.getElementById('cheez-btn').disabled = true;
  renderMyCards();
});

function chooseToReplace() {
  replaceModeActive = true;
  document.body.classList.add('replace-mode-on');
  document.getElementById('drawn-panel').classList.add('moved-away');
  document.getElementById('replace-hint').style.display = 'block';
  toast('اختر ورقة من أوراقك للاستبدال بها', 'info');
  renderMyCards();
}

function discardDrawn() {
  if (!drawnCard) return;
  socket.emit('discard-card', { card: drawnCard });
  drawnCard = null;
  replaceModeActive = false;
  document.body.classList.remove('replace-mode-on');
  document.getElementById('drawn-panel').classList.remove('active', 'moved-away');
  document.getElementById('replace-hint').style.display = 'none';
}

function renderCardData(el, card, show) {
  if (!el) return;
  if (!card || !card.suit) {
    el.classList.remove('red', 'black', 'is-joker');
    el.classList.remove(...el.className.split(' ').filter(c => c.startsWith('pat-')));
    el.classList.add(...cardBackClasses().split(' '));
    el.innerHTML = renderCardBackHTML();
    return;
  }
  el.classList.remove('card-back', 'red', 'black', 'is-joker');
  el.classList.remove(...el.className.split(' ').filter(c => c.startsWith('pat-')));
  if (card.isJoker) {
    el.classList.add('is-joker');
    if (show) {
      el.innerHTML = `
        <div class="card-top" style="font-size:13px;">JOKER</div>
        <div class="card-mid">🃏</div>
        <div class="card-bottom" style="font-size:13px;">JOKER</div>
      `;
    } else {
      el.classList.add(...cardBackClasses().split(' '));
      el.innerHTML = `<div class="card-pattern">${getBackIcon()}</div>`;
    }
    return;
  }
  const isRed = card.suit === '♥' || card.suit === '♦';
  el.classList.add(isRed ? 'red' : 'black');
  if (show) {
    const v = card.value || '';
    const s = card.suit || '';
    el.innerHTML = `
      <div class="card-top">${v}<br>${s}</div>
      <div class="card-mid">${s}</div>
      <div class="card-bottom">${v}<br>${s}</div>
    `;
  }
}

function renderCardInner(card) {
  if (!card || !card.suit) {
    return renderCardBackHTML();
  }
  if (card.isJoker) {
    return `
      <div class="card-top" style="font-size:13px;">JOKER</div>
      <div class="card-mid">🃏</div>
      <div class="card-bottom" style="font-size:13px;">JOKER</div>
    `;
  }
  const v = card.value || '';
  const s = card.suit || '';
  return `
    <div class="card-top">${v}<br>${s}</div>
    <div class="card-mid">${s}</div>
    <div class="card-bottom">${v}<br>${s}</div>
  `;
}

socket.on('card-replaced', ({ playerId, cardIndex, discard }) => {
  if (playerId === currentUser.id) {
    renderMyCards();
  }
  renderOpponents();
  renderDiscard(discard);
});

socket.on('card-discarded', ({ playerId, card }) => {
  renderDiscard(card);
});

function renderDiscard(card) {
  const el = document.getElementById('discard-card');
  renderCardData(el, card, true);
}

// ============ ACTIONS ============
socket.on('action-7-prompt', () => {
  const body = document.getElementById('action-body');
  body.innerHTML = `<p class="modal-subtitle">اختر ورقة من أوراقك لتشاهدها سرياً</p>
    <div class="action-pick-card">
      ${myCards.map((c,i) => `<div class="card ${c ? (cardBackClasses() + ' selectable') : 'empty'}" data-idx="${i}" onclick="pickAction7(${i})">
        ${c ? renderCardBackHTML() : ''}
      </div>`).join('')}
    </div>`;
  document.getElementById('action-title').innerHTML = '🎯 أكشن ورقة ٧';
  openModal('action-modal');
});

function pickAction7(idx) {
  if (!myCards[idx]) return;
  closeModal('action-modal');
  socket.emit('action-7-execute', { cardIndex: idx });
}

socket.on('action-7-result', ({ cardIndex, card }) => {
  myCards[cardIndex].revealedToMe = true;
  const el = document.getElementById(`mycard-${cardIndex}`);
  if (el) {
    el.classList.remove('card-back');
    renderCardData(el, card, true);
  }
  toast(`شاهدت ورقة ${card.value}${card.suit}`, 'info');
  setTimeout(() => {
    myCards[cardIndex].revealedToMe = false;
    renderMyCards();
  }, 3000);
});

socket.on('action-8-prompt', ({ players: others }) => {
  const body = document.getElementById('action-body');
  body.innerHTML = `<p class="modal-subtitle">اختر اللاعب الذي تريد مشاهدة ورقة منه</p>
    <div class="action-player-list">
      ${others.map(p => `<button class="action-player-btn" onclick="pickAction8Player(${p.id})">👤 ${escapeHtml(p.username)}</button>`).join('')}
    </div>`;
  document.getElementById('action-title').innerHTML = '🎯 أكشن ورقة ٨';
  actionState = { type: 8, step: 'player' };
  openModal('action-modal');
});

function pickAction8Player(playerId) {
  actionState.targetId = playerId;
  actionState.step = 'card';
  const body = document.getElementById('action-body');
  body.innerHTML = `<p class="modal-subtitle">اختر أي ورقة تريد مشاهدتها</p>
    <div class="action-pick-card">
      ${[0,1,2,3].map(i => `<div class="card ${cardBackClasses()} selectable" onclick="pickAction8Card(${i})">${renderCardBackHTML()}</div>`).join('')}
    </div>`;
}

function pickAction8Card(idx) {
  closeModal('action-modal');
  socket.emit('action-8-execute', { targetId: actionState.targetId, cardIndex: idx });
  actionState = null;
}

socket.on('action-8-result', ({ targetId, cardIndex, card }) => {
  toast(`شاهدت ورقة ${card.value}${card.suit} من اللاعب`, 'info');
});

socket.on('action-10-prompt', ({ players: others }) => {
  const body = document.getElementById('action-body');
  body.innerHTML = `<p class="modal-subtitle">الخطوة ١: اختر ورقتك التي تريد تبديلها</p>
    <div class="action-pick-card">
      ${myCards.map((c,i) => `<div class="card ${c ? (cardBackClasses() + ' selectable') : 'empty'}" data-idx="${i}" onclick="pickAction10My(${i})">
        ${c ? renderCardBackHTML() : ''}
      </div>`).join('')}
    </div>`;
  document.getElementById('action-title').innerHTML = '🎯 أكشن ورقة ١٠';
  actionState = { type: 10, step: 'mycard' };
  openModal('action-modal');
});

function pickAction10My(idx) {
  if (!myCards[idx]) return;
  actionState.myIdx = idx;
  actionState.step = 'player';
  const others = players.filter(p => p.id !== currentUser.id);
  const body = document.getElementById('action-body');
  body.innerHTML = `<p class="modal-subtitle">الخطوة ٢: اختر اللاعب اللي تتبادل معه</p>
    <div class="action-player-list">
      ${others.map(p => `<button class="action-player-btn" onclick="pickAction10Player(${p.id})">👤 ${escapeHtml(p.username)}</button>`).join('')}
    </div>`;
}

function pickAction10Player(playerId) {
  actionState.targetId = playerId;
  actionState.step = 'theircard';
  const body = document.getElementById('action-body');
  body.innerHTML = `<p class="modal-subtitle">الخطوة ٣: اختر الورقة اللي تريدها منه</p>
    <div class="action-pick-card">
      ${[0,1,2,3].map(i => `<div class="card ${cardBackClasses()} selectable" onclick="pickAction10Card(${i})">${renderCardBackHTML()}</div>`).join('')}
    </div>`;
}

function pickAction10Card(idx) {
  closeModal('action-modal');
  socket.emit('action-10-execute', {
    myCardIndex: actionState.myIdx,
    targetId: actionState.targetId,
    targetCardIndex: idx
  });
  actionState = null;
}

socket.on('action-10-notify', () => {
  toast('🔄 تم تبادل أوراق سراً!', 'info');
});

// ============ BURN ============
let isBurnInitiator = false;
socket.on('burn-start', ({ value, initiatorId }) => {
  burnActive = true;
  burnAttempted = false;
  isBurnInitiator = initiatorId === (currentUser?.id ?? -999);
  renderMyCards();
});

socket.on('burn-end', () => {
  burnActive = false;
  burnAttempted = false;
  isBurnInitiator = false;
  document.body.classList.remove('burn-mode-on');
  if (burnTimer) clearTimeout(burnTimer);
  closeModal('burn-modal');
  hideBanner();
});

socket.on('burn-success', ({ playerId, cardIndex, card }) => {
  if (playerId === currentUser.id) {
    if (myCards[cardIndex]) myCards[cardIndex]._burnSuccess = true;
    setTimeout(() => { myCards[cardIndex] = null; renderMyCards(); }, 700);
    toast('🔥 نجاح', 'success');
  } else {
    renderOpponents();
  }
  renderMyCards();
});

socket.on('burn-fail', ({ playerId, cardIndex, card }) => {
  if (playerId === currentUser.id && myCards[cardIndex]) {
    myCards[cardIndex].revealedPublicly = true;
    myCards[cardIndex]._burnFail = true;
    setTimeout(() => { if (myCards[cardIndex]) myCards[cardIndex]._burnFail = false; renderMyCards(); }, 600);
    toast('❌ فشل', 'error');
  }
  renderMyCards();
});

function showBanner(text) {
  const b = document.getElementById('action-banner');
  b.textContent = text;
  b.classList.add('active');
}
function hideBanner() {
  document.getElementById('action-banner').classList.remove('active');
}

// ============ CHEEZ ============
function declareCheez() {
  const player = players[currentTurn];
  if (!player || player.id !== currentUser.id) return;
  if (drawnCard || burnActive || actionState) return;
  if (!confirm('هل أنت متأكد؟ ستبدأ الجولة الأخيرة!')) return;
  socket.emit('declare-cheez');
}

socket.on('cheez-declared', ({ playerId }) => {
  cheezDeclaredBy = playerId;
  const name = players.find(p => p.id === playerId)?.username || '';
  const p = players.find(pl => pl.id === playerId);
  if (p) p.cheezDeclarer = true;
  document.getElementById('cheez-badge').style.display = 'inline-block';
  document.getElementById('cheez-btn').disabled = true;
  toast(`🧀 ${name} قال تشيز!`, 'info');
  addChatSys(`🧀 ${escapeHtml(name)} قال تشيز! الجولة الأخيرة`, 'game-chat-messages');
  renderOpponents();
});

// ============ ROUND END ============
socket.on('round-ended', async ({ results }) => {
  drawnCard = null;
  replaceModeActive = false;
  burnActive = false;
  burnAttempted = false;
  isBurnInitiator = false;
  peekLocked = false;
  document.body.classList.remove('replace-mode-on', 'burn-mode-on');
  document.getElementById('drawn-panel').classList.remove('active', 'moved-away');
  document.getElementById('replace-hint').style.display = 'none';
  if (burnTimer) clearTimeout(burnTimer);
  hideBanner();

  const body = document.getElementById('results-body');
  results.sort((a,b) => a.finalScore - b.finalScore);
  
  const winners = results.filter(r => r.isWinner);
  body.innerHTML = `
    <div class="results-list">
      ${results.map(r => {
        const miniCards = r.cards.map(c => {
          const isRed = c.suit === '♥' || c.suit === '♦';
          return `<span class="mini-card ${isRed ? 'red' : 'black'}">${c.value}${c.suit}</span>`;
        }).join('');
        const cheezTag = r.playerId === cheezDeclaredBy ? '<span class="winner-tag" style="background:#ff9800;color:white">🧀 صاحب التشيز</span>' : '';
        return `<div class="result-row ${r.isWinner && winners.length === 1 ? 'winner' : (r.playerId === cheezDeclaredBy && !r.isWinner ? 'loser' : '')}">
          <img src="${picUrl(r.profile_pic)}" onerror="this.src='${DEFAULT_PIC}'">
          <div class="result-info">
            <div class="result-name">${escapeHtml(r.username)}</div>
            <div class="result-cards">${miniCards || '<span style="opacity:0.5">(لا أوراق)</span>'}</div>
            <div class="result-tags">
              ${r.isWinner && winners.length === 1 ? '<span class="winner-tag">🏆 الفائز!</span>' : ''}
              ${cheezTag}
            </div>
          </div>
          <div class="result-score">${r.finalScore}</div>
        </div>`;
      }).join('')}
    </div>
  `;
  openModal('results-modal');
  
  if (currentUser) {
    try {
      const res = await fetch('/api/user/' + currentUser.id);
      const data = await res.json();
      if (!data.error) {
        currentUser = { ...currentUser, wins: data.wins, losses: data.losses, games_played: data.games_played, cheez_count: data.cheez_count, total_points: data.total_points, coins: data.coins, owned: data.owned, equipped: data.equipped };
        localStorage.setItem('cheez_user', JSON.stringify(currentUser));
        document.getElementById('lobby-coins').textContent = currentUser.coins || 0;
      }
    } catch(e) {}
  }
});

socket.on('player-left', (pls) => {
  players = pls;
  renderOpponents();
});

// ============ PROFILE ============
async function openProfile() {
  const res = await fetch('/api/user/' + currentUser.id);
  const data = await res.json();
  document.getElementById('profile-username').textContent = data.username;
  document.getElementById('profile-pic').src = picUrl(data.profile_pic);
  document.getElementById('stat-games').textContent = data.games_played || 0;
  document.getElementById('stat-wins').textContent = data.wins || 0;
  document.getElementById('stat-losses').textContent = data.losses || 0;
  document.getElementById('stat-cheez').textContent = data.cheez_count || 0;
  document.getElementById('stat-points').textContent = data.total_points || 0;
  
  const allAch = [
    { id: 'nakba', name: 'النكبة', desc: 'تقول تشيز وتخسر دايم', icon: '💀' },
    { id: 'double', name: 'دبل جبن', desc: 'تفوز دايم', icon: '🧀' },
    { id: 'khawaf', name: 'الخواف', desc: 'مايسوي شي', icon: '🐔' }
  ];
  const userAchIds = (data.achievements || []).map(a => a.id);
  document.getElementById('achievements-list').innerHTML = allAch.map(a => {
    const unlocked = userAchIds.includes(a.id);
    return `<div class="achievement-card ${unlocked ? '' : 'locked'}">
      <div class="achievement-icon">${a.icon}</div>
      <div class="achievement-name">${a.name}</div>
      <div class="achievement-desc">${a.desc}</div>
    </div>`;
  }).join('');
  
  openModal('profile-modal');
}

async function uploadPic(e) {
  const file = e.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('pic', file);
  form.append('userId', currentUser.id);
  const res = await fetch('/api/upload-pic', { method: 'POST', body: form });
  const data = await res.json();
  if (data.success) {
    currentUser.profile_pic = data.filename;
    localStorage.setItem('cheez_user', JSON.stringify(currentUser));
    document.getElementById('profile-pic').src = picUrl(data.filename);
    document.getElementById('lobby-user-pic').src = picUrl(data.filename);
    toast('تم تغيير الصورة!', 'success');
  }
}

// ============ LEADERBOARD ============
async function showLeaderboard() {
  const res = await fetch('/api/leaderboard');
  const rows = await res.json();
  const ranks = ['', 'gold', 'silver', 'bronze'];
  document.getElementById('leaderboard-list').innerHTML = rows.length ? rows.map((r,i) => `
    <div class="leaderboard-row">
      <div class="lb-rank ${ranks[i+1] || ''}">${i+1}</div>
      <img src="${picUrl(r.profile_pic)}" onerror="this.src='${DEFAULT_PIC}'">
      <div class="lb-info">
        <div class="lb-name">${escapeHtml(r.username)}</div>
        <div class="lb-stats">🧀 ${r.cheez_count||0} | 🎮 ${r.games_played||0}</div>
      </div>
      <div class="lb-wins">🏆 ${r.wins||0}</div>
    </div>
  `).join('') : '<div class="empty-state" style="padding:30px"><div class="empty-icon">🏆</div><p>لا يوجد لاعبين بعد</p></div>';
  openModal('leaderboard-modal');
}

// ============ UTILS ============
function picUrl(f) {
  if (!f) return DEFAULT_PIC;
  if (f.startsWith('data:')) return f;
  return '/uploads/' + f;
}
function escapeHtml(s) {
  return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function openModal(id) {
  document.getElementById('modal-overlay').classList.add('active');
  document.getElementById(id).classList.add('active');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  const anyOpen = document.querySelectorAll('.modal.active').length > 0;
  if (!anyOpen) document.getElementById('modal-overlay').classList.remove('active');
}
document.getElementById('modal-overlay').onclick = () => {
  document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
  document.getElementById('modal-overlay').classList.remove('active');
};

function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const d = document.createElement('div');
  d.className = 'toast ' + type;
  d.textContent = msg;
  c.appendChild(d);
  setTimeout(() => d.remove(), 3100);
}

// ============ INIT ============
window.addEventListener('DOMContentLoaded', () => {
  detectDevice();
  const saved = localStorage.getItem('cheez_user');
  if (saved) {
    try {
      currentUser = JSON.parse(saved);
      enterLobby();
      return;
    } catch(e) {}
  }
  showScreen('auth-screen');
});
