'use strict';

/**
 * Resolve provider icon codes without mixing numeric and legacy filename sets.
 *
 * @param {string | number | null | undefined} original provider URL or numeric code
 * @param {object} config adapter icon configuration
 * @returns {string | null | undefined} resolved URL or missing input
 */
function resolveIconUrl(original, config) {
    if (original === undefined) {
        return undefined;
    }
    if (original === null) {
        return null;
    }
    if (original === '') {
        return '';
    }
    const value = String(original);
    const numeric = /^[0-9]{1,4}$/.test(value);
    const providerUrl = numeric ? `https://www.wunderground.com/static/i/c/v4/${value}.svg` : value;
    const filename = providerUrl.substring(providerUrl.lastIndexOf('/') + 1);
    const base = (config.custom_icon_base_url || '').trim().replace(/\/+$/, '');
    if (base) {
        return `${base}/${filename.replace(/\.\w+$/, `.${config.custom_icon_format || 'gif'}`)}`;
    }
    if (config.iconSet) {
        return numeric
            ? providerUrl
            : `https://www.wunderground.com/static/i/c/${encodeURIComponent(config.iconSet)}/${filename}`;
    }
    return providerUrl;
}

module.exports = resolveIconUrl;
