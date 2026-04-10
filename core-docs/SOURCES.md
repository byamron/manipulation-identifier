# Sources & Attribution

This document lists all external research, datasets, and resources referenced in the development of the Manipulation Identifier's tactic detection system.

---

## Taxonomy References

### CoCoLoFa (Comments with Common Logical Fallacies)

We referenced CoCoLoFa's 8-category logical fallacy taxonomy when expanding our tactic list from 11 to 15. We use only the standard academic fallacy category names (e.g., "Hasty Generalization", "Appeal to Majority"), which are established concepts in informal logic and are not copyrightable. All definitions, examples, and educational guidance in our `tactics.json` are original.

**Citation:**

> Min-Hsuan Yeh, Ruyuan Wan, and Ting-Hao Kenneth Huang. 2024. CoCoLoFa: A Dataset of News Comments with Common Logical Fallacies Written by LLM-Assisted Crowds. In *Proceedings of the 2024 Conference on Empirical Methods in Natural Language Processing (EMNLP)*, pages 660--677, Miami, Florida, USA. Association for Computational Linguistics.

**BibTeX:**

```bibtex
@inproceedings{yeh-etal-2024-cocolofa,
    title     = "{C}o{C}o{L}o{F}a: A Dataset of News Comments with Common Logical Fallacies Written by {LLM}-Assisted Crowds",
    author    = "Yeh, Min-Hsuan and Wan, Ruyuan and Huang, Ting-Hao Kenneth",
    booktitle = "Proceedings of the 2024 Conference on Empirical Methods in Natural Language Processing",
    month     = nov,
    year      = "2024",
    address   = "Miami, Florida, USA",
    publisher = "Association for Computational Linguistics",
    pages     = "660--677",
    doi       = "10.18653/v1/2024.emnlp-main.39"
}
```

**Links:**
- Paper: https://aclanthology.org/2024.emnlp-main.39/
- Repository: https://github.com/Crowd-AI-Lab/cocolofa
- arXiv: https://arxiv.org/abs/2410.03457

**License:** Paper text is CC-BY 4.0. The GitHub repository does not include an explicit license for the dataset. We do not redistribute any CoCoLoFa data. If benchmarking against their dataset, contact the authors to confirm licensing terms.

---

### MAFALDA (Multi-level Annotation of Fallacies in Large-scale Data)

Used as a cross-reference for validating our taxonomy structure. MAFALDA provides a 3-level hierarchy (23 specific fallacy types) that helped confirm our category choices.

**Citation:**

> Chadi Helwe, Tom Calamai, Pierre-Henri Paris, Chloe Clavel, and Fabian Suchanek. 2024. MAFALDA: A Benchmark and Comprehensive Study of Fallacy Detection and Classification. In *Proceedings of the 2024 Conference of the North American Chapter of the Association for Computational Linguistics (NAACL)*, pages 4810--4845. Association for Computational Linguistics.

**BibTeX:**

```bibtex
@inproceedings{helwe-etal-2024-mafalda,
    title     = "{MAFALDA}: A Benchmark and Comprehensive Study of Fallacy Detection and Classification",
    author    = "Helwe, Chadi and Calamai, Tom and Paris, Pierre-Henri and Clavel, Chlo{\'e} and Suchanek, Fabian",
    booktitle = "Proceedings of the 2024 Conference of the North American Chapter of the Association for Computational Linguistics",
    year      = "2024",
    publisher = "Association for Computational Linguistics",
    pages     = "4810--4845",
    doi       = "10.18653/v1/2024.naacl-long.270"
}
```

**Links:**
- Paper: https://aclanthology.org/2024.naacl-long.270/
- Repository: https://github.com/ChadiHelwe/MAFALDA

**License:** CC-BY-SA. Compatible with open-source use (with share-alike requirement).

---

## Design References

### Jigsaw Prebunking Initiative

Google/Jigsaw's prebunking initiative applies *inoculation theory* to build resilience against online manipulation. Rather than debunking false claims after the fact, prebunking teaches people to recognize common manipulation techniques before they encounter them. The initiative identifies core manipulation tactics -- including emotional language, scapegoating, false dichotomies, and ad hominem attacks -- and uses short video interventions to inoculate audiences against these techniques.

**Relevance to this project:** The prebunking approach directly informed the extension's educational philosophy of "educate, don't censor." Both systems share the core thesis that teaching people to recognize manipulation techniques is more effective than hiding or labeling specific claims. The initiative's tactic-based (rather than claim-based) framing influenced our decision to detect manipulation *techniques* rather than assess factual accuracy.

**Links:**
- Website: https://prebunking.withgoogle.com/

---

## Theoretical References

### Evidence-Frame Framework for Online Rumoring

