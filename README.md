# IELTS Semantic World

Situation → Language: a text-based IELTS vocabulary learning prototype.

Live site: https://gyc5151.github.io/ielts-semantic-world/

## Current scope

S01 Housing & Commuting: nine micro-scenes and 45 retrieval/transfer tasks. English scene reading, full-text Chinese support, clickable words and chunks, contextual usage, multiple WordNet senses and examples, and spaced review.

Practice records are saved only in the current browser. There is no account service or cross-device synchronization. Use the export function to keep a backup. Records from the localhost prototype do not automatically transfer to this domain.

These are original practice materials, not official IELTS questions. Machine-assisted dictionary translations are explicitly marked and have not been individually reviewed. They are learning aids rather than authoritative Chinese dictionary entries.

## Attribution

WordNet 3.0 © 2006 Princeton University. See [license](data/WORDNET_LICENSE.txt).

The auxiliary Chinese translation layer uses an Argos/OPUS-MT model. See [model attribution](data/TRANSLATION_MODEL_ATTRIBUTION.md). Project Chinese explanations and translations are kept separately from the original English dictionary material.

## Deployment

This repository contains the static runtime website only. GitHub Pages publishes the root of `main`. `.nojekyll` disables Jekyll processing. Open with a static HTTP server for local development.
