socket.on('request_upgrade_machine', data => {
    const loc = socketToPlayerMap[socket.id];
    if (!loc) return;
    // Broadcast upgrade activation to host/room
    io.to(loc.lobbyId).emit('client_upgrade_machine_sync', { active: true, readyToCollect: false, timer: 0, weaponSlot: data.weaponSlot });
  });

  socket.on('request_mystery_box_spin', () => {
    const loc = socketToPlayerMap[socket.id];
    if (!loc) return;
    io.to(loc.lobbyId).emit('client_mystery_box_sync', { active: true, readyToCollect: false, timer: 0, cyclingReward: "SUMMONING...", rewardType: 1, currentRoom: 0 });
  });

  socket.on('claim_mystery_box_reward', data => {
    const loc = socketToPlayerMap[socket.id];
    if (!loc) return;
    io.to(loc.lobbyId).emit('client_mystery_box_sync', { active: false, readyToCollect: false, timer: 0, cyclingReward: "CLAIMED", rewardType: data.rewardType, currentRoom: 0 });
  });

  socket.on('request_open_crypt', () => {
    const loc = socketToPlayerMap[socket.id];
    if (!loc) return;
    io.to(loc.lobbyId).emit('client_elevator_sync', { active: false, progress: 0, direction: 1, permanentlyOpen: true, secretActive: true });
  });

  socket.on('request_elevator_toggle', () => {
    const loc = socketToPlayerMap[socket.id];
    if (!loc) return;
    io.to(loc.lobbyId).emit('client_elevator_sync', { active: true, progress: 0.5, direction: -1, permanentlyOpen: true, secretActive: true });
  });
