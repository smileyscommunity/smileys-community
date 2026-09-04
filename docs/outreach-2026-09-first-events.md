# First-event outreach — drafts for approval (2026-09-04)

Nothing here has been sent. Two emails and one digest block, all aimed at the
same thing: the five live cities outside Istanbul hold 24 approved members
between them and one upcoming event. Content did not fix that and will not.

Both emails should go via Resend with `replyTo` set to Nate's Gmail, the way
the Antalya founding-member emails went on 2026-08-31 — a reply has to land
somewhere a person reads.

---

## 1. Antalya — 15 members, no event ever held

**Why now, and why it's the better of the two bets.** Five of the fifteen
joined on 3–4 September and four logged in today, so this is the most alive
Antalya has been. Four members live in Kaleiçi, four in Konyaaltı, three in
Muratpaşa — enough overlap for one table. Nobody has volunteered to host, and
Nate is the default host on paper only, so the email's real job is to turn one
of these fifteen into the person who picks a place.

**Send to:** the 15 approved Antalya members (list below). Individually, not
as a visible group — a member seeing fourteen strangers' addresses is a
privacy failure and a bad first impression.

**Subject:** Antalya, a first coffee — who's around?

> Hi {{firstName}},
>
> You're one of the first fifteen people in Smileys Antalya, which is a
> strange and good place to be: everything here is still unwritten.
>
> I'd like to fix the obvious gap. There's a city guide, there are clubs,
> and there has not yet been a single evening where any of you were in the
> same room. That's the only thing that actually matters.
>
> So: a first coffee or dinner in Kaleiçi, one evening in the next two
> weeks. Four of you are in Kaleiçi already and four more are twenty minutes
> away in Konyaaltı.
>
> Two questions, and a one-line reply is a complete answer:
>
> 1. Would you come?
> 2. Do you know the right place — somewhere with a table for eight that
>    won't mind us talking for three hours?
>
> If you know the place, you're the person to pick it, and I'll back you.
> That's how every Smileys city has started, Istanbul included.
>
> Nate

**Notes for review.** The ask is deliberately two lines, because a founding
email asking for nothing gets read and forgotten. "I'll back you" is a real
commitment — a member who says yes needs a host grant and the /host flow.

---

## 2. Ankara — one member, who asked for this city before it existed

**Who.** Elçin Yıldız Şimşek (yirmitemmuz@gmail.com), an approved Istanbul
member since before Ankara existed, who put herself on the Ankara interest
list on 17 August and got the automatic launch email when the city went live
on 3 September. Last active 17 August, the day she registered the interest —
so she has not been back, and this is a re-engagement note as much as a
welcome.

One thing to check before sending: her profile neighborhood is Maltepe, which
is a district of both Istanbul and Ankara. Whether she lives in Ankara,
is moving there, or simply has ties is genuinely unclear from the data, so
the draft asks rather than assumes.

**Subject:** Ankara is open — and you asked first

> Hi Elçin,
>
> Ankara went live this week, and you're the only person who asked for it
> before it existed. That earns you a real email rather than an
> announcement.
>
> There are eighteen neighbourhoods mapped, fifteen places worth going
> written up, and a guide to the Başkentkart that took an embarrassing
> amount of research. What there isn't yet is a single event, because a
> city becomes real the first time two people who met here have coffee.
>
> Can I ask what your Ankara actually is? Do you live there, are you
> moving, or is it family and old friends? It changes what would be useful
> to build.
>
> And if you'd ever want to start the first thing — a coffee in Kızılay, a
> walk somewhere in Hamamönü, whatever you'd actually turn up to — say the
> word and I'll set it up around you.
>
> Nate

**Notes for review.** Deliberately not a founding-member template: she is one
person, and a templated "founding member #1" mail to an audience of one reads
as automation. The question in the middle is the point — we don't know why she
wants Ankara, and the answer decides everything else.

---

## 3. Digest spotlight — the Monday slot from 9 September

İzmir's block runs to 8 September, so the next window is free. Staged as two
blocks in `data/content.json`, Antalya then Ankara, one week each — the array
form the digest already supports.

The digest goes to Istanbul's ~1,644 members, so these are written for people
who might be *going* to Antalya or Ankara, not people who live there. That is
the only realistic recruiting channel a new city has.

**Antalya, 9–15 September** — leads with the honest gap rather than the guide,
because "fifteen people and no first dinner yet" is a more interesting
invitation than "we have a city page".

**Ankara, 16–22 September** — aimed at the large number of Istanbul members
with Ankara ties, and at the capital's own expat population.

Both are in the JSON change alongside this file; nothing sends until the
Monday cron runs, and either can be pulled by deleting its block.

---

## What none of this fixes

No email makes an event happen. The bottleneck in Antalya is one person
willing to name a place and turn up, and the honest purpose of draft 1 is to
find out whether that person is among the fifteen. If nobody replies, that is
information too, and worth more than another city launch.
