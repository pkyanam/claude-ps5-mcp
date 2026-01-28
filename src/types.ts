/**
 * Type definitions for PS5 MCP Server
 */

/**
 * PSN OAuth2 configuration constants
 */
export const PSN_CONFIG = {
  CLIENT_ID: 'ba495a24-818c-472b-b12d-ff231c1b5745',
  CLIENT_SECRET: 'mvaiZkRsAsI1IBkY',
  REDIRECT_URI: 'https://remoteplay.dl.playstation.net/remoteplay/redirect',
  AUTH_URL: 'https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/authorize',
  TOKEN_URL: 'https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/token',
  USER_INFO_URL: 'https://us-prof.np.community.playstation.net/userProfile/v1/users/me/profile2',
} as const;

/**
 * Stored token information
 */
export interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiry: number; // Unix timestamp
  userInfo?: UserInfo;
}

/**
 * PSN user information
 */
export interface UserInfo {
  onlineId: string;
  accountId: string; // Base64 encoded account ID
  userId: string;
  aboutMe?: string;
  avatarUrls?: AvatarUrl[];
  languages?: string[];
}

/**
 * Avatar URL information
 */
export interface AvatarUrl {
  size: number;
  url: string;
}

/**
 * Discovered console information
 */
export interface Console {
  hostId: string;
  hostName: string;
  hostType: string;
  status: 'AWAKE' | 'STANDBY';
  systemVersion: string;
  ipAddress?: string;
  port?: number;
}

/**
 * Discovery request options
 */
export interface DiscoveryOptions {
  timeout?: number;
  port?: number;
}

/**
 * Remote Play credentials matching playactor's IRemotePlayCredentials
 */
export interface RemotePlayCredentials {
  'app-type': 'r';
  'auth-type': 'R';
  'client-type': 'vr';
  'model': 'm' | 'w';
  'user-credential': string;
  accountId: string;
  registration: {
    'AP-Bssid': string;
    'AP-Name': string;
    'PS5-Mac'?: string;
    'PS5-RegistKey'?: string;
    'PS5-Nickname'?: string;
    'RP-KeyType': string;
    'RP-Key': string;
    'PS4-Mac'?: string;
    'PS4-RegistKey'?: string;
    'PS4-Nickname'?: string;
  };
}

/**
 * Wake request parameters
 */
export interface WakeParams {
  host: string; // IP address
  credential: string; // user-credential from playactor credentials
  port?: number;
}

/**
 * OAuth authorization response
 */
export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

/**
 * Discovery message format
 */
export interface DiscoveryMessage {
  type: 'search' | 'response';
  data?: Record<string, string>;
}
