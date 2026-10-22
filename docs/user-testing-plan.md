# User testing plan — practice, continuity, saved comparisons

The automated checks show that the states behave as designed. They do not show
that people understand them. This plan tests understanding with a few
first-time users before more features are added.

## Setup

- **People:** five who have not seen the tool. Three on their own phones, two
  on a laptop. If possible, one who uses a screen reader or only the keyboard.
- **Browser:** a fresh profile or private window, so no saved progress or
  comparisons carry over.
- **Moderator:** read each task aloud as written. Do not name buttons or explain
  terms. Ask people to think aloud. Note every hint you had to give and where.
- **Time:** about 40 minutes per person.

## Task 1 — practice and feedback (Preflop → Trainer)

"Answer a set of 10 questions. Then look at how you did and practise the ones
you got wrong."

Watch for: whether they find the next question, the review and Retry missed
without help; whether they read the feedback after each answer.

Then ask, without the screen in front of them if possible:

1. "One answer said your Raise was *in range*. Does that mean you should raise
   this hand every time?" (Expected: no; on a mixed hand it is one of the
   allowed actions at some frequency.)
2. "If you got every frequency question right, what does that tell you about
   your real results or about GTO play?" (Expected: only that they remember
   these demonstration frequencies; not real EV, not solver-verified.)

**Pass:** at least four of five answer both questions in their own words
without hints.

## Task 2 — continuing later (phone and laptop)

1. "Answer three questions. Answer the fourth, but don't go to the next one.
   Now close the tab and open the page again."
   Ask: "Where are you, and what was your last answer?"
2. "Retry what you missed. While doing that, go to the Library and add one
   hand to practise. Switch to another scenario, then reload and come back."
   Ask: "How many of these questions are ones you missed earlier? Where is the
   review of your first set?"
3. On a phone: "Find A5s. What does this spot do with it? Now show it in the
   chart." Watch where they look, whether the summary under the search box is
   enough, and how they get back to the search.

**Pass:** they say where they are and what the last answer was without
reopening the first question; they tell missed and added questions apart from
the set note; on a phone they read the A5s mix without scrolling and get back
to the search without getting lost. The automated tests already cover the data
side of each step; here we are testing whether people can tell.

## Task 3 — saved result or recalculation (Risk Lab)

Use the files in [`user-testing-files/`](user-testing-files/) (regenerate them
with `node docs/user-testing-files/make.js`). Start with
`1-earlier-engine.json`: the functional-fix engine's real results, which the
current engine recomputes as 28.90% and 6.35% instead of 27.75% and 7.85%.

1. "Import this file and look at the numbers it saved."
2. "Now run it again with the current calculator."
3. Ask: "Which number is the saved one and which is new? Why might they
   differ? Did anything you entered cause the difference?"

Repeat with `2-seed-7.json` (current engine, seed 7: recomputing matches),
`4-broken.json` (cut off part-way) and `3-edited-by-hand.json` (current engine,
B's risk changed from 6.35% to 5.35% after saving).

**Pass:** they point to the saved and the recalculated values correctly and
attribute an engine-version difference to the calculator, not to their inputs.
For the hand-edited file they say the numbers do not match and something needs
checking, rather than blaming themselves.

## Task 4 — read a risk interval (Risk Lab, then the case study)

Open the Risk Lab with its default inputs.

1. Ask: "What does the 95% interval next to the risk mean?"
   (Expected: the range the simulation itself could be off by, given these
   inputs; it says nothing about whether the inputs are right.)
2. Ask: "If we ran 20,000 paths instead of 2,000, would you be more sure what
   your real risk is?" (Expected: more sure of the model's number, not of the
   real risk, because the win rate is still uncertain.)
3. Then show question 2 of the [case study](../case-study/index.html#q2) and
   ask the second question again.

**Pass:** before the case study, note how many give the expected answer; after
it, at least four of five separate simulation error from win-rate uncertainty
in their own words.

## What to record

One row per person and task. Change wording only where at least two people
stumble in the same place; then test the change with new people rather than
the same five.

| Person | Device | Task | Done without a hint? | Where a hint was needed | Their explanation, in their words | Wording misread |
|---|---|---|---|---|---|---|
| P1 | phone / laptop | 1–4 | yes / no | | | |

When writing it up, give the number of people, the tasks, what blocked them,
and what changed as a result. Call it a small usability observation: five
people can show where wording fails, not that the tool improves learning in
general.

## Not covered here

Real-game outcomes, whether the demonstration ranges are good strategy, and
statistical validity of the engine. Those are covered by `CHANGELOG.md`,
`checks/` and `docs/methodology.md`, or are out of scope.
