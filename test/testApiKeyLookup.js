const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const main = path.join(__dirname, '..', 'main.js');
const source = fs.readFileSync(main, 'utf8');
const adapterRequire = createRequire(main);

describe('API key lookup', () => {
    for (const legacy of [false, true]) {
        it(`fetches ${legacy ? 'legacy and website' : 'only website'} keys in ${legacy ? 'legacy' : 'new'} API mode`, () => {
            const calls = [];
            vm.runInNewContext(
                source +
                    `
                adapter = { config: { useLegacyApi: testLegacy } };
                getStationKey = callback => { testCalls.push('legacy'); callback(); };
                getWebsiteKey = callback => { testCalls.push('website'); callback(); };
                getApiKey(() => testCalls.push('done'));
            `,
                {
                    require: (name) => (name === '@iobroker/adapter-core' ? {} : adapterRequire(name)),
                    module: { parent: true, exports: {} },
                    testLegacy: legacy,
                    testCalls: calls,
                },
            );
            assert.deepEqual(calls, legacy ? ['legacy', 'website', 'done'] : ['website', 'done']);
        });
    }
});
