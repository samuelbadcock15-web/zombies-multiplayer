const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Fixed lobbies 1 to 6
const LOBBIES = {};
for (let i = 1; i <= 6; i++) {
  LOBBIES[i] = {
    id: i,
    started: false,
    hostSocketId: null,
    slots: [null, null, null, null],
    doorState: [false, false, false, false]
  };
}

const PLAYER_COLORS = [0x00ffcc, 0xff4444, 0xffbb00, 0x9944ff];

function getLobbiesSummary() {
  return Object.values(LOBBIES).map(l => ({
    id: l.id,
    started: l.started,
    playerCount: l.slots.filter(Boolean).length,
    slots: l.slots.map((s, idx) => s ? {
      name: s.name,
      slotIndex: idx + 1,
      ready: s.ready,
      color: PLAYER_COLORS[idx],
      socketId: s.socketId
    } : null)
  }));
}

io.on('connection', (socket) => {
  let joinedLobbyId = null;
  let mySlotIdx = -1;

  socket.emit('lobby_list', getLobbiesSummary());

  socket.on('join_slot', ({ lobbyId, name }) => {
    const lobby = LOBBIES[lobbyId];
    if (!lobby) return socket.emit('error_msg', 'Invalid Lobby Number.');
    if (lobby.started) return socket.emit('error_msg', 'Mission already in progress.');

    const openIdx = lobby.slots.findIndex(s => s === null);
    if (openIdx === -1) return socket.emit('error_msg', `Lobby ${lobbyId} is full (4/4).`);

    joinedLobbyId = lobbyId;
    mySlotIdx = openIdx;

    if (!lobby.hostSocketId) {
      lobby.hostSocketId = socket.id;
    }

    lobby.slots[openIdx] = {
      socketId: socket.id,
      name: (name || `Marine ${openIdx + 1}`).toUpperCase().trim(),
      ready: false,
      slotNumber: openIdx + 1,
      color: PLAYER_COLORS[openIdx],
      x: (openIdx - 1.5) * 3,
      y: 3,
      z: 15,
      yaw: 0,
      pitch: 0
    };

    socket.join(`lobby_${lobbyId}`);

    socket.emit('slot_joined', {
      lobbyId,
      slotNumber: openIdx + 1,
      myColor: PLAYER_COLORS[openIdx],
      myId: socket.id
    });

    io.emit('lobby_list', getLobbiesSummary());
  });

  socket.on('toggle_ready', () => {
    if (!joinedLobbyId || mySlotIdx === -1) return;
    const lobby = LOBBIES[joinedLobbyId];
    if (!lobby || !lobby.slots[mySlotIdx]) return;

    lobby.slots[mySlotIdx].ready = !lobby.slots[mySlotIdx].ready;
    io.emit('lobby_list', getLobbiesSummary());

    const filledSlots = lobby.slots.filter(Boolean);
    const allFourFilled = filledSlots.length === 4;
    const allFourReady = allFourFilled && filledSlots.every(p => p.ready);

    if (allFourReady) {
      launchGame(joinedLobbyId);
    }
  });

  function launchGame(lobbyId) {
    const lobby = LOBBIES[lobbyId];
    if (!lobby) return;
    lobby.started = true;
    const activePlayers = lobby.slots.filter(Boolean);
    
    lobby.hostSocketId = activePlayers[0].socketId;

    io.to(`lobby_${lobbyId}`).emit('game_start', {
      lobbyId,
      hostSocketId: lobby.hostSocketId,
      players: activePlayers
    });
    io.emit('lobby_list', getLobbiesSummary());
  }

  socket.on('player_update', (data) => {
    if (!joinedLobbyId) return;
    socket.to(`lobby_${joinedLobbyId}`).emit('remote_player_update', {
      id: socket.id,
      ...data
    });
  });

  socket.on('host_zombie_sync', (data) => {
    if (!joinedLobbyId) return;
    socket.to(`lobby_${joinedLobbyId}`).emit('client_zombie_sync', data);
  });

  socket.on('host_round_sync', (roundNum) => {
    if (!joinedLobbyId) return;
    socket.to(`lobby_${joinedLobbyId}`).emit('client_round_sync', roundNum);
  });

  socket.on('zombie_hit', (data) => {
    if (!joinedLobbyId) return;
    const lobby = LOBBIES[joinedLobbyId];
    if (!lobby) return;
    const host = lobby.slots.find(s => s !== null);
    if (host) {
      io.to(host.socketId).emit('host_apply_zombie_hit', {
        ...data,
        shooterId: socket.id
      });
    }
  });

  socket.on('unlock_door', (doorIndex) => {
    if (!joinedLobbyId) return;
    io.to(`lobby_${joinedLobbyId}`).emit('door_unlocked', { doorIndex });
  });

  function handleLeave() {
    if (joinedLobbyId && mySlotIdx !== -1) {
      const lobby = LOBBIES[joinedLobbyId];
      if (lobby) {
        lobby.slots[mySlotIdx] = null;
        if (lobby.slots.every(s => s === null)) {
          lobby.started = false;
        }
        socket.leave(`lobby_${joinedLobbyId}`);
        io.to(`lobby_${joinedLobbyId}`).emit('player_left', socket.id);
      }
      joinedLobbyId = null;
      mySlotIdx = -1;
      io.emit('lobby_list', getLobbiesSummary());
    }
  }

  socket.on('leave_slot', () => { handleLeave(); });
  socket.on('disconnect', () => { handleLeave(); });
});

server.listen(PORT, () => {
  console.log(`Zombies Server live on port ${PORT}`);
});
