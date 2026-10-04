import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { VerifyEmail } = require('./dist/nodes/VerifyEmail/VerifyEmail.node.js');

const fixturesDir = existsSync(new URL('./fixtures/', import.meta.url)) ? './fixtures/' : '../../docs/api/fixtures/';
const fixture = (name) =>
	JSON.parse(readFileSync(new URL(`${fixturesDir}${name}.json`, import.meta.url), 'utf8'));
const sample = (name) => readFileSync(new URL(`./samples/${name}.json`, import.meta.url), 'utf8');
const serialise = (value) => `${JSON.stringify(value, null, 2)}\n`;

const PENDING = fixture('pending').response.body;
const RATE_HEADERS = { 'content-type': 'application/json', 'ratelimit-limit': '3' };
const reply = (statusCode, body, headers = { 'content-type': 'application/json' }) => ({ statusCode, body, headers });

function run(params, replies, { continueOnFail = false } = {}) {
	const calls = [];
	const context = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name) => params[name],
		getNode: () => ({ name: 'VerifyEmail', type: 'n8n-nodes-tryverifyemail.verifyEmail', typeVersion: 1, parameters: {} }),
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequestWithAuthentication: async (credential, options) => {
				calls.push({ credential, ...options });
				const next = replies.shift();
				if (!next) throw new Error(`unexpected extra request to ${options.url}`);
				return next;
			},
		},
	};
	return new VerifyEmail().execute.call(context).then(
		(output) => ({ output: output[0], calls }),
		(error) => ({ error, calls }),
	);
}

const results = [];
async function check(label, fn) {
	try {
		await fn();
		results.push(true);
		console.log(`ok   ${label}`);
	} catch (error) {
		results.push(false);
		console.log(`FAIL ${label}\n     ${error.message}`);
	}
}
function assert(condition, message) {
	if (!condition) throw new Error(message);
}

const VERIFY = { resource: 'email', operation: 'verify', email: 'jane@example.com' };
const BASE = 'https://api.tryverifyemail.com/v1/email-verifications';

await check('completed: one POST, flat output byte-matches samples/completed-deliverable.json', async () => {
	const { output, calls, error } = await run(VERIFY, [reply(200, fixture('completed-deliverable').response.body)]);
	assert(!error, error?.message);
	assert(calls.length === 1, `expected 1 request, got ${calls.length}`);
	assert(calls[0].credential === 'verifyEmailApi', `credential was ${calls[0].credential}`);
	assert(calls[0].method === 'POST' && calls[0].url === `${BASE}?timeout=25`, `${calls[0].method} ${calls[0].url}`);
	assert(serialise(calls[0].body) === serialise({ email: 'jane@example.com', source: 'n8n' }), 'POST body must be { email, source: "n8n" }');
	assert(!('Authorization' in calls[0].headers), 'the credential, not the node, must set Authorization');
	assert(serialise(output[0].json) === sample('completed-deliverable'), 'output differs from the sample');
	assert(output[0].pairedItem.item === 0, 'pairedItem missing');
});

await check('completed invalid syntax: output byte-matches samples/completed-invalid-syntax.json', async () => {
	const { output, error } = await run(
		{ ...VERIFY, email: 'not-an-email' },
		[reply(200, fixture('completed-invalid-syntax').response.body)],
	);
	assert(!error, error?.message);
	assert(serialise(output[0].json) === sample('completed-invalid-syntax'), 'output differs from the sample');
});

await check('pending after poll: exactly one GET ?timeout=25, item succeeds as samples/pending.json', async () => {
	const { output, calls, error } = await run(VERIFY, [reply(202, PENDING), reply(202, PENDING)]);
	assert(!error, error?.message);
	assert(calls.length === 2, `expected 2 requests, got ${calls.length}`);
	assert(calls[1].method === 'GET' && calls[1].url === `${BASE}/${PENDING.id}?timeout=25`, `${calls[1].method} ${calls[1].url}`);
	assert(serialise(output[0].json) === sample('pending'), 'output differs from the sample');
});

