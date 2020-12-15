// Globals

let game = {}

jQuery(function(){

  const admin = new URLSearchParams(window.location.search).has('admin');
  let password = "";
  if (admin) {
    password = new URLSearchParams(window.location.search).get('admin');
    console.log("Showing admin buttons");
    $("#new-game-button-container").removeClass("hidden");
    $("#new-game-submit-button").on("click",newGame);
    function newGame() {
      socket.emit("start new game",{password:password})
    }
    $("#players-sidebar").addClass("admin-padding")
  }

  const socket = io();

  const disconnectedAlertElement = $("#disconnected-alert");
  socket.on('disconnect', function(){
    $("#shade").removeClass("hidden");
    disconnectedAlertElement.removeClass("hidden")
  })
  socket.on('game title', function(msg) {
    $(document).prop('title', msg.gameTitle);
  })

  socket.on('connect', function(){
    disconnectedAlertElement.addClass("hidden");
    if (game && game.playerName) {
      socket.emit("rejoin as existing player",game.playerName)
    }
  })
  socket.on('connected', function(msg) {
    $(document).prop('title', msg.gameTitle);
  })
  disconnectedAlertElement.on("click",reconnect)
  function reconnect() {
    /*console.log("reconnecting");
    $("#shade").addClass("hidden")
    $("#disconnected-alert").addClass("hidden")
    socket = io()
    socket.emit("name query", {playerName:game.playerName});*/
  }

  function submitName() {
    let name = $("#name-field").val();
    if (name.length < 2) {
      $("#name-error-alert").removeClass("hidden").text("This name is too short. Please try another");
    } else if (name.length > 32) {
      $("#name-error-alert").removeClass("hidden").text("This name is too long. Please try another");
    } else {
      socket.emit("name query", {playerName:name});
    }
  }
  $("#name-join-button").on("click",submitName)

  socket.on('name query response', function(msg){
    if (msg.status==="active") {
      $("#name-error-alert").removeClass("hidden").text("This name is already in use. Please try another");
    } else if (msg.status==="disconnected") {
      socket.emit("rejoin as existing player",msg.playerName)
      hideNamePrompt();
    } else if (msg.status==="unused") {
      socket.emit("join as new player",msg.playerName)
      hideNamePrompt();
    } else {
      console.log("ERROR");
    }
  });
  function hideNamePrompt(){
    $("#shade").addClass("hidden");
    $("#name-dialog").addClass("hidden");
  }

  socket.on("article request", function(msg){
    console.log("Article request received")
    $("#article-input").removeClass('hidden')
    $("#chosen-article-title").addClass('hidden')
    $("#chosen-article-intro-text").text("Please enter the name of your article")
  })

  $("#article-send-button").on("click",function(){
    const submitField = $("#article-field")
    let message = submitField.val();
    submitField.val("")
    console.log(message)
    socket.emit('article submission',{article:message,playerName:game.playerName})
  })

  socket.on("article accepted", function(msg) {
    console.log("Article set to "+msg.article)
    $("#article-input").addClass('hidden')
    $("#chosen-article-title").removeClass('hidden').text(msg.article)
    $("#chosen-article-intro-text").text("Your article is:")
  })

  socket.on("article rejected", function(msg){
    console.log("Article request received")
    $("#article-input").removeClass('hidden')
    $("#chosen-article-title").addClass('hidden')
    $("#chosen-article-intro-text").text("Article does not exist. Please enter the name of your article")
  })



  socket.on('game state update', onStateUpdate);

  function onStateUpdate(state) {
    $(document).prop('title', state.gameTitle);
    //console.log("update received");
    //console.log(state);
    game = state

    // Players list consistency Check
    const playersListElements = $("#players-list li");
    const playerCount = playersListElements.length;
    let playersOK = (playerCount === Object.keys(state.players).length);
    for (let i = 0; i < playerCount; i++) {
      let card = $(`#players-list li:nth-child(${i+1})`);
      let playerName = card.children("span.player-name").text();
      let connected = card.hasClass("connected");
      let hasArticle = card.hasClass("has-article");
      playersOK = playersOK && state.players[playerName].connected === connected && state.players[playerName].hasArticle === hasArticle;
    }
    if (!playersOK) {
      playersListElements.remove()
      for (let player in state.players) {
      appendPlayer(state.players[player]);
      }
    }
    if (state.chosenArticle) {
      $("#article-input").addClass('hidden')
      $("#chosen-article-title").removeClass('hidden').text(state.chosenArticle)
      $("#chosen-article-intro-text").text("Your article is:")
    }
    $('#display-article-title').text(state.displayArticle)
    console.log(state.reveal);
    let frame = $('#display-article-frame');
    if (state.reveal && state.displayArticle) {
      $("#display-article-intro-text").text("Last round's article was:")
      if (frame.attr('src') !== state.displayArticle) {
        frame.attr('src',"https://en.wikipedia.org/wiki/"+state.displayArticle);
      }
    } else {
      $("#display-article-intro-text").text("This round's article is:")
    }
  }
  function appendPlayer(player) {
    $('#players-list')
      .append($('<li>')
      .addClass("list-group-item")
      .addClass("player-card")
      .addClass(player.playerName === game.playerName ? "this-player" : "other-player")
      .addClass(player.connected ? "connected" : "disconnected")
      .addClass(player.hasArticle ? "has-article" : "has-no-article")
      .html(`<span class="player-name">${player.playerName}</span>`)
    );
    if (admin) {
      let card = $('#players-list li:nth-last-child(1)')
      card.append(
        $('<input type="button" value="K">')
        .addClass("btn btn-sm btn-danger player-admin-button")
        .on("click",function(){kickPromptPlayer(player.playerName,card)})
      )
    }
  }
  $("#advance-button").on("click",function(){
    if (!game.reveal) {
      socket.emit("end round")
    } else {
      socket.emit("start round")
    }
  })

  function kickPromptPlayer(playerName,cardElement) {
    if (cardElement.children(".kick-button").length === 1) {
      cardElement.children(".kick-button").remove();
    } else {
      cardElement.append($('<input type="button" value="Kick?">').addClass("btn btn-sm btn-danger player-admin-button kick-button")
      .on("click",function(){kickPlayer(playerName)}))
    }
  }
  function kickPlayer(playerName) {
    socket.emit("remove player",{targetName:playerName,password:password})
  }

  socket.on("player removed",removePlayer)
  function removePlayer(msg) {
    let count = $("#players-list li").length;
    for (let i = 0; i < count; i++) {
      let card = $(`#players-list li:nth-child(${i+1})`);
      let playerName = card.children("span.player-name").text();
      if (playerName === msg.playerName) {
        card.remove();
        return;
      }
    }
  }
  socket.on("game ended", gameEnded)
  function gameEnded() {
    disconnectedAlertElement.text("The game  has ended. Please refresh the page to join a new game").removeClass("hidden")
    $("#shade").removeClass("hidden")
  }
  /*appendPlayer({playerName:"Sam", handSize:3, connected: true})
  appendPlayer({playerName:"Kate", handSize:17, connected: false})
  handList = ["3H","AH","XC"]
  for (i of handList) { appendCardToHand(i)};
  discardList = ["6S","JC","9D","QC","2D","5S","4H","7C","8S","KD"]
  for (i of discardList) { appendCardToDiscard(i)}
  onStateUpdate({hand:handList,discard:discardList,deckSize:144,players:{Sam:{playerName:"Sam", handSize:3, connected: true}, Kate:{playerName:"Kate", handSize:17, connected: false}}})*/

});
