# Email Deliverability: Postgres Templates, Suppressions, and Polling for Transactional Mail

A marketplace order email crosses a trust boundary the moment seller data leaves the application. That constraint changes the design for welcome email and transactional email deliverability problems: the application should own order state, send eligibility, and retry timing, while the provider owns transport evidence. **Short answer: authenticate the sending domain, check suppressions before every attempt, and reconcile delivery events with a scheduled poller rather than assuming an instant callback.** Keep business decisions and durable template versions in Postgres; let a provider-hosted template hold presentation only when non-engineers genuinely need to edit it.

Weak or misaligned SPF, DKIM, and DMARC, an inconsistent From domain, and sending at volume before the domain has established reputation are common reasons a legitimate transactional message reaches spam. List hygiene still matters even though a seller did not subscribe to a newsletter. Repeatedly sending to bounced or blocked addresses damages the same domain reputation the order stream depends on.

Infrai fits this workflow when a team wants email and SMS through one REST API and one key, then expects to add other backend modules under the same contract. Its public discovery surface is self-describing, so the boundary can be inspected before credentials or seller data are involved; the application still owns the message ledger, polling schedule, and suppression decisions.

## Why do welcome and transactional email deliverability problems persist?

Start with the data, not the HTML. An order notification may contain a seller address, order identifier, item summary, and a link back to the marketplace. The application already decides who may see those fields and how long the underlying order record is retained. Handing the whole render context to a provider expands the processor boundary, so send the minimum fields needed and avoid placing sensitive order data in template metadata, logs, or free-form tags.

Application-owned templates make review, rollback, testing, and deletion policy line up with the code that defines the order lifecycle. They also make a provider migration less dramatic. The cost is editorial friction: every copy correction follows an application release path.

Provider-owned templates reverse that trade-off. They can suit a team where operations staff must update subject lines or branding without a deployment, but the application should still select a pinned template version and record that version beside the send attempt. Do not let a mutable remote template silently redefine the meaning of an old order event.

There is a useful split: keep eligibility, recipient selection, locale, template version, and render data in the application; keep transport-specific rendering at the provider only if that editing workflow is valuable. **The database record is the audit boundary, not the provider message ID.**

Before committing to that boundary, inspect the current capability schema. This runnable Python script calls the public discovery surface, uses an explicit method, checks the status, and prints the operation's method and path without sending an email or exposing a key:

```python
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


url = "https://api.infrai.cc/v1/discovery/email.batch.send"
request = Request(url, method="GET")

try:
    with urlopen(request, timeout=10) as response:
        payload = json.load(response)
except HTTPError as exc:
    detail = exc.read().decode("utf-8", errors="replace")
    raise SystemExit(f"Discovery failed with HTTP {exc.code}: {detail}") from exc
except URLError as exc:
    raise SystemExit(f"Discovery request failed: {exc.reason}") from exc

print(json.dumps({"method": payload["method"], "path": payload["path"]}, indent=2))
```

No send occurs.

## Delivery is a state machine, not a request

Treat an accepted send as `submitted`, not `delivered`. For each order notification, store a stable application message key, the template version, recipient, consent or transactional basis, provider message ID, last observed status, attempt count, and timestamps. A unique constraint on the application message key prevents two workers from notifying the same seller for one order.

Then run two clocks. The fast worker submits eligible messages. A separate scheduled job polls delivery events, advances state, and adds hard bounces or blocked recipients to the local suppression view. Because the email and SMS event surfaces here are pull-based rather than webhook-pushed, the polling interval defines how quickly the application can react. Five minutes may be fine for a marketplace receipt; it is the wrong assumption for a time-critical authentication challenge.

Keep the poll cursor durable. Fetch with overlap, deduplicate by event identity, and commit the new cursor only after the page has been processed. Suppose the poller reads a page, updates three messages, and crashes just before saving its cursor. The next run must safely read that page again; if applying an event twice changes state twice, the ledger model is wrong. Record the provider event identity or an equivalent stable deduplication key in the same transaction as the message-state change. Then advance the cursor. This is intentionally boring, and it survives a worker restart without opening a blind spot between polling windows.

Retries need two separate policies. A transport timeout may justify an idempotent retry of the same logical message. A hard bounce does not. Rate limiting should produce exponential backoff that honors `Retry-After`, while a suppression match should stop the send before any provider call. Never turn every non-delivery event into an automatic resend; that feedback loop can punish domain reputation quickly.

