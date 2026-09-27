import { createHash, createHmac } from 'node:crypto';

// Hand-rolled AWS SigV4 signing against Backblaze B2's S3-compatible endpoint, using
// only node:crypto and fetch — no AWS SDK dependency for three PUT/GET/DELETE calls.
export type B2Credentials = { bucket: string; endpoint: string; keyId: string; applicationKey: string };

function sha256Hex(data: Buffer): string { return createHash('sha256').update(data).digest('hex'); }
function hmac(key: Buffer | string, data: string): Buffer { return createHmac('sha256', key).update(data).digest(); }

function regionFor(endpoint: string): string {
  const match = endpoint.match(/^s3\.([^.]+)\.backblazeb2\.com$/);
  if (!match) throw new Error(`Unrecognized B2 S3 endpoint: ${endpoint} (expected s3.<region>.backblazeb2.com)`);
  return match[1];
}

async function signedRequest(creds: B2Credentials, method: string, objectKey: string, body?: Buffer): Promise<Response> {
  const region = regionFor(creds.endpoint);
  const canonicalUri = `/${creds.bucket}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? Buffer.alloc(0));
  const headerNames = ['host', 'x-amz-content-sha256', 'x-amz-date'];
  const headerValues: Record<string, string> = { host: creds.endpoint, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const canonicalHeaders = headerNames.map(name => `${name}:${headerValues[name]}\n`).join('');
  const signedHeaders = headerNames.join(';');
  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(Buffer.from(canonicalRequest))].join('\n');
  const dateKey = hmac(`AWS4${creds.applicationKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.keyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return fetch(`https://${creds.endpoint}${canonicalUri}`, {
    method, headers: { ...headerValues, Authorization: authorization }, body
  });
}

export async function putObject(creds: B2Credentials, objectKey: string, body: Buffer): Promise<void> {
  const response = await signedRequest(creds, 'PUT', objectKey, body);
  if (!response.ok) throw new Error(`B2 upload failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
}
export async function getObject(creds: B2Credentials, objectKey: string): Promise<Buffer> {
  const response = await signedRequest(creds, 'GET', objectKey);
  if (!response.ok) throw new Error(`B2 download failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
  return Buffer.from(await response.arrayBuffer());
}
export async function deleteObject(creds: B2Credentials, objectKey: string): Promise<void> {
  const response = await signedRequest(creds, 'DELETE', objectKey);
  if (!response.ok && response.status !== 404) throw new Error(`B2 delete failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
}
