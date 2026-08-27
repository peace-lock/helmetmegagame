# Tag design

A **tag** is a single named fact about a character: a skill, a trait, an
injury, a possession, a status. Everything a character sheet knows beyond a
name, a location and a Resource count is a tag. The catalog lives in
`docs/tags.yaml` and is the only source for it.

This document describes how tags are priced and what their fields mean. It is
a reference for writing catalog entries, not a rules summary for players.

The scale in §1 is restated from `docs/systemdocs/TAGS.md` §4a, which
governs. If the two ever disagree, that one is right.

---

## 1. Point cost

Every tag carries a `pointCost`. At character creation a player spends a fixed
budget on tags; the budget is currently **12 points**, adjusted per role
(`extraStartingPoints`) and reduced by 3 for a cursed re-roll.

The scale is absolute, not relative to a category. A 3-point item and a
3-point skill are meant to matter about equally.

| Cost | Meaning |
|---|---|
| 1 | Minor. A small edge, a small possession, a narrow competence. |
| 2 | Moderate. A real capability, one rung of a skill chain. |
| 3 | Significant. Reliably changes how a scene goes. |
| 4 | Good. A third of the whole budget. |
| 5 | Very good. |
| 6 | Character defining. A revolver; being a giant. |

Negative tags return points, on a mirrored scale:

| Cost | Meaning |
|---|---|
| −1 | An inconvenience. |
| −2 | A real cost, situational. |
| −3 | A real cost, most of the time. |
| −4 | Severe. Permanent or near-permanent. |
| −5 | Removes a whole sense or capability, with no realistic cure. |

**Your drawbacks can give back at most 6 points in total.** (A GM can change
that number, so the point-buy menu always shows the live limit next to your
points.) It's a point total, not a count — one severe drawback and a minor
one is as legal as five small ones, so long as they add up to 6 or less. Only
what you buy yourself counts — a drawback your role hands you for free, and
anything that happens to you in play, doesn't spend any of that budget.

**0 is a valid cost and the most common one.** A tag that cannot be bought —
an injury, a mood, a meal, something a role grants — still needs the field,
and 0 is what it should be unless the tag is deliberately offered at creation.

### Cost is not a wound scale

The `health` category prices *cures*, not points. A Health tag's `pointCost`
answers "what is this worth at character creation", and for almost all of them
the answer is 0 because they are not purchasable. What that tag costs to treat
is the `requirement` block, which follows a separate seven-rung ladder
documented in `docs/systemdocs/TAGS.md` §5c.

---

## 2. `purchasable` and `purchasableAfterStart`

Two independent booleans.

**`purchasable`** — may a player select this during character creation?

- GM-granted tags are `false`. Anything the game applies to a character by
  itself is `false`.
- Transient statuses are `false`: Poisoned, Dislocated Shoulder, Hungry,
  Drunk. These are things that happen to a character, not things a character
  is.
- Durable conditions are `true`: Depressed, Chronic Pain, Missing Eye. These
  are things a character arrives with.
- Negative tags that are `true` return their points to the budget.

The test is duration and authorship. If a character could plausibly have
lived with it for years before the game started, it is purchasable; if it is
something that happened this week, it is not.

**`purchasableAfterStart`** — may a player buy this once the game is running?

- **Items are always `false`.** Objects enter play by being crafted or found,
  never by being bought with points. An item's route into the game is its
  `craftable` flag and its `requirement` block.
- **Negative tags are always `false`.** Selling a limb for points mid-game is
  not a trade the system offers.
- Skills and traits may be `true` where it makes sense for a character to
  develop them in play.

A tag that is not `purchasable` should normally not be
`purchasableAfterStart` either.

---

## 3. Skill chains

A **chain** is a ladder of tags where each rung names the one below it as its
`parentTag`. Holding a higher rung replaces the lower one; a character never
holds two rungs of the same chain at once. This is enforced at purchase time:
buying or adding a higher rung takes the held lower rung off the sheet in the
same transaction, and a rung below one already held can't be bought at all —
a chain replaces upward and never re-opens downward. (A GM Undo of the
purchase restores the replaced rung exactly as it was.)

Chains are **cumulative**. The cost shown for a rung is its own `pointCost`,
but the cost to acquire it is the sum of every rung up to and including it,
minus whatever the character already holds. Buying Fighting (Skilled) from
nothing costs 9; buying it while holding Fighting (Trained) costs 3.

The Fighting chain, at **3 points per rung** since the Combat Update:

| Rung | Own cost | Cumulative |
|---|---|---|
| Basic | 3 | 3 |
| Trained | 3 | 6 |
| Skilled | 3 | 9 |
| Expert | 3 | 12 |
| Legendary | 3 | 15 |

Legendary is 15 of a 12-point budget. That is intended: you climb into it in
play, not at creation.

