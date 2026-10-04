import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class VerifyEmailApi implements ICredentialType {
	name = 'verifyEmailApi';

	displayName = 'VerifyEmail API';

	icon: Icon = { light: 'file:../icons/verifyemail.svg', dark: 'file:../icons/verifyemail.dark.svg' };

	documentationUrl = 'https://tryverifyemail.com/docs/integrations/n8n/';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			placeholder: 'e.g. sk_live_xxxxxxxx',
			description:
				'Create a key in the VerifyEmail dashboard under Developers → API keys. It starts with sk_.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://api.tryverifyemail.com',
			url: '/v1/me',
			method: 'GET',
		},
	};
}
