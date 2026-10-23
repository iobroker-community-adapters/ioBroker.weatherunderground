import { defineConfig } from 'vite';
import { federation } from '@module-federation/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    base: './',
    build: {
        outDir: fileURLToPath(new URL('./custom', import.meta.url)),
        emptyOutDir: true,
        target: 'es2022',
        rollupOptions: { input: fileURLToPath(new URL('./src/WeatherSettings.js', import.meta.url)) },
    },
    plugins: [
        federation({
            name: 'WeatherUndergroundConfig',
            dts: false,
            filename: 'remoteEntry.js',
            exposes: { './Components': './admin/src/WeatherSettings.js' },
            shared: { react: { singleton: true, import: false, requiredVersion: false } },
        }),
    ],
});