Medical, Building, Brewing and Cooking use the flat **2**/rung shape with
shorter ladders. Fighting is the exception.

### Sidegrades

Six Fighting tags sit outside the ladder: **Archer**, **Guerrilla**, **Shield
Wall**, **Grappler**, **Firearms**, **Duelist**. Each costs 3, each takes
`requiredTag: fighting-basic`, and none has a `parentTag`.

`requiredTag` is a prerequisite that is **not** replaced and **not** charged
cumulatively. A sidegrade is bought once at its face value, on top of whatever
rung the character holds.

Sidegrades cost the same as one rung of the main ladder — deliberately, since
they are conditional: a sidegrade applies in its own circumstances (at range,
from cover, in formation, unarmed, with a firearm, one-on-one) and does
nothing outside them. They stack with each other and with any rung. A
Trained fighter who is also an Archer has spent 6 + 3 = 9.

`requiredTag` is satisfied by **any rung of the required tag's chain**, so
Fighting (Expert) satisfies a `fighting-basic` requirement.

### A third thing that is not a chain

`requirement.skills` lists skills **someone else** must hold to act on this
tag. It appears on Health tags to say who can treat the condition. It is not a
prerequisite for holding the tag and has nothing to do with chains.

---

## 4. Descriptions

Every tag has a `description`. It is what a player reads in a tooltip on the
website and in the tag picker at creation, so it is the whole of what most
people will ever know about the tag.

Guidance:

- **Short.** One or two sentences. Three is long.
- **Explanatory where the mechanic is not obvious.** If the tag does something
  a player could not guess from its name, say what.
- **Flavourful where it is obvious.** If the name already carries the meaning,
  spend the sentence on voice instead of restating it.
- **Second person.** Address the character's player directly: "You're blind."
- Do not restate the point cost, the category, or the requirement block. Those
  are rendered separately.

Two worked examples from the catalog:

> **Nekker Musk** — "You smell like one of them. Nekkers will not attack you,
> and will not be pleased when it wears off."

The name explains nothing on its own, so the description carries the mechanic
and the sting in the tail.

> **Flashed** — "You're blind. Whatever that was, it went off in your face,
> and the dark you're standing in is not helping."

The effect is one clause; the rest is voice.

---

## 5. Other fields

Structural fields, briefly. Full detail is in the header comment of
`docs/tags.yaml`, which is authoritative where this table is not.

| Field | Meaning |
|---|---|
| `slug` | Stable identifier. Never changed once in use — everything references it. |
| `name` | Display name. |
| `category` | One of Meta, General, Skills, Status, Health, Items, Assets. |
| `group` | Sub-grouping within a category; drives the picker's tabs and the chip colour. |
| `visible` | Whether another player who inspects this character can see the tag. Set it by whether a bystander could actually tell. |
| `removable` | Whether a player can strip the tag off themselves without a GM. |
| `stackable` | Whether a character can hold more than one. Meals, ammunition, batches. |
| `consumable` | Whether a player can use it up from their sheet. Consuming takes exactly one unit. |
| `consumesInto` | What being consumed turns it into. A meal becomes Ate a Meal. |
| `craftable` | Whether a player can make it, as opposed to only ever receiving it. |
| `equippable` | Whether it can be worn or carried into an equip slot. |
| `durationTurns` | Turns until it expires on its own. Omit for anything permanent. |
| `expiresInto` | What it becomes when the clock runs out, instead of simply vanishing. The untreated-wound chain. Requires `durationTurns`. |
| `requirement` | What it costs to add or remove in play: `turnsCost`, `resourceCost`, `skills`, `gambit`. Reference for GM adjudication; not enforced by code. |

Two fields exist in the data and currently do nothing:

- **`tradeable`** — reserved for a trade flow that is not built. Nothing reads
  it. Do not rely on it to mean an item can change hands.
- **`concealsIdentity`** — reserved for masks and hoods. Set on no tag. It
  must be paired with `equippable` or the sync refuses to run.

---

## 6. File format

`docs/tags.yaml` is one document with two top-level keys, `categories` and
`tags`. Groups live in the sibling file `docs/taggroups.yaml`.

Tags are a list under `tags:`, each entry indented two spaces with `- slug:`
and its fields four. Only `slug`, `name`, `category`, `description` and
`pointCost` are required; every other field defaults to false or absent, and
is omitted rather than written out as `false`.

