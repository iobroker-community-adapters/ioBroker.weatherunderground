/**
 * Move the released plaintext field through the controller's encrypted config writer.
 *
 * @param {{namespace: string, config: {apiKey?: string}, getForeignObjectAsync: (id: string) => Promise<{native: Record<string, unknown>, encryptedNative?: string[]} | null | undefined>, updateConfig: (config: {apiKey: string, apikey: string}) => Promise<unknown>, decrypt: (value: string) => string}} adapter running adapter
 * @returns {Promise<'updated' | 'stale' | false>} whether requests must wait for the next startup
 */
async function migrateApiKey(adapter) {
    try {
        const object = await adapter.getForeignObjectAsync(`system.adapter.${adapter.namespace}`);
        if (!object?.native || !object.encryptedNative?.includes('apiKey')) {
            throw new Error();
        }
        const { apikey: legacy, apiKey: stored } = object.native;
        if (
            (legacy !== undefined && typeof legacy !== 'string') ||
            (stored !== undefined && typeof stored !== 'string')
        ) {
            throw new Error();
        }
        const current = typeof stored === 'string' && stored ? adapter.decrypt(stored) : '';
        if (legacy && current && current !== legacy) {
            throw new Error();
        }
        if (typeof legacy === 'string' && legacy) {
            await adapter.updateConfig({ apiKey: current || legacy, apikey: '' });
            return 'updated';
        }
        return current !== (adapter.config.apiKey || '') ? 'stale' : false;
    } catch {
        throw new Error('API key migration failed; check configuration and retry');
    }
}

module.exports = migrateApiKey;
