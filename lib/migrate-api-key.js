const { isDeepStrictEqual } = require('node:util');

/**
 * Protect existing instance keys before upgrading the adapter metadata.
 *
 * @param {Pick<import('@iobroker/adapter-core').AdapterInstance, 'getForeignObjectsAsync' | 'getForeignObjectAsync' | 'getForeignStateAsync' | 'setForeignObjectAsync' | 'encrypt'>} adapter connected install-mode adapter
 * @returns {Promise<{inspected: number, updated: number, unchanged: number}>} migration counts
 */
async function migrateApiKeys(adapter) {
    let currentId;
    let reason = 'database access failed';
    try {
        const system = await adapter.getForeignObjectAsync('system.config');
        if (typeof system?.native?.secret !== 'string' || !system.native.secret) {
            reason = 'system secret is missing or invalid';
            throw new Error();
        }
        const instances = await adapter.getForeignObjectsAsync('system.adapter.weatherunderground.*', 'instance');
        const plans = [];
        for (const id of Object.keys(instances)) {
            currentId = undefined;
            if (!/^system\.adapter\.weatherunderground\.\d+$/.test(id)) {
                reason = 'invalid instance ID';
                throw new Error();
            }
            currentId = id;
            reason = 'instance read failed';
            const object = await adapter.getForeignObjectAsync(id);
            if (!object || object._id !== id || object.type !== 'instance') {
                reason = 'invalid instance object';
                throw new Error();
            }
            if (object.common?.enabled !== false) {
                reason = 'disable every instance before migration';
                throw new Error();
            }
            if (
                !object.native ||
                typeof object.native !== 'object' ||
                Array.isArray(object.native) ||
                (object.native.apikey !== undefined && typeof object.native.apikey !== 'string')
            ) {
                reason = 'invalid instance configuration';
                throw new Error();
            }
            for (const list of [object.encryptedNative, object.protectedNative]) {
                if (list !== undefined && (!Array.isArray(list) || list.some(value => typeof value !== 'string'))) {
                    reason = 'invalid native protection list';
                    throw new Error();
                }
            }
            reason = 'instance liveness check failed';
            if ((await adapter.getForeignStateAsync(`${id}.alive`))?.val === true) {
                reason = 'stop every instance before migration';
                throw new Error();
            }
            const original = structuredClone(object);
            const updated = structuredClone(object);
            if (!object.encryptedNative?.includes('apikey') && object.native.apikey) {
                reason = 'key encryption failed';
                updated.native.apikey = adapter.encrypt(system.native.secret, object.native.apikey);
            }
            updated.encryptedNative = [...(object.encryptedNative || [])];
            updated.protectedNative = [...(object.protectedNative || [])];
            if (!updated.encryptedNative.includes('apikey')) {
                updated.encryptedNative.push('apikey');
            }
            if (!updated.protectedNative.includes('apikey')) {
                updated.protectedNative.push('apikey');
            }
            plans.push({ id, original, updated });
            reason = 'database access failed';
        }

        let updatedCount = 0;
        for (const plan of plans) {
            currentId = plan.id;
            if (isDeepStrictEqual(plan.original, plan.updated)) {
                continue;
            }
            reason = 'instance revalidation failed';
            const fresh = await adapter.getForeignObjectAsync(plan.id);
            if (
                !isDeepStrictEqual(fresh, plan.original) ||
                (await adapter.getForeignStateAsync(`${plan.id}.alive`))?.val === true
            ) {
                reason = 'instance changed or started during migration';
                throw new Error();
            }
            reason = 'instance write failed';
            await adapter.setForeignObjectAsync(plan.id, plan.updated);
            reason = 'instance readback failed';
            const stored = await adapter.getForeignObjectAsync(plan.id);
            if (
                !stored ||
                stored.type !== 'instance' ||
                stored.native?.apikey !== plan.updated.native.apikey ||
                !isDeepStrictEqual(stored.encryptedNative, plan.updated.encryptedNative) ||
                !isDeepStrictEqual(stored.protectedNative, plan.updated.protectedNative)
            ) {
                throw new Error();
            }
            updatedCount++;
        }
        return { inspected: plans.length, updated: updatedCount, unchanged: plans.length - updatedCount };
    } catch {
        throw new Error(
            currentId
                ? `API key migration failed for ${currentId}: ${reason}`
                : `API key migration preflight failed: ${reason}`,
        );
    }
}

module.exports = migrateApiKeys;

if (require.main === module) {
    let completed = false;
    process.on('exit', code => {
        if (code === 0 && !completed) {
            process.stderr.write('API key migration did not complete.\n');
            process.exitCode = 1;
        }
    });
    if (!process.argv.includes('--install')) {
        process.stderr.write('API key migration requires --install and stopped instances.\n');
        process.exitCode = 1;
    } else if (require('../io-package.json').encryptedNative?.includes('apikey')) {
        process.stderr.write('Run before upgrading; restore pre-upgrade backup.\n');
        process.exitCode = 1;
    } else {
        try {
            const { Adapter } = require('@iobroker/adapter-core');
            const adapter = new Adapter({
                name: 'weatherunderground',
                dirname: require('node:path').join(__dirname, '..'),
                install() {
                    void migrateApiKeys(adapter).then(
                        summary => {
                            completed = true;
                            adapter.log.info(
                                `API key migration complete: ${summary.updated} updated, ${summary.unchanged} unchanged`,
                            );
                            adapter.terminate(0);
                        },
                        error => {
                            adapter.log.error(error.message);
                            adapter.terminate(1);
                        },
                    );
                },
            });
        } catch {
            process.stderr.write('API key migration could not start.\n');
            process.exitCode = 1;
        }
    }
}
