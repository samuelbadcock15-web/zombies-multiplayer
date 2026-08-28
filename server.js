const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const lobbies = [
  { id: 1, maxPlayers: 2, playerCount: 0, started: false, slots: [null, null], hostSocketId: null },
  { id: 2, maxPlayers: 3, playerCount: 0, started: false, slots: [null, null, null], hostSocketId: null },
  { id: 3, maxPlayers: 4, playerCount: 0, started: false, slots: [null, null, null, null], hostSocketId: null }
];

const playerColors = [0x00ffcc, 0xffaa00, 0xff0055, 0x9900ff];

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  socket.emit('lobby_list', lobbies);

  socket.on('join_slot', ({ lobbyId, name }) => {
    const lobby = lobbies.find(l => l.id === lobbyId);
    if (!lobby || lobby.started) return;

    lobbies.forEach(l => {
      const sIdx = l.slots.findIndex(s => s && s.socketId === socket.id);
      if (sIdx !== -1) {
        l.slots[sIdx] = null;
        l.playerCount--;
        if (l.playerCount === 0) l.started = false;
      }
    });

    const openSlotIdx = lobby.slots.findIndex(s => s === null);
    if (openSlotIdx === -1) return;

    lobby.slots[openSlotIdx] = {
      socketId: socket.id,
      name: name || `MARINE ${openSlotIdx + 1}`,
      color: playerColors[openSlotIdx],
      ready: false
    };
    lobby.playerCount++;

    if (openSlotIdx === 0) {
      lobby.hostSocketId = socket.id;
    }

    socket.join(`lobby_${lobbyId}`);
    socket.emit('slot_joined', {
      lobbyId,
      slotNumber: openSlotIdx + 1,
      myColor: playerColors[openSlotIdx],
      myId: socket.id
    });

    io.emit('lobby_list', lobbies);
  });

  socket.on('toggle_ready', () => {
    for (const lobby of lobbies) {
      const slot = lobby.slots.find(s => s && s.socketId === socket.id);
      if (slot) {
        slot.ready = !slot.ready;
        
        const allFilled = lobby.slots.every(s => s !== null);
        const allReady = lobby.slots.every(s => s !== null && s.ready);

        if (allFilled && allReady && !lobby.started) {
          lobby.started = true;
          io.to(`lobby_${lobby.id}`).emit('game_start', {
            hostSocketId: lobby.hostSocketId,
            players: lobby.slots.map(s => ({
              socketId: s.socketId,
              name: s.name,
              color: s.color,
              slotNumber: lobby.slots.indexOf(s) + 1
            }))
          });
        }
        io.emit('lobby_list', lobbies);
        break;
      }
    }
  });

  socket.on('leave_slot', () => {
    lobbies.forEach(l => {
      const sIdx = l.slots.findIndex(s => s && s.socketId === socket.id);
      if (sIdx !== -1) {
        l.slots[sIdx] = null;
        l.playerCount--;
        if (l.playerCount === 0) l.started = false;
        socket.leave(`lobby_${l.id}`);
        io.emit('lobby_list', lobbies);
      }
    });
  });

  // Host Authoritative Sync Handlers
  socket.on('host_zombie_sync', (data) => {
    socket.broadcast.emit('client_zombie_sync', data);
  });

  socket.on('host_mystery_box_sync', (data) => {
    socket.broadcast.emit('client_mystery_box_sync', data);
  });

  socket.on('host_upgrade_machine_sync', (data) => {
    socket.broadcast.emit('client_upgrade_machine_sync', data);
  });

  socket.on('host_elevator_sync', (data) => {
    socket.broadcast.emit('client_elevator_sync', data);
  });

  socket.on('host_robot_sync', (data) => {
    socket.broadcast.emit('client_robot_sync', data);
  });

  socket.on('host_round_sync', (round) => {
    socket.broadcast.emit('client_round_sync', round);
  });

  // Universal Action Requests from Non-Hosts
  socket.on('request_mystery_box', () => {
    io.emit('trigger_mystery_box_start');
  });

  socket.on('request_upgrade', (data) => {
    io.emit('trigger_upgrade_start', data);
  });

  socket.on('player_update', (data) => {
    socket.broadcast.emit('remote_player_update', { id: socket.id, ...data });
  });

  socket.on('zombie_hit', (data) => {
    io.emit('host_apply_zombie_hit', { shooterId: socket.id, ...data });
  });

  socket.on('unlock_door', (doorIndex) => {
    io.emit('door_unlocked', { doorIndex });
  });

  socket.on('fill_hole', (data) => {
    socket.broadcast.emit('sync_hole_fill', data);
  });

  socket.on('award_points', ({ socketId, amount }) => {
    io.to(socketId).emit('grant_points', amount);
  });

  socket.on('player_bitten', (targetId) => {
    io.to(targetId).emit('force_damage_player');
  });

  socket.on('disconnect', () => {
    lobbies.forEach(l => {
      const sIdx = l.slots.findIndex(s => s && s.socketId === socket.id);
      if (sIdx !== -1) {
        l.slots[sIdx] = null;
        l.playerCount--;
        if (l.playerCount === 0) l.started = false;
        io.emit('lobby_list', lobbies);
        io.to(`lobby_${l.id}`).emit('player_left', socket.id);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Haunted Mansion Vault Outbreak Server running on port ${PORT}`);
});
