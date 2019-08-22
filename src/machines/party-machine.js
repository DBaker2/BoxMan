import * as XState from 'xstate';
import Peer from 'simple-peer';

import XIRSYS_SECRET from '../xirsys.secret';
import config from '../config';

const { Machine } = XState;

const { assign, send, sendParent } = XState.actions;

window.peers = [];
window.remoteStreams = [];

const emit = emitting => console.log('emitting', emitting);

function addPeer(
  isInitiator,
  socket,
  myUsername,
  iceServers,
  peerUsername,
  partyMachineCallback,
) {
  const peer = new Peer({
    initiator: isInitiator,
    channelName: 'whatever-boxman',
    config: { iceServers },
    trickle: false,
    streams: window.localStream ? [window.localStream] : [],
  });

  peer.username = peerUsername;
  // if (initiator === false) {
  //   peer.signal(data);
  // }

  peer.on('signal', d => {
    console.log('🛑 sending to socket', JSON.stringify(d));
    socket.send(
      JSON.stringify({
        from: myUsername,
        to: peerUsername,
        type: 'signal',
        payload: d,
      }),
    );
    // if (!peer.destroyed) peer.signal(d);
  });

  peer.on('connect', () => {
    peer.send(`🤑🤑🤑🤑🤑you successfully connected to me, ${myUsername}`);
    partyMachineCallback({ type: 'PEER_CONNECT', peer });
  });

  peer.on('data', data => {
    emit({ type: 'PEER_DATA' });
    console.log(`data: ${data}`);
  });

  peer.on('stream', stream => {
    emit({ type: 'PEER_STREAM' });
    console.log(`stream: ${stream}`);
    window.remoteStreams = [stream, ...window.remoteStreams];
    console.log('window.remoteStreams', window.remoteStreams);
  });

  peer.on('error', err => {
    console.error('caught error', err);
  });

  console.log('🔥  peer', peer);
  return peer;
}

const fetchIceServers = () => fetch('https://global.xirsys.net/_turn/FourthPerson/', {
  method: 'PUT',
  headers: new Headers({ Authorization: `Basic ${btoa(XIRSYS_SECRET)}` }),
})
  .then(response => {
    console.log('response', response);
    return response.json();
  })
  .then(data => {
    if (data.s === 'ok') {
      // data.v is where the ICE servers object lives
      return data.v;
    }
    throw new Error(data.s);
  });

// const socketMachine = Machine(
//   {
//     id: 'socketMachine',
//     initial: 'connecting',
//     context: {
//       socket: null,
//     },
//     states: {
//       connecting: {
//         onEntry: () => console.log('entered state'),
//         invoke: {
//           id: 'socketEvents',
//           // src:
//         },
//         on: {
//           CONNECTED_TO_SOCKET: 'connected',
//           actions: (ctx, event) => console.log('🔥  ctx', ctx),
//         },
//       },
//       connected: {
//         // probably don't do this
//         onEntry: () => {
//           // addPeer({ initiator: false });
//         },
//         on: {
//           DISCONNECT: 'notConnected',
//           OFFER: 'handshaking',
//         },
//       },
//       handshaking: {},
//     },
//   },
//   {},
//   null,
//   { log: true },
// );

