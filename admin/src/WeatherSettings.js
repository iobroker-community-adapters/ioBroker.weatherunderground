import React from 'react';

const icons = [
    'chanceflurries',
    'chancerain',
    'chancesleet',
    'chancesnow',
    'chancetstorms',
    'clear',
    'cloudy',
    'flurries',
    'fog',
    'hazy',
    'mostlycloudy',
    'mostlysunny',
    'partlycloudy',
    'partlysunny',
    'sleet',
    'rain',
    'snow',
    'sunny',
    'tstorms',
];

/**
 * Apply the legacy first-load defaults without changing existing settings.
 *
 * @param {object} data instance configuration
 * @param {object} system system common configuration
 * @returns {object} initial form values
 */
export function initialSettings(data, system) {
    const settings = { ...data };
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
    let base = data.iconSet
        ? `https://www.wunderground.com/static/i/c/${data.iconSet}/`
        : (data.custom_icon_base_url || '').trim();
    if (!base) {
        return [];
    }
    if (!base.endsWith('/')) {
        base += '/';
    }
    const extension = data.iconSet ? 'gif' : data.custom_icon_format || 'gif';
    return icons.map(icon => ({ name: icon, src: `${base}${icon}.${extension}` }));
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
