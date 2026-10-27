const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(express.static(__dirname));

const lobbies = [
  { id: 1, maxPlayers: 2, playerCount: 0, started: false, slots: [null, null], hostSocketId: null },
  { id: 2, maxPlayers: 3, playerCount: 0, started: false, slots: [null, null, null], hostSocketId: null },
  { id: 3, maxPlayers: 4, playerCount: 0, started: false, slots: [null, null, null, null], hostSocketId: null }
];

const playerColors = [0x00ffcc, 0xffaa00, 0xff0055, 0x9900ff];
const upgradeStates = {};

function getLobbyBySocket(socketId) {
  return lobbies.find(l => l.slots.some(s => s && s.socketId === socketId));
}

function getLobbyRoom(socketId) {
  const lobby = getLobbyBySocket(socketId);
  return lobby ? `lobby_${lobby.id}` : null;
}

function clearUpgradeTimer(socketId) {
  if (upgradeStates[socketId] && upgradeStates[socketId].intervalId) {
    clearInterval(upgradeStates[socketId].intervalId);
    upgradeStates[socketId].intervalId = null;
  }
}

io.on('connection', (socket) => {
  console.log(`Marine connected: ${socket.id}`);

  upgradeStates[socket.id] = {
    active: false,
    timer: 0,
    weaponSlot: 1,
    intervalId: null
  };

  socket.emit('lobby_list', lobbies);
  socket.emit('sync_upgrade_state', {
    active: false,
    timer: 0,
    weaponSlot: 1
  });

  socket.on('join_slot', ({ lobbyId, name }) => {
    const lobby = lobbies.find(l => l.id === lobbyId);
    if (!lobby || lobby.started) return;

    // Leave any other slots in all lobbies first
    lobbies.forEach(l => {
      const sIdx = l.slots.findIndex(s => s && s.socketId === socket.id);
      if (sIdx !== -1) {
        l.slots[sIdx] = null;
        l.playerCount--;
        socket.leave(`lobby_${l.id}`);

        if (l.playerCount === 0) {
          l.started = false;
          l.hostSocketId = null;
        } else if (l.hostSocketId === socket.id) {
          const nextHost = l.slots.find(s => s !== null);
          l.hostSocketId = nextHost ? nextHost.socketId : null;
        }
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

    if (!lobby.hostSocketId) {
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
        socket.leave(`lobby_${l.id}`);

        if (l.playerCount === 0) {
          l.started = false;
          l.hostSocketId = null;
        } else if (l.hostSocketId === socket.id) {
          const nextHost = l.slots.find(s => s !== null);
          l.hostSocketId = nextHost ? nextHost.socketId : null;
        }

        io.emit('lobby_list', lobbies);
      }
    });
  });

  // --- UPGRADE ALTAR (PACK-A-PUNCH) ---
  socket.on('start_upgrade_ritual', (data) => {
    const state = upgradeStates[socket.id];
    if (!state || state.active) return;

    clearUpgradeTimer(socket.id);

    state.active = true;
    state.timer = 0;
    state.weaponSlot = data.weaponSlot;

    state.intervalId = setInterval(() => {
      if (!upgradeStates[socket.id]) {
        clearInterval(state.intervalId);
        return;
      }

      state.timer += 1;
      if (state.timer >= 5) {
        clearInterval(state.intervalId);
        state.intervalId = null;
        state.active = false;
        state.timer = 0;
        socket.emit('grant_upgrade_success', state.weaponSlot);
      }

      socket.emit('sync_upgrade_state', {
        active: state.active,
        timer: state.timer,
        weaponSlot: state.weaponSlot
      });
    }, 1000);

    socket.emit('sync_upgrade_state', {
      active: state.active,
      timer: state.timer,
      weaponSlot: state.weaponSlot
    });
  });

  // --- CO-OP POSITION & ACTION SYNC ---
  socket.on('player_update', (data) => {
    const room = getLobbyRoom(socket.id);
    if (room) {
      socket.to(room).emit('remote_player_update', { id: socket.id, ...data });
    }
  });

  socket.on('player_weapon_change', (data) => {
    const room = getLobbyRoom(socket.id);
    if (room) {
      socket.to(room).emit('remote_weapon_change', { id: socket.id, weaponId: data.weaponId });
    }
  });

  socket.on('throw_grenade_sync', (data) => {
    const room = getLobbyRoom(socket.id);
    if (room) {
      socket.to(room).emit('client_throw_grenade', data);
    }
  });

  socket.on('place_claymore_sync', (data) => {
    const room = getLobbyRoom(socket.id);
    if (room) {
      socket.to(room).emit('client_place_claymore', data);
    }
  });

  // --- BARRICADE & BURROW HOLE SYNC ---
  socket.on('sync_archway_tear', (data) => {
    const room = getLobbyRoom(socket.id);
    if (room) {
      socket.to(room).emit('client_archway_tear', data);
    }
  });

  socket.on('repair_archway', (data) => {
    const room = getLobbyRoom(socket.id);
    if (room) {
      io.to(room).emit('client_archway_repaired', data);
      socket.emit('grant_points', 10);
    }
  });

  socket.on('sync_hole_dig', (data) => {
    const room = getLobbyRoom(socket.id);
    if (room) {
      socket.to(room).emit('sync_hole_dig', data);
    }
  });

  socket.on('fill_hole', (data) => {
    const room = getLobbyRoom(socket.id);
    if (room) {
      socket.to(room).emit('sync_hole_fill', data);
    }
  });

  // --- HOST WORLD SIMULATION SYNC ---
  socket.on('host_zombie_sync', (data) => {
    const lobby = getLobbyBySocket(socket.id);
    if (lobby && lobby.hostSocketId === socket.id) {
      socket.to(`lobby_${lobby.id}`).emit('client_zombie_sync', data);
    }
  });

  socket.on('host_saws_sync', (data) => {
    const lobby = getLobbyBySocket(socket.id);
    if (lobby && lobby.hostSocketId === socket.id) {
      socket.to(`lobby_${lobby.id}`).emit('client_saws_sync', data);
    }
  });

  socket.on('host_round_sync', (round) => {
    const lobby = getLobbyBySocket(socket.id);
    if (lobby && lobby.hostSocketId === socket.id) {
      socket.to(`lobby_${lobby.id}`).emit('client_round_sync', round);
    }
  });

  socket.on('host_mystery_box_sync', (data) => {
    const lobby = getLobbyBySocket(socket.id);
    if (lobby && lobby.hostSocketId === socket.id) {
      socket.to(`lobby_${lobby.id}`).emit('client_mystery_box_sync', data);
    }
  });

  socket.on('host_elevator_sync', (data) => {
    const lobby = getLobbyBySocket(socket.id);
    if (lobby && lobby.hostSocketId === socket.id) {
      socket.to(`lobby_${lobby.id}`).emit('client_elevator_sync', data);
    }
  });

  socket.on('host_robot_sync', (data) => {
    const lobby = getLobbyBySocket(socket.id);
    if (lobby && lobby.hostSocketId === socket.id) {
      socket.to(`lobby_${lobby.id}`).emit('client_robot_sync', data);
    }
  });

  // --- INTERACTABLES & TRIGGERS ---
  socket.on('player_spin_mystery_box', () => {
    const room = getLobbyRoom(socket.id);
    if (room) {
      io.to(room).emit('trigger_mystery_box_start');
    }
  });

  socket.on('player_collect_mystery_box', () => {
    const room = getLobbyRoom(socket.id);
    if (room) {
      socket.emit('grant_mystery_box_reward');
      io.to(room).emit('force_clear_mystery_box_holo');
    }
  });

  socket.on('request_hire_robot', () => {
    const room = getLobbyRoom(socket.id);
    if (room) {
      io.to(room).emit('trigger_hire_robot');
    }
  });

  socket.on('request_elevator_trigger', (data) => {
    const room = getLobbyRoom(socket.id);
    if (room) {
      io.to(room).emit('trigger_elevator_start', data);
    }
  });

  socket.on('request_hidden_button', () => {
    const room = getLobbyRoom(socket.id);
    if (room) {
      io.to(room).emit('trigger_hidden_button');
    }
  });

  socket.on('zombie_hit', (data) => {
    const room = getLobbyRoom(socket.id);
    if (room) {
      io.to(room).emit('apply_zombie_hit', data);
      const pts = data.isHeadshot ? 40 : 20;
      socket.emit('grant_points', pts);
      socket.emit('hit_registered', {
        zombieId: data.zombieId,
        isHeadshot: data.isHeadshot,
        killed: data.damage >= 3,
        pointsAwarded: pts
      });
    }
  });

  socket.on('unlock_door', (doorIndex) => {
    const lobby = getLobbyBySocket(socket.id);
    if (!lobby) return;

    const target = io.to(`lobby_${lobby.id}`);
    let doorsToOpen = [];
    if (doorIndex === 0 || doorIndex === 1) {
      doorsToOpen = [0, 1];
    } else if (doorIndex === 2 || doorIndex === 3) {
      doorsToOpen = [2, 3];
    } else {
      doorsToOpen = [doorIndex];
    }

    doorsToOpen.forEach((idx) => {
      target.emit('door_unlocked', { doorIndex: idx });
    });
  });

  socket.on('award_points', ({ socketId, amount }) => {
    io.to(socketId).emit('grant_points', amount);
  });

  socket.on('player_bitten', (targetId) => {
    io.to(targetId).emit('force_damage_player');
  });

  socket.on('disconnect', () => {
    clearUpgradeTimer(socket.id);
    delete upgradeStates[socket.id];

    lobbies.forEach(l => {
      const sIdx = l.slots.findIndex(s => s && s.socketId === socket.id);
      if (sIdx !== -1) {
        l.slots[sIdx] = null;
        l.playerCount--;

        io.to(`lobby_${l.id}`).emit('player_left', socket.id);

        if (l.playerCount === 0) {
          l.started = false;
          l.hostSocketId = null;
        } else if (l.hostSocketId === socket.id) {
          const nextHost = l.slots.find(s => s !== null);
          l.hostSocketId = nextHost ? nextHost.socketId : null;
        }

        io.emit('lobby_list', lobbies);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
