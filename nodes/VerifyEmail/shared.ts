export const DEFAULT_BASE_URL = "https://api.tryverifyemail.com";
export const BILLING_URL = "https://app.tryverifyemail.com/dashboard/billing";
export const DEFAULT_TIMEOUT_SECONDS = 25;
export const MAX_RETRY_AFTER_SECONDS = 10;

export const HUB_FIELDS = [
  "id",
  "status",
  "email",
  "normalized_email",
  "verdict",
  "sub_status",
  "quality_score",
  "confidence",
  "provider",
  "primary_mx",
  "signal_syntax",
  "signal_domain",
  "signal_mx",
  "signal_smtp",
  "signal_catch_all",
  "signal_role_account",
  "signal_disposable",
  "signal_dnsbl",
  "signal_toxic",
  "signal_greylisting",
  "verified_at",
  "is_deliverable",
] as const;

export type HubField = (typeof HUB_FIELDS)[number];

export type Verdict = "deliverable" | "undeliverable" | "risky" | "unknown";

export type SignalStatus = "pass" | "fail" | "warn" | "unknown" | "skipped" | "error";

export interface Signals {
  syntax: SignalStatus;
  domain: SignalStatus;
  mx: SignalStatus;
  smtp: SignalStatus;
  catch_all: SignalStatus;
  role_account: SignalStatus;
  disposable: SignalStatus;
  dnsbl: SignalStatus;
  toxic: SignalStatus;
  greylisting: SignalStatus;
}

export interface VerificationResult {
  email: string;
  normalized_email: string;
  verdict: Verdict;
  sub_status: string | null;
  quality_score: number;
  confidence: number;
  provider: string | null;
  primary_mx: string | null;
  signals: Signals;
  verified_at: string;
}

export interface CompletedVerification {
  id: string;
  status: "completed";
  result: VerificationResult;
}

export interface PendingVerification {
  id: string;
  status: "pending";
  poll_after_ms: number;
  next_retry_at: string;
}

export type Verification = CompletedVerification | PendingVerification;

export interface FlatVerification {
  id: string;
  status: "completed" | "pending";
  email: string | null;
  normalized_email: string | null;
  verdict: Verdict | null;
  sub_status: string | null;
  quality_score: number | null;
  confidence: number | null;
  provider: string | null;
  primary_mx: string | null;
  signal_syntax: SignalStatus | null;
  signal_domain: SignalStatus | null;
  signal_mx: SignalStatus | null;
  signal_smtp: SignalStatus | null;
  signal_catch_all: SignalStatus | null;
  signal_role_account: SignalStatus | null;
  signal_disposable: SignalStatus | null;
  signal_dnsbl: SignalStatus | null;
  signal_toxic: SignalStatus | null;
  signal_greylisting: SignalStatus | null;
  verified_at: string | null;
  is_deliverable: boolean;
}

export interface Me {
  email: string;
  plan: string;
  credits_available: number;
  api_key: { id: string; label: string; mode: "live" | "test" } | null;
}

export interface HttpRequest {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  headers: { get(name: string): string | null | undefined };
  json(): Promise<unknown>;
}

export type HttpClient = (url: string, init: HttpRequest) => Promise<HttpResponse>;

export interface ApiConnection {
  baseUrl?: string;
  apiKey: string;
  // Injected because n8n's community-package scanner rejects any reference to setTimeout.
  sleep: (ms: number) => Promise<void>;
}

export interface VerifyOptions extends ApiConnection {
  email: string;
  source?: string;
  timeout?: number;
  pollTimeout?: number;
}

export type IntegrationErrorCode =
  | "invalid_api_key"
  | "insufficient_credits"
  | "account_frozen"
  | "rate_limited"
  | "request_failed"
  | "server_error"
  | "unexpected_response";

export class IntegrationError extends Error {
  readonly code: IntegrationErrorCode;
  readonly status: number;

  constructor(code: IntegrationErrorCode, message: string, status: number) {
    super(message);
    this.name = "IntegrationError";
    this.code = code;
    this.status = status;
  }
}

export function flatten(body: Verification): FlatVerification {
  if (body.status !== "completed") {
    return {
      id: body.id,
      status: "pending",
      email: null,
      normalized_email: null,
      verdict: null,
      sub_status: null,
      quality_score: null,
      confidence: null,
      provider: null,
      primary_mx: null,
      signal_syntax: null,
      signal_domain: null,
      signal_mx: null,
      signal_smtp: null,
      signal_catch_all: null,
      signal_role_account: null,
      signal_disposable: null,
      signal_dnsbl: null,
      signal_toxic: null,
      signal_greylisting: null,
      verified_at: null,
      is_deliverable: false,
    };
  }
  const result = body.result;
  const signals = result.signals;
  return {
    id: body.id,
    status: "completed",
    email: result.email,
    normalized_email: result.normalized_email,
    verdict: result.verdict,
    sub_status: result.sub_status,
    quality_score: result.quality_score,
    confidence: result.confidence,
    provider: result.provider,
    primary_mx: result.primary_mx,
    signal_syntax: signals.syntax,
    signal_domain: signals.domain,
    signal_mx: signals.mx,
    signal_smtp: signals.smtp,
    signal_catch_all: signals.catch_all,
    signal_role_account: signals.role_account,
    signal_disposable: signals.disposable,
    signal_dnsbl: signals.dnsbl,
    signal_toxic: signals.toxic,
    signal_greylisting: signals.greylisting,
    verified_at: result.verified_at,
    is_deliverable: result.verdict === "deliverable",
  };
}

