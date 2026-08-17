# İzmir handbook — gap analysis and first draft (Aug 17, 2026)

## Where the gap actually is

Every Smileys city is in Türkiye, so the four **global** articles already serve a
new city on day one:

| article | why it travels |
|---|---|
| `residence-permit-first-application` | Göç İdaresi process, national |
| `opening-turkish-bank-account` | national banking rules |
| `sim-card-and-home-internet-in-turkiye` | IMEI registration, three national operators |
| `scams-tourist-traps-in-t-rkiye-…` | countrywide |

What a new city lacks is exactly the five now filed as Istanbul-local:

| Istanbul article | İzmir equivalent needed | category |
|---|---|---|
| `istanbulkart-mastery` | **İzmirim Kart** — drafted below | Getting Around |
| `istanbul-apartment-hunting-guide` | İzmir renting | Home & Housing |
| `healthcare-in-istanbul-how-the-system-works` | İzmir hospitals | Healthcare |
| `daily-life-in-istanbul-…` | İzmir daily life | Home & Housing |
| `family-life-in-istanbul-…` | İzmir schools | Everyday Life |

> **Priority note.** `bodrum` is `preparing`; `izmir` is still `coming_soon`.
> Bodrum launches first on current data — if only one city's handbook gets
> written, it should probably be Bodrum's. The structure below is city-agnostic
> and transfers directly.

---

## Draft 1 — İzmirim Kart (paste-ready)

**Everything here comes from the İzmir Büyükşehir Belediyesi transport pages.
Anything I could not confirm from an official source is marked `⚠ VERIFY` and
must be checked by someone in İzmir before publishing — do not publish those
lines as-is.**

- **Title:** İzmirim Kart: The Only Ticket That Matters
- **Category:** `Getting Around`
- **City:** İzmir (set `cityId` — this is city-local, not global)
- **Tags:** `izmirim kart`, `eshot`, `izban`, `metro`, `vapur`, `ulaşım`, `toplu taşıma`
- **Excerpt:** One contactless card covers İzmir's metro, tram, İZBAN commuter
  rail, ferries, ESHOT buses and the Balçova cable car — plus a 90-minute free
  transfer window that most newcomers never realise they are entitled to.

### Body

**One card, the whole city.** The İzmirim Kart is İzmir's contactless transport
card. A single card works across the metro, the tram, İZBAN (the commuter rail
that runs the length of the bay), the ferries, ESHOT city buses and the Balçova
cable car. There is no separate ticket to buy for any of them.

**Where to get one.** Cards and tickets are sold at Konak and Karşıyaka ferry
terminals, at the central metro stations — Konak, Fahrettin Altay, Bornova,
Halkapınar and Şirinyer — at the airport stations, and at designated 24-hour
booths around the city.

**Topping up.** Every station has charging machines, and all ferry terminals
have both machines and staffed booths during office hours. You can also top up
online or through the İzmirim Kart app, which will create a digital card and let
you board by QR code.

> **The online top-up trap.** An online top-up is not usable immediately. It
> activates when you tap a validator on a vehicle, and the municipality states
> this takes effect after one hour. If you top up online on the way to the stop,
> assume it will not be there when you tap. Load at a machine if you need it now.

**The 90-minute transfer is the part people miss.** On the metro, tram, İZBAN
and the ferries, the second and any subsequent rides within 90 minutes of your
first are **free**. A ferry across the bay followed by a metro ride is one fare,
not two — so long as you tap within the window.

The exception matters: this transfer benefit does **not** apply to the bus routes
serving the outlying İzmir districts. Those are charged separately.

**Travel at the right hour and pay half.** A 50% discount applies to the existing
tariff between 06:00–07:00 and 19:00–20:00.

**Card types.** Alongside the standard pay-as-you-go card there are reduced-fare
cards for students and public-sector staff, and an electronic senior pass for the
nationally-mandated free travel entitlement. ⚠ VERIFY — the exact eligibility
rules and what documents a foreign student needs to obtain a student card.

⚠ VERIFY — **fares are deliberately absent from this draft.** I could not confirm
current prices from an official source, and this category is on the 90-day review
cadence precisely because fares move. Either cite the live ESHOT tariff page or
omit figures entirely; do not publish a number nobody has checked this month.

### Official sources (populate `officialSources`)

- İzmir Büyükşehir Belediyesi — Transportation Guide:
  https://www.izmir.bel.tr/en/transportation-guide/494/17
- İzmir Büyükşehir Belediyesi — İzmirim Kart:
  https://www.izmir.bel.tr/en/transportation-guide/494/1035

### Review metadata

- `reviewIntervalDays`: leave null — `Getting Around` is `volatility: 'high'`,
  so it inherits the 90-day cadence, which is right for fares and routes.
- `lastReviewedAt`: **leave null until a human in İzmir checks it.** Null renders
  as "not yet reviewed", which is honest. Do not set it to the publish date.

---

## Drafts 2–5 — what to ask, not what to guess

I have not drafted these. Each depends on lived local knowledge that cannot be
sourced remotely without risking confident, wrong answers on things that cost
people money or legal standing. What each one needs to answer:

**İzmir renting** (`Home & Housing`) — which neighbourhoods people actually
live in and their rough price order; deposit and commission norms; whether
`emlakçı` practice differs from Istanbul; the aidat question; what a foreigner
is asked for on a lease.

**İzmir healthcare** (`Healthcare`, high-stakes) — which state hospitals serve
which side of the bay; the private hospitals people actually use; where the
nearest 112 / emergency departments are; whether SGK registration differs
locally. High-stakes means it renders the "verify before you act" warning and
needs official sources.

**İzmir daily life** (`Home & Housing`) — utilities setup and which providers;
market days by neighbourhood; the local rhythm differences from Istanbul that
catch people out.

**İzmir family life** (`Everyday Life`) — international and private schools;
enrolment timing; paediatric care.

## Suggested order

1. **İzmirim Kart** — drafted, needs a fare decision and one local check.
2. **Renting** — the question every arriving member asks first.
3. **Healthcare** — highest stakes, so slowest to write properly.
4. Daily life and family — genuinely useful, least urgent.

If Bodrum launches first, run the same list against Bodrum: the transport
article becomes a "getting around without a metro" piece, which is a different
shape, and renting is seasonal there in a way it is not in İzmir.
