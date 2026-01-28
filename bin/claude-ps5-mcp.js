#!/usr/bin/env node

// Get the directory where this bin file is located
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import from the built dist folder (relative to this bin file)
const indexPath = join(__dirname, '..', 'dist', 'index.js');

import(indexPath).catch((error) => {
  console.error('Failed to start PS5 MCP Server:', error);
  process.exit(1);
});
