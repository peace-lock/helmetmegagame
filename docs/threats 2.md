# Threats

The GM-assigned seats: Sympathizer, the Demoness, the Cult of Bacchus, the
Judge, the NPC monsters, the Brigands.

Note this list and the **antagonist opt-in catalog** are separate and have
drifted: `db/lib/antagonists.js` ships twelve consent entries a player can tick
at character creation (`CHARACTERS.md` §1), while the briefs below cover fewer
seats. Neither reads the other — the opt-ins are pure consent data, and these
are prose for a GM. If you add a seat to one, consider whether it belongs in
the other.

**Nothing reads this file.** These seats never appear in the player-facing role
picker and have no rows in the database — a GM hands one out by hand, over
Discord, and runs it from there. This file exists so that brief is legible in
one place. It lived in `docs/roles.yaml`'s `zones[].threats[]` blocks until it
was moved here; those blocks carried `starting_resources`, `starting_location`,
`doc_elements` and seat caps, all of which were only ever decoration, since
`db/lib/syncRoles.js` walks `zones[].factions[].roles[]` and never touches
threats.

Starting tags are kept, because they are a genuinely useful pointer for the GM
setting the seat up: they name real entries in `docs/tags.yaml`, and a GM grants
them from `/gm/dev/characters/[characterId]`.

---

## Fortress

### Sympathizer (Fortress)

_Install the Bastard on the throne, by any means necessary._