```yaml
tags:
  - slug: kebab-case-identifier      # required, permanent
    name: Display Name               # required
    category: items                  # required
    group: items-gear                # optional, but nearly always wanted
    description: "One or two sentences, in double quotes."
    pointCost: 2                     # required; 0 for anything unpurchasable

    parentTag: lower-rung-slug       # chain: replaces, charged cumulatively
    requiredTag: prerequisite-slug   # gate: not replaced, not charged

    purchasable: true                # at character creation
    purchasableAfterStart: false     # once the game is running
    visible: true                    # can a bystander tell?
    removable: true                  # can the player shed it unaided?
    stackable: true                  # more than one at a time
    equippable: true                 # goes in an equip slot
    craftable: true                  # a player can make it
    consumable: true                 # a player can use it up

    durationTurns: 3                 # expires on its own after N turns
    expiresInto: [what-it-becomes]   # requires durationTurns
    consumesInto: [what-using-it-gives]

    requirement:                     # cost to add or remove in play
      turnsCost: 2
      resourceCost: 35
      skills: [smithing]
      gambit: false
```

Comments survive edits and are used freely — section headers between blocks,
and a note above an entry whose reasoning is not obvious from its fields.

### Worked examples

A trait. Nothing but the required fields plus the two purchase flags:

```yaml
  - slug: seductive
    name: Seductive
    category: general
    group: general-social
    description: "You can see a person's Desire by examining them."
    pointCost: 4
    purchasable: true
    purchasableAfterStart: true
```

A skill-chain rung. `parentTag` is the whole of what makes it a chain; note it
carries no `group`, since the Skills category is not subdivided:

```yaml
  - slug: fighting-trained
    name: Fighting (Trained)
    category: skills
    description: "Formally trained combatant, but not particularly talented."
    pointCost: 2
    parentTag: fighting-basic
    visible: true
    purchasable: true
    purchasableAfterStart: true
```

An item, which is where most of the fields turn up at once. `requiredTag`
gates it without charging for the prerequisite, `purchasableAfterStart` is
false as every item's is, and `requirement` is the craft cost:

```yaml
  - slug: bastard-sword
    name: Bastard Sword
    category: items
    group: items-weapons
    description: "A large sword. Durable and sharp, and it asks for both hands when the work gets serious."
    pointCost: 4
    requiredTag: fighting-basic
    equippable: true
    tradeable: true
    stackable: true
    visible: true
    purchasable: true
    purchasableAfterStart: false
    removable: true
    craftable: true
    requirement:
      turnsCost: 2
      resourceCost: 35
      skills: [smithing]
      gambit: false
```

A Health tag on the untreated-wound chain. `durationTurns` plus `expiresInto`
is the clock; `requirement` here is the *cure*, copied from tier 2 of the
ladder rather than invented:

```yaml
  - slug: infected
    name: Infected
    category: health
    group: health-infection
    description: "The wound is hot, swollen and weeping. It will not settle on its own — left alone it begins to fester, and from there it only goes deeper."
    pointCost: 0
    visible: true
    purchasable: false
    purchasableAfterStart: false
    removable: true
    durationTurns: 3
    expiresInto: [festering]
    requirement:
      resourceCost: 2
      skills: [medical-basic]
```

A consumable, showing the conditional form of `consumesInto` — the second
grant is withheld from anyone holding a listed tag:

```yaml
  - slug: fine-meal
    name: Fine Meal
    category: items
    group: items-food
    description: "An honest, well-made meal. Makes an ordinary person happy; Nobility expect one as a matter of course."
    pointCost: 0
    tradeable: true
    stackable: true
    visible: true
    purchasable: false
    purchasableAfterStart: false
    removable: true
    craftable: true
    consumable: true
    consumesInto:
      - ate-meal
      # An honest meal cheers an ordinary person; a noble expects one as a
      # matter of course, so it does nothing for their mood. They still eat.
      - slug: happy
        unlessTags: [nobility]
    requirement:
      resourceCost: 2
      skills: [cooking-basic]
      gambit: false
```

A negative tag. Purchasable at creation, never after; `removable: false`
because it is not something a character walks off:

```yaml
  - slug: missing-eye
    name: Missing Eye
    category: health
    group: health-maiming
    description: "One socket, empty or covered. Your depth perception is a running joke and your blind side is a genuine liability."
    pointCost: -3
    visible: true
    purchasable: true
    purchasableAfterStart: false
    removable: false
```

---

## 7. Adding a tag

1. Pick the category and group first. Group determines visibility and colour.
2. Price it against §1, not against its neighbours.
3. Set `purchasable` and `purchasableAfterStart` per §2. Items are `false` for
   the second.
4. If it is a Health tag, copy a cure-ladder rung verbatim rather than
   inventing numbers.
5. Write the description last, once the mechanics are settled.

Every `parentTag`, `requiredTag`, `expiresInto`, `consumesInto` and
`requirement.skills` slug must resolve to another tag in the same file, and
every `group` to a group in `docs/taggroups.yaml`. The sync validates all of
these before writing anything, so a bad reference fails loudly rather than
silently dropping.
