const chalk = require('chalk');
const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });
console.log('wss', Boolean(wss));

// Broadcast to all.
// 🤯 get eslint rules working again, so functions like this that are unused get flaagged (maybe)
wss.broadcast = function broadcast(data) {
  wss.clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
};

wss.on('connection', function connection(ws) {
  console.log(
    chalk.green('new connection'),
    chalk.grey(`current num connections: ${wss.clients.size}`)
  );

  ws.on('message', function incoming(data) {
    console.log(
      'incoming message',
      chalk.grey(`${data.substring(0, 40)}${data.length > 40 ? '...' : ''}`)
    );
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'offer') {
        /** 🔮 probably eventually only broadcast to your channel name */
        broadcastToOthers(wss.clients, ws, data);
      } else if (parsed.type === 'answer') {
        /** 🤔 should this be to all others? probably not, but haven't thought through */
        broadcastToOthers(wss.clients, ws, data);
      } else if (parsed.candidate) {
        /** 🤔 should this be to all others? probably not, but haven't thought through */
        broadcastToOthers(wss.clients, ws, data);
      }
    } catch (e) {
      console.error('JSON parse fail', e);
    }
  });

  ws.on('error', function(err) {
    console.log('error', err);
  });
});

// clients is a Set
function broadcastToOthers(clients /*: Set*/, ws, data) {
  // console.log('clients', clients);
  console.log('clients.size', clients.size);
  // Broadcast to everyone else.
  clients.forEach(function each(client) {
    if (client.readyState === WebSocket.OPEN) {
      if (client !== ws) {
        client.send(data);
      } else if (client === ws) {
        const x = `{"type": "rebound", "data": ${data}}`;
        // debugger;
        client.send(x);
      }
    }
  });
}