- Your main goal: install the Bastard on the throne. To that end, turn the court against itself, scheme, and so on.
- You must also choose a second, self-serving goal. Ideas: kill the Baron in a dramatic way as revenge; kidnap the Heir or Successor (you're obsessed); take the Manor from the Lord and install yourself in it. In other words, figure out why you are personally invested in seeing this through.
- Be creative. Turn people against each other, convert people, cause incidents that make other people look bad.

**Starting tags:** none.

### Demoness (Fortress)

_You live for the thrill of enslaving souls and causing pain._

- You are a being from the Caves. You have been alive for a long time, but your memory is fuzzy.
- You don't need to eat. Instead, you live for the thrill of enslaving souls, manipulating people, and causing pain. You will become unhappy if you don't.
- You can Break souls — see the Demoness tag.
- Your Desires are drawn from the Demoness's own gated catalog entries (`demoness`), a ladder running from encouraging someone to let loose at the low end up to enslaving the soul of the Heir at the top — see `docs/desires.yaml`'s `4g. Demoness` block for the full list. ‡
- You find normal crosses tacky and boring. Fire scares you somewhat — it definitely hurts. The Silver Cross, on the other hand, terrifies you. If you touch it, your powers are disabled for the rest of the day.
- There may be people in the area who want to use your power. They'll take your treasured independence — the demented, servile idiots.

**Starting tags:** Hungerless, Insightful, Demoness.

The Demoness tag unlocks the Demoness tag category — Slavemaster, the
discounted Seductive/Torturer twins, and the three true forms. See
`docs/tags.yaml` and the `demoness` document in `docs/documents.yaml`.

## Town

### Cult of Bacchus (Leader)

_Bacchus has willed you to take Ravenheart for them._

- Bacchus is the Lustful God, Creator of Illusions, the Eternal One. Bacchus is honest. Bacchus is life. Bacchus is pleasure. Bacchus is a zealot of hedonism. They rejoice over the fulfillment of desires and the euphoric suicide of their followers.
- Bacchus has willed you to take Ravenheart for them.
- Bacchus is often depicted as an apple, a deer, or, in some circles, as a gigantic dead sea creature. Bacchus's gender is irrelevant. The specifics of doctrine are for you to figure out if you want.
- The stuck-ups in Ravenheart would kill you if they knew. Be careful.
- Followers of Bacchus pick their Desires from the cult's own gated list (`cultist`, tier 2 and up) that are more indulgent, and worth more, than the general catalog's low end. You also gain access to powerful Bacchus tags.
- Your goal is to spread the influence of Bacchus and throw parties. All cult members unlock more powerful Bacchus tags if you manage to host a party hitting each of the first three party thresholds. People do not have to be part of the Cult to count towards the party number. Anyone with Nobility (Baron, Heir, Successor, Baroness, Bastard) counts as 3 people.
- There is a Demoness on the loose. She is an amazing asset, but she finds your ways too controlling. If you manage to bring her to the fold, she'll count as 3 people towards each party.
- Something very special happens at the Final Party, the fourth and largest threshold, which also needs the blood of someone with the Nobility tag. This is your ultimate goal. If the Demoness is present during the party, the surprise will be even better!
- You can either initiate people willingly or forcibly. Either way, you must perform a ritual that involves (1) either alcohol, music, lavish food, or drugs, and (2) secret chants in an ancient tongue. To initiate people against their will, lash them down and chant the rites—if they resist, it will be a Move.
- You can leave the Cult at any point, but you must confess everything you've ever done to a preacher, lose -10 Tag Points (yes, you can go into negative), and suffer through life-changing, excruciating withdrawal.

**Starting tags:** Cultist, Cult Leader.

### Cult of Bacchus (Cultist)

_You either love Bacchus and believe in their message, or love-hate them._

- Bacchus is the Lustful God, Creator of Illusions, the Eternal One. Bacchus is honest. Bacchus is life. Bacchus is pleasure. Bacchus is a zealot of hedonism. They rejoice over the fulfillment of desires and the euphoric suicide of their followers.
- You either love Bacchus and believe in their message, or love-hate them. Either way, you are certain you'll never leave.
- Bacchus is often depicted as an apple, a deer, or, in some circles, as a gigantic dead sea creature. Bacchus's gender is irrelevant. The specifics of doctrine are for you to figure out if you want.
- The stuck-ups in Ravenheart would kill you if they knew. Be careful.
- Followers of Bacchus pick their Desires from the cult's own gated list (`cultist`, tier 2 and up) that are more indulgent, and worth more, than the general catalog's low end. You also gain access to powerful Bacchus tags. ‡
- You can either initiate people willingly or forcibly. Either way, you must perform a ritual that involves (1) either alcohol, music, lavish food, or drugs, and (2) secret chants in an ancient tongue.
- You can leave the Cult at any point, but you must confess everything you've ever done to a preacher, lose -10 Tag Points (yes, you can go into negative), and suffer through life-changing, excruciating withdrawal.

**Starting tags:** Cultist.

The Cultist tag unlocks the Bacchus tag category, and carries the `cultist`
and `bacchuslore` documents; the Leader additionally holds Cult Leader, which
carries `cultistleader`. As the cult grows, a GM grants Cult: Ripening and
then Cult: Bountiful, each rung unlocking a further gated group of Bacchus
tags (a young cult holds no tier tag at all). See `docs/tags.yaml`, `docs/taggroups.yaml` and
`docs/documents.yaml`.

The four party thresholds are **not** fixed numbers — they are 4, 8, 12 and 16
players per 100, floored and never below 1, scaled live by
`GameConfig.playerCount` (`db/lib/partySize.js`). At the default 100 players
that is 4/8/12/16; in a 50-player game it is 2/4/6/8. The player-facing
documents print them through the `{partysize:N}` token, so they can never go
stale. See `systemdocs/PARTY-SIZE.md`.

### The Judge (Town, or Cave)

_"Whatever in creation exists without my knowledge exists without my consent."_

- "Whatever in creation exists without my knowledge exists without my consent." You start with +15 Tag Points.
- True evil doesn't exist, but you come close. Among the lost, weak, and misunderstood, history contains those who inexplicably choose darkness. That is you.
- Your ultimate goal is to become infamous—not because you care what other people think, but because it sends a message. The more people know, fear, or respect your name, the better.
- Immortal or delusional, you treat life like a game. You glory in war and despise weakness. You fear nothing, although people that are genuinely good through and through make you uncomfortable. Fortunately, there are very few of those left.
- You can work alone, but you are a natural leader. Take over the Brigands, start an adventurer troop, or rise the ranks of the Bastard's entourage.
- Do not hide your nature or commit murders in the dark. You're not a serial killer.
- People can't help but love you.
- Your Desires must relate to violence, glory, control, or competition.

**Starting tags:** none.

## Caves

### Monsters (NPC)

_Monsters in the caves, to be hunted._

- Monsters in the caves, to be hunted.

**Starting tags:** none.

### Brigand Leader (Caves)

_Loot the caves (dangerous) as a way to fund the Camp's war effort._

- Loot the caves (dangerous) as a way to fund the Camp's war effort.

**Starting tags:** none.

### Brigand (Caves)

_Loot the caves (dangerous) as a way to fund the Camp's war effort._

- Loot the caves (dangerous) as a way to fund the Camp's war effort.

**Starting tags:** none.