await check('pending then completed: the single poll returns the verdict', async () => {
	const { output, calls, error } = await run(VERIFY, [reply(202, PENDING), reply(200, fixture('completed-deliverable').response.body)]);
	assert(!error, error?.message);
	assert(calls.length === 2, `expected 2 requests, got ${calls.length}`);
	assert(serialise(output[0].json) === sample('completed-deliverable'), 'output differs from the sample');
});

await check('429 retry: waits Retry-After via n8n sleep, retries once, then succeeds', async () => {
	const started = Date.now();
	const { output, calls, error } = await run(VERIFY, [
		reply(429, { error: 'rate_limited', retry_after: 1 }, { ...RATE_HEADERS, 'retry-after': '1' }),
		reply(200, fixture('completed-deliverable').response.body),
	]);
	const waited = Date.now() - started;
	assert(!error, error?.message);
	assert(calls.length === 2, `expected 2 requests, got ${calls.length}`);
	assert(waited >= 900, `expected a ~1s wait, waited ${waited}ms`);
	assert(serialise(output[0].json) === sample('completed-deliverable'), 'output differs from the sample');
});

await check('429 twice: fails with NodeApiError naming the plan rate', async () => {
	const limited = reply(429, { error: 'rate_limited', retry_after: 1 }, { ...RATE_HEADERS, 'retry-after': '1' });
	const { error, calls } = await run(VERIFY, [limited, { ...limited }]);
	assert(calls.length === 2, `expected 2 requests, got ${calls.length}`);
	assert(error?.name === 'NodeApiError', `expected NodeApiError, got ${error?.name}`);
	assert(error.message === 'Rate limited: your plan allows 3 requests/second.', error.message);
	assert(error.httpCode === '429', `httpCode ${error.httpCode}`);
});

await check('402 insufficient credits: fails with NodeApiError linking to billing', async () => {
	const { error, calls } = await run(VERIFY, [
		reply(402, { error: 'insufficient_credits', balance: 0, required: 1, shortfall: 1 }),
	]);
	assert(calls.length === 1, `expected 1 request, got ${calls.length}`);
	assert(error?.name === 'NodeApiError', `expected NodeApiError, got ${error?.name}`);
	assert(
		error.message === 'Your VerifyEmail account is out of credits. Top up at https://app.tryverifyemail.com/dashboard/billing',
		error.message,
	);
	assert(error.httpCode === '402', `httpCode ${error.httpCode}`);
});

await check('402 with continueOnFail: the item carries the message instead of stopping the workflow', async () => {
	const { output, error } = await run(VERIFY, [reply(402, { error: 'insufficient_credits' })], { continueOnFail: true });
	assert(!error, error?.message);
	assert(output[0].json.error.startsWith('Your VerifyEmail account is out of credits.'), output[0].json.error);
});

await check('401: fails with the invalid key message', async () => {
	const { error } = await run(VERIFY, [reply(401, { error: 'unauthorized' })]);
	assert(error?.name === 'NodeApiError', `expected NodeApiError, got ${error?.name}`);
	assert(error.message.startsWith('Invalid API key.'), error.message);
});

await check('Get Verification: one GET ?timeout=25 for the given id', async () => {
	const { output, calls, error } = await run(
		{ resource: 'email', operation: 'getVerification', id: ` ${PENDING.id} ` },
		[reply(200, fixture('completed-deliverable').response.body)],
	);
	assert(!error, error?.message);
	assert(calls.length === 1 && calls[0].method === 'GET', 'expected one GET');
	assert(calls[0].url === `${BASE}/${PENDING.id}?timeout=25`, calls[0].url);
	assert(serialise(output[0].json) === sample('completed-deliverable'), 'output differs from the sample');
});

await check('Account Get Info: GET /v1/me, returned as is', async () => {
	const me = { email: 'owner@example.com', plan: 'payg', credits_available: 120, api_key: { id: 'key_1', label: 'n8n', mode: 'live' } };
	const { output, calls, error } = await run({ resource: 'account', operation: 'getInfo' }, [reply(200, me)]);
	assert(!error, error?.message);
	assert(calls[0].method === 'GET' && calls[0].url === 'https://api.tryverifyemail.com/v1/me', calls[0].url);
	assert(serialise(output[0].json) === serialise(me), 'account output changed');
});

const failed = results.filter((passed) => !passed).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
if (failed > 0) process.exitCode = 1;
