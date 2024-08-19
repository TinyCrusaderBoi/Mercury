const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const express = require('express');
const { spawn } = require('child_process');

const LOG_FILE = 'debug.log';
const logFile = fs.createWriteStream(LOG_FILE, { flags: 'a' });
const log = (message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}\n`;
  console.log(logMessage);
  logFile.write(logMessage);
};

const app = express();
const PORT = 5900;

const CREDENTIALS_PATH = path.join(__dirname, 'csecret.json');
const TOKEN_DIR = path.join(__dirname, 'tokens'); // Where to store user tokens

const SCOPES = [
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/contacts.other.readonly',
];

let accounts = [];
let currentIndex = -1; // Start before the first account
let currentAccount = ''; // Global variable to hold the current account being processed
let childProcesses = []; // Array to keep track of child processes

function createOAuth2Client() {
  const content = fs.readFileSync(CREDENTIALS_PATH);
  const credentials = JSON.parse(content);
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
}

async function processNextAccount() {
  if (currentIndex < 0 || currentIndex >= accounts.length) {
    log('No more accounts to process or invalid index.');
    return;
  }

  currentAccount = accounts[currentIndex];
  log(`Processing account: ${currentAccount}`);
  const tokenPath = path.join(TOKEN_DIR, `${currentAccount}.json`);

  if (fs.existsSync(tokenPath)) {
    log(`Token found for ${currentAccount}`);
    const token = fs.readFileSync(tokenPath);
    const oAuth2Client = createOAuth2Client();
    oAuth2Client.setCredentials(JSON.parse(token));

    log(`Launching child process for ${currentAccount}...`);
    const child = spawn('cmd', ['/c', 'node', 'syncContacts.js', currentAccount], {
      detached: true,
      stdio: 'ignore', // Ignore stdio to avoid interference
    });

    child.unref(); // Allow parent process to exit independently of child
    childProcesses.push(child); // Track child process

    // Prompt the user for the next action
    const userResponse = await promptUserForAction();
    log(`User response: ${userResponse}`);
    
    if (userResponse.toLowerCase() === 'y') {
      currentIndex++;
      if (currentIndex < accounts.length) {
        await processNextAccount();
      }
    } else if (userResponse.toLowerCase() === 'n') {
      log('Skipping authentication for remaining accounts.');
      currentIndex = accounts.length; // End loop
      displayProgress();
    }

  } else {
    log(`Token not found for ${currentAccount}. Please authorize this account.`);
    const oAuth2Client = createOAuth2Client();
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent',
    });
    log(`Authorize this app by visiting this url: ${authUrl}`);
    
    // Wait for user authorization
    log('Waiting for user authorization...');
    await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minute pause

    // After waiting, prompt the user for the next action
    const userResponse = await promptUserForAction();
    log(`User response: ${userResponse}`);
    
    if (userResponse.toLowerCase() === 'y') {
      currentIndex++;
      await processNextAccount();
    } else if (userResponse.toLowerCase() === 'n') {
      log('Skipping authentication for remaining accounts.');
      currentIndex = accounts.length; // End loop
      displayProgress();
    }
  }
}

async function promptUserForAction() {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdout.write("Do you want to authorize another account? (y/n): ");
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim());
    });
  });
}

async function loadAccounts() {
  log('Loading accounts from accounts.txt...');
  accounts = fs.readFileSync('accounts.txt', 'utf-8').split('\n').map(line => line.trim()).filter(Boolean); // Read accounts from file
  log(`Accounts loaded: ${accounts.join(', ')}`);
  currentIndex = 0; // Start from the beginning
}

function displayProgress() {
  log('Displaying progress...');
  // Here you can implement logic to check the progress of child processes
  // For example, you could periodically check if child processes have completed
  // and calculate the percentage completion based on some criteria.
}

app.get('/', (req, res) => {
  log('Server started');
  try {
    res.send('Server is running.');
  } catch (error) {
    log('Error during startup: ' + error);
    res.send('Error during startup');
  }
});

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    res.send('Error: No code provided');
    return;
  }

  try {
    const oAuth2Client = createOAuth2Client();
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // Save the token for the current account
    const tokenPath = path.join(TOKEN_DIR, `${currentAccount}.json`);
    fs.writeFileSync(tokenPath, JSON.stringify(tokens));
    log('Token stored to ' + tokenPath);

    // Continue processing
    await processNextAccount();
    res.send('Authorization successful! You can close this window.');

  } catch (error) {
    log('Error during authorization: ' + error);
    res.send('Error during authorization');
  }
});

app.listen(PORT, async () => {
  log(`App listening on port ${PORT}`);
  await loadAccounts();
  if (accounts.length > 0) {
    await processNextAccount();
  } else {
    log('No accounts found to process');
  }
});