const partyMachine = Machine({
  id: 'party',
  initial: 'notConnected',
  context: {
    partyName: null,
    username: 'me',
    role: null,
    peerNetwork: {},
    iceServers: [],
  },
  states: {
    notConnected: {
      invoke: {
        id: 'ice',
        src: fetchIceServers,
        onDone: {
          actions: assign({
            iceServers: (ctx, event) => console.log('🔥  event', event) || event.data.iceServers,
          }),
        },
        onError: (ctx, event) => {
          console.log('🔥ice servers failed event', event);
        },
      },
      on: {
        REQUEST_TO_ENTER_PARTY: {
          target: 'connecting',
          actions: assign((ctx, event) => ({
            partyName: event.payload.partyName,
            username: event.payload.username,
            role: event.payload.role,
          })),
        },
      },
    },
    connecting: {
      /* 💁 I'm not using a separate socketMachine because it looked like xstate was broken for communicating between services  */
      invoke: {
        id: 'socket',
        src: (ctx, event) => callback => {
          const socket = new WebSocket(
            // 'wss://boxman-signaling-server.now.sh'
            `wss://${config.SOCKET_SERVER_ADDRESS}:443`,
          );

          console.log('🔥  socket', socket);

          socket.addEventListener('open', _event => {
            console.log('🔥  socket.readyState', socket.readyState);
            socket.send(
              JSON.stringify({
                type: 'new member',
                role: ctx.role,
                username: ctx.username,
                partyName: ctx.partyName,
              }),
            );
            callback({ type: 'CONNECTED_TO_SOCKET' });
          });

          socket.addEventListener('message', event => {
            try {
              const messageData = JSON.parse(event.data);
              console.log('socket message received', messageData);

              switch (messageData.type) {
                case 'others':
                  if (messageData.count === 0) {
                    callback({ type: 'NO_ONE_ELSE_IS_IN_YOUR_PARTY' });
                  } else {
                    console.log('🔥  messageData.payload', messageData.payload);
                    messageData.payload.forEach(otherUsername => {
                      window.peers = [
                        ...(window.peers || []),
                        addPeer(
                          false,
                          socket,
                          ctx.username,
                          ctx.iceServers,
                          otherUsername,
                          callback,
                        ),
                      ];
                    });
                  }
                  break;

                case 'new member':
                  console.log('🔥  adding peer as initiator');
                  window.peers = [
                    ...(window.peers || []),
                    addPeer(
                      true,
                      socket,
                      ctx.username,
                      ctx.iceServers,
                      messageData.username,
                      callback,
                    ),
                  ];
                  break;

                case 'signal':
                  const signal = JSON.stringify(messageData.payload);

                  switch (messageData.payload.type) {
                    case 'offer':
                      // very side-effectful
                      console.log('🔥  received peer offer from websocket');
                      window.peers.forEach(peer => {
                        if (
                          !peer.destroyed
                          && peer.username === messageData.from
                        ) peer.signal(signal);
                      });
                      break;

                    case 'answer':
                      // socketService.send('ANSWER', { payload: messageData });
                      console.log('🔥  received peer answer from websocket');

                      window.peers.forEach(peer => {
                        console.log(
                          '🔥  window.peers.length',
                          window.peers.length,
                        );
                        if (
                          !peer.destroyed
                          && peer.username === messageData.from
                        ) peer.signal(signal);
                      });
                      break;

                    case 'candidate':
                      console.log('🔥  received peer candidate from websocket');

                      // socketService.send('CANDIDATE', { payload: messageData });

                      // very side-effectful
                      window.peers.forEach(peer => {
                        if (
                          !peer.destroyed
                          && peer.username === messageData.from
                        ) peer.signal(signal);
                      });
                      break;

                    default:
                      console.warn('other signal data', messageData);
                  }
                  break;
                default:
                  console.warn('other message data', messageData);
              }
            } catch (e) {
              console.error('error in socket message listener', e);
            }
          });

          socket.addEventListener('close', evt => {
            console.log('websocket close event', evt);
            emit({
              type: 'SOCKET_CLOSE',
              evt,
            }); /** 🔮 do something */
          });

          socket.addEventListener('error', e => {
            console.error('websocket error', e);
            console.log('e.target.url', e.target.url);
            window.open(e.target.url.replace('wss', 'https'));
            emit({
              type: 'SOCKET_ERROR',
              e,
            }); /** 🔮 do something */
          });

          return () => {
            console.log('🌧️️️️🌧️️️️🌧️️️️🌧️️️️🌧️️️️🌧️️️️🌧️️️️🌧️️️️unsub');
          };
        },
      },
      // onEntry: () => console.log('🔥  CONNECT') || send('CONNECT', { to: 'socket' }),
      on: {
        PEER_CONNECT: 'connected',
      },
    },
    connected: {},
  },
});

/* eslint-disable  */
// const socketService = interpret(socketMachine)
//   .onTransition(state => {
//     true && console.log('CONTEXT:', state.context);
//     true && console.log('STATE', state.value);
//   })
//   .onEvent(e => true && console.log('EVENT:', e))
//   .start();
// const partyService = interpret(partyMachine)
//   .onTransition(state => {
//     true && console.log('CONTEXT:', state.context);
//     true && console.log('STATE', state.value);
//   })
//   .onEvent(e => true && console.log('EVENT:', e))
//   .start();
/* eslint-enable  */

// partyService.send({ type: 'REQUEST_TO_ENTER_PARTY' });

export default partyMachine;
