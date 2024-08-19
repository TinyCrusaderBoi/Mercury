const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { parse } = require('csv-parse');

const CREDENTIALS_PATH = path.join(__dirname, 'csecret.json');
const CSV_FILE_PATH = path.join(__dirname, 'contacts.csv');
const TOKEN_DIR = path.join(__dirname, 'tokens'); // Where to store user tokens

const SCOPES = [
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/contacts.other.readonly',
];

const account = process.argv[2];
if (!account) {
  console.error('No account provided');
  process.exit(1);
}

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
        console.log(`Contact deleted: ${contact.resourceName}`);
      }
    }
    console.log('All contacts deleted');

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

    console.log('CSV file parsed');
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
        console.log(`Contact created: ${contact['First Name']} ${contact['Last Name']}`);
      } catch (error) {
        console.error('Error creating contact: ' + error);
      }
    }

    console.log('Contacts processed');
  } catch (error) {
    console.error('Error during processing: ' + error);
    throw error;
  }
}

async function main() {
  const tokenPath = path.join(TOKEN_DIR, `${account}.json`);
  if (!fs.existsSync(tokenPath)) {
    console.error(`Token not found for ${account}.`);
    process.exit(1);
  }

  const token = fs.readFileSync(tokenPath);
  const oAuth2Client = createOAuth2Client();
  oAuth2Client.setCredentials(JSON.parse(token));

  await processContacts(oAuth2Client);
}

main().catch(error => {
  console.error('Error in syncContacts: ' + error);
  process.exit(1);
});
