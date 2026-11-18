#!/usr/bin/env node
/**
 * Checks whether an App Store version can still take new texts and
 * screenshots. Apple locks a version from the moment it is submitted for
 * review: uploads fail one by one ("Can't Delete Screenshot After Submit for
 * review"), so store-metadata asks first and stops with a clear message.
 *
 * Usage (App Store Connect API key, as the Fastfiles read it):
 *   APP_STORE_CONNECT_API_KEY_ID=... APP_STORE_CONNECT_API_KEY_ISSUER_ID=... \
 *   APP_STORE_CONNECT_API_KEY_KEY=<.p8 as base64> \
 *   node app-store-version.mjs --bundle-id com.example.app --version 3.9.0
 * Prints `state=<state|NONE>` and `editable=<true|false>` (GITHUB_OUTPUT format).
 * NONE: the version does not exist yet; deliver creates it, so it is editable.
 */
import { createSign } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const API = 'https://api.appstoreconnect.apple.com/v1';

/** App Store version states before submission (or after a rejection). */
const EDITABLE_STATES = new Set([
  'PREPARE_FOR_SUBMISSION',
  'READY_FOR_REVIEW',
  'WAITING_FOR_EXPORT_COMPLIANCE',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
]);

/** Whether a version in `state` (null: not created yet) accepts uploads. */
export const isEditable = (state) => state === null || EDITABLE_STATES.has(state);

/** The state of `version` among the app's App Store versions, or null. */
export const versionState = (versions, version) => {
  const match = versions.find((entry) => entry.attributes?.versionString === version);
  if (!match) {
    return null;
  }
  return match.attributes.appVersionState ?? match.attributes.appStoreState ?? null;
};

/** ES256 JWT for the App Store Connect API (valid for 10 minutes). */
export const apiToken = ({ keyId, issuerId, privateKey }, now = Math.floor(Date.now() / 1000)) => {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${encode({
    iss: issuerId,
    iat: now,
    exp: now + 600,
    aud: 'appstoreconnect-v1',
  })}`;
  const signature = createSign('SHA256')
    .update(unsigned)
    .sign({ key: privateKey, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${unsigned}.${signature}`;
};

const get = async (path, token) => {
  const response = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`GET ${path}: ${response.status} ${await response.text()}`);
  }
  return response.json();
};

const main = async () => {
  const { values } = parseArgs({
    options: { 'bundle-id': { type: 'string' }, version: { type: 'string' } },
  });
  const {
    APP_STORE_CONNECT_API_KEY_ID: keyId,
    APP_STORE_CONNECT_API_KEY_ISSUER_ID: issuerId,
    APP_STORE_CONNECT_API_KEY_KEY: keyBase64,
  } = process.env;

  if (!values['bundle-id'] || !values.version || !keyId || !issuerId || !keyBase64) {
    throw new Error('Needs --bundle-id, --version and the APP_STORE_CONNECT_API_KEY_* variables');
  }

  const token = apiToken({
    keyId,
    issuerId,
    privateKey: Buffer.from(keyBase64, 'base64').toString('utf8'),
  });
  const apps = await get(`/apps?filter[bundleId]=${encodeURIComponent(values['bundle-id'])}`, token);
  const app = apps.data?.[0];
  if (!app) {
    throw new Error(`No app with bundle id ${values['bundle-id']}`);
  }

  const versions = await get(
    `/apps/${app.id}/appStoreVersions?filter[platform]=IOS&filter[versionString]=${encodeURIComponent(values.version)}`,
    token,
  );
  const state = versionState(versions.data ?? [], values.version);

  process.stdout.write(`state=${state ?? 'NONE'}\neditable=${isEditable(state)}\n`);
};

const isEntryPoint =
  process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;

if (isEntryPoint) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
