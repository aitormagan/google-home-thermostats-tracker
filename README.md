# Google Home Thermostats Tracking

Polls Google Nest thermostats through the Google Smart Device Management (SDM) API and writes their current temperature and humidity to InfluxDB 1.x. It is designed to run periodically on a Raspberry Pi or another Node.js host.

The script uses Node.js's built-in `fetch`, so it does not need a Google API client library. It keeps the existing InfluxDB measurements and fields:

| Measurement | Field | Meaning |
| --- | --- | --- |
| `temperature` | `value` | Ambient temperature in Celsius |
| `humidity` | `value` | Ambient relative humidity in percent |

Both measurements include a `device_id` tag. Google provides the values as the SDM Temperature and Humidity traits. A device without one of those traits is skipped for that measurement.
Only devices whose SDM Connectivity trait reports `ONLINE` are recorded; devices reported as `OFFLINE` or without a connectivity status are skipped.

## Requirements

- Node.js 18 or newer and npm.
- InfluxDB 1.x with an existing database (default client port: `8086`).
- A Google Cloud project with the Smart Device Management API enabled.
- A Google Device Access project and an OAuth 2.0 client linked to it.
- A refresh token for the Google account that has authorized the Nest home in Partner Connections Manager (PCM).

## Google setup

1. Create a Google Cloud project and enable **Smart Device Management API**.
2. In Google Auth Platform, configure the consent screen for external use, add your Google account as a test user if the app is still in Testing, and add this scope:

   ```text
   https://www.googleapis.com/auth/sdm.service
   ```

3. Create an OAuth client. For the authorization flow described below, register this redirect URI exactly:

   ```text
   https://www.google.com
   ```

4. Create a project in [Google Device Access](https://console.nest.google.com/device-access), associate the OAuth Client ID, and copy its **Device Access Project ID**. This is different from the Google Cloud project ID.
5. Authorize your Google account and Nest home in PCM. Use the OAuth client ID and Device Access Project ID to build this URL, replacing the two placeholders:

   ```text
   https://nestservices.google.com/partnerconnections/DEVICE_ACCESS_PROJECT_ID/auth?redirect_uri=https://www.google.com&access_type=offline&prompt=consent&client_id=OAUTH_CLIENT_ID&response_type=code&scope=https://www.googleapis.com/auth/sdm.service
   ```

6. After granting access, Google redirects to `https://www.google.com`. Copy the `code` query parameter from the browser address bar. Exchange it for tokens:

   ```bash
   read -r -p "OAuth Client ID: " CLIENT_ID
   read -r -s -p "OAuth Client Secret: " CLIENT_SECRET
   echo
   read -r -s -p "Authorization code: " AUTH_CODE
   echo

   curl -sS -X POST "https://oauth2.googleapis.com/token" \
     -H "Content-Type: application/x-www-form-urlencoded" \
     --data-urlencode "client_id=$CLIENT_ID" \
     --data-urlencode "client_secret=$CLIENT_SECRET" \
     --data-urlencode "code=$AUTH_CODE" \
     --data-urlencode "grant_type=authorization_code" \
     --data-urlencode "redirect_uri=https://www.google.com"

   unset CLIENT_ID CLIENT_SECRET AUTH_CODE
   ```

   Keep the returned `refresh_token` private. The short-lived `access_token` is obtained automatically by the script.

For a personal integration, Google says OAuth verification is not required. However, an external OAuth app left in **Testing** issues refresh tokens that expire after 7 days. Set the app's publishing status to **In production** to avoid that testing-mode expiry. See [Google's Device Access authorization guide](https://developers.google.com/nest/device-access/authorize) and [OAuth refresh token expiration details](https://developers.google.com/identity/protocols/oauth2#expiration).

## Install and configure

From the project directory:

```bash
npm install
cp -n config.example.js config.js
```

The `-n` option avoids overwriting an existing `config.js`; skip the copy step if you have already configured it.

Edit `config.js`:

- `influx.host`: InfluxDB host name or IP address.
- `influx.database`: existing InfluxDB 1.x database name.
- `sdm.projectId`: Device Access Project ID.
- `sdm.clientId` and `sdm.clientSecret`: credentials for the OAuth client linked to that Device Access project.
- `sdm.refreshToken`: refresh token returned by the authorization code exchange.
- `sdm.deviceMappings`: optional map from SDM device identifiers to the old InfluxDB `device_id` values.

Example mapping:

```js
deviceMappings: {
    'enterprises/DEVICE_ACCESS_PROJECT_ID/devices/SDM_DEVICE_ID': 'old-device-id'
}
```

Use the full SDM resource name as the key where possible. The script also checks the SDM device ID alone and the thermostat's SDM `customName`. If no mapping matches, it uses the SDM device ID as `device_id`.

`config.js` is excluded from Git because it contains credentials. Do not commit or share it. `config.example.js` is a safe template.

## Run

Run one collection manually:

```bash
npm start
```

On success, the script reports the number of InfluxDB points written and exits. Errors are printed to stderr and produce a nonzero exit status. The script fetches a new access token each run, lists authorized devices, and writes available temperature and humidity readings.

To collect every five minutes with cron, edit the schedule using the actual project and Node paths on the host:

```cron
*/5 * * * * cd /path/to/google-home-thermostats-tracking && /usr/bin/node index.js >> /path/to/nest-tracking.log 2>&1
```

Make sure the cron user can read `config.js`, write the log, and reach both the Google APIs and InfluxDB.

## Refresh token expiry and recovery

Google refresh tokens can be revoked or become invalid. They may expire after 7 days while the OAuth app is in Testing, after six months of non-use, or if the user revokes access. This script refreshes the access token on each run, so a regularly scheduled run avoids the inactivity period. A refresh token cannot be renewed after Google rejects it: authorize the account again, exchange the new authorization code, and replace `sdm.refreshToken` in `config.js`.

If the script reports `invalid_grant`, reauthorize and replace the refresh token. If it reports an SDM `403` or `404`, check that the Google account granted access in PCM, the OAuth client is the one linked to the Device Access project, and the correct Device Access Project ID is configured.

## Data and limitations

- The current implementation supports one OAuth client, one refresh token, and one Device Access Project ID.
- One authorization can expose the homes/devices selected for that Google account in PCM. The script writes all devices returned by SDM that have temperature or humidity traits.
- Temperature is written in Celsius; humidity is written as a percentage.
- InfluxDB authentication and TLS options are not currently configured in the sample. Extend the InfluxDB constructor if the server requires them.
- No historical backfill is performed. Each run records the values returned at that time.
