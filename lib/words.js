const fs = require('node:fs');
const path = require('node:path');

function readTranslations() {
    try {
        const dictionary = {};
        const directory = path.join(__dirname, '../admin/i18n');
        for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.json'))) {
            const language = file.slice(0, -5);
            const translations = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
            for (const [key, value] of Object.entries(translations)) {
                const word = key.replace(/^weatherunderground_/, '');
                dictionary[word] = dictionary[word] || {};
                dictionary[word][language] = value;
            }
        }
        return dictionary;
    } catch {
        return {};
    }
}

module.exports = readTranslations();
