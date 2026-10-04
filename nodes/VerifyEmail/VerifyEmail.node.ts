import type {
	IDataObject,
	IExecuteFunctions,
	IN8nHttpFullResponse,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError, sleep } from 'n8n-workflow';
import {
	DEFAULT_TIMEOUT_SECONDS,
	getMe,
	getVerification,
	IntegrationError,
	verifyWithPoll,
	type ApiConnection,
	type HttpClient,
	type IntegrationErrorCode,
} from './shared';

const CREDENTIAL = 'verifyEmailApi';
const SOURCE = 'n8n';

const ERROR_DESCRIPTIONS: Partial<Record<IntegrationErrorCode, string>> = {
	invalid_api_key:
		'Open the VerifyEmail API credential and paste a key from Developers → API keys in the dashboard. If the key has trusted IPs, leave that list empty for the key you use in n8n.',
	rate_limited:
		'The node already waited and retried once. Space out the runs or move to a plan with a higher rate: https://tryverifyemail.com/pricing/',
};

function httpClient(context: IExecuteFunctions): HttpClient {
	return async (url, init) => {
		const headers: IDataObject = { ...init.headers };
		delete headers.Authorization;
		const response = (await context.helpers.httpRequestWithAuthentication.call(context, CREDENTIAL, {
			url,
			method: init.method,
			headers,
			body: init.body === undefined ? undefined : (JSON.parse(init.body) as IDataObject),
			json: true,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
		})) as IN8nHttpFullResponse;
		const responseHeaders = response.headers ?? {};
		return {
			status: response.statusCode,
			headers: {
				get: (name: string) => {
					const value = responseHeaders[name.toLowerCase()] ?? responseHeaders[name];
					return value === undefined || value === null ? null : String(value);
				},
			},
			json: async () =>
				typeof response.body === 'string' ? (JSON.parse(response.body) as unknown) : response.body,
		};
	};
}

export class VerifyEmail implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'VerifyEmail',
		name: 'verifyEmail',
		icon: { light: 'file:../../icons/verifyemail.svg', dark: 'file:../../icons/verifyemail.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'VerifyEmail is a real-time email verification service. Check whether an address can receive mail before you send to it.',
		defaults: {
			name: 'VerifyEmail',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: CREDENTIAL,
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Account',
						value: 'account',
					},
					{
						name: 'Email',
						value: 'email',
					},
				],
				default: 'email',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['email'],
					},
				},
				options: [
					{
						name: 'Get Verification',
						value: 'getVerification',
						action: 'Get a verification',
						description: 'Fetch a verification by ID, such as one that came back pending',
					},
					{
						name: 'Verify',
						value: 'verify',
						action: 'Verify an email address',
						description: 'Check whether an email address can receive mail',
					},
				],
				default: 'verify',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['account'],
					},
				},
				options: [
					{
						name: 'Get Info',
						value: 'getInfo',
						action: 'Get account info',
						description: 'Get the account email, plan and the credits it can spend right now',
					},
				],
				default: 'getInfo',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'e.g. nathan@example.com',
				required: true,
				default: '',
				description:
					'The address to verify. A malformed address is not a failure: it comes back undeliverable with sub-status invalid_syntax.',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['verify'],
					},
				},
			},
			{
				displayName: 'Verification ID',
				name: 'id',
				type: 'string',
				required: true,
				default: '',
				description: 'The ID output of a Verify operation',
				displayOptions: {
					show: {
						resource: ['email'],
						operation: ['getVerification'],
					},
				},
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const http = httpClient(this);
		const connection: ApiConnection = { apiKey: '', sleep };
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				let json: IDataObject;

				if (resource === 'account' && operation === 'getInfo') {
					json = { ...(await getMe(http, connection)) };
				} else if (resource === 'email' && operation === 'verify') {
					const email = this.getNodeParameter('email', itemIndex) as string;
					json = { ...(await verifyWithPoll(http, { ...connection, email, source: SOURCE })) };
				} else if (resource === 'email' && operation === 'getVerification') {
					const id = (this.getNodeParameter('id', itemIndex) as string).trim();
					json = { ...(await getVerification(http, connection, id, DEFAULT_TIMEOUT_SECONDS)) };
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation "${operation}" is not supported for resource "${resource}"`,
						{ itemIndex },
					);
				}

				returnData.push({ json, pairedItem: { item: itemIndex } });
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				if (error instanceof IntegrationError && error.code !== 'unexpected_response') {
					throw new NodeApiError(
						this.getNode(),
						{ code: error.code, status: error.status, message: error.message } as JsonObject,
						{
							message: error.message,
							description: ERROR_DESCRIPTIONS[error.code],
							httpCode: String(error.status),
							itemIndex,
						},
					);
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}
