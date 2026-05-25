import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { Octokit } from '@octokit/rest';

const AUTH_DIR = path.join(os.homedir(), '.greatlibrary');
const AUTH_FILE = path.join(AUTH_DIR, 'auth.json');

export async function login(): Promise<void> {
  console.log('Opening browser for GitHub authentication...');
  console.log('Waiting for OAuth callback...');

  const token = await waitForToken();

  const octokit = new Octokit({ auth: token });
  const { data: user } = await octokit.users.getAuthenticated();

  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  fs.writeFileSync(AUTH_FILE, JSON.stringify({ token, username: user.login }, null, 2));
  fs.chmodSync(AUTH_FILE, 0o600);

  console.log(`Authenticated as ${user.login}`);
}

function waitForToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://localhost:${9876}`);
      const token = url.searchParams.get('token');

      if (token) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Authentication successful!</h1><p>You can close this window.</p>');
        server.close();
        resolve(token);
      } else {
        res.writeHead(400);
        res.end('Missing token');
      }
    });

    server.listen(9876, () => {
      const clientId = process.env.GITHUB_CLIENT_ID || '';
      const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=http://localhost:9876/callback&scope=repo`;
      console.log(`Visit: ${authUrl}`);
    });

    server.on('error', reject);
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timeout'));
    }, 120000);
  });
}

export function getStoredAuth(): { token: string; username: string } | null {
  if (!fs.existsSync(AUTH_FILE)) return null;
  return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
}
