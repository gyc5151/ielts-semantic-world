# IELTS Semantic World

Situation → Language: learn English through decisions, objects and events.

**[Open the learning website](https://gyc5151.github.io/ielts-semantic-world/)**

## Current version: pilot-40-0

34 routes, 225 short bilingual scenes, 911 retrieval/transfer tasks:

| Route | Contents | UI setting |
|---|---|---|
| 找房到安顿 / Housing & Commuting | 11 scenes | home |
| 蓝色账单 / A room that felt like home | 2 scenes | home |
| 改动的通知 / The notice that arrived in time | 2 scenes | community |
| 异常水样 / The sample with a missing label | 3 scenes | science |
| 潮汐与鸟 / Beyond the shell-shaped handle | 2 scenes | nature |
| 大厅里的身体展览 / Inside the Body | 8 scenes | science |
| 新学期的几页纸 / First Term | 7 scenes | campus |
| 社区中心的一份工作 / A Job at the Centre | 8 scenes | campus |
| 照片与告示之间 / Council & Neighbours | 2 scenes | community |
| 诊所里的几张便签 / The notes at the clinic | 7 scenes | health |
| 门厅外的一个月 / A Month at the Community Centre | 20 scenes | community |
| 楼上的社区编辑室 / The Room Above the Library | 16 scenes | media |
| 街角小店的第一张订单 / The First Order at the Corner Shop | 19 scenes | commerce |
| 河街的周末 / Market Weekend | 7 scenes | civic |
| 篱笆那边的农场 / Farm Visit | 4 scenes | nature |
| 温室外的小径 / The Path Beyond the Greenhouse | 16 scenes | nature |
| 画里的街，柜里的杯 / Art & Local Heritage | 2 scenes | community |
| 帕克路十八号 / Inside the House | 6 scenes | home |
| 窗边的装箱桌 / Industry & Making | 2 scenes | industry |
| 厨房里的一张食谱 / A recipe on the kitchen table | 4 scenes | kitchen |
| 球篮旁的运动包 / Leisure & Sport | 2 scenes | community |
| 旧厂房里的新中心 / The Old Mill Centre | 5 scenes | urban |
| 开放日的志愿者 / The Open Day | 8 scenes | community |
| 未征同意的照片 / The photograph nobody asked for | 2 scenes | community |
| 一间更安静的房间 / A Quieter Room | 11 scenes | science |
| 空杯子旁的两份纸 / Information & Discussion | 2 scenes | media |
| 从河岸到旅行展厅 / River Journey | 5 scenes | travel |
| 玻璃柜后的科学馆 / Behind the Glass | 16 scenes | research |
| 收据背后的问题 / The question behind the receipt | 5 scenes | commerce |
| 门口的邀请 / Neighbours & Belonging | 2 scenes | community |
| 门后的声音 / The sound behind the gate | 2 scenes | urban |
| 车站后的房间 / A room after the journey | 5 scenes | travel |
| 改动的约定 / Before the deadline | 10 scenes | campus |
| 传单背后的工作坊 / What a short workshop can offer | 2 scenes | campus |

Every route uses clickable English words and expression blocks, optional Chinese support, contextual usage, multiple WordNet senses and original examples, independent recall and spaced review. S01 main lessons and branch scenes have expandable object cues. 225 lessons have 1466 editorial word-sense/chunk/construction units with self-checked observations, sentence listening and session-only recording. Each of these lessons has at most five Core targets; Support and Recognition expressions remain available for understanding. Expression records have search, route and practice-state filters. Written and spoken recall and transfer have separate unit-level dates; assisted practice does not advance independent success. Backup restore merges original facts and rebuilds review dates. Using cues before answering is recorded as assisted practice.

Direct links:

- [Blue bill](https://gyc5151.github.io/ielts-semantic-world/#branch/blue-bill)
- [Changed notice](https://gyc5151.github.io/ielts-semantic-world/#branch/notice)
- [Water sample](https://gyc5151.github.io/ielts-semantic-world/#branch/water-lab)
- [Tides and birds](https://gyc5151.github.io/ielts-semantic-world/#branch/tidal-hide)
- [Square and entrance](https://gyc5151.github.io/ielts-semantic-world/#branch/square-gate)
- [Workshop leaflet](https://gyc5151.github.io/ielts-semantic-world/#branch/workshop-leaflet)
- [Photograph and consent](https://gyc5151.github.io/ielts-semantic-world/#branch/photo-consent)
- [Before the deadline](https://gyc5151.github.io/ielts-semantic-world/#branch/work-study)
- [A room after the journey](https://gyc5151.github.io/ielts-semantic-world/#branch/station-stay)
- [The question behind the receipt](https://gyc5151.github.io/ielts-semantic-world/#branch/shop-service)
- [A recipe on the kitchen table](https://gyc5151.github.io/ielts-semantic-world/#branch/kitchen-table)
- [The notes at the clinic](https://gyc5151.github.io/ielts-semantic-world/#branch/clinic-notes)

New lessons distinguish requests, comparisons, explanations, rewriting and conditional opinions. Rewrite prompts show the draft separately from reference answers. Route search and category filters help choose a setting. Some advanced attitude words are marked for comprehension first.

Practice records are stored in the current browser. No account service or cross-device synchronization is provided. Export records for a backup; preview and merge a JSON backup in About. Recording audio stays in the current practice session and is not included in backups. This version keeps the existing S01 storage key and prompt IDs, so earlier records on this domain remain usable.

These are original practice materials, not official IELTS questions. English stories, Chinese support, object cues and exercises are project-authored adaptations. Source-derived target terms keep separate provenance. Machine-assisted dictionary translations are marked and have not all been individually reviewed. Dictionary coverage gaps are explicitly indicated.

## Attribution

WordNet 3.0 © 2006 Princeton University. See [license](data/WORDNET_LICENSE.txt).

The Chinese dictionary support layer uses an Argos/OPUS-MT model. See [model attribution](data/TRANSLATION_MODEL_ATTRIBUTION.md). The original English dictionary remains separate from project Chinese support.

## Deployment

Only static runtime website files and attribution are included. GitHub Pages publishes the root of `main`; `.nojekyll` skips Jekyll processing. Authoring files, original source materials, models and practice/audit records are not part of this repository.

## Resource loading

Navigation opens from a fixed release directory. Course text, word meanings and unit details load for the selected course. Dictionary English senses and Chinese support load independently for the selected word. Search covers the complete published route directory; expression records use complete metadata and 50-item pages. Original learning IDs and the existing practice storage key are preserved. Resource errors can be retried without clearing practice records.

The compiled startup directory is 195,323 raw JSON bytes for this release; opening a course and resolving existing records adds its required resources. This is a file inventory, not a measured loading-time or learner-effect result.
