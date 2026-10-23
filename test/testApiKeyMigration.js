const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const migrateApiKeys = require('../lib/migrate-api-key');

const secret = '0123456789abcdef'.repeat(3);
const plaintext = '0123456789abcdefFEDCBA9876543210';
const id = 'system.adapter.weatherunderground.0';

function encrypt(key, value) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-192-cbc', Buffer.from(key, 'hex'), iv);
    return `$/aes-192-cbc:${iv.toString('hex')}:${Buffer.concat([cipher.update(value), cipher.final()]).toString('hex')}`;
}

function instance(number = 0) {
    return {
        _id: `system.adapter.weatherunderground.${number}`,
        type: 'instance',
        common: { name: 'weatherunderground', enabled: false, custom: 'preserve' },
        native: { apikey: plaintext, station: 'TEST', location: '0,0', nonMetric: false },
        encryptedNative: ['otherSecret'],
        protectedNative: ['otherSecret'],
        custom: { nested: ['preserve', 0, false] },
    };
}

function setup(objects = [instance()]) {
    const fixture = {
        store: JSON.parse(JSON.stringify(Object.fromEntries(objects.map(object => [object._id, object])))),
        writes: [],
        alive: {},
        system: JSON.parse(JSON.stringify({ native: { secret } })),
        onRead: (_id, _count) => {},
        beforeWrite: async (_id, _object) => {},
        afterWrite: _id => {},
    };
    const reads = new Map();
    const adapter = {
        getForeignObjectsAsync: async () => structuredClone(fixture.store),
        getForeignObjectAsync: async key => {
            if (key === 'system.config') {
                return structuredClone(fixture.system);
            }
            reads.set(key, (reads.get(key) || 0) + 1);
            fixture.onRead(key, reads.get(key));
            return structuredClone(fixture.store[key]);
        },
        getForeignStateAsync: async key => fixture.alive[key] || null,
        setForeignObjectAsync: async (key, object) => {
            await fixture.beforeWrite(key, object);
            fixture.store[key] = structuredClone(object);
            fixture.writes.push(key);
            fixture.afterWrite(key);
            return { id: key };
        },
        encrypt: (key, value) => encrypt(key, value),
    };
    return { fixture, adapter };
}

function independentlyDecrypt(value) {
    const [algorithm, iv, ciphertext] = value.split(':');
    assert.equal(algorithm, '$/aes-192-cbc');
    const decipher = crypto.createDecipheriv('aes-192-cbc', Buffer.from(secret, 'hex'), Buffer.from(iv, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'hex')), decipher.final()]).toString();
}

