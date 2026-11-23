# Tibay Gym

Tibay Gym tracks guests, members, gym visits, and purchases.

## Language

**Guest**:
A customer who has not become a member. A guest can be either Student or Regular.

**Rate category**:
A customer's Student or Regular classification, which determines applicable membership and daily session prices independently of Guest or Member status.

**Daily session**:
A gym visit purchased at the applicable per-session rate as an alternative to monthly membership coverage.

**Monthly membership**:
Gym access covered by a monthly purchase, without an additional daily session fee for covered visits.

### Coaching

**Coaching package**:
An admin-defined bundle of coaching sessions with one price for every rate category and a coaching validity in days, which also includes one month of Monthly membership. Both run from the package start; unused sessions expire with the coaching validity.
_Avoid_: Plan, coaching plan

**Package start**:
The moment a paid coaching package's coaching validity and membership month begin: the client's first check-in or first coaching session, or automatically 15 days after payment approval. The membership month is added after any membership already paid for.
_Avoid_: Activation, start date

**Coaching session**:
One coach-accompanied workout for one client, with a start time and duration, from the moment it is added to a date. Marking it done consumes a session from a coaching package or session top-up; until it is marked it is upcoming.
_Avoid_: Session (alone), class, booking

**Target muscle**:
A muscle group from the gym's fixed list (Chest, Back, Shoulders, Arms, Core, Legs, Glutes, Full body, Cardio) that a coaching session focuses on; a session can have several.
_Avoid_: Focus, body part

**Exercise checklist**:
The exercises planned for one coaching session, typed freely and ticked as the client completes them. It is a record only: unticked exercises never stop the session being marked done, and it stays editable after marking.
_Avoid_: Workout plan, program

**Set**:
One round of an exercise on the exercise checklist, optionally recorded with the reps and weight the client did.
_Avoid_: Round

**Session note**:
One optional note a coach or the admin writes on a coaching session; the client sees it in their session history.
_Avoid_: Remark, comment

**No-show**:
A coaching session the client missed, noted by the coach without consuming a session.
_Avoid_: Missed session, forfeit

**Session top-up**:
Coaching sessions bought individually, in any quantity, at a single per-session price; they pay for coaching only, never gym access, and share an active package's coaching validity or else last 30 days.
_Avoid_: Add-on, reload

**Freeze**:
An admin-approved pause of a started package's coaching sessions, at most once per package and 14 days, counted from the day the admin approves it, that pushes the coaching validity back by the days frozen and cancels the upcoming coaching sessions inside it; the membership month keeps running, and the client can end it early without approval.
_Avoid_: Hold, suspension

**Session adjustment**:
An admin's manual change to a client's remaining package or top-up sessions, always recorded with a reason.
_Avoid_: Refund, correction

**Coach**:
A staff member with their own login who runs coaching sessions for the clients the admin assigns to them.
_Avoid_: Trainer, instructor

**Client**:
A person with coaching sessions assigned to a coach.
_Avoid_: Trainee, student

**Preferred schedule**:
The days of the week and single time slot a client would like to train in; a preference, not a booking. The coach sets the actual schedule with the client at their first coaching session.
_Avoid_: Booking, appointment

**Coaching sign-up link**:
The one fixed public page where new people register for coaching and pay for a package or top-up.
_Avoid_: Promo link, referral link

**Personal training**:
The public name for Coaching, used only on the coaching sign-up link; it is not a separate product.
_Avoid_: One-on-one coaching
