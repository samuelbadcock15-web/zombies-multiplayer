const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Rooms dictionary
const rooms = {};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const PLAYER_COLORS = [0x00ffcc, 0xff4444, 0xffbb00, 0x9944ff];

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('create_room', (playerName) => {
    const code = generateRoomCode();
    rooms[code] = {
      code,
      hostId: socket.id,
      started: false,
      players: {},
      doorState: [false, false, false, false]
    };
    joinRoom(socket, code, playerName);
  });

  socket.on('join_room', ({ code, playerName }) => {
    const rCode = (code || '').toUpperCase().trim();
    if (!rooms[rCode]) {
      socket.emit('error_msg', 'Room not found.');
      return;
    }
    if (rooms[rCode].started) {
      socket.emit('error_msg', 'Game already in progress.');
      return;
    }
    if (Object.keys(rooms[rCode].players).length >= 4) {
      socket.emit('error_msg', 'Room is full (max 4 players).');
      return;
    }
    joinRoom(socket, rCode, playerName);
  });

  function joinRoom(sock, code, name) {
    currentRoom = code;
    sock.join(code);

    const room = rooms[code];
    const playerIdx = Object.keys(room.players).length;
    room.players[sock.id] = {
      id: sock.id,
      name: name || `Marine ${playerIdx + 1}`,
      colorIndex: playerIdx,
      color: PLAYER_COLORS[playerIdx],
      x: (playerIdx - 1.5) * 3,
      y: 3,
      z: 15,
      yaw: 0,
      pitch: 0,
      weapon: 1,
      isFiring: false,
      isDowned: false
    };

    sock.emit('room_joined', {
      code,
      myId: sock.id,
      isHost: room.hostId === sock.id,
      players: room.players
    });

    io.to(code).emit('lobby_update', {
      players: Object.values(room.players),
      hostId: room.hostId
    });
  }

  socket.on('start_game', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    if (rooms[currentRoom].hostId !== socket.id) return;

    rooms[currentRoom].started = true;
    io.to(currentRoom).emit('game_started', {
      players: rooms[currentRoom].players
    });
  });

  // Relay 3D position & state
  socket.on('player_update', (data) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const p = rooms[currentRoom].players[socket.id];
    if (p) {
      Object.assign(p, data);
      socket.to(currentRoom).emit('remote_player_update', {
        id: socket.id,
        ...data
      });
    }
  });

  // Host broadcasts authoritative zombie positions/stages
  socket.on('host_zombie_sync', (zombieData) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    if (rooms[currentRoom].hostId !== socket.id) return;
    socket.to(currentRoom).emit('client_zombie_sync', zombieData);
  });

  // Damage / Kill events
  socket.on('zombie_hit', (data) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    io.to(rooms[currentRoom].hostId).emit('host_apply_zombie_hit', {
      ...data,
      shooterId: socket.id
    });
  });

  // Shared door unlocks
  socket.on('unlock_door', (doorIndex) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    rooms[currentRoom].doorState[doorIndex] = true;
    io.to(currentRoom).emit('door_unlocked', { doorIndex, unlockedBy: socket.id });
  });

  // Weapon fire effects relay
  socket.on('fire_shot', (data) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('remote_fire_shot', { id: socket.id, ...data });
  });

  // Grenade / Explosions
  socket.on('spawn_grenade', (gData) => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('remote_grenade', gData);
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    delete room.players[socket.id];

    if (Object.keys(room.players).length === 0) {
      delete rooms[currentRoom];
    } else {
      if (room.hostId === socket.id) {
        room.hostId = Object.keys(room.players)[0];
        io.to(room.hostId).emit('host_promoted');
      }
      io.to(currentRoom).emit('player_left', socket.id);
      io.to(currentRoom).emit('lobby_update', {
        players: Object.values(room.players),
        hostId: room.hostId
      });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Zombies 4-Player server running on port ${PORT}`);
});