export async function verifyWithPoll(http: HttpClient, options: VerifyOptions): Promise<FlatVerification> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_SECONDS;
  const payload = options.source ? { email: options.email, source: options.source } : { email: options.email };
  const created = await call(http, options, "POST", `/v1/email-verifications?timeout=${timeout}`, payload);
  const verification = asVerification(created);
  if (verification.status === "completed") return flatten(verification);
  return getVerification(http, options, verification.id, options.pollTimeout ?? timeout);
}

export async function getVerification(
  http: HttpClient,
  connection: ApiConnection,
  id: string,
  timeout?: number,
): Promise<FlatVerification> {
  const query = timeout === undefined ? "" : `?timeout=${timeout}`;
  const response = await call(http, connection, "GET", `/v1/email-verifications/${encodeURIComponent(id)}${query}`);
  return flatten(asVerification(response));
}

export async function getMe(http: HttpClient, connection: ApiConnection): Promise<Me> {
  const response = await call(http, connection, "GET", "/v1/me");
  if (!isRecord(response.body) || typeof response.body.email !== "string") throw unexpected(response.status);
  return response.body as unknown as Me;
}

interface ApiResponse {
  status: number;
  body: unknown;
}

async function call(
  http: HttpClient,
  connection: ApiConnection,
  method: HttpRequest["method"],
  path: string,
  payload?: unknown,
): Promise<ApiResponse> {
  const baseUrl = (connection.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const init: HttpRequest = {
    method,
    headers: { Authorization: `Bearer ${connection.apiKey}`, Accept: "application/json" },
  };
  if (payload !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(payload);
  }

  let response = await http(`${baseUrl}${path}`, init);
  if (response.status === 429) {
    await connection.sleep(retryAfterSeconds(response, await readJson(response)) * 1000);
    response = await http(`${baseUrl}${path}`, init);
  }

  const body = await readJson(response);
  if (response.status >= 200 && response.status < 300) return { status: response.status, body };
  throw toIntegrationError(response, body);
}

async function readJson(response: HttpResponse): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function retryAfterSeconds(response: HttpResponse, body: unknown): number {
  const fromHeader = Number(response.headers.get("Retry-After"));
  const fromBody = isRecord(body) ? Number(body.retry_after) : Number.NaN;
  const seconds = Number.isFinite(fromHeader) && fromHeader > 0 ? fromHeader : fromBody;
  if (!Number.isFinite(seconds) || seconds <= 0) return 1;
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
}

const FROZEN_REASONS: Record<string, string> = {
  past_due: "a payment is past due",
  cancelled: "the subscription was cancelled",
};

function toIntegrationError(response: HttpResponse, body: unknown): IntegrationError {
  const record = isRecord(body) ? body : {};
  const apiError = typeof record.error === "string" ? record.error : undefined;

  if (response.status === 401) {
    return new IntegrationError(
      "invalid_api_key",
      "Invalid API key. Check that the VerifyEmail key you connected is correct and has not been revoked.",
      401,
    );
  }
  if (response.status === 402 && apiError === "account_frozen") {
    const reason = typeof record.reason === "string" ? FROZEN_REASONS[record.reason] : undefined;
    return new IntegrationError(
      "account_frozen",
      `Your VerifyEmail account is frozen${reason ? ` because ${reason}` : ""}. Resolve it at ${BILLING_URL}`,
      402,
    );
  }
  if (response.status === 402) {
    return new IntegrationError(
      "insufficient_credits",
      `Your VerifyEmail account is out of credits. Top up at ${BILLING_URL}`,
      402,
    );
  }
  if (response.status === 429) {
    const limit = response.headers.get("RateLimit-Limit");
    return new IntegrationError(
      "rate_limited",
      limit
        ? `Rate limited: your plan allows ${limit} requests/second.`
        : "Rate limited by the VerifyEmail API. Try again in a few seconds.",
      429,
    );
  }
  return new IntegrationError(
    response.status >= 500 ? "server_error" : "request_failed",
    apiError ?? `The VerifyEmail API answered HTTP ${response.status}.`,
    response.status,
  );
}

function asVerification(response: ApiResponse): Verification {
  const body = response.body;
  if (
    isRecord(body) &&
    typeof body.id === "string" &&
    (body.status === "pending" || (body.status === "completed" && isRecord(body.result)))
  ) {
    return body as unknown as Verification;
  }
  throw unexpected(response.status);
}

function unexpected(status: number): IntegrationError {
  return new IntegrationError("unexpected_response", "The VerifyEmail API returned a response this integration does not recognise.", status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
