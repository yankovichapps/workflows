import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';

import { apiToken, isEditable, versionState } from './app-store-version.mjs';

describe('isEditable', () => {
  it('accepts a version that is not submitted, or was rejected', () => {
    for (const state of [null, 'PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED']) {
      assert.equal(isEditable(state), true, String(state));
    }
  });

  it('refuses a version in or past review', () => {
    for (const state of ['WAITING_FOR_REVIEW', 'IN_REVIEW', 'PENDING_DEVELOPER_RELEASE', 'READY_FOR_DISTRIBUTION', 'READY_FOR_SALE', 'PROCESSING_FOR_DISTRIBUTION']) {
      assert.equal(isEditable(state), false, state);
    }
  });
});

describe('versionState', () => {
  it('prefers appVersionState and matches the version exactly', () => {
    const versions = [
      { attributes: { versionString: '13.9.0', appVersionState: 'READY_FOR_DISTRIBUTION' } },
      { attributes: { versionString: '3.9.0', appVersionState: 'WAITING_FOR_REVIEW', appStoreState: 'WAITING_FOR_REVIEW' } },
    ];
    assert.equal(versionState(versions, '3.9.0'), 'WAITING_FOR_REVIEW');
    assert.equal(versionState([{ attributes: { versionString: '3.9.0', appStoreState: 'IN_REVIEW' } }], '3.9.0'), 'IN_REVIEW');
  });

  it('is null when the version does not exist yet', () => {
    assert.equal(versionState([], '3.10.0'), null);
  });
});

describe('apiToken', () => {
  it('is an ES256 JWT for App Store Connect, verifiable with the public key', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const token = apiToken({ keyId: 'KEY', issuerId: 'ISSUER', privateKey }, 1000);
    const [header, payload, signature] = token.split('.');

    assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'ES256', kid: 'KEY', typ: 'JWT' });
    assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), {
      iss: 'ISSUER', iat: 1000, exp: 1600, aud: 'appstoreconnect-v1',
    });
    const valid = createVerify('SHA256')
      .update(`${header}.${payload}`)
      .verify({ key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'));
    assert.equal(valid, true);
  });
});
