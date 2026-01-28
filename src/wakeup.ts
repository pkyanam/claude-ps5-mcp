/**
 * PS5 Wake Module
 * Sends wake packets to PS5 consoles
 */

import dgram from 'dgram';
import type { WakeParams } from './types.js';

const DDP_CLIENT_TYPE = 'vr';
const DDP_AUTH_TYPE = 'R';
const DDP_MODEL = 'w';
const DDP_APP_TYPE = 'r';
const BIND_PORT = 16690;

/**
 * Create wakeup message for PS5
 */
function createWakeupMessage(credential: string): string {
  const lines = [
    'WAKEUP * HTTP/1.1',
    `client-type:${DDP_CLIENT_TYPE}`,
    `auth-type:${DDP_AUTH_TYPE}`,
    `model:${DDP_MODEL}`,
    `app-type:${DDP_APP_TYPE}`,
    `user-credential:${credential}`,
    'device-discovery-protocol-version:00030010',
  ];

  return lines.join('\n');
}

/**
 * Wake up a PS5 console
 */
export async function wakeConsole(params: WakeParams): Promise<boolean> {
  const { host, credential, port = 9302 } = params;

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let isSocketClosed = false;

    socket.on('error', (err) => {
      console.error('Socket error:', err);
      if (!isSocketClosed) {
        isSocketClosed = true;
        socket.close();
      }
      reject(err);
    });

    socket.once('listening', () => {
      try {
        // Create wakeup message
        const message = createWakeupMessage(credential);
        const messageBuffer = Buffer.from(message, 'utf-8');

        // Send wakeup packet
        socket.send(messageBuffer, 0, messageBuffer.length, port, host, (error) => {
          if (error) {
            console.error('Send message error:', error);
            if (!isSocketClosed) {
              isSocketClosed = true;
              socket.close();
            }
            reject(new Error(`Failed to send wakeup packet: ${error.message}`));
            return;
          }

          console.log(`Wakeup packet sent to ${host}:${port}`);
          console.log(`Using credential: ${credential}`);

          // Close socket after a delay
          setTimeout(() => {
            if (!isSocketClosed) {
              isSocketClosed = true;
              socket.close();
            }
            resolve(true);
          }, 2000);
        });
      } catch (err) {
        console.error('Error in listening handler:', err);
        if (!isSocketClosed) {
          isSocketClosed = true;
          socket.close();
        }
        reject(err);
      }
    });

    // Bind the socket to local port
    try {
      socket.bind(BIND_PORT, '0.0.0.0');
    } catch (err) {
      console.error('Socket bind error:', err);
      if (!isSocketClosed) {
        isSocketClosed = true;
        socket.close();
      }
      reject(err);
    }
  });
}

/**
 * Wake up all discovered consoles
 */
export async function wakeAllConsoles(consoles: Array<{ ipAddress?: string; credential: string }>): Promise<void> {
  const promises = consoles
    .filter((console) => console.ipAddress)
    .map((console) => wakeConsole({ host: console.ipAddress!, credential: console.credential }));

  await Promise.all(promises);
}
