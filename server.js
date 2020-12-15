const server_port = process.env.PORT || 8080
const password = process.env.PASSWORD || "password"
const server_ip_address = process.env.IP || 'localhost'
const game_title = process.env.GAME_TITLE || 'Some of these people are lying'
console.log("Environment Variables")
console.log("Title: "+game_title)
console.log("Password: "+password)

const express = require('express');
const app = express();
const { http, https } = require('follow-redirects');
const httpServer = http.createServer(app);
const io = require('socket.io')(httpServer);

let game;

app.get('/', function(req, res){
  res.sendFile(__dirname + '/www/index.html');
});
app.use('/', express.static('www'))

let unallocated_sockets = [];

io.on('connection', function(socket){
  unallocated_sockets.push(socket)
  socket.emit('connected',{gameTitle: game_title})
  console.log('Socket connecting');
  socket.on('name query', function(msg){
    console.log('name query: '+msg.playerName);
    socket.emit('name query response', {playerName: msg.playerName, status: queryName(msg.playerName)});
  });
  socket.on('join as new player', function(playerName){
    if (queryName(playerName) !== "unused") {
      console.log("A socket attempted to create "+playerName+" as a new player, when that player already exists");
      return;
    }
    console.log('player joining: '+playerName);
    game.addPlayer(playerName);
    socket.emit('you joined', {playerName: playerName});
    socket.broadcast.emit('player joined', {playerName: playerName});
    allocateSocket(socket,playerName);
  });
  socket.on('rejoin as existing player', function(playerName){
    if (queryName(playerName) !== "disconnected") {
      if (queryName(playerName) === "active") {
        console.log("A socket attempted to reconnect as "+playerName+", but that player is already connected");
      } else {
        console.log("A socket attempted to reconnect as "+playerName+", but that player does not exist");
      }
      return;
    }
    console.log('player rejoining: '+playerName);
    game.broadcast('player reconnected', {playerName: playerName});
    allocateSocket(socket,playerName);
  });
  socket.on('disconnect', function() {
    console.log("Unallocated socket disconnecting");
    console.log(unallocated_sockets.length+" unallocated socket(s) currently connected");
    unallocated_sockets.splice(unallocated_sockets.indexOf(this),1);
  });
});

function allocateSocket(socket,playerName) {
  if (!game.players[playerName].article) {
    socket.emit('article request', {playerName: playerName});
  }
  unallocated_sockets.splice(unallocated_sockets.indexOf(socket),1);
  game.players[playerName].connected = true;
  game.players[playerName].socket = socket
  game.broadcastStates();
  socket.on('disconnect', function(){
    console.log('player lost connection: '+playerName);
    game.players[playerName].connected = false;
    game.broadcast('player disconnected', {playerName: playerName});
    game.broadcastStates();
  });


  socket.on('article submission', function(msg){
    console.log(msg.playerName + " has set their article to " + msg.article);
    new Promise(function(resolve,reject) {
      let req = https.request({host:"en.wikipedia.org",path:"/wiki/"+encodeURIComponent(msg.article)},function(res){
        console.log(res.statusCode)
        if (res.statusCode === 404) {
          resolve(false)
        } else if (res.statusCode >= 200 && res.statusCode < 300 || res.statusCode === 304) {
          resolve(true)
        }
      })
      req.on('error', reject)
      req.end();
      console.log("Req ended")
    }).then(function(articleExists) {
      if (articleExists) {
        game.players[msg.playerName].article = msg.article
        socket.emit('article accepted', {playerName: playerName, article: msg.article});
        game.broadcastStates();
      } else {
        socket.emit('article rejected', {playerName: playerName, article: msg.article});
      }
    })
  })
  socket.on('start round', function(msg){
    console.log("round starting")
    let article = ""
    let randomPlayer
    for (let i = 0; i < 10;i++) {
      let filteredPlayersList = Object.keys(game.players).filter((p) => !!game.players[p].article)
      if (!filteredPlayersList.length) {break}
      randomPlayer = filteredPlayersList[Math.floor(Math.random()*filteredPlayersList.length)]
      if (game.players[randomPlayer].article) {
        article = game.players[randomPlayer].article
        game.activePlayer = randomPlayer;
        game.article = article;
        game.reveal = false;
        game.broadcastStates()
        console.log("round started")
        break
      }
    }
  })
  socket.on('end round', function(msg){
    console.log("round ended")
    game.reveal = true;
    if (game.players[game.activePlayer]) {
      game.players[game.activePlayer].article = null;
      game.players[game.activePlayer].socket.emit('article request')
    }
    game.broadcastStates()
  })

  socket.on('chat message', function(msg){
    console.log("Chat message: "+msg.playerName+": "+msg.message);
    game.broadcast('chat message',msg)
  })
  socket.on('set article', function(msg){

  })

  socket.on('remove player', function(msg){
    if (msg.password !== password) return;
    let player = game.players[msg.targetName];
    if (player.connected) {
      player.socket.disconnect();
    }
    game.broadcast('player removed',{playerName:msg.targetName})
    delete game.players[msg.targetName];
    game.broadcastStates();
  });
  socket.on('start new game',function (msg){
    if (msg.password !== password) return;
    game.broadcast('game ended')
    for (playerName in game.players) {
      if (game.players.hasOwnProperty(playerName)) {
        game.players[playerName].socket.disconnect();
        delete game.players[playerName].socket; // IDK if this is necessary, but it's good to collect your garbage
        delete game.players[playerName];
        console.log("deleting "+playerName);
      } else {
        // TODO: Error Condition=
      }
    }
    game = newGame(msg);
  })
}

function queryName(playerName) {
  for (let usedName in game.players) {
    if (usedName === playerName) {
      if (game.players[playerName].connected === true) return "active";
      else return "disconnected";
    }
  }
  return "unused";
}

httpServer.listen(server_port, function(){
  console.log('listening on '+server_ip_address+':'+server_port);
});



const emptyGame = {
  players: {},
  article: null,
  reveal: true ,
  chooser: "",
  activePlayer: null,
  addPlayer: function(playerName) {
    this.players[playerName] = {
      playerName: playerName,
      article: null,
      connected: false,
    };
  },
  broadcast: function(message,...args) {
    io.emit(message,...args)
  },
  broadcastStates: function() {
    let state = {
      players: {},
      displayArticle: this.article,
      gameTitle: game_title,
      reveal: game.reveal
    }
    for (let otherPlayerName in this.players) {
      state.players[otherPlayerName] = {
        playerName: otherPlayerName,
        connected: this.players[otherPlayerName].connected,
        hasArticle: !!this.players[otherPlayerName].article
      }
    }
    for (let playerName in this.players) {
      if (this.players[playerName].connected) {
        state.chosenArticle = this.players[playerName].article;
        state.playerName = playerName;
        state.createdOn = Date.now();
        this.players[playerName].socket.emit('game state update',state);
      }
    }
    console.log("Update sent");
  },
  findSocketByPlayerName: function(playerName) {
    if (this.players[playerName].connected) {
      return this.players[playerName].socket
    } else return false;
  }
}
//emptyGame.giveBackCard = emptyGame.takeBackCard

function newGame() {
  game = Object.create(emptyGame)
  game.players = {...game.players}
  return game;
}
// Helper functions
function repeatArray(arr, count) {
  let ln = arr.length;
  let b = new Array(ln*count);
  for(let i=0; i<ln*count; i++) {
    b[i] = (arr[i%ln]);
  }
  return b;
}

game = newGame()
