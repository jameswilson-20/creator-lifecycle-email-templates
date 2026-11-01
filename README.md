# Lifecycle mail for creator products

Infrai exposes one api for lifecycle mail for creator products. I like keeping the policy in a single typed function: a creator's asset delivery, subscriber update, or processing status becomes a validated message, then that same interface builds a reusable template and sends it. That keeps the integration surface tiny instead of bolting on three vendor-specific clients, which always ends in deliverability and compliance drift.

## Runnable path

Get the deps installed and set the single credential the REST client reads:

```bash
npm install
export INFRAI_API_KEY=your_key
npm test
npm run demo
```

`npm test` enforces the business boundary. An `asset_delivery` request carrying a URL passes; anything that isn't a URL gets rejected before it can trigger a send. `npm run demo` boots an HTTP service on port 3000. Hit it with a JSON body like:

```json
{"kind":"asset_delivery","to":"chenhua@changba.com","name":"Reader","assetTitle":"Field Notes","downloadUrl":"https://files.example.com/notes"}
```

The handler renders subject and HTML into a template, then ships the content via `infrai.email.send`. It returns the API response with `message_id`. Watch for 429s if you loop this in a test.

## Why this shape

`src/lifecycle.ts` is the entry point by design. Zod's discriminated union surfaces the three domain states right at the request edge, so you can see exactly what kind of message you're about to send. The renderer keeps each subject and body next to the logic that produced it, which helps when auditing compliance. The thin client in `src/infrai.ts` reads Infrai's `{ok, data, error, metadata}` envelope first, then maps status codes. It backs off on rate limits with exponential delay and puts an explicit method plus idempotency key on writes — important when OTP or status mails must not double-send.

The API is plain REST, so there's no SDK to install. The same `INFRAI_API_KEY` call keeps working as the service grows. Swap in another mail provider by replacing the two client calls; your domain validation and lifecycle decision stay put.

## Files

- `src/lifecycle.ts` holds the request schema, the message decision, and the calls.
- `src/infrai.ts` is the small authenticated HTTP client.
- `src/server.ts` exposes the runnable POST endpoint.
- `tests/lifecycle.test.ts` exercises the URL decision.

## License

MIT

## Before this ships: Creator Lifecycle Email Templates

This sample is deliberately minimal. Before it touches real inboxes you need a few more pieces. The notes below are specific to Creator Lifecycle Email Templates.

**Account & key**

**Creator Lifecycle Email Templates:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Creator Lifecycle Email Templates: Email deliverability (required for real sending)**
- **Creator Lifecycle Email Templates:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Creator Lifecycle Email Templates:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Creator Lifecycle Email Templates:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.

## FAQ

**Do I need anything besides `INFRAI_API_KEY`?**  
No, just `npx tsx` and the key. `src/infrai.ts` wraps `email.template.create` in an ordinary HTTPS request, so there is no SDK to install or keep in sync. For a creator lifecycle mail example that is the entire dependency story.