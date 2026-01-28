# claude-ps5-mcp

[![npm version](https://badge.f.herokuapp.com/npm/claude-ps5-mcp.svg)](https://www.npmjs.com/package/claude-ps5-mcp)

A Model Context Protocol (MCP) server that enables Claude Code to discover, register, and wake PS5 consoles on your local network.

## Features

- **PSN Authentication**: Log in to PlayStation Network for account-based features
- **Console Discovery**: Find PS5/PS4 consoles on your local network
- **Device Registration**: One-time registration using your PS5's Remote Play PIN
- **Wake Control**: Turn on your PS5 from standby mode remotely
- **Status Checking**: Check if your console is awake or in standby

## Installation

Add the MCP server to Claude Code:

```bash
claude mcp add ps5 -- npx -y claude-ps5-mcp
```

Then restart Claude Code to load the server.

## Quick Start

### 1. Authenticate with PlayStation Network

First, log in to your PSN account:

```
Please start PSN authentication
```

This will open a browser window. After logging in, copy the redirect URL and provide it to Claude:

```
Complete PSN authentication with redirect URL: https://remoteplay.dl.playstation.net/remoteplay/redirect?code=...
```

### 2. Register Your PS5

Register your PS5 once (must be turned ON):

```
Register my PS5 with PIN 12345678
```

To get the PIN:
- Go to **Settings → System → Remote Play → Link Device** on your PS5
- Note the PIN code displayed (changes every few minutes)

### 3. Discover and Wake Your Console

```
Find my PS5
```

Once discovered, wake it from standby:

```
Wake up my PS5
```

## Available Tools

| Tool | Description |
|------|-------------|
| `psn_login` | Authenticate with PlayStation Network |
| `psn_get_user_info` | Get current authenticated user info |
| `ps5_discover` | Discover PS5/PS4 consoles on your network |
| `ps5_register` | Register your PS5 for Remote Play (one-time) |
| `ps5_wake` | Send wake packet to turn on your PS5 |
| `ps5_status` | Get status of discovered consoles |

## PS5 Requirements

For wake-on-LAN to work:

1. **Enable "Stay Connected to the Internet"**
   - Settings → System → Power Saving → Features Available in Rest Mode

2. **Use Rest Mode** (not fully powered off)
   - Press power button briefly until it blinks blue
   - Or use Quick Menu → Power → Enter Rest Mode

3. **Same Network**
   - Your computer and PS5 must be on the same local network

## Troubleshooting

**No consoles found**
- Ensure PS5 is in Rest Mode (not fully off)
- Verify "Stay Connected to the Internet" is enabled
- Check both devices are on the same network
- Try disabling VPN on your computer

**Registration failed**
- PS5 must be turned ON (not in standby)
- PIN expires after a few minutes - refresh it
- Ensure you're in Settings → System → Remote Play → Link Device

**Wake packet sent but console didn't turn on**
- Wait 10-30 seconds for console to wake
- Verify PS5 is in Rest Mode (orange light)
- Make sure you've completed registration first

**No credentials found for device**
- Run PSN authentication first
- Complete device registration with your PIN
- Check that credentials exist at `~/.config/playactor/credentials.json`

## How It Works

The server uses UDP broadcast to discover PlayStation consoles on your local network, then communicates with them using Sony's Device Discovery Protocol (DDP). Credentials are stored locally and used to send authenticated wake packets.

## License

MIT
