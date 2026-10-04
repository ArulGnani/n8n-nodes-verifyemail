# n8n-nodes-tryverifyemail

The VerifyEmail community node for [n8n](https://n8n.io). VerifyEmail is a real-time email verification service: it checks whether an address can receive mail before you send to it, and returns a verdict, a quality score and the signals behind it.

The node runs on your own VerifyEmail API key. Every verification that reaches a verdict costs 1 credit from your account.

- Homepage: https://tryverifyemail.com
- Docs: https://tryverifyemail.com/docs/integrations/n8n/
- Support: team@tryverifyemail.com

## Installation

On a self-hosted n8n instance (owner or admin account):

1. Go to **Settings > Community Nodes** and select **Install**.
2. Enter `n8n-nodes-tryverifyemail` as the npm package name.
3. Tick **I understand the risks of installing unverified code from a public source** and select **Install**.

See n8n's [community node installation guide](https://docs.n8n.io/integrations/community-nodes/installation-and-management/gui-installation.md) for details. To install without the UI, run `npm install n8n-nodes-tryverifyemail` in `~/.n8n/nodes` and restart n8n.

## Credentials

The node uses one credential, **VerifyEmail API**, with one field.

1. In the VerifyEmail dashboard open **Developers > API keys** (https://app.tryverifyemail.com/dashboard/developers/api-keys) and create a key. Name it after n8n so you can tell its usage apart.
2. In n8n, add a **VerifyEmail** node, open **Credential to connect with** and select **Create new credential**.
3. Paste the key (it starts with `sk_`) into **API Key** and select **Save**.

n8n tests the credential by calling `GET /v1/me`, which costs no credits. The key is sent as `Authorization: Bearer <key>`.

Two notes on keys:

- **Trusted IPs.** A key with a trusted-IP allowlist answers `401` to calls from addresses outside it. n8n Cloud and most hosted instances call from their own servers, so leave the allowlist empty on the key you use here.
- **Test keys.** "Test" is only a label. A test key runs real checks and spends real credits.

## Operations

| Resource | Operation | Input | API call |
| --- | --- | --- | --- |
| Email | Verify | Email | `POST /v1/email-verifications?timeout=25`, then at most one `GET /v1/email-verifications/{id}?timeout=25` |
| Email | Get Verification | Verification ID | `GET /v1/email-verifications/{id}?timeout=25` |
| Account | Get Info | none | `GET /v1/me` |

**Verify** checks one address. A malformed address is not a failure: it comes back `undeliverable` with `sub_status: invalid_syntax`.

**Get Verification** fetches a check by the `id` a Verify step returned. Use it to finish a check that came back `pending`.

**Get Info** returns the account email, plan, the credits it can spend right now (`credits_available`) and the key's label and mode.

### Output

Verify and Get Verification return one flat item with these fields, in this order:

`id`, `status`, `email`, `normalized_email`, `verdict`, `sub_status`, `quality_score`, `confidence`, `provider`, `primary_mx`, `signal_syntax`, `signal_domain`, `signal_mx`, `signal_smtp`, `signal_catch_all`, `signal_role_account`, `signal_disposable`, `signal_dnsbl`, `signal_toxic`, `signal_greylisting`, `verified_at`, `is_deliverable`

- `verdict` is `deliverable`, `undeliverable`, `risky` or `unknown`.
- `is_deliverable` is `true` only when `verdict` is `deliverable`.
- Each `signal_*` is `pass`, `fail`, `warn`, `unknown` or `skipped`.

A completed check:

```json
{
  "id": "5f1c9d2e-8b1a-4f5e-9c3d-2a7b6e4d1f08",
  "status": "completed",
  "email": "jane@example.com",
  "normalized_email": "jane@example.com",
  "verdict": "deliverable",
  "sub_status": "mailbox_exists",
  "quality_score": 95,
  "confidence": 92,
  "provider": "google",
  "primary_mx": "aspmx.l.google.com",
  "signal_syntax": "pass",
  "signal_domain": "pass",
  "signal_mx": "pass",
  "signal_smtp": "pass",
  "signal_catch_all": "pass",
  "signal_role_account": "pass",
  "signal_disposable": "pass",
  "signal_dnsbl": "pass",
  "signal_toxic": "pass",
  "signal_greylisting": "pass",
  "verified_at": "2026-09-05T06:35:01.000Z",
  "is_deliverable": true
}
```

All field definitions: https://tryverifyemail.com/docs/api/verify-email/result/

## Pending results

Some mail servers take longer to answer than one step should wait. Verify waits up to 25 seconds, and if the check is still running it asks once more, for up to another 25 seconds. If the check is still running after that, the step **succeeds** with `status: "pending"`, the `id`, `is_deliverable: false` and every other field `null`. The node never guesses a verdict.

The check keeps running on VerifyEmail's side. To finish it, add a **Wait** node and then a **VerifyEmail > Get Verification** step with `{{ $json.id }}`. It returns the finished result, or `pending` again if the server still hasn't answered. Every check finishes within 180 seconds. If the recipient's server never answers, the result is `verdict: unknown` with `sub_status: timeout`, and that check is not charged.

## Rate limits, credits and keys

- **429 Too Many Requests.** Your plan allows a set number of requests per second. The node waits for the `Retry-After` time (at most 10 seconds) and retries once. If it is still limited, the step stops with `Rate limited: your plan allows N requests/second.` Space out the runs (for example with **Loop Over Items** and a **Wait**) or move to a plan with a higher rate.
- **402 Payment Required.** The account is out of credits (nothing was started or charged) or it is frozen. The step stops with a link to https://app.tryverifyemail.com/dashboard/billing. Top up and run it again.
- **401 Unauthorized.** The key is wrong, revoked, or limited to trusted IPs that don't include n8n's servers.

With **Settings > On Error > Continue** the failing item carries `{ "error": "<message>" }` instead of stopping the workflow.

## Example workflow

Paste this into an n8n canvas. It verifies one address and routes deliverable addresses to the true branch. Pick your VerifyEmail credential on the VerifyEmail node after pasting.

```json
{
  "name": "Verify an email with VerifyEmail",
  "nodes": [
    {
      "parameters": {},
      "name": "When clicking 'Execute workflow'",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0]
    },
    {
      "parameters": {
        "resource": "email",
        "operation": "verify",
        "email": "jane@example.com"
      },
      "name": "VerifyEmail",
      "type": "n8n-nodes-tryverifyemail.verifyEmail",
      "typeVersion": 1,
      "position": [220, 0]
    },
    {
      "parameters": {
        "conditions": {
          "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "strict" },
          "conditions": [
            {
              "id": "6a3f1c9e-1b2d-4c5e-8f7a-9b0c1d2e3f40",
              "leftValue": "={{ $json.is_deliverable }}",
              "rightValue": "",
              "operator": { "type": "boolean", "operation": "true", "singleValue": true }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "name": "Deliverable?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [440, 0]
    }
  ],
  "connections": {
    "When clicking 'Execute workflow'": {
      "main": [[{ "node": "VerifyEmail", "type": "main", "index": 0 }]]
    },
    "VerifyEmail": {
      "main": [[{ "node": "Deliverable?", "type": "main", "index": 0 }]]
    }
  }
}
```

## Compatibility

Built with `@n8n/node-cli` 0.50 against the n8n nodes API version 1. The package has no runtime dependencies.

## Development

```sh
pnpm install
pnpm run lint
pnpm run check
pnpm run dev
```

`pnpm run check` builds the node and runs `check.mjs`, which drives it against a mocked API: a completed check, a check still pending after the poll, a `429` that clears on retry, a `429` that doesn't, a `402`, a `401`, Get Verification and Get Info. `samples/` holds the node's real output for each fixture in `fixtures/`.

This repository is a mirror. The source lives in the VerifyEmail monorepo under `integrations/n8n/`, and `nodes/VerifyEmail/shared.ts` is a verbatim copy of the client every VerifyEmail marketplace integration shares. Report issues at https://github.com/ArulGnani/n8n-nodes-verifyemail/issues or team@tryverifyemail.com.

## License

[MIT](LICENSE)
