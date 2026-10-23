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
        it(`normalizes ${JSON.stringify(station)} without a dashboard request`, () => {
            const calls = [];
            vm.runInNewContext(
                source +
                    `
                adapter = { config: { useLegacyApi: false, station: testStation } };
                getStationKey = () => { throw new Error('unexpected dashboard request'); };
                getWebsiteKey = callback => { testCalls.push(adapter.config.station); callback(); };
                getApiKey(() => testCalls.push('done'));
            `,
                {
                    require: (name) => (name === '@iobroker/adapter-core' ? {} : adapterRequire(name)),
                    module: { parent: true, exports: {} },
                    testStation: station,
                    testCalls: calls,
                },
            );
            assert.deepEqual(calls, ['TEST1', 'done']);
        });
    }

    for (const previousApi of [false, true]) {
        it(`fetches ${previousApi ? 'dashboard and website' : 'only website'} keys in ${previousApi ? 'previous' : 'new'} API mode`, () => {
            const calls = [];
            vm.runInNewContext(
                source +
                    `
                adapter = { config: { useLegacyApi: testPreviousApi } };
                getStationKey = callback => { testCalls.push('dashboard'); callback(); };
                getWebsiteKey = callback => { testCalls.push('website'); callback(); };
                getApiKey(() => testCalls.push('done'));
            `,
                {
                    require: (name) => (name === '@iobroker/adapter-core' ? {} : adapterRequire(name)),
                    module: { parent: true, exports: {} },
                    testPreviousApi: previousApi,
                    testCalls: calls,
                },
            );
            assert.deepEqual(calls, previousApi ? ['dashboard', 'website', 'done'] : ['website', 'done']);
        });
    }
});
