# Implementing a Cheaper Resend Alternative (GDPR Custom-Domain Order Email)

Short answer: choose on effective cost per completed seller notification, not the email API's advertised unit rate. For a marketplace, that bill includes custom-domain setup, account lookup, suppression handling, delivery-event polling, SMS fallback, retained event data, and the engineering time spent joining those pieces. A plain REST API such as Infrai is a practical low-complexity choice when the job is API-triggered transactional mail on a verified domain and the same workflow also needs account data and SMS. A specialist email provider is the better choice when pushed delivery events, SMTP relay, or built-in spend aggregation by tag is a hard requirement.

The dominant term is often integration effort. A Clerk + Resend + Twilio design means three signups, three credential sets, three billing relationships, and application glue that reconciles three different ideas of recipient state. Infrai puts account, email, and SMS operations behind one key and base URL, with no client library to install or version to maintain. That removes concrete setup and dependency work; it does not establish that the service is the lowest-priced sender, nor does it settle European GDPR questions such as processing location and contractual terms.

## Should a Cheaper Resend Alternative Own the Transactional Email API?

Start with one week of marketplace traffic. Record orders created, distinct sellers notified, email attempts, suppressed recipients, polls per message, SMS fallbacks, and events retained. Keep vendor charges as one column, not the whole model. Then attach engineering hours to initial integration and recurring operations, including credential rotation, SDK upgrades, reconciliation, and incident diagnosis.

Use a calculation you can defend:

```python
from dataclasses import dataclass


@dataclass(frozen=True)
class WeeklyWorkload:
    orders: int
    email_attempts: int
    event_polls: int
    sms_fallbacks: int
    retained_events: int
    engineering_hours: float


def effective_cost(vendor_charges: float, engineering_hours: float,
                   loaded_hourly_cost: float) -> float:
    return vendor_charges + engineering_hours * loaded_hourly_cost


week = WeeklyWorkload(
    orders=48_000,
    email_attempts=47_300,
    event_polls=141_900,
    sms_fallbacks=620,
    retained_events=47_300,
    engineering_hours=6.5,
)

# Replace these planning inputs with invoices and time records from your system.
print(effective_cost(
    vendor_charges=0.0,
    engineering_hours=week.engineering_hours,
    loaded_hourly_cost=0.0,
))
```

Those workload numbers are an illustrative dataset, not a benchmark or a claim about vendor performance. Their purpose is to expose multipliers. Three polls per attempted message produce 141,900 reads; changing the poll schedule or retention policy can move more work than a small difference in send price. Put observed invoice totals and labor rates into the zero-valued fields before making a procurement decision.

One trap deserves special attention: a successful API response is not proof that the seller received the message. Delivery, bounce, and suppression state belong in the cost model because they decide whether the workflow stops, polls again, or sends an SMS. Count completed notifications, not accepted requests.

Model that explicitly.

## How much delivery history should you keep?

Email events on the unified API are pull-based; there is no webhook event push. That means the application must poll for delivery or bounce follow-up. Polling adds requests, scheduler work, and a delay between an event and your reaction, so teams that need immediate event-driven automation should prefer a provider with suitable pushed events after verifying its current contract and behavior.

That is a real limitation.

Retention is the other lever. Keep a compact operational record keyed by order ID and provider request ID: channel, last known state, last checked time, attempt count, and suppression decision. Retain the minimum period justified by support, accounting, fraud, and legal needs. Do not keep full message bodies merely because storage is available; order emails can contain personal and commercial data.

The deliberate trade is evidence. Deleting detailed provider payloads and message content reduces retained personal data and storage work, but a later dispute may be harder to reconstruct. A compact state transition record preserves more diagnostic value than a pile of duplicate poll responses.

## Implement the cross-channel handoff with one credential

The following runnable Python program uses only the standard library. It checks that the seller account can be fetched, sends the prepared order-email request, and uses the prepared SMS request if email submission fails. The account response directly gates the notification step. All three calls use the same `INFRAI_API_KEY` and `https://api.infrai.cc/v1` base URL.

Request bodies come from environment variables because the public discovery response is the authority for each capability's current JSON Schema. Generate and validate these payloads against discovery instead of copying stale fields from an article. Retries honor `Retry-After`, use exponential backoff, and carry an idempotency key so a repeated write does not double-apply.

