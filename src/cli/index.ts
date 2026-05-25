#!/usr/bin/env node
import { Command } from 'commander';
import { login } from './login';
import { publish } from './publish';

const program = new Command();

program
  .name('greatlibrary')
  .description('GreatLibrary developer CLI')
  .version('1.0.0');

program
  .command('login')
  .description('Authenticate with GitHub OAuth')
  .action(login);

program
  .command('publish')
  .description('Publish a blueprint to the GreatLibrary marketplace')
  .action(publish);

program.parse();
