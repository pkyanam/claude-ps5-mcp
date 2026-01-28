/**
 * PS5 Console Discovery Module
 * Discovers PS5/PS4 consoles on the local network via UDP broadcast
 */

import dgram from 'dgram';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import type { Console, DiscoveryOptions } from './types.js';

const execAsync = promisify(exec);

/**
 * Discovery protocol constants
 */
const DISCOVERY_PORT = 9302;
const REMOTE_PLAY_PORT = 997;
const SEARCH_MESSAGE = 'SRCH * HTTP/1.1\ndevice-discovery-protocol-version:00030010\n';

/**
 * Get local network broadcast addresses
 * On macOS, the global broadcast 255.255.255.255 doesn't always work,
 * so we need to use the network-specific broadcast addresses
 */
function getBroadcastAddresses(): string[] {
  const addresses: string[] = [];
  const interfaces = os.networkInterfaces();

  for (const name in interfaces) {
    for (const iface of interfaces[name] || []) {
      // Skip internal and non-IPv4 addresses
      if (iface.internal || iface.family !== 'IPv4') {
        continue;
      }

      // Calculate broadcast address from IP and netmask
      const ip = iface.address;
      const netmask = iface.netmask;

      if (ip && netmask) {
        const ipParts = ip.split('.').map(Number);
        const maskParts = netmask.split('.').map(Number);
        const broadcastParts = ipParts.map((part, i) => part | (~maskParts[i] & 255));
        const broadcast = broadcastParts.join('.');

        if (!addresses.includes(broadcast)) {
          addresses.push(broadcast);
        }
      }
    }
  }

  // Always include global broadcast as well
  // On some networks, PS5 responds to global broadcast but not local
  if (!addresses.includes('255.255.255.255')) {
    addresses.push('255.255.255.255');
  }

  return addresses;
}

/**
 * Check if PS5 is awake by attempting to ping it
 * This is more reliable than the status field in discovery responses
 */
async function isPs5Awake(ipAddress: string): Promise<boolean> {
  try {
    // macOS: -W is in seconds, Linux: -W is in milliseconds
    // Use -W 1 (1 second) for macOS compatibility
    const { stdout } = await execAsync(`ping -c 1 -W 1 ${ipAddress}`);
    // Check if ping was successful (contains "ttl" or "bytes from")
    return stdout.includes('ttl') || stdout.includes('bytes from');
  } catch (error) {
    // Ping failed - host is unreachable (likely in standby or off)
    return false;
  }
}

/**
 * Parse discovery response message
 */
async function parseDiscoveryResponse(message: string, ipAddress: string): Promise<Partial<Console>> {
  const lines = message.split('\n');
  const data: Record<string, string> = {};

  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();
      data[key] = value;
    }
  }

  // Try to get status from response
  let status = (data['status'] as 'AWAKE' | 'STANDBY' | undefined);

  // If no status in response, check by connecting to Remote Play port
  if (!status) {
    status = await isPs5Awake(ipAddress) ? 'AWAKE' : 'STANDBY';
  }

  return {
    hostId: data['host-id'] || '',
    hostName: data['host-name'] || 'Unknown Console',
    hostType: data['host-type'] || 'Unknown',
    status,
    systemVersion: data['system-version'] || 'Unknown',
  };
}

/**
 * Discover PS5 consoles on the local network
 */
export async function discoverConsoles(options: DiscoveryOptions = {}): Promise<Console[]> {
  const timeout = options.timeout || 5000;
  const port = options.port || DISCOVERY_PORT;

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const consoles: Console[] = [];
    let timeoutHandle: NodeJS.Timeout;
    let isResolved = false;

    // Set up timeout
    timeoutHandle = setTimeout(() => {
      if (isResolved) return;
      isResolved = true;
      try {
        socket.close();
      } catch (error) {
        // Ignore errors during close
      }
      resolve(consoles);
    }, timeout);

    // Handle incoming messages
    socket.on('message', async (msg, rinfo) => {
      if (isResolved) return;
      try {
        const messageStr = msg.toString('utf-8');
        const consoleData = await parseDiscoveryResponse(messageStr, rinfo.address);

        // Check if we've already found this console (by host ID or IP address)
        const alreadyFound = consoles.some(
          (c) => c.hostId === consoleData.hostId || c.ipAddress === rinfo.address
        );

        if (alreadyFound) {
          return; // Skip duplicate responses
        }

        // Add IP address and port info
        const consoleInfo: Console = {
          ...consoleData,
          hostId: consoleData.hostId || '',
          hostName: consoleData.hostName || 'Unknown Console',
          hostType: consoleData.hostType || 'Unknown',
          status: consoleData.status || 'STANDBY',
          systemVersion: consoleData.systemVersion || 'Unknown',
          ipAddress: rinfo.address,
          port: rinfo.port,
        };

        consoles.push(consoleInfo);
        console.log(`Found console: ${consoleInfo.hostName} at ${rinfo.address}:${rinfo.port} (${consoleInfo.status})`);
      } catch (error) {
        console.error('Failed to parse discovery response:', error);
      }
    });

    // Handle socket errors
    socket.on('error', (error) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timeoutHandle);
      try {
        socket.close();
      } catch (closeError) {
        // Ignore errors during close
      }
      reject(new Error(`Socket error: ${error.message}`));
    });

    // Start listening
    socket.bind(() => {
      if (isResolved) return;
      try {
        // Enable broadcast
        socket.setBroadcast(true);

        // Get all broadcast addresses
        const broadcastAddresses = getBroadcastAddresses();

        // Send discovery message to all broadcast addresses
        const searchBuffer = Buffer.from(SEARCH_MESSAGE, 'utf-8');

        // Send to all broadcast addresses sequentially with slight delays
        // This helps avoid overwhelming the network and improves reliability
        broadcastAddresses.forEach((broadcastAddr, index) => {
          setTimeout(() => {
            if (!isResolved) {
              socket.send(searchBuffer, 0, searchBuffer.length, port, broadcastAddr, (error) => {
                if (error && !isResolved) {
                  console.error(`Failed to send discovery to ${broadcastAddr}: ${error.message}`);
                }
              });
            }
          }, index * 100); // 100ms delay between each broadcast
        });
      } catch (error) {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeoutHandle);
          try {
            socket.close();
          } catch (closeError) {
            // Ignore errors during close
          }
          reject(error);
        }
      }
    });
  });
}

/**
 * Discover PS4 consoles (legacy protocol)
 */
export async function discoverPS4(options: DiscoveryOptions = {}): Promise<Console[]> {
  return discoverConsoles({
    ...options,
    port: 987, // PS4 discovery port
  });
}