describe('pre-upgrade API key migration', () => {
    it('encrypts plaintext and writes protection flags together while preserving unrelated configuration', async () => {
        const original = instance();
        const { fixture, adapter } = setup([original]);
        assert.deepEqual(await migrateApiKeys(adapter), { inspected: 1, updated: 1, unchanged: 0 });
        const stored = fixture.store[id];
        assert.notEqual(stored.native.apikey, plaintext);
        assert.equal(independentlyDecrypt(stored.native.apikey), plaintext);
        assert.deepEqual(stored, {
            ...original,
            native: { ...original.native, apikey: stored.native.apikey },
            encryptedNative: ['otherSecret', 'apikey'],
            protectedNative: ['otherSecret', 'apikey'],
        });
        assert.deepEqual(fixture.writes, [id]);
        const firstCiphertext = stored.native.apikey;
        assert.deepEqual(await migrateApiKeys(adapter), { inspected: 1, updated: 0, unchanged: 1 });
        assert.equal(fixture.store[id].native.apikey, firstCiphertext);
        assert.equal(fixture.writes.length, 1);
    });

    it('uses canonical instance objects when enumeration adds virtual enum metadata', async () => {
        const { fixture, adapter } = setup();
        adapter.getForeignObjectsAsync = async () => {
            const enumerated = structuredClone(fixture.store);
            enumerated[id].enums = { 'enum.rooms.example': 'Example room' };
            return enumerated;
        };
        assert.deepEqual(await migrateApiKeys(adapter), { inspected: 1, updated: 1, unchanged: 0 });
        assert.equal(independentlyDecrypt(fixture.store[id].native.apikey), plaintext);
        assert.equal('enums' in fixture.store[id], false);
        assert.equal(fixture.store[id].native.station, 'TEST');
    });

    for (const value of ['', undefined]) {
        it(`preserves ${value === undefined ? 'missing' : 'empty'} keys and adds both missing lists`, async () => {
            const object = instance();
            object.native.apikey = value;
            delete object.encryptedNative;
            delete object.protectedNative;
            const { fixture, adapter } = setup([object]);
            await migrateApiKeys(adapter);
            assert.equal(fixture.store[id].native.apikey, value);
            assert.deepEqual(fixture.store[id].encryptedNative, ['apikey']);
            assert.deepEqual(fixture.store[id].protectedNative, ['apikey']);
        });
    }

    for (const [label, ciphertext] of [
        ['AES', encrypt(secret, plaintext)],
        [
            'legacy XOR',
            // js-controller-common-db 7.2.5 encryptLegacy('old-system-secret', plaintext).
            Buffer.from(
                '5f005d0056001e0047004c00450043005d0054004c001100060007001700030032002a00280027006f00320040004b0043005300580019004000570052004200',
                'hex',
            ).toString('utf16le'),
        ],
    ]) {
        it(`trusts encryptedNative for ${label} and retains exact ciphertext bytes`, async () => {
            const object = instance();
            object.native.apikey = ciphertext;
            object.encryptedNative.push('apikey');
            const { fixture, adapter } = setup([object]);
            await migrateApiKeys(adapter);
            assert.equal(fixture.store[id].native.apikey, ciphertext);
            assert.deepEqual(fixture.store[id].protectedNative, ['otherSecret', 'apikey']);
        });
    }

    it('does not infer encryption from an unmarked AES-looking plaintext value', async () => {
        const object = instance();
        object.native.apikey = '$/aes-192-cbc:this-is-a-plaintext-key';
        const { fixture, adapter } = setup([object]);
        await migrateApiKeys(adapter);
        assert.equal(independentlyDecrypt(fixture.store[id].native.apikey), object.native.apikey);
    });

    const invalidCases = [
        {
            label: 'enabled instance',
            invalidate: object => {
                object.common.enabled = true;
            },
        },
        {
            label: 'nonboolean enabled',
            invalidate: object => {
                object.common.enabled = undefined;
            },
        },
        {
            label: 'invalid key type',
            invalidate: object => {
                object.native.apikey = 123;
            },
        },
        {
            label: 'invalid encryption list',
            invalidate: object => {
                object.encryptedNative = 'apikey';
            },
        },
        {
            label: 'invalid protection list item',
            invalidate: object => {
                object.protectedNative = [false];
            },
        },
        {
            label: 'invalid ID',
            invalidate: object => {
                object._id = 'system.adapter.weatherunderground.not-an-instance';
            },
        },
    ];
    for (const { label, invalidate } of invalidCases) {
        it(`preflights every instance before writing: ${label}`, async () => {
            const first = instance();
            const second = JSON.parse(JSON.stringify(instance(1)));
            invalidate(second);
            const { fixture, adapter } = setup([first, second]);
            const before = structuredClone(fixture.store);
            await assert.rejects(migrateApiKeys(adapter), error => {
                assert.ok(error instanceof Error);
                assert.equal(error.message.includes(plaintext), false);
                return /^API key migration (?:preflight failed|failed for system\.adapter\.weatherunderground\.\d+): /.test(
                    error.message,
                );
            });
            assert.deepEqual(fixture.store, before);
            assert.deepEqual(fixture.writes, []);
        });
    }

    it('refuses an alive instance even when disabled', async () => {
        const { fixture, adapter } = setup();
        fixture.alive[`${id}.alive`] = { val: true };
        await assert.rejects(
            migrateApiKeys(adapter),
            /API key migration failed for system.adapter.weatherunderground.0/,
        );
        assert.deepEqual(fixture.writes, []);
    });

    for (const invalidSecret of ['', undefined, 42]) {
        it(`refuses missing or invalid system secret (${typeof invalidSecret}) without writes`, async () => {
            const { fixture, adapter } = setup();
            fixture.system.native.secret = invalidSecret;
            await assert.rejects(migrateApiKeys(adapter), /API key migration preflight failed/);
            assert.deepEqual(fixture.writes, []);
        });
    }

    it('refuses a concurrent object change and preserves it', async () => {
        const { fixture, adapter } = setup();
        fixture.onRead = (key, count) => {
            if (count === 2) {
                fixture.store[key].native.station = 'CONCURRENT';
            }
        };
        await assert.rejects(migrateApiKeys(adapter), /API key migration failed/);
        assert.equal(fixture.store[id].native.station, 'CONCURRENT');
        assert.equal(fixture.store[id].native.apikey, plaintext);
        assert.deepEqual(fixture.writes, []);
    });

    it('detects an instance starting after preflight', async () => {
        const { fixture, adapter } = setup();
        fixture.onRead = (key, count) => {
            if (count === 2) {
                fixture.alive[`${key}.alive`] = { val: true };
            }
        };
        await assert.rejects(migrateApiKeys(adapter), /API key migration failed/);
        assert.deepEqual(fixture.writes, []);
    });

    it('detects altered readback without retrying or logging raw data', async () => {
        const { fixture, adapter } = setup();
        fixture.afterWrite = key => {
            fixture.store[key].protectedNative = [];
        };
        await assert.rejects(migrateApiKeys(adapter), error => {
            assert.ok(error instanceof Error);
            assert.equal(error.message, `API key migration failed for ${id}: instance readback failed`);
            return true;
        });
        assert.equal(fixture.writes.length, 1);
    });

    it('reports partial failure by ID, preserves completed writes and safely resumes on retry', async () => {
        const second = instance(1);
        const { fixture, adapter } = setup([instance(), second]);
        fixture.beforeWrite = async key => {
            if (key === second._id) {
                throw new Error(`provider echoed ${plaintext}`);
            }
        };
        await assert.rejects(migrateApiKeys(adapter), error => {
            assert.ok(error instanceof Error);
            assert.equal(error.message, `API key migration failed for ${second._id}: instance write failed`);
            return true;
        });
        const completedCiphertext = fixture.store[id].native.apikey;
        assert.equal(independentlyDecrypt(completedCiphertext), plaintext);
        assert.equal(fixture.store[second._id].native.apikey, plaintext);
        fixture.beforeWrite = async () => {};
        assert.deepEqual(await migrateApiKeys(adapter), { inspected: 2, updated: 1, unchanged: 1 });
        assert.equal(fixture.store[id].native.apikey, completedCiphertext);
        assert.equal(independentlyDecrypt(fixture.store[second._id].native.apikey), plaintext);
    });

    it('returns nonzero when the controller exits successfully before the install callback', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wu-migration-runner-'));
        const preload = path.join(directory, 'early-exit.js');
        fs.writeFileSync(
            preload,
            `
            const Module = require('node:module');
            const original = Module._load;
            Module._load = function(name, ...args) {
                if (name === '../io-package.json') return {};
                if (name === '@iobroker/adapter-core') return { Adapter: class { constructor() { process.exit(0); } } };
                return original.call(this, name, ...args);
            };
        `,
        );
        try {
            const result = spawnSync(
                process.execPath,
                ['--require', preload, path.join(__dirname, '../lib/migrate-api-key.js'), '--install'],
                { encoding: 'utf8' },
            );
            assert.equal(result.status, 1);
            assert.match(result.stderr, /API key migration did not complete/);
            assert.equal((result.stdout + result.stderr).includes(plaintext), false);
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    for (const args of [[], ['--install']]) {
        it(`refuses unsafe standalone invocation (${args.length ? 'already upgraded metadata' : 'missing --install'}) before loading the controller`, () => {
            const result = spawnSync(process.execPath, [path.join(__dirname, '../lib/migrate-api-key.js'), ...args], {
                encoding: 'utf8',
            });
            assert.equal(result.status, 1);
            assert.match(
                result.stderr,
                args.length ? /Run before upgrading; restore pre-upgrade backup/ : /requires --install/,
            );
            assert.equal((result.stdout + result.stderr).includes(plaintext), false);
        });
    }
});
