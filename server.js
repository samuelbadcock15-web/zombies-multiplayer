// --- ROBUST SERVER-AUTHORITATIVE MYSTERY BOX ---
  const boxRewards = [
    { name: "PISTOL", type: 1 },
    { name: "AUTO PISTOL", type: 2 },
    { name: "HEAVY SHOTGUN", type: 3 },
    { name: "AUTOMATIC RIFLE", type: 4 },
    { name: "RAY PISTOL", type: 5 },
    { name: "FRAG GRENADES", type: 6 },
    { name: "CLAYMORE MINE", type: 7 },
    { name: "ROBOT GOODY UPGRADE", type: 8 }
  ];

  let boxState = {
    active: false,
    readyToCollect: false,
    reward: null,
    currentRoom: 0,
    spinTimeout: null,
    collectTimeout: null
  };

  socket.on('player_spin_mystery_box', () => {
    const room = getLobbyRoom(socket.id);
    if (!room || boxState.active || boxState.readyToCollect) return;

    boxState.active = true;
    boxState.readyToCollect = false;

    // 1. Tell everyone to play cycling animation
    io.to(room).emit('trigger_mystery_box_start');

    // Pick winning reward on server
    const fr = Math.random();
    const winningReward = fr < 0.1 ? boxRewards[4] : (fr < 0.35 ? boxRewards[Math.floor(Math.random() * 4)] : (fr < 0.7 ? boxRewards[5] : (fr < 0.9 ? boxRewards[6] : boxRewards[7])));
    boxState.reward = winningReward;

    // 2. Exactly 2.5s later, land the weapon on all screens
    clearTimeout(boxState.spinTimeout);
    boxState.spinTimeout = setTimeout(() => {
      boxState.active = false;
      boxState.readyToCollect = true;

      io.to(room).emit('mystery_box_landed', {
        rewardType: winningReward.type,
        rewardName: winningReward.name
      });

      // 3. Exactly 10s window to collect
      clearTimeout(boxState.collectTimeout);
      boxState.collectTimeout = setTimeout(() => {
        if (boxState.readyToCollect) {
          boxState.readyToCollect = false;
          boxState.reward = null;
          io.to(room).emit('force_clear_mystery_box_holo');
        }
      }, 10000);
    }, 2500);
  });

  socket.on('player_collect_mystery_box', () => {
    const room = getLobbyRoom(socket.id);
    if (!room || !boxState.readyToCollect || !boxState.reward) return;

    clearTimeout(boxState.collectTimeout);
    boxState.readyToCollect = false;

    // Give weapon to collecting player
    socket.emit('grant_mystery_box_reward', {
      rewardType: boxState.reward.type,
      rewardName: boxState.reward.name
    });

    boxState.reward = null;

    // Clear box visually for everyone in lobby
    io.to(room).emit('force_clear_mystery_box_holo');
  });
