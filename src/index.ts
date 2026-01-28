/**
 * MCP Server for PS5 Control
 * Entry point for the Model Context Protocol server
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { startAuthentication, authenticateWithRedirectUrl, getCurrentUserInfo, getAccessToken } from './auth.js';
import { discoverConsoles } from './discovery.js';
import { wakeConsole } from './wakeup.js';
import { registerDevice, getWakeCredential, listRegisteredDevices } from './registration.js';
import type { Console } from './types.js';
import type { IRemotePlayCredentials } from 'playactor/dist/credentials/model.js';

/**
 * Define available MCP tools
 */
const TOOLS: Tool[] = [
  {
    name: 'psn_login',
    description: 'Authenticate with PlayStation Network (PSN). Opens a browser window for OAuth2 login. After logging in, copy the redirect URL from your browser and call this tool again with the redirectUrl parameter.',
    inputSchema: {
      type: 'object',
      properties: {
        redirectUrl: {
          type: 'string',
          description: 'The complete redirect URL from your browser after logging in. Should start with https://remoteplay.dl.playstation.net/remoteplay/redirect?code=...',
        },
      },
      required: [],
    },
  },
  {
    name: 'psn_get_user_info',
    description: 'Get current authenticated PSN user information including username, account ID, and other profile details.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'ps5_discover',
    description: 'Discover PS5 (and PS4) consoles on the local network. Returns list of found consoles with their IP addresses, names, and status (AWAKE/STANDBY). Requires devices to be on the same network.',
    inputSchema: {
      type: 'object',
      properties: {
        timeout: {
          type: 'number',
          description: 'Discovery timeout in milliseconds (default: 2000)',
          default: 2000,
        },
      },
      required: [],
    },
  },
  {
    name: 'ps5_register',
    description: 'Register your PS5 for Remote Play. This is required once before using wake commands. Your PS5 must be turned ON and on the same network. You will need to enter a PIN from your PS5 (go to Settings > System > Remote Play > Link Device on your PS5 to get the PIN). IMPORTANT: You must complete PSN authentication first using psn_login tool before registering.',
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'IP address of the PS5 console (optional - will use discovered console if not provided)',
        },
        pin: {
          type: 'string',
          description: 'PIN code displayed on your PS5 after going to Settings > System > Remote Play > Link Device',
        },
        accountId: {
          type: 'string',
          description: 'Account ID from PSN authentication (optional - will use authenticated account if not provided)',
        },
      },
      required: ['pin'],
    },
  },
  {
    name: 'ps5_wake',
    description: 'Send a wake packet to turn on a PS5 console. The console must be in standby mode and on the same local network. Requires the console to be registered first (run ps5_register).',
    inputSchema: {
      type: 'object',
      properties: {
        host: {
          type: 'string',
          description: 'IP address of the PS5 console',
        },
        credential: {
          type: 'string',
          description: 'User-credential string (auto-fetched from stored credentials if not provided). Only needed if you want to override the stored credentials.',
        },
      },
      required: ['host'],
    },
  },
  {
    name: 'ps5_status',
    description: 'Get the status of discovered PS5 consoles (AWAKE or STANDBY). Returns all discovered consoles with their current status.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

/**
 * Format console info for display
 */
function formatConsoleInfo(console: Console): string {
  return [
    `Name: ${console.hostName}`,
    `Type: ${console.hostType}`,
    `Status: ${console.status}`,
    `System Version: ${console.systemVersion}`,
    `IP Address: ${console.ipAddress || 'Unknown'}`,
    `Host ID: ${console.hostId}`,
  ].join('\n');
}

/**
 * Main server class
 */
class PS5MCPServer {
  private server: Server;
  private discoveredConsoles: Console[] = [];

  constructor() {
    this.server = new Server(
      {
        name: 'claude-ps5-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  /**
   * Set up tool request handlers
   */
  private setupToolHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: TOOLS,
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'psn_login': {
            const params = args as { redirectUrl?: string };

            if (params.redirectUrl) {
              // Complete authentication with redirect URL
              const tokenData = await authenticateWithRedirectUrl(params.redirectUrl);
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(
                      {
                        success: true,
                        message: 'Successfully authenticated with PSN',
                        user: {
                          onlineId: tokenData.userInfo?.onlineId,
                          accountId: tokenData.userInfo?.accountId,
                        },
                      },
                      null,
                      2
                    ),
                  },
                ],
              };
            } else {
              // Start authentication - open browser
              const authUrl = await startAuthentication();
              return {
                content: [
                  {
                    type: 'text',
                    text: `Browser opened to PSN login page.\n\n` +
                          `After logging in, you will be redirected to a PlayStation page.\n` +
                          `Copy the complete URL from your browser and provide it here.\n\n` +
                          `The URL should look like:\n` +
                          `https://remoteplay.dl.playstation.net/remoteplay/redirect?code=...\n\n` +
                          `Then call psn_login again with the redirectUrl parameter.`,
                  },
                ],
              };
            }
          }

          case 'psn_get_user_info': {
            const userInfo = await getCurrentUserInfo();
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(userInfo, null, 2),
                },
              ],
            };
          }

          case 'ps5_discover': {
            const timeout = (args as { timeout?: number }).timeout || 2000;
            this.discoveredConsoles = await discoverConsoles({ timeout });

            if (this.discoveredConsoles.length === 0) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'No PlayStation consoles found on the local network. Make sure:\n' +
                          '- Your PS5 is in standby mode (not completely powered off)\n' +
                          '- "Stay Connected to the Internet" is enabled in PS5 settings\n' +
                          '- Your computer is on the same network as your PS5',
                  },
                ],
              };
            }

            const consoleList = this.discoveredConsoles
              .map((console) => formatConsoleInfo(console))
              .join('\n\n---\n\n');

            return {
              content: [
                {
                  type: 'text',
                  text: `Found ${this.discoveredConsoles.length} console(s):\n\n${consoleList}`,
                },
              ],
            };
          }

          case 'ps5_register': {
            const params = args as { pin: string; accountId?: string };

            try {
              // Get account ID from PSN auth
              let accountId = params.accountId;
              if (!accountId) {
                // Try to get account ID from current authentication
                const userInfo = await getCurrentUserInfo();
                accountId = userInfo.accountId;
              }

              // Register device - this handles discovery and registration
              const credentials = await registerDevice({ pin: params.pin, accountId }) as IRemotePlayCredentials;

              // Get list of registered devices
              const registeredDevices = await listRegisteredDevices();

              return {
                content: [
                  {
                    type: 'text',
                    text: `Successfully registered your PS5!\n\n` +
                          `Account ID: ${credentials.accountId}\n\n` +
                          `Registered devices: ${registeredDevices.length}\n` +
                          (registeredDevices.length > 0
                            ? registeredDevices.map((id) => `  - ${id}`).join('\n')
                            : '') +
                          '\n\nYou can now wake your PS5 from standby using:\n' +
                          '  1. ps5_discover (to find your console)\n' +
                          '  2. ps5_wake with host=<IP_ADDRESS>',
                  },
                ],
              };
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              return {
                content: [
                  {
                    type: 'text',
                    text: `Registration failed: ${errorMessage}`,
                  },
                ],
                isError: true,
              };
            }
          }

          case 'ps5_wake': {
            const params = args as { host: string; credential?: string };

            // Get credential from storage if not provided
            let credential = params.credential;

            if (!credential) {
              // Try to find credentials for the discovered console
              const deviceCredentials = this.discoveredConsoles.find(
                (console) => console.ipAddress === params.host
              );

              if (!deviceCredentials || !deviceCredentials.hostId) {
                return {
                  content: [
                    {
                      type: 'text',
                      text: `Error: Could not find console with IP ${params.host} in discovered consoles. ` +
                            'Please run ps5_discover first to find the console.',
                    },
                  ],
                  isError: true,
                };
              }

              // Get user-credential from storage
              const userCredential = await getWakeCredential(deviceCredentials.hostId);

              if (!userCredential) {
                const registeredDevices = await listRegisteredDevices();

                let errorMsg = `Error: No credentials found for device "${deviceCredentials.hostName}" (${deviceCredentials.ipAddress}).\n\n`;
                errorMsg += 'Before using wake commands, you must register your PS5:\n';
                errorMsg += '1. Make sure your PS5 is turned ON\n';
                errorMsg += '2. On your PS5, go to Settings > System > Remote Play > Link Device\n';
                errorMsg += '3. Note the PIN code displayed\n';
                errorMsg += '4. Run: ps5_register with pin=<PIN>';

                if (registeredDevices.length > 0) {
                  errorMsg += '\n\nRegistered devices:\n';
                  registeredDevices.forEach((id) => errorMsg += `  - ${id}\n`);
                }

                return {
                  content: [
                    {
                      type: 'text',
                      text: errorMsg,
                    },
                  ],
                  isError: true,
                };
              }

              credential = userCredential;
            }

            await wakeConsole({
              host: params.host,
              credential,
            });

            return {
              content: [
                {
                  type: 'text',
                  text: `Wake packet sent to ${params.host}. The console should power on shortly. ` +
                        'It may take 10-30 seconds for the console to fully wake up.',
                },
              ],
            };
          }

          case 'ps5_status': {
            // Re-discover to get current status
            this.discoveredConsoles = await discoverConsoles({ timeout: 5000 });

            if (this.discoveredConsoles.length === 0) {
              return {
                content: [
                  {
                    type: 'text',
                    text: 'No PlayStation consoles found on the local network.',
                  },
                ],
              };
            }

            const statusList = this.discoveredConsoles
              .map(
                (console) =>
                  `${console.hostName} (${console.ipAddress || 'Unknown IP'}): ${console.status}`
              )
              .join('\n');

            return {
              content: [
                {
                  type: 'text',
                  text: statusList,
                },
              ],
            };
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('PS5 MCP Server running on stdio');
  }
}

/**
 * Main entry point
 */
async function main() {
  const server = new PS5MCPServer();
  await server.start();
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
