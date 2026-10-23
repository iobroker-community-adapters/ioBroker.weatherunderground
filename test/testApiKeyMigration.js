const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const migrateApiKey = require('../lib/migrate-api-key');

const key = '0123456789abcdefFEDCBA9876543210';

function setup(native, config = {}) {
    const writes = [];
    const object = { native: { ...native }, encryptedNative: ['apiKey'] };
    const adapter = {
        namespace: 'weatherunderground.0',
        config,
        getForeignObjectAsync: async id => {
            assert.equal(id, 'system.adapter.weatherunderground.0');
            return object;
        },
        // Deliberately no encryption mock: only the documented decrypted API result.
        decrypt: value => {
            assert.equal(value, 'controller-ciphertext');
            return key;
        },
        updateConfig: async patch => {
            writes.push(patch);
        },
    };
    return { adapter, object, writes };
}

describe('automatic API key migration', () => {
    it('copies canonical legacy key and empties it in one updateConfig payload', async () => {
        const { adapter, writes } = setup({ apikey: key, station: 'preserve' }, { apikey: 'stale-snapshot' });
        assert.equal(await migrateApiKey(adapter), 'updated');
        assert.deepEqual(writes, [{ apiKey: key, apikey: '' }]);
    });

    for (const legacy of ['', undefined]) {
        it(`does not write for ${legacy === undefined ? 'missing' : 'empty'} legacy`, async () => {
            const { adapter, writes } = setup({ apikey: legacy });
            assert.equal(await migrateApiKey(adapter), false);
            assert.deepEqual(writes, []);
        });
    }

    it('uses the existing new key without rewriting it', async () => {
        const { adapter, writes } = setup({ apiKey: 'controller-ciphertext' }, { apiKey: key });
        assert.equal(await migrateApiKey(adapter), false);
        assert.deepEqual(writes, []);
    });

    it('clears duplicate legacy only when the decrypted new key agrees', async () => {
        const { adapter, writes } = setup({ apiKey: 'controller-ciphertext', apikey: key }, { apiKey: key });
        assert.equal(await migrateApiKey(adapter), 'updated');
        assert.deepEqual(writes, [{ apiKey: key, apikey: '' }]);
    });

    it('defers requests when Admin changed the current key after startup', async () => {
        const { adapter, writes } = setup({ apiKey: 'controller-ciphertext' }, { apiKey: 'old-key' });
        assert.equal(await migrateApiKey(adapter), 'stale');
        assert.deepEqual(writes, []);
    });

    for (const failure of ['conflict', 'write', 'decrypt', 'metadata']) {
        it(`preserves configuration and sanitizes ${failure} failures`, async () => {
            const { adapter, object, writes } = setup({ apikey: key });
            if (failure === 'conflict') {
                object.native.apiKey = 'controller-ciphertext';
                object.native.apikey = 'different-key';
            } else if (failure === 'write') {
                adapter.updateConfig = async () => {
                    throw new Error(key);
                };
            } else if (failure === 'decrypt') {
                object.native.apiKey = 'controller-ciphertext';
                adapter.decrypt = () => {
                    throw new Error(key);
                };
            } else {
                object.encryptedNative = [];
            }
            const before = structuredClone(object);
            await assert.rejects(migrateApiKey(adapter), error => {
                assert.ok(error instanceof Error);
                assert.equal(error.message.includes(key), false);
                assert.match(error.message, /^API key migration failed/);
                return true;
            });
            assert.deepEqual(object, before);
            assert.deepEqual(writes, []);
        });
    }

    for (const outcome of ['updated', 'stale', 'error']) {
        it(`sends no requests or schedule changes before migration ${outcome}`, async () => {
            const main = path.join(__dirname, '..', 'main.js');
            const adapterRequire = createRequire(main);
            const handlers = {};
            const logs = [];
            const terminated = [];
            const fakeAdapter = {
                on: (event, handler) => {
                    handlers[event] = handler;
                },
                log: { error: message => logs.push(message) },
                terminate: code => terminated.push(code),
                getForeignObjectAsync: () => {
                    throw new Error('unexpected schedule read');
                },
            };
            const testModule = { parent: true, exports: {} };
            const factory = vm.runInNewContext(`${fs.readFileSync(main, 'utf8')}\nmodule.exports;`, {
                module: testModule,
                require: name => {
                    if (name === '@iobroker/adapter-core') {
                        return {
                            Adapter: function () {
                                return fakeAdapter;
                            },
                        };
                    }
                    if (name === './lib/migrate-api-key') {
                        return async () => {
                            if (outcome === 'error') {
                                throw new Error('sanitized migration failure');
                            }
                            return outcome;
                        };
                    }
                    if (name === 'axios') {
                        return () => {
                            throw new Error('unexpected provider request');
                        };
                    }
                    return adapterRequire(name);
                },
            });
            factory();
            await handlers.ready();
            assert.deepEqual(terminated, [outcome === 'error' ? 1 : 0]);
            assert.deepEqual(logs, outcome === 'error' ? ['sanitized migration failure'] : []);
        });
    }
});
