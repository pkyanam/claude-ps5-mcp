/**
 * PS5 Device Registration Module
 * Handles device registration using playactor library
 */

import type { ICredentials, IRemotePlayCredentials } from 'playactor/dist/credentials/model.js';
import type { IDiscoveredDevice } from 'playactor/dist/discovery/model.js';

/**
 * Custom credential requester that uses provided PIN and account ID
 * This skips the OAuth flow and directly registers with the device
 */
class PinCredentialRequester {
  constructor(
    private readonly pin: string,
    private readonly accountId: string
  ) {}

  async requestForDevice(device: IDiscoveredDevice): Promise<ICredentials> {
    const { registKeyToCredential } = await import('playactor/dist/credentials/oauth/requester.js');
    const { RemotePlayRegistration } = await import('playactor/dist/remoteplay/registration.js');

    console.error(`[playactor] Registering with device ${device.name} via Remote Play.`);

    // Register with the device using the PIN
    const registration = new RemotePlayRegistration();
    const registrationResult = await registration.register(device, {
      accountId: this.accountId,
      pin: this.pin,
    });

    const registKey = registrationResult['PS5-RegistKey'] || registrationResult['PS4-RegistKey'];
    if (!registKey) {
      throw new Error('Did not receive registration key from device');
    }

    const credential = registKeyToCredential(registKey);

    return {
      'app-type': 'r',
      'auth-type': 'R',
      'client-type': 'vr',
      model: 'w',
      'user-credential': credential,
      accountId: this.accountId,
      registration: registrationResult,
    };
  }
}

/**
 * Registration options
 */
export interface RegistrationOptions {
  pin: string;
  accountId: string;
}

/**
 * Register a PS5 device for Remote Play
 *
 * This process:
 * 1. Discovers the device on the network
 * 2. Requests credentials using the provided PIN and account ID
 * 3. Stores the credentials
 * 4. Returns the credentials
 *
 * IMPORTANT: This requires PSN authentication to be completed first (via psn_login tool)
 * to obtain the account ID. The account ID should be available from storage.
 *
 * @param options - Registration options including PIN and account ID
 * @returns The registered credentials
 */
export async function registerDevice(options: RegistrationOptions): Promise<IRemotePlayCredentials> {
  const { Discovery } = await import('playactor/dist/discovery.js');
  const { StandardDiscoveryNetworkFactory } = await import('playactor/dist/discovery/standard.js');

  // Create discovery
  const discoveryConfig = {
    timeoutMillis: 10000,
    uniqueDevices: true,
  };

  const discoveryFactory = StandardDiscoveryNetworkFactory;
  const discovery = new Discovery(discoveryConfig, discoveryFactory);

  // Discover devices
  const discovered: IDiscoveredDevice[] = [];
  for await (const device of discovery.discover()) {
    discovered.push(device);

    // Stop at the first PS5 device
    if (device.type === 'PS5') {
      break;
    }
  }

  if (discovered.length === 0) {
    throw new Error(
      'No PlayStation consoles found on the network.\n\n' +
      'Make sure:\n' +
      '- Your PS5 is turned ON (not in standby)\n' +
      '- Your computer is on the same network as your PS5'
    );
  }

  const targetDevice = discovered[0];

  // Check if device is awake
  if (targetDevice.status !== 'AWAKE') {
    throw new Error(
      `Device "${targetDevice.name}" is in ${targetDevice.status} mode.\n\n` +
      'Your PS5 must be turned ON to register.\n' +
      'Please turn on your PS5 and try again.'
    );
  }

  // Create credential requester with PIN and account ID
  const { DiskCredentialsStorage } = await import('playactor/dist/credentials/disk-storage.js');

  const storage = new DiskCredentialsStorage();
  const requester = new PinCredentialRequester(options.pin, options.accountId);

  // Request credentials directly
  let credentials: ICredentials;
  try {
    credentials = await requester.requestForDevice(targetDevice);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check for common PIN errors
    if (errorMessage.includes('PIN') || errorMessage.includes('pin') || errorMessage.includes('registration')) {
      throw new Error(
        `Registration failed. Please check:\n` +
        `1. Your PS5 is turned ON\n` +
        `2. You've completed PSN authentication first (use psn_login tool)\n` +
        `3. The PIN on your PS5 is current (go to Settings > System > Remote Play > Link Device)\n\n` +
        `Original error: ${errorMessage}`
      );
    }

    throw new Error(`Registration failed: ${errorMessage}`);
  }

  // Store the credentials
  await storage.write(targetDevice.id, credentials);
  console.error(`[playactor] Credentials stored for device ${targetDevice.name} (${targetDevice.id})`);

  // Verify the credentials were stored correctly
  const storedCreds = await storage.read(targetDevice.id);
  if (!storedCreds) {
    throw new Error('Registration completed but credentials were not stored');
  }

  // Verify it's a Remote Play credential
  if (storedCreds['auth-type'] !== 'R') {
    throw new Error('Registration did not produce Remote Play credentials');
  }

  return storedCreds as IRemotePlayCredentials;
}

/**
 * Check if a device is already registered
 */
export async function isDeviceRegistered(hostId: string): Promise<boolean> {
  const { DiskCredentialsStorage } = await import('playactor/dist/credentials/disk-storage.js');
  const storage = new (DiskCredentialsStorage as any)();
  const creds = await storage.read(hostId);
  return creds !== null;
}

/**
 * Get credentials for a device
 */
export async function getDeviceCredentials(hostId: string): Promise<ICredentials | null> {
  const { DiskCredentialsStorage } = await import('playactor/dist/credentials/disk-storage.js');
  const storage = new (DiskCredentialsStorage as any)();
  return await storage.read(hostId);
}

/**
 * Get the user-credential needed for wake packets
 */
export async function getWakeCredential(hostId: string): Promise<string | null> {
  const creds = await getDeviceCredentials(hostId);
  if (!creds) {
    return null;
  }

  // Verify this is a Remote Play credential
  if (creds['auth-type'] !== 'R') {
    throw new Error(`Device ${hostId} does not have Remote Play credentials`);
  }

  return creds['user-credential'];
}

/**
 * List all registered device IDs
 */
export async function listRegisteredDevices(): Promise<string[]> {
  const fs = await import('fs/promises');
  const { homedir } = await import('os');
  const { join } = await import('path');

  const filePath = join(homedir(), '.config', 'playactor', 'credentials.json');

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const credentials = JSON.parse(content);
    return Object.keys(credentials);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
