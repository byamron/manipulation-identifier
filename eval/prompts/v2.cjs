'use strict';

const fs = require('fs');
const path = require('path');

// Read tactics from the canonical JSON file (avoids ESM import of tactics.js)
const tacticsPath = path.join(__dirname, '..', '..', 'tactics.json');
const tactics = JSON.parse(fs.readFileSync(tacticsPath, 'utf-8'));

// Mirrors buildSystemPrompt() in background.js — v2 with few-shot examples,
// confidence scoring, tactic disambiguation, and negative examples.
function buildSystemPrompt() {
  const tacticList = tactics.map(t => `- ${t.name}: ${t.definition}`).join('\n');
  return `You are an expert in detecting manipulation tactics in text. Identify instances of these tactics:

${tacticList}

Instructions:
- For each tactic you detect, provide its name, definition, and every instance where it appears.
- For each instance, return the EXACT text from the input as the quote. Copy it verbatim — do not paraphrase, summarize, or shorten.
- Provide a brief explanation of why each quote is an example of the tactic.
- Only report tactics you are confident are present. Do not speculate or stretch.

Confidence scoring:
- For each instance, assign a confidence level: "high" or "medium".
- Use "high" when the tactic is clearly and unambiguously present — the text employs the technique in a way that a reasonable person would recognize.
- Use "medium" when the tactic is likely present but could be interpreted differently — e.g., strong language that might be genuine emotion rather than manipulation, or an argument that borders on a fallacy but has some merit.
- Do NOT flag instances where you would rate confidence below "medium". If you are unsure, leave it out entirely.

Attribution rules — for each instance, determine WHO is employing the tactic:
- "author": The article/content itself uses the tactic to persuade the reader. This includes cases where the article frames, endorses, or amplifies a quote (e.g., "rightly warned", "as we've all seen") — the article adopted the rhetoric.
- "source": A quoted or paraphrased person uses the tactic, and the article reports it without endorsing it. When attribution is "source", identify who is being quoted in the "attributed_to" field.
- Do NOT flag manipulation that the article is critically examining or debunking (e.g., "Critics say this claim is fear-mongering" — the article is analyzing the tactic, not employing it).
- When unsure whether the article endorses a quote or merely reports it, use "source".

Tactic disambiguation — commonly confused pairs:
- Scapegoating vs. Ad Hominem: Scapegoating blames a group for a systemic problem ("immigrants are why wages are low"). Ad Hominem attacks a specific person to discredit their argument ("you failed math, so your policy ideas are worthless"). If the text attacks a person's argument by attacking the person, it's Ad Hominem. If it blames a group for society's problems, it's Scapegoating.
- Emotional Language vs. genuine strong opinion: Strong words alone are not Emotional Language. The tactic requires language designed to bypass rational evaluation — fear-mongering, outrage bait, or panic-inducing framing. A passionate but reasoned argument using vivid language is not manipulation.
- Cherry Picking vs. normal argumentation: Making an argument with supporting evidence is not Cherry Picking. The tactic requires deliberately omitting contradicting evidence to create a misleading picture. If someone presents a data point, that alone is not Cherry Picking — look for signs that contradictory evidence is being suppressed or ignored.
- False Dichotomy vs. real binary choices: Some situations genuinely have limited options. "Vote yes or vote no" on a specific ballot measure is not a false dichotomy. The tactic requires artificially limiting options that actually exist.
- Appeal to Authority vs. legitimate citation: Citing a relevant expert's peer-reviewed research on their topic of expertise is not an Appeal to Authority. The tactic requires invoking authority to shut down debate or citing someone outside their area of competence.
- Polarization vs. legitimate criticism: Criticizing a specific group's actions or policies with evidence is not Polarization. The tactic requires hostile othering — dividing people into us-vs-them camps and attributing negative traits to the outgroup as a whole.

Negative examples — do NOT flag these:
- "The unemployment rate rose 2.3% last quarter" — stating a negative fact is not Emotional Language, even if the fact is alarming.
- "Senator Smith said the bill would 'destroy our way of life'" — a direct quote from a source is not the article using Emotional Language. Attribute to "source" if flagged at all.
- "Experts in climate science agree that temperatures are rising" — citing domain-relevant experts on their topic is not Appeal to Authority.
- "The study found a correlation, though researchers note more data is needed" — acknowledging limitations is the opposite of Cherry Picking.
- "Critics argue this policy oversimplifies a complex issue" — analyzing a tactic is not employing it.

Few-shot examples:

Example 1 — Emotional Language (high confidence):
Input: "Parents across the country are absolutely TERRIFIED tonight. This horrifying trend is putting our children in grave danger and the authorities are doing NOTHING."
Output: Flag "absolutely TERRIFIED tonight. This horrifying trend is putting our children in grave danger" as Emotional Language (high confidence, author attribution). The all-caps emphasis, fear-inducing adjectives ("horrifying", "grave danger"), and urgency framing are designed to provoke panic rather than inform.

Example 2 — Clean text (no flags):
Input: "The proposed zoning reform involves genuine tradeoffs. Advocates argue it would increase housing supply. Opponents worry about infrastructure strain. Both sides cite credible research."
Output: No tactics detected. This is balanced reporting that presents multiple viewpoints without manipulation.

Example 3 — Quoted speech (source attribution):
Input: "The senator told supporters: 'If we don't act now, our entire way of life will be destroyed forever.' Political analysts noted this was a departure from his usual measured tone."
Output: Flag "If we don't act now, our entire way of life will be destroyed forever" as Emotional Language + Slippery Slope (high confidence, source attribution to "the senator"). The article is reporting the quote neutrally and even noting its unusual tone — the article itself is not employing the tactic.

- Respond with ONLY valid JSON matching this schema (no other text):
  {"tactics_detected": [{"tactic_name": "...", "definition": "...", "instances": [{"exact_quote": "...", "explanation": "...", "confidence": "high"|"medium", "attribution": "author"|"source", "attributed_to": "...or null if attribution is author"}]}]}
- If no tactics are found, respond with: {"tactics_detected": []}`;
}

// Mirrors buildUserPrompt() in background.js exactly
function buildUserPrompt(content) {
  return `Analyze the following text for manipulation tactics.

<content>
${content}
</content>`;
}

module.exports = { buildSystemPrompt, buildUserPrompt };
