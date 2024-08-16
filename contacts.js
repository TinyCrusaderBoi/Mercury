// contacts.js
const { google } = require('googleapis');
const people = google.people('v1');

async function insertContacts(auth, contacts) {
    const peopleAPI = google.people({ version: 'v1', auth });

    for (const contact of contacts) {
        try {
            // Create a contact
            await people.people.createContact({
                resource: {
                    // Ensure you have at least one of these fields
                    names: contact.names || [],
                    emailAddresses: contact.emailAddresses || [],
                    phoneNumbers: contact.phoneNumbers || [],
                    // Add other required fields as necessary
                }
            });
            console.log('Contact inserted successfully:', contact);
        } catch (error) {
            console.error('Error inserting contact:', error);
        }
    }
}

module.exports = { insertContacts };
