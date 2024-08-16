const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const express = require('express');
const { parse } = require('csv-parse');

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
const CSV_FILE_PATH = path.join(__dirname, 'contacts.csv');
const TOKEN_DIR = path.join(__dirname, 'tokens'); //Where to store user tokens

const SCOPES = [
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/contacts.other.readonly',
];

function createOAuth2Client() {
  const content = fs.readFileSync(CREDENTIALS_PATH);
  const credentials = JSON.parse(content);
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  return new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
}

async function processContacts(oAuth2Client) {
  try {
    const peopleService = google.people({ version: 'v1', auth: oAuth2Client });

    // Delete all existing contacts
    const contacts = await peopleService.people.connections.list({
      resourceName: 'people/me',
      pageSize: 1000,
      personFields: 'names',
    });

    for (const contact of contacts.data.connections || []) {
      if (contact.resourceName) {
        await peopleService.people.deleteContact({
          resourceName: contact.resourceName,
        });
        log(`Contact deleted: ${contact.resourceName}`);
      }
    }
    log('All contacts deleted');

    // Import new contacts from CSV
    const csvData = fs.readFileSync(CSV_FILE_PATH, 'utf8');
    const parsedContacts = await new Promise((resolve, reject) => {
      parse(csvData, { columns: true }, (err, contacts) => {
        if (err) {
          reject(err);
        } else {
          resolve(contacts);
        }
      });
    });

    log('CSV file parsed');
    for (const contact of parsedContacts) {
      const resource = {
        names: [{ 
          givenName: contact['First Name'] || '', 
          middleName: contact['Middle Name'] || '', 
          familyName: contact['Last Name'] || ''
        }],
        phoneNumbers: [
          contact['Phone 1 - Value'] ? { value: contact['Phone 1 - Value'], type: contact['Phone 1 - Label'] || 'mobile' } : undefined,
          contact['Phone 2 - Value'] ? { value: contact['Phone 2 - Value'], type: contact['Phone 2 - Label'] || 'mobile' } : undefined
        ].filter(Boolean),
        emailAddresses: [
          contact['E-mail 1 - Value'] ? { value: contact['E-mail 1 - Value'], type: contact['E-mail 1 - Label'] || 'home' } : undefined,
          contact['E-mail 2 - Value'] ? { value: contact['E-mail 2 - Value'], type: contact['E-mail 2 - Label'] || 'home' } : undefined
        ].filter(Boolean),
        addresses: [{
          formattedValue: contact['Address 1 - Formatted'] || '',
          streetAddress: contact['Address 1 - Street'] || '',
          city: contact['Address 1 - City'] || '',
          postalCode: contact['Address 1 - Postal Code'] || '',
          region: contact['Address 1 - Region'] || '',
          country: contact['Address 1 - Country'] || '',
        }],
        organizations: [{
          name: contact['Organization Name'] || '',
          title: contact['Organization Title'] || '',
          department: contact['Organization Department'] || '',
        }],
        birthdays: contact['Birthday'] ? [{ date: { year: parseInt(contact['Birthday'].split('-')[0], 10), month: parseInt(contact['Birthday'].split('-')[1], 10) || 1, day: parseInt(contact['Birthday'].split('-')[2], 10) || 1 } }] : [],
        biographies: contact['Notes'] ? [{ value: contact['Notes'] }] : [],
      };

      try {
        await peopleService.people.createContact({ resource });
        log(`Contact created: ${contact['First Name']} ${contact['Last Name']}`);
      } catch (error) {
        log('Error creating contact: ' + error);
      }
    }

    log('Contacts processed');
  } catch (error) {
    log('Error during processing: ' + error);
    throw error;
  }
}

async function processAllAccounts() {
  const accounts = fs.readFileSync('accounts.txt', 'utf-8').split('\n').map(line => line.trim());
  
  for (const account of accounts) {
    if (!account) continue;

    log(`Processing account: ${account}`);
    const tokenPath = path.join(TOKEN_DIR, `${account}.json`);

    let oAuth2Client;
    if (fs.existsSync(tokenPath)) {
      log(`Token found for ${account}`);
      const token = fs.readFileSync(tokenPath);
      oAuth2Client = createOAuth2Client();
      oAuth2Client.setCredentials(JSON.parse(token));
      
      // Proceed to sync contacts for this account
      await processContacts(oAuth2Client);
      
      // Ask if the user wants to continue with another account
      const userResponse = await promptUserForNextAccount();
      if (userResponse.toLowerCase() === 'n') {
        log('Stopping further authorizations and contact syncing.');
        break;
      }

    } else {
      log(`Token not found for ${account}. Please authorize this account.`);
      oAuth2Client = createOAuth2Client();
      const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
      });
      log(`Authorize this app by visiting this url: ${authUrl}`);
      
      // Wait for user authorization
      await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minute pause
    }
  }
}

async function promptUserForNextAccount() {
  return new Promise((resolve) => {
    // Prompt the user with a simple yes/no question to proceed
    process.stdout.write("Do you want to authorize another account? (y/n): ");
    process.stdin.once("data", (data) => {
      resolve(data.toString().trim());
    });
  });
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

    const account = req.query.account || 'default';
    const tokenPath = path.join(TOKEN_DIR, `${account}.json`);
    fs.writeFileSync(tokenPath, JSON.stringify(tokens));
    log('Token stored to ' + tokenPath);
    res.send('Authorization successful! You can close this window.');

  } catch (error) {
    log('Error during authorization: ' + error);
    res.send('Error during authorization. Please reauthorize by <a href="/">clicking here</a>.');
  }
});

app.listen(PORT, () => {
  log(`App listening on port ${PORT}`);
  processAllAccounts();
});
