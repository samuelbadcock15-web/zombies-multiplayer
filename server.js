const expressApp = require('express');

const http = require('http');

const { Server } = require('socket.io');



const app = expressApp();

const server = http.createServer(app);

const io = new Server(server);



app.use(expressApp.static(__dirname));



const lobbies = [

  { id: 1, maxPlayers: 2, slots: [null, null], playerCount: 0, started: false },

  { id: 2, maxPlayers: 2, slots: [null, null], playerCount: 0, started: false },

  { id: 3, maxPlayers: 3, slots: [null, null, null], playerCount: 0, started: false },

  { id: 4, maxPlayers: 3, slots: [null, null, null], playerCount: 0, started: false },

  { id: 5, maxPlayers: 4, slots: [null, null, null, null], playerCount: 0, started: false },

  { id: 6, maxPlayers: 4, slots: [null, null, null, null], playerCount: 0, started: false }

];



const playerColors = [0x00ffcc, 0xff0055, 0x00a8ff, 0xffaa00];

const socketToPlayerMap = {};



function broadcastLobbyList() {

  io.emit('lobby_list', lobbies.map(l => ({

    id: l.id,

    maxPlayers: l.maxPlayers,

    playerCount: l.playerCount,

    started: l.started,

    slots: l.slots

  })));

}



io.on('connection', socket => {

  console.log('Player connected:', socket.id);

  broadcastLobbyList();



  socket.on('join_slot', data => {

    const lobby = lobbies.find(l => l.id === data.lobbyId);

    if (!lobby || lobby.started) return;



    leaveCurrentLobby(socket);



    let slotIdx = lobby.slots.findIndex(s => s === null);

    if (slotIdx === -1) return;



    const assignedColor = playerColors[slotIdx % playerColors.length];

    const playerInfo = {

      socketId: socket.id,

      slotNumber: slotIdx + 1,

      name: (data.name || 'MARINE').substring(0, 12),

      color: assignedColor,

      ready: false

    };



    lobby.slots[slotIdx] = playerInfo;

    lobby.playerCount++;

    socketToPlayerMap[socket.id] = { lobbyId: lobby.id, slotIndex: slotIdx };



    socket.join(lobby.id);



    socket.emit('slot_joined', {

      lobbyId: lobby.id,

      slotNumber: playerInfo.slotNumber,

      myColor: assignedColor,

      myId: socket.id

    });



    broadcastLobbyList();

  });



  socket.on('toggle_ready', () => {

    const loc = socketToPlayerMap[socket.id];

    if (!loc) return;

    const lobby = lobbies.find(l => l.id === loc.lobbyId);

    if (!lobby || lobby.started) return;



    const slot = lobby.slots[loc.slotIndex];

    if (slot) {

      slot.ready = !slot.ready;

      broadcastLobbyList();



      const allFilled = lobby.playerCount === lobby.maxPlayers && lobby.slots.every(s => s !== null);

      const allReady = lobby.slots.every(s => s !== null && s.ready);



      if (allFilled && allReady) {

        lobby.started = true;

        const hostSocketId = lobby.slots[0].socketId;

        

        io.to(lobby.id).emit('game_start', {

          hostSocketId: hostSocketId,

          players: lobby.slots.map(pl => ({

            socketId: pl.socketId,

            slotNumber: pl.slotNumber,

            name: pl.name,

            color: pl.color

          }))

        });

        

        broadcastLobbyList();

      }

    }

  });



  socket.on('leave_slot', () => {

    leaveCurrentLobby(socket);

    broadcastLobbyList();

  });



  socket.on('player_update', data => {

    const loc = socketToPlayerMap[socket.id];

    if (!loc) return;

    socket.to(loc.lobbyId).emit('remote_player_update', {

      id: socket.id,

      x: data.x,

      y: data.y,

      z: data.z,

      yaw: data.yaw,

      pitch: data.pitch

    });

  });



  socket.on('zombie_hit', data => {

    io.emit('host_apply_zombie_hit', {

      zombieIndex: data.zombieIndex,

      damage: data.damage,

      isHeadshot: data.isHeadshot,

      shooterId: socket.id

    });

  });



  socket.on('award_points', data => {

    io.to(data.socketId).emit('grant_points', data.amount);

  });



  socket.on('host_zombie_sync', zombies => {

    const loc = socketToPlayerMap[socket.id];

    if (!loc) return;

    socket.to(loc.lobbyId).emit('client_zombie_sync', zombies);

  });



  socket.on('host_round_sync', r => {

    const loc = socketToPlayerMap[socket.id];

    if (!loc) return;

    socket.to(loc.lobbyId).emit('client_round_sync', r);

  });



  socket.on('unlock_door', doorIndex => {

    const loc = socketToPlayerMap[socket.id];

    if (!loc) return;

    io.to(loc.lobbyId).emit('door_unlocked', { doorIndex });

  });



  socket.on('player_bitten', targetSocketId => {

    io.to(targetSocketId).emit('force_damage_player');

  });



  socket.on('sync_hole_dig', data => {

    const loc = socketToPlayerMap[socket.id];

    if (!loc) return;

    socket.to(loc.lobbyId).emit('sync_hole_dig', data);

  });



  socket.on('fill_hole', data => {

    const loc = socketToPlayerMap[socket.id];

    if (!loc) return;

    socket.emit('grant_points', 5);

    socket.to(loc.lobbyId).emit('sync_hole_fill', data);

  });



  socket.on('host_mystery_box_sync', data => {

    const loc = socketToPlayerMap[socket.id];

    if (!loc) return;

    socket.to(loc.lobbyId).emit('client_mystery_box_sync', data);

  });



  socket.on('host_upgrade_machine_sync', data => {

    const loc = socketToPlayerMap[socket.id];

    if (!loc) return;

    socket.to(loc.lobbyId).emit('client_upgrade_machine_sync', data);

  });



  socket.on('host_elevator_sync', data => {

    const loc = socketToPlayerMap[socket.id];

    if (!loc) return;

    socket.to(loc.lobbyId).emit('client_elevator_sync', data);

  });



  socket.on('host_robot_sync', data => {

    const loc = socketToPlayerMap[socket.id];

    if (!loc) return;

    socket.to(loc.lobbyId).emit('client_robot_sync', data);

  });



  socket.on('disconnect', () => {

    leaveCurrentLobby(socket);

    console.log('Player disconnected:', socket.id);

    broadcastLobbyList();

  });

});



function leaveCurrentLobby(socket) {

  const loc = socketToPlayerMap[socket.id];

  if (!loc) return;

  const lobby = lobbies.find(l => l.id === loc.lobbyId);

  if (lobby) {

    lobby.slots[loc.slotIndex] = null;

    lobby.playerCount = Math.max(0, lobby.playerCount - 1);

    if (lobby.playerCount === 0) lobby.started = false;

  }

  socket.leave(loc.lobbyId);

  delete socketToPlayerMap[socket.id];

  socket.broadcast.emit('player_left', socket.id);

}



const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {

  console.log(`Outbreak server running on port ${PORT}`);

});
