/**
 * Token storage using JSON file in user home directory
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { TokenData } from './types.js';

const STORAGE_DIR = path.join(os.homedir(), '.claude-ps5-mcp');
const CREDENTIALS_FILE = path.join(STORAGE_DIR, 'credentials.json');

/**
 * Ensure storage directory exists
 */
async function ensureStorageDir(): Promise<void> {
  try {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
    // Set restrictive permissions on directory
    await fs.chmod(STORAGE_DIR, 0o700);
  } catch (error) {
    throw new Error(`Failed to create storage directory: ${error}`);
  }
}

/**
 * Load tokens from storage
 */
export async function loadTokens(): Promise<TokenData | null> {
  try {
    await ensureStorageDir();
    const data = await fs.readFile(CREDENTIALS_FILE, 'utf-8');
    const tokens = JSON.parse(data) as TokenData;

    // Check if token is expired
    if (tokens.expiry < Date.now()) {
      console.log('Token expired, needs refresh');
      return null;
    }

    return tokens;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // File doesn't exist yet
      return null;
    }
    throw new Error(`Failed to load tokens: ${error}`);
  }
}

/**
 * Save tokens to storage
 */
export async function saveTokens(tokens: TokenData): Promise<void> {
  try {
    await ensureStorageDir();
    const data = JSON.stringify(tokens, null, 2);
    await fs.writeFile(CREDENTIALS_FILE, data, 'utf-8');
    // Set restrictive permissions on file
    await fs.chmod(CREDENTIALS_FILE, 0o600);
  } catch (error) {
    throw new Error(`Failed to save tokens: ${error}`);
  }
}

/**
 * Clear stored tokens
 */
export async function clearTokens(): Promise<void> {
  try {
    await fs.unlink(CREDENTIALS_FILE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`Failed to clear tokens: ${error}`);
    }
  }
}

/**
 * Get storage directory path (for debugging)
 */
export function getStoragePath(): string {
  return CREDENTIALS_FILE;
}