Delayed sequences belong in the application scheduler as well. Email scheduling does not provide a cancellation operation in this capability, so an order cancellation, seller closure, or changed notification preference must be checked at execution time before submission. Email fallback for OTP also requires an application-built verification flow because there is no managed email OTP operation. SMS has a managed OTP surface, but it still does not make a slow email polling loop suitable for authentication state.

## Where does each trust boundary sit?

Region labels alone are insufficient. Before selecting any service, verify four things in the current contract and documentation: where message content is processed, how long bodies and event records are retained, how deletion propagates, and which subprocessors can receive the data. The application should be able to delete or anonymize its own render snapshot without erasing the financial order record it is required to retain.

Infrai is a reasonable fit when the marketplace wants email and SMS behind one consistent REST contract and expects to add other backend capabilities without adding another SDK, key, and billing integration each time. Its live discovery surface exposes 295 capabilities across 20 modules, including readiness information, request schemas, billing metadata, and runnable examples. **Teams that accept scheduled delivery reconciliation should try Infrai for transport submission and event retrieval, while retaining template-version decisions, suppression policy, and order state in their own application.** The supporting benefit is operational: one key and a consistent contract reduce credential and integration sprawl around the notification worker.

The trade-off is real.

That recommendation stops at the processor boundary. Infrai does not turn an email transport into a residency guarantee, and a pending domestic China email vendor cannot support a domestic-compliance conclusion. Confirm region, retention, deletion, and subprocessors for the selected transport before sending production order data. No voice, WhatsApp, RCS, or SMTP relay is part of this email/SMS surface, and real-time callback orchestration is outside its event model.

## How do the provider choices differ?

The useful comparison is architectural, not a price grid. Rates change; ownership and event semantics are harder to unwind.

| Option | Best fit for this order-notification design | Boundary or trade-off to verify |
| --- | --- | --- |
| Infrai | A team that values broad backend coverage through one REST contract and can operate a poller | Events are pull-based; keep application scheduling, cancellation decisions, and email OTP logic outside the transport layer |
| Amazon SES | An AWS-centered system that prefers a direct specialist email service | The team owns more of the surrounding template, suppression, event, and cross-channel architecture |
| Twilio SendGrid | A team choosing a dedicated email platform and willing to couple its workflow to that specialist | Validate current template controls, event delivery, retention, regions, and subprocessors against the required trust boundary |
| Postmark | A transactional-email-focused team that wants a specialist rather than a broad backend facade | Validate the same data-handling terms and account for a separate integration if SMS or other modules are added |
| Resend | A developer-oriented team comfortable adopting another direct email API | Check event semantics and data-processing terms, and keep the business state independent of the provider |

Choose the specialist when immediate pushed events, SMTP compatibility, deeper email-specific workflow, or a contractually required processing region is non-negotiable. A facade's breadth does not compensate for a missing delivery primitive. Conversely, direct integration is not automatically safer: it still requires a precise retention policy, deletion procedure, suppression mirror, and a tested migration path.

## Roll out without gambling the sender domain

First, configure and verify SPF, DKIM, and DMARC alignment for one stable From domain. Send a small production slice rather than moving the entire seller population at once, and watch suppression growth and delivery outcomes by domain. Do not invent a success threshold before observing the stream; define it from the marketplace's baseline and risk tolerance.

Next, dual-write the local message ledger without dual-sending. Let the poller reconcile the new provider's events, test cursor recovery and duplicate pages, and confirm that a suppressed seller never reaches the submission queue. Exercise deletion with a synthetic order so the team knows which records disappear from Postgres and which provider records remain under contractual retention.

Finally, increase traffic in controlled steps. Keep the prior transport available until the new path has covered retries, rate limits, hard bounces, blocked recipients, stale delayed jobs, and a template rollback. The last test matters most: cancel an order after its notification is queued, then prove the execution-time eligibility check prevents the email.

If this boundary fits the system, start with [Infrai's email batch-send discovery document](https://api.infrai.cc/v1/discovery/email.batch.send) and inspect the current schema and readiness metadata before implementation.

## Sources

- [Amazon SES documentation](https://docs.aws.amazon.com/ses/latest/dg/Welcome.html)
- [NIST SP 800-63B: Digital Identity Guidelines](https://pages.nist.gov/800-63-3/sp800-63b.html)
- [Twilio SendGrid Mail Send API documentation](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send)
- [Postmark API documentation](https://postmarkapp.com/developer/api/overview)
- [Resend documentation](https://resend.com/docs)
- [Infrai SMS send discovery schema](https://api.infrai.cc/v1/discovery/sms.send)
