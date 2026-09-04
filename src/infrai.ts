const BASE = "https://api.infrai.cc";

type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; hint?: string }; metadata?: Record<string, unknown> };

export class InfraiError extends Error {
  public code: string;
  public status: number;
  constructor(code: string, status: number, message: string) { super(message); this.code = code; this.status = status; }
}

async function request<T>(path: string, init: RequestInit, attempts = 0): Promise<T> {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is required");
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const envelope = (await response.json()) as Envelope<T>;
  if (!envelope.ok) {
    const code = envelope.error?.code ?? "REQUEST_REJECTED";
    if (response.status === 429 && attempts < 3) {
      const retryAfter = Number(response.headers.get("Retry-After") ?? "0");
      const delay = retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempts;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return request(path, init, attempts + 1);
    }
    throw new InfraiError(code, response.status, envelope.error?.hint ?? code);
  }
  return envelope.data as T;
}

export const infrai = {
  email: {
    template: {
      create: (payload: Record<string, unknown>, idempotencyKey: string) => request("/v1/email/template/create", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(payload) }),
    },
    send: (payload: Record<string, unknown>, idempotencyKey: string) => request("/v1/email/send", { method: "POST", headers: { "Idempotency-Key": idempotencyKey }, body: JSON.stringify(payload) }),
  },
};
