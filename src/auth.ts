/**
 * PSN Authentication Module
 * Handles OAuth2 authentication flow with PSN
 *
 * Flow:
 * 1. User opens browser to auth URL
 * 2. User logs in
 * 3. Sony redirects to https://remoteplay.dl.playstation.net/remoteplay/redirect?code=...
 * 4. User copies the redirect URL
 * 5. Token is extracted and exchanged
 */

import axios from 'axios';
import open from 'open';
import type { TokenData, UserInfo, OAuthTokenResponse } from './types.js';
import { loadTokens, saveTokens } from './storage.js';
import { PSN_CONFIG } from './types.js';

/**
 * Generate OAuth2 authorization URL
 */
function getAuthUrl(): string {
  const params = new URLSearchParams({
    service_entity: 'urn:service-entity:psn',
    response_type: 'code',
    client_id: PSN_CONFIG.CLIENT_ID,
    redirect_uri: PSN_CONFIG.REDIRECT_URI,
    scope: 'psn:clientapp referenceDataService:countryConfig.read pushNotification:webSocket.desktop.connect sessionManager:remotePlaySession.system.update',
    request_locale: 'en_US',
    ui: 'pr',
    service_logo: 'ps',
    layout_type: 'popup',
    smcid: 'remoteplay',
    prompt: 'always',
    PlatformPrivacyWs1: 'minimal',
  });

  return `${PSN_CONFIG.AUTH_URL}?${params.toString()}`;
}

/**
 * Extract account ID from user info
 * Converts user_id (number) to base64 encoded LE64 Uint64
 */
function extractAccountId(userId: string): string {
  const asNumber = BigInt(userId);
  const buffer = Buffer.alloc(8, 'binary');
  buffer.writeBigUInt64LE(asNumber, 0);
  return buffer.toString('base64');
}

/**
 * Exchange authorization code for access token
 */
async function exchangeCodeForToken(code: string): Promise<OAuthTokenResponse> {
  const params = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    scope: 'psn:clientapp referenceDataService:countryConfig.read pushNotification:webSocket.desktop.connect sessionManager:remotePlaySession.system.update',
    redirect_uri: PSN_CONFIG.REDIRECT_URI,
  });

  try {
    const response = await axios.post(PSN_CONFIG.TOKEN_URL, params, {
      auth: {
        username: PSN_CONFIG.CLIENT_ID,
        password: PSN_CONFIG.CLIENT_SECRET,
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Token exchange failed: ${error.response?.data || error.message}`);
    }
    throw error;
  }
}

/**
 * Get user information from PSN using the token endpoint
 * This returns the account info needed for wake credentials
 */
async function getUserInfo(accessToken: string): Promise<UserInfo> {
  try {
    const response = await axios.get(`${PSN_CONFIG.TOKEN_URL}/${accessToken}`, {
      auth: {
        username: PSN_CONFIG.CLIENT_ID,
        password: PSN_CONFIG.CLIENT_SECRET,
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const profile = response.data;

    // Extract account_id (base64 encoded user_id)
    const accountId = extractAccountId(profile.user_id);

    return {
      onlineId: profile.online_id,
      accountId: accountId,
      userId: profile.user_id,
      aboutMe: profile.country_code,
      avatarUrls: [],
      languages: [profile.language_code],
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Failed to get user info: ${error.response?.data || error.message}`);
    }
    throw error;
  }
}

/**
 * Refresh access token using refresh token
 */
async function refreshToken(refreshToken: string): Promise<TokenData> {
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: 'psn:clientapp',
    redirect_uri: PSN_CONFIG.REDIRECT_URI,
  });

  try {
    const response = await axios.post(PSN_CONFIG.TOKEN_URL, params, {
      auth: {
        username: PSN_CONFIG.CLIENT_ID,
        password: PSN_CONFIG.CLIENT_SECRET,
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const tokenResponse: OAuthTokenResponse = response.data;
    const userInfo = await getUserInfo(tokenResponse.access_token);

    const tokenData: TokenData = {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiry: Date.now() + tokenResponse.expires_in * 1000,
      userInfo,
    };

    await saveTokens(tokenData);
    return tokenData;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(`Token refresh failed: ${error.response?.data || error.message}`);
    }
    throw error;
  }
}

/**
 * Authenticate with PSN using redirect URL from browser
 * Call this after user has logged in and been redirected
 */
export async function authenticateWithRedirectUrl(redirectUrl: string): Promise<TokenData> {
  console.log('Processing authentication...');

  // Extract code from redirect URL
  const url = new URL(redirectUrl);
  const code = url.searchParams.get('code');

  if (!code) {
    throw new Error('No authorization code found in redirect URL');
  }

  // Exchange code for token
  const tokenResponse = await exchangeCodeForToken(code);

  // Get user info
  const userInfo = await getUserInfo(tokenResponse.access_token);

  const tokenData: TokenData = {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiry: Date.now() + tokenResponse.expires_in * 1000,
    userInfo,
  };

  // Save tokens
  await saveTokens(tokenData);

  console.log(`Authentication successful! Welcome, ${userInfo.onlineId}`);
  return tokenData;
}

/**
 * Start authentication flow - open browser for user to login
 * Returns the auth URL for user to visit
 */
export async function startAuthentication(): Promise<string> {
  // Check if we have valid cached tokens
  const existingTokens = await loadTokens();
  if (existingTokens && existingTokens.expiry > Date.now()) {
    console.log('Using cached tokens');
    return 'Already authenticated';
  }

  // If we have a refresh token, try to refresh
  if (existingTokens?.refreshToken) {
    try {
      console.log('Refreshing expired tokens');
      await refreshToken(existingTokens.refreshToken);
      return 'Token refreshed successfully';
    } catch (error) {
      console.log('Refresh failed, need full re-authentication');
    }
  }

  // Full authentication flow - open browser
  console.log('Starting PSN authentication...');

  const authUrl = getAuthUrl();
  console.log('Opening browser for authentication...');
  console.log(`URL: ${authUrl}\n`);
  await open(authUrl);

  console.log('\nAfter logging in, you will be redirected to a PlayStation page.');
  console.log('Copy the complete URL from your browser and provide it here.');
  console.log('The URL should look like:');
  console.log('https://remoteplay.dl.playstation.net/remoteplay/redirect?code=...');

  return authUrl;
}

/**
 * Get current user info (from cached tokens)
 */
export async function getCurrentUserInfo(): Promise<UserInfo> {
  const tokens = await loadTokens();
  if (!tokens?.userInfo) {
    throw new Error('No user info available. Please authenticate first.');
  }
  return tokens.userInfo;
}

/**
 * Get valid access token (auto-refresh if needed)
 */
export async function getAccessToken(): Promise<string> {
  const tokens = await loadTokens();
  if (!tokens) {
    throw new Error('No authentication tokens found. Please authenticate first.');
  }

  // Check if token is expired
  if (tokens.expiry < Date.now()) {
    console.log('Token expired, refreshing...');
    const newTokens = await refreshToken(tokens.refreshToken);
    return newTokens.accessToken;
  }

  return tokens.accessToken;
}

/**
 * Logout - clear stored tokens
 */
export async function logout(): Promise<void> {
  await saveTokens({
    accessToken: '',
    refreshToken: '',
    expiry: 0,
  });
  console.log('Logged out successfully');
}

/**
 * Legacy authenticate function for backward compatibility
 * This just starts the authentication flow
 */
export async function authenticate(): Promise<TokenData> {
  await startAuthentication();
  throw new Error('Please complete authentication in browser, then call authenticateWithRedirectUrl with the redirect URL');
}
