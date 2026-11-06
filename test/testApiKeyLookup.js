const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const main = path.join(__dirname, '..', 'main.js');
const source = fs.readFileSync(main, 'utf8');
const adapterRequire = createRequire(main);

describe('API key lookup', () => {
    for (const station of [' pws:TEST1 ', ' TEST1 ']) {
        it(`normalizes ${JSON.stringify(station)}`, () => {
            const calls = [];
            vm.runInNewContext(
                `${source}
                adapter = { config: { station: testStation } };
                getWebsiteKey = callback => { testCalls.push(adapter.config.station); callback(); };
                getApiKey(() => testCalls.push('done'));
            `,
                {
                    require: name => (name === '@iobroker/adapter-core' ? {} : adapterRequire(name)),
                    module: { parent: true, exports: {} },
                    testStation: station,
                    testCalls: calls,
                },
            );
            assert.deepEqual(calls, ['TEST1', 'done']);
        });
    }
});
