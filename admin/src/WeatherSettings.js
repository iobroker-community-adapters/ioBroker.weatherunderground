import React from 'react';

const icons = [0, 12, 26, 32];

/**
 * Apply the legacy first-load defaults without changing existing settings.
 *
 * @param {object} data instance configuration
 * @param {object} system system common configuration
 * @returns {object} initial form values
 */
export function initialSettings(data, system) {
    const settings = { ...data };
    // Admin encrypts apiKey and clears the legacy plaintext in the same configuration save.
    if (
        typeof settings.apikey === 'string' &&
        settings.apikey &&
        (!settings.apiKey || settings.apiKey === settings.apikey)
    ) {
        settings.apiKey = settings.apikey;
        settings.apikey = '';
    }
    for (const [key, value] of Object.entries({ iconSet: 'i', nonMetric: false, country: 'DE', useLegacyApi: true })) {
        if (settings[key] === undefined) {
            settings[key] = value;
        }
    }
    if (!settings.location) {
        if ((system.tempUnit || '').includes('F')) {
            settings.nonMetric = true;
        }
        if (
            [system.latitude, system.longitude].every(
                value => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value)),
            )
        ) {
            settings.location = `${system.latitude},${system.longitude}`;
        }
    }
    return settings;
}

/**
 * Build the same icon URLs used by the adapter runtime.
 *
 * @param {object} data instance configuration
 * @returns {object[]} icon names and preview URLs
 */
export function previewUrls(data) {
    // Runtime always uses the new API, even if a saved useLegacyApi flag is true.
    const base = (data.custom_icon_base_url || '').trim().replace(/\/+$/, '');
    const extension = base ? data.custom_icon_format || 'gif' : 'svg';
    return icons.map(icon => ({
        name: String(icon),
        src: `${base || 'https://www.wunderground.com/static/i/c/v4'}/${icon}.${extension}`,
    }));
}

class WeatherSettings extends React.Component {
    componentDidMount() {
        if (this.props.schema.custom.mode === 'defaults') {
            const settings = initialSettings(this.props.data, this.props.systemConfig);
            if (JSON.stringify(settings) !== JSON.stringify(this.props.data)) {
                this.props.onChange(settings, undefined, () => this.props.forceUpdate(Object.keys(settings), settings));
            }
        }
    }

    render() {
        if (this.props.schema.custom.mode === 'defaults') {
            return null;
        }
        return React.createElement(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
            previewUrls(this.props.data).map(icon =>
                React.createElement('img', {
                    key: icon.name,
                    src: icon.src,
                    alt: icon.name,
                    width: 50,
                    height: 50,
                }),
            ),
        );
    }
}

export default { WeatherSettings };
