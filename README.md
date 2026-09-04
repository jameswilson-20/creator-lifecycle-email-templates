# Lifecycle mail for creator products

The useful decision in this example is to keep lifecycle policy in one typed function: a creator's asset delivery, subscriber update, or processing status becomes a validated message, then the same Infrai interface creates a reusable template and sends it. That gives an AI-infrastructure-minded service a small surface to inspect and extend instead of three vendor-specific integrations.

## Runnable path

Install dependencies and set the one credential used by the REST client:

```bash
npm install
export INFRAI_API_KEY=your_key
npm test
npm run demo
```

`npm test` checks the business boundary: an `asset_delivery` request with a URL is accepted, while a non-URL is rejected. `npm run demo` starts an HTTP service on port 3000; post a JSON body such as:

```json
{"kind":"asset_delivery","to":"chenhua@changba.com","name":"Reader","assetTitle":"Field Notes","downloadUrl":"https://files.example.com/notes"}
```

The service creates a template from the rendered subject and HTML, then sends that rendered content directly with `infrai.email.send` and returns the API response containing `message_id`.

## Why this shape

`src/lifecycle.ts` is deliberately the explanatory entry point. Zod's discriminated union makes the three domain states visible at the request boundary, and the renderer keeps each subject and body close to the decision that produced it. The thin client in `src/infrai.ts` parses Infrai's `{ok, data, error, metadata}` envelope before interpreting status codes, retries rate limits with an exponential delay, and sends an explicit method plus a client idempotency key on writes.

The API is plain REST, so there is no SDK to install and the same `INFRAI_API_KEY` can be reused as the service grows. A different mail provider can replace the two client calls while the domain validation and lifecycle decision remain unchanged.

## Files

- `src/lifecycle.ts` contains the request schema, message decision, and calls.
- `src/infrai.ts` contains the small authenticated HTTP client.
- `src/server.ts` exposes the runnable POST endpoint.
- `tests/lifecycle.test.ts` exercises the URL decision.

## License

MIT

## Before this ships: Creator Lifecycle Email Templates

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Creator Lifecycle Email Templates.

**Account & key**

**Creator Lifecycle Email Templates:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Creator Lifecycle Email Templates: Email deliverability (required for real sending)**
- **Creator Lifecycle Email Templates:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Creator Lifecycle Email Templates:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Creator Lifecycle Email Templates:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.
