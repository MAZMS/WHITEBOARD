import fs from 'fs';
import path from 'path';
import axios from 'axios';
import simpleGit from 'simple-git';
import { Octokit } from '@octokit/rest';
import { getStoredAuth } from './login';

const API_BASE = process.env.GREATLIBRARY_API_URL || 'https://api.greatlibrary.ai';

export async function publish(): Promise<void> {
  const claudeMdPath = path.join(process.cwd(), 'CLAUDE.md');
  const settingsPath = path.join(process.cwd(), '.claude', 'settings.json');

  if (!fs.existsSync(claudeMdPath)) {
    console.error('Error: CLAUDE.md not found in current directory.');
    console.error('A CLAUDE.md file is required to publish a blueprint.');
    process.exit(1);
  }

  if (!fs.existsSync(settingsPath)) {
    console.error('Error: .claude/settings.json not found in current directory.');
    console.error('A .claude/settings.json file is required to publish a blueprint.');
    process.exit(1);
  }

  const auth = getStoredAuth();
  if (!auth) {
    console.error('Error: Not authenticated. Run `greatlibrary login` first.');
    process.exit(1);
  }

  const git = simpleGit(process.cwd());

  let remoteUrl: string | undefined;
  try {
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin');
    remoteUrl = origin?.refs.push;
  } catch {
    // no remotes
  }

  if (!remoteUrl) {
    console.log('No git remote origin found. Creating GitHub repository...');
    const repoName = path.basename(process.cwd());
    const octokit = new Octokit({ auth: auth.token });
    const { data: repo } = await octokit.repos.createForAuthenticatedUser({
      name: repoName,
      private: false,
    });
    await git.addRemote('origin', repo.clone_url);
    await git.push('origin', 'main');
    remoteUrl = repo.clone_url;
    console.log(`Created repository: ${repo.html_url}`);
  }

  const claudeMd = fs.readFileSync(claudeMdPath, 'utf-8');
  const manifest = {
    githubUrl: remoteUrl,
    claudeMd,
    settings: JSON.parse(fs.readFileSync(settingsPath, 'utf-8')),
  };

  try {
    const { data } = await axios.post(`${API_BASE}/v1/blueprints`, manifest, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    console.log(`Blueprint published: ${data.url}`);
  } catch (err: unknown) {
    const error = err as { response?: { data?: { error?: string } } };
    console.error('Publish failed:', error.response?.data?.error || 'Unknown error');
    process.exit(1);
  }
}
