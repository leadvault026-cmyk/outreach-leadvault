# Sample data

`leadvault-sample-prospects.csv` is a small, **entirely fictional** prospect file for testing
imports locally. Every company, person, phone number and address is invented. All domains use the
reserved `.example` top-level domain (RFC 2606), so no address in it can ever receive email.

Each row demonstrates a specific behaviour:

| Row | Company                       | What it shows                                                                                                                            |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | Lone Star Family Clinic       | Clean, verified, Texas — eligible in the demo workspace (which has a demo-only Texas policy)                                             |
| 3   | Brazos Pediatrics             | Full state and country names ("Texas", "United States") normalised to `US-TX` / `US`; the honorific "Dr." is dropped from the name split |
| 4   | Gulf Coast Dermatology        | Catch-all verification → RISKY → review required                                                                                         |
| 5   | Hill Country Physical Therapy | No verification result → review required                                                                                                 |
| 6   | Peach State Orthodontics      | Georgia has no configured policy → review required (never assumed legal)                                                                 |
| 7   | Thames Valley Dental          | United Kingdom has no configured policy → review required                                                                                |
| 8   | Maple Leaf Chiropractic       | Canada (Ontario) has no configured policy → review required                                                                              |
| 9   | Riverbend Urgent Care         | Malformed email (`[at]`) → row rejected as invalid                                                                                       |
| 10  | (blank company)               | Missing required company name → row rejected                                                                                             |
| 11  | Lone Star Family Clinic       | Same email in different case → duplicate within the file                                                                                 |
| 12  | Cedar Grove Podiatry          | No country (unless you set a default country) → review required                                                                          |
| 13  | Prairie Vision Center         | Role mailbox (`info@`) and no contact name → review required                                                                             |
| 14  | Pecos Hearing Clinic          | No email → stored, but ineligible                                                                                                        |
| 15  | Bluebonnet Sleep Center       | Unrecognised verification label → treated as not verified, never as verified                                                             |
| 16  | @Home Care Partners           | Cells starting with `@` / `=` are neutralised in CSV exports (formula-injection protection)                                              |
| 17  | Mesa Verde Allergy            | Email domain differs from the website → domain not confirmed → review required                                                           |

The "Specialty" column is not a standard field: the mapping step lets you keep it as a custom
field or ignore it.

Verification dates are in September 2026. Results older than 90 days count as **stale**, so after
late December 2026 the verified rows show as stale (review required) — that is expected behaviour.
