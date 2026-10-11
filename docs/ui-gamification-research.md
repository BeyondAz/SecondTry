# Pyspace UI and gamification design brief

Research date: October 11, 2026. Status: proposed design, not implemented.

## Direction

Make Pyspace a welcoming Python practice space with a small, expressive companion. The user referenced Knowt's character and wants new game features as well as updated graphics. A full space-adventure theme is not necessary. Assume beginner learners for the first design; validate this with actual users.

Recommended concept: **Pip**, a small rounded python character with an expressive face, simple silhouette, and a curled tail. Name and appearance are provisional. Its role is to welcome, explain, encourage retries, and celebrate progress. Give it a recognizable original shape and personality. Keep it beside the learning task, never over the code.

## Findings from the existing app

This audit inspected the repository's source and README, not a rendered browser session.

- The home page leads with the editor and Fix my code; My Practice and lessons appear farther down. A beginner's next action competes with several tools.
- Existing lessons already provide prediction, guided repair, tests, progressive hints, and an independent follow-up. This is the strongest foundation for a game loop.
- There are three concepts: accumulators, early returns, and off-by-one errors. Start with this real content rather than displaying a large, mostly empty skill map.
- Practice history records exercise outcomes, hints, and timestamps. Recommendations already suggest retries, independent follow-ups, and revisits after 24 hours.
- These are browser-reported practice events, not verified assessments. Repeated passed runs do not establish mastery. History can be unavailable, and the anonymous learner identity does not provide cross-device accounts.

## Research translated into design

| Finding | Application to Pyspace |
| --- | --- |
| A meta-analysis found positive average effects of gamification on learning, with less stable motivational and behavioral results in higher-rigor subsets. | Treat gamification as a testable design hypothesis; measure learning and return behavior separately. [Sailer and Homner](https://link.springer.com/article/10.1007/s10648-019-09498-w) |
| A motivational model of games emphasizes competence, autonomy, and relatedness. | Show specific improvement, offer a choice of challenge, and use an encouraging companion. A mascot's benefit here remains a hypothesis. [Przybylski, Rigby, and Ryan](https://selfdeterminationtheory.org/SDT/documents/2010_PrzybylskiRigbyRyan_ROGP.pdf) |
| Progressive disclosure reduces the initial complexity of an interface. | Show task, editor, Run tests, and one hint entry point first. Expand advanced inputs and detailed output on demand. [Nielsen Norman Group](https://www.nngroup.com/articles/progressive-disclosure/) |
| Recognition is easier than recalling hidden information. | Keep the current goal, lesson step, and expected behavior visible while editing. [Nielsen Norman Group](https://www.nngroup.com/articles/recognition-and-recall/) |
| Duolingo reports better retention in an experiment separating streak maintenance from a larger daily goal. | Prototype an achievable weekly practice goal; do not assume its reported gains transfer to Python learning. [Duolingo experiment](https://blog.duolingo.com/improving-the-streak/) |
| Knowt documents streaks, XP, levels, badges, coins, and controls for gamification pop-ups. | Use its compact companion-led experience as inspiration, while choosing only mechanics that serve Pyspace. The help center verifies features, not their effectiveness. [Knowt help center](https://help.knowt.com/en/collections/11169501-gamification) |
| W3C describes allowing users to disable nonessential interaction-triggered animation. | Respect reduced-motion preferences and provide static celebrations. [W3C guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html) |

## Proposed new features

### First release

1. **Companion with a small home.** Pip has idle, thinking, encouragement, and celebration poses. Finish meaningful milestones to earn a hat, desk item, or background. Accessories are cosmetic; hints stay freely available. Pip never becomes sick or loses possessions when the learner takes a break.
2. **Challenge hub.** One prominent Continue practicing card uses the existing recommendation. A short daily challenge offers a reviewed exercise or revisit. With the current small catalog, label repeats as review rather than claiming a new problem every day.
3. **Skill progression.** Each concept shows Not started, Guided complete, and Independent complete. Add Practiced again when there is a later review. Completion remains distinct from mastery; learners may freely revisit earlier steps.
4. **Milestone rewards.** Award a collectible for the first completed repair, first independent challenge, and completion across all three concepts. Count unique eligible accomplishments; repeatedly pressing Run does not award more items.
5. **Weekly practice goal.** Start with a selectable goal such as three practice days per week. Define a qualifying day as completing an exercise, and explain this next to the goal. Decide timezone behavior before implementation. Missed days do not erase earned progress.

### Second release: new learning modes

- **Bug Detective:** identify the faulty line and predict its effect before repairing it. Complements the existing output-prediction exercise with a new interaction.
- **Remix challenge:** solve a reviewed variant with changed inputs and boundary cases. Build a variant bank before claiming an endless supply of challenges.
- **Review queue:** revisit previously practiced concepts using the existing recommendation logic initially. Later evaluate a more adaptive schedule against delayed independent performance.
- **Capstone challenge:** combine two concepts in a short program. Introduce only after authoring enough reviewed exercises; offer hints without taking away rewards already earned.

Defer public leaderboards, currencies, shops, and multiplayer. Personal progress and direct cosmetic unlocks are sufficient for the initial content volume. Competitive features would need a stronger identity and outcome-validation model.

## UI and graphics

Use warm off-white surfaces, ink-colored text, violet primary actions, and restrained mint and peach accents. Keep the editor visually quiet. Use rounded cards with clear borders, generous spacing, consistent line icons, and a readable sans-serif paired with the editor's monospace font. Check final text and control contrast rather than assuming these palette names are accessible.

Primary navigation: **Practice · Playground · Progress**. Companion customization is a small entry point in Progress, not another competing dashboard.

The Practice screen places Pip and a brief greeting beside the recommended activity. Below it: three concept cards, the weekly goal, and the next cosmetic unlock. The Playground retains free coding and Fix my code. The Progress screen emphasizes completed concepts and useful next steps, with detailed history expandable.

Inside a challenge, show **Predict → Repair → Test → Reflect**. On desktop, keep instructions beside the editor and output below it. On mobile, stack instructions, editor, and results with a readily reachable Run tests button. Use text plus icons for success and failure. Preserve keyboard focus when results appear and announce concise status updates.

Example completion: “You repaired the running total. All four checks passed.” Follow with one next action: “Try it independently.” A small Pip celebration may accompany the message without delaying it.

Initial graphics inventory: one companion design in four poses, three concept illustrations, three milestone badges, and a small set of cosmetic accessories. Use lightweight vector assets for simple UI illustrations; avoid a large animation system for the first release.

## Delivery and evaluation

1. Establish visual tokens and build a representative Practice/challenge prototype with Pip.
2. Implement navigation and challenge feedback around the existing runner and lessons.
3. Add durable milestone and unlock records with duplicate-award protection. Do not derive lifetime rewards solely from a limited recent-history response. Distinguish pending local progress from saved progress when history is unavailable.
4. Add the new challenge modes and expand reviewed content.

Before implementation, follow AGENTS.md and read the installed Next.js guides for the components and APIs being changed. Existing unrelated working-tree changes must be preserved.

Evaluate whether beginners can identify the next action, finish a first challenge, interpret a failed test, and find a hint. Track first-challenge completion, independent follow-up completion, later independent success, and voluntary return. Check whether rewards cause repetitive easy-task farming or discourage hint use. Establish a baseline before setting numerical improvement targets; no uplift is promised by this brief.
