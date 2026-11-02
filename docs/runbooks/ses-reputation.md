# Runbook: SES bounce / complaint rate

**Alarms:**
- `SesBounceRateAlarm` — `AWS/SES` `Reputation.BounceRate` over 0.05 (5%).
- `SesComplaintRateAlarm` — `AWS/SES` `Reputation.ComplaintRate` over 0.001 (0.1%).

Both are account-level rates over a rolling window.

## What it means

AWS suspends an account's sending at a **10% bounce rate** or a **0.5% complaint
rate**. These alarms fire well below those lines (5% and 0.1%) so there is time
to react before SES pauses sending — which would take down transactional mail
(verification, password reset) entirely.

A **bounce** is mail SES could not deliver (bad address, mailbox full). A
**complaint** is a recipient marking it as spam.

## First thing to check

### Bounce rate
1. In the SES console, open the account dashboard → Reputation metrics, and the
   bounce/complaint event stream (if an SNS/event destination is configured).
2. A bounce spike usually means a batch of bad addresses — a sign-up flow
   accepting unverified emails, or an import of stale addresses. Find the source
   and stop sending to it.

### Complaint rate
1. Complaints mean recipients did not want the mail. Confirm you are only
   sending **transactional** mail (SnapURL has no marketing send), and that no
   loop is re-sending the same message.

## Note

If no mail is being sent (`MAIL_TRANSPORT` is `outbox`), these metrics have no
data and the alarms stay green (missing data is treated as not-breaching). An
alarm firing therefore also confirms mail *is* going out.
