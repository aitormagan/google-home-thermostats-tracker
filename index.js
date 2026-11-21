'use strict';

const { InfluxDB } = require('influx');
const config = require('./config');

const sdm = config.sdm;
const influx = new InfluxDB({
    host: config.influx.host,
    database: config.influx.database
});

async function getAccessToken() {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: sdm.clientId,
            client_secret: sdm.clientSecret,
            refresh_token: sdm.refreshToken,
            grant_type: 'refresh_token'
        })
    });

    const body = await response.json();
    if (!response.ok) {
        const detail = body.error === 'invalid_grant'
            ? 'Google rejected this refresh token. It may have expired or been revoked; authorize this account again and replace its refreshToken in config.js.'
            : JSON.stringify(body);
        throw new Error(`Google token refresh failed (${response.status}): ${detail}`);
    }
    if (!body.access_token) {
        throw new Error('Google token response did not contain an access_token');
    }
    return body.access_token;
}

async function getDevices(accessToken) {
    const url = `https://smartdevicemanagement.googleapis.com/v1/enterprises/${encodeURIComponent(sdm.projectId)}/devices`;
    const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    const body = await response.json();
    if (!response.ok) {
        throw new Error(`SDM devices request failed (${response.status}): ${JSON.stringify(body)}`);
    }
    return body.devices || [];
}

function toInfluxPoints(devices, mappings) {
    const points = [];
    const temperatureTrait = 'sdm.devices.traits.Temperature';
    const humidityTrait = 'sdm.devices.traits.Humidity';

    for (const device of devices) {
        const traits = device.traits || {};
        const sdmDeviceId = (device.name || '').split('/').pop();
        if (!sdmDeviceId) continue;
        const currentName = traits['sdm.devices.traits.Info']?.customName;
        const legacyDeviceId = mappings[device.name] || mappings[sdmDeviceId] ||
            (currentName && mappings[currentName]) || sdmDeviceId;

        const temperature = traits[temperatureTrait]?.ambientTemperatureCelsius;
        if (typeof temperature === 'number' && Number.isFinite(temperature)) {
            points.push({
                measurement: 'temperature',
                fields: { value: temperature },
                tags: { device_id: legacyDeviceId }
            });
        }

        const humidity = traits[humidityTrait]?.ambientHumidityPercent;
        if (typeof humidity === 'number' && Number.isFinite(humidity)) {
            points.push({
                measurement: 'humidity',
                fields: { value: humidity },
                tags: { device_id: legacyDeviceId }
            });
        }
    }
    return points;
}

async function main() {
    if (typeof fetch !== 'function') {
        throw new Error('This script requires Node.js 18 or newer (built-in fetch).');
    }
    if (!sdm?.clientId || !sdm?.clientSecret || !sdm?.refreshToken || !sdm?.projectId) {
        throw new Error('config.sdm must define clientId, clientSecret, refreshToken, and projectId.');
    }

    const accessToken = await getAccessToken();
    const devices = await getDevices(accessToken);
    const points = toInfluxPoints(devices, sdm.deviceMappings || {});

    if (points.length === 0) {
        throw new Error('SDM returned no temperature or humidity readings to write.');
    }

    await influx.writePoints(points);
    console.log(`Wrote ${points.length} points from ${devices.length} SDM devices to InfluxDB.`);
}

main().catch(error => {
    console.error(`Nest tracking failed: ${error.message}`);
    process.exitCode = 1;
});