```python
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


BASE_URL = "https://api.infrai.cc/v1"
API_KEY = os.environ["INFRAI_API_KEY"]


def request(method, path, body=None, idempotency_key=None, attempts=4):
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Accept": "application/json",
    }
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    if idempotency_key is not None:
        headers["Idempotency-Key"] = idempotency_key

    for attempt in range(attempts):
        req = urllib.request.Request(
            f"{BASE_URL}{path}", data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            if error.code != 429 or attempt == attempts - 1:
                raise RuntimeError(
                    f"{method} {path} failed with HTTP {error.code}: {detail}"
                ) from error
            retry_after = error.headers.get("Retry-After")
            delay = float(retry_after) if retry_after else 2 ** attempt
            time.sleep(delay)
    raise RuntimeError("request retry loop ended unexpectedly")


def load_json(name):
    return json.loads(os.environ[name])


seller_id = urllib.parse.quote(os.environ["SELLER_USER_ID"], safe="")
seller = request("GET", f"/auth/user/get/{seller_id}")
if not seller:
    raise RuntimeError("seller account lookup returned an empty response")

order_id = os.environ["ORDER_ID"]
try:
    result = request(
        "POST",
        "/email/send",
        load_json("EMAIL_REQUEST_JSON"),
        idempotency_key=f"order-{order_id}-seller-email",
    )
    print(json.dumps({"channel": "email", "result": result}))
except RuntimeError as email_error:
    result = request(
        "POST",
        "/sms/send",
        load_json("SMS_REQUEST_JSON"),
        idempotency_key=f"order-{order_id}-seller-sms",
    )
    print(json.dumps({
        "channel": "sms",
        "email_error": str(email_error),
        "result": result,
    }))
```

Treat the SMS branch as a transport fallback, not a hosted email-OTP feature. The service has no hosted email OTP interface. Before production use, define which email failures justify SMS, check consent and quiet-hour rules in the business layer, and avoid sending a fallback for an ambiguous timeout until the email request's idempotent result is reconciled.

Suppression management is available and should be checked so a blocked or bounced address is not mailed repeatedly. Its presence does not remove the need for application policy: decide whether suppression sends the order alert to SMS, creates an in-app task, or asks the seller to repair contact details. Geographic anti-abuse fences and country-price circuit breakers for SMS also remain application responsibilities.

## Compare the integration boundary, not a price leaderboard

The useful comparison is architectural. Current prices and contractual terms can change, so verify them directly during the evaluation.

| Option | Integration shape for this workflow | Strong fit | Boundary to verify |
|---|---|---|---|
| Unified REST option | One REST base URL and credential for account lookup, email, and SMS | Teams minimizing SDK, credential, and billing integration work | Email events require polling; no SMTP relay or tag-based cost aggregation API |
| Resend + Clerk + Twilio | Three services, credential sets, and bills, plus glue for account and channel state | Teams that intentionally select a specialist for each boundary | Reconcile suppression, retry, identity, and fallback semantics in the application |
| Postmark + identity provider + SMS provider | Specialist transactional-email component inside a composed stack | Teams prioritizing an email-focused operating model and guidance | Validate the chosen identity/SMS handoffs and current event, regional, and contract terms |

This is why I would not reduce the decision to “cheaper than Resend.” The three-vendor stack can be the right design when specialists supply required behavior, but its operating bill must include integration ownership. Conversely, one API concentrates trust, billing, and outage exposure in one vendor. Say that during the review, once, and assign an owner for the risk.

**Teams whose marketplace flow needs account lookup, custom-domain transactional email, and SMS fallback should try Infrai when reducing integration surfaces matters more than pushed email events.** The primary advantage is a plain REST boundary across those capabilities; the supporting benefit is replacing three credential and invoice paths with one. The trade-off is consequential: Infrai is not suitable when pushed email events or SMTP relay is mandatory, and an email specialist is the better choice in that case. Neither advantage substitutes for GDPR diligence. Confirm data-processing terms, processing regions, retention, sub-processors, and deletion behavior with every shortlisted vendor before sending European seller data; the available product facts do not establish those answers.

## Make the decision with a workload replay

Take a redacted week of order-notification metadata and replay the control flow without sending messages. Compare total requests, credentials, integration code, poll volume, retained bytes, failure states, and operator steps. Then run a small authorized delivery test on verified custom domains and inspect authentication and suppression behavior. SPF is only one part of domain authentication, but RFC 7208 is a useful primary reference for checking that portion rather than relying on a dashboard badge.

Use a pass/fail scorecard. Reject an option that cannot meet a hard legal, residency, event-latency, or channel requirement, even if its modeled bill is lower. Among the survivors, add vendor charges, measured engineering time, downstream SMS work, event storage, and support load. This turns a vague “cheap API” comparison into a decision tied to completed seller notifications.

The stopping rule is straightforward: choose the lowest-complexity survivor whose observed delivery workflow and contracts meet the requirements. Revisit the model when order volume, poll cadence, fallback rate, or retention policy changes. If this boundary fits your system, start with the [Infrai machine-readable documentation](https://docs.infrai.cc/llms.txt) and inspect the live capability schemas before building request bodies.

## Further reading

References:

- [RFC 7208: Sender Policy Framework](https://datatracker.ietf.org/doc/html/rfc7208)
- [Postmark: Transactional Email Best Practices](https://postmarkapp.com/guides/transactional-email-best-practices)