Adapts Klein et al.'s data-frame theory of collective sensemaking to study how online rumors form and spread. The paper decomposes rumoring into two interacting components -- evidence (factual claims and artifacts) and frames (interpretive lenses) -- demonstrating that misinformation often operates through the selective amplification and reframing of real evidence rather than fabrication.

**Relevance to this project:** Informs our understanding of Decontextualization (broadening from "removing context" to "imposing a new interpretive frame on evidence"), Cherry Picking (selective evidence sharing in real-world rumoring), Hasty Generalization (isolated incidents scaled to systemic claims), and Emotional Language (escalatory framing). Validates the extension's core thesis that manipulation is often subtle and operates through framing rather than outright lies. The paper's social-dynamic findings (cross-post frame escalation, call-and-response amplification) are not implementable as they require multi-text analysis beyond the extension's single-page scope.

**Citation:**

> Kate Starbird, Stephen Prochaska, and Ben Yamron. 2025. What is going on? An evidence-frame framework for analyzing online rumors about election integrity. *Proc. ACM Hum.-Comput. Interact.* 9, 7, Article CSCW341 (November 2025), 37 pages.

**BibTeX:**

```bibtex
@article{starbird-etal-2025-evidence-frame,
    title     = "What is going on? An evidence-frame framework for analyzing online rumors about election integrity",
    author    = "Starbird, Kate and Prochaska, Stephen and Yamron, Ben",
    journal   = "Proc. ACM Hum.-Comput. Interact.",
    volume    = "9",
    number    = "7",
    article   = "CSCW341",
    year      = "2025",
    month     = nov,
    pages     = "1--37",
    doi       = "10.1145/3757522",
    publisher = "ACM"
}
```

**Links:**
- DOI: https://doi.org/10.1145/3757522

**License:** CC-BY 4.0 (ACM open access).

---

### Deep Storytelling and Collective Sensemaking

Examines how persistent meta-narratives ("deep stories") shape collective sensemaking around election-related misinformation. Analyzes Twitter discourse across the 2020 and 2022 U.S. elections, showing how influencers, political elites, and audiences collaboratively construct and reinforce deep stories through "networked performance." Key finding: storytelling evolved from explicit explanations of fraud mechanisms (2020) to implicit presentation of evidence without interpretation (2022), relying on audiences' pre-existing knowledge of the deep story to supply meaning.

**Relevance to this project:** Provides context for *why* manipulation tactics work -- they tap into pre-existing narrative frameworks that audiences carry with them. The paper's per-tweet codebook identifies patterns relevant to detection: "escalates with negative affect" (maps to Emotional Language), "sows doubt" through leading questions (implicit manipulation), and "presents artifact/event without describing meaning" (a form of implicit framing). The concept of "kayfabe" -- staged, conflict-oriented performance that blurs real and performed -- describes a manipulation pattern that combines Emotional Language, Scapegoating, and Polarization. However, deep stories are fundamentally multi-text, culturally-embedded narratives not detectable from a single page, so the paper's contribution is contextual rather than directly implementable.

**Citation:**

> Stephen Prochaska, Julie Vera, Douglas Lew Tan, Ben Yamron, Sylvie Venuto, Amaya Kejriwal, Sarah Chu, and Kate Starbird. 2025. Deep Storytelling: Collective Sensemaking and Layers of Meaning in U.S. Elections. *Proc. ACM Hum.-Comput. Interact.* 9, 7, Article CSCW395 (November 2025), 43 pages.

**BibTeX:**

```bibtex
@article{prochaska-etal-2025-deep-storytelling,
    title     = "Deep Storytelling: Collective Sensemaking and Layers of Meaning in {U.S.} Elections",
    author    = "Prochaska, Stephen and Vera, Julie and Tan, Douglas Lew and Yamron, Ben and Venuto, Sylvie and Kejriwal, Amaya and Chu, Sarah and Starbird, Kate",
    journal   = "Proc. ACM Hum.-Comput. Interact.",
    volume    = "9",
    number    = "7",
    article   = "CSCW395",
    year      = "2025",
    month     = nov,
    pages     = "1--43",
    doi       = "10.1145/3757576",
    publisher = "ACM"
}
```

**Links:**
- DOI: https://doi.org/10.1145/3757576

**License:** CC-BY 4.0 (ACM open access).

---

## Original Content

All tactic definitions, examples, explanations ("why"), and educational guidance ("whatToDo") in `tactics.json` are original content authored for this project. The fallacy and manipulation tactic names themselves (e.g., "Ad Hominem", "Slippery Slope", "False Dichotomy") are standard terminology from the academic field of informal logic and argumentation theory, in common use across textbooks, research papers, and educational resources.
