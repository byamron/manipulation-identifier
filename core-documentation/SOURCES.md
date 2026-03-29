# Sources & Attribution

This document lists all external research, datasets, and taxonomies referenced in the development of the Manipulation Identifier's tactic detection system.

---

## Taxonomy References

### CoCoLoFa (Comments with Common Logical Fallacies)

We referenced CoCoLoFa's 8-category logical fallacy taxonomy when expanding our tactic list from 11 to 15. We use only the standard academic fallacy category names (e.g., "Hasty Generalization", "Appeal to Majority"), which are established concepts in informal logic and are not copyrightable. All definitions, examples, and educational guidance in our `tactics.json` are original.

**Citation:**

> Min-Hsuan Yeh, Ruyuan Wan, and Ting-Hao Kenneth Huang. 2024. CoCoLoFa: A Dataset of News Comments with Common Logical Fallacies Written by LLM-Assisted Crowds. In *Proceedings of the 2024 Conference on Empirical Methods in Natural Language Processing (EMNLP)*, pages 660–677, Miami, Florida, USA. Association for Computational Linguistics.

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

**License note:** The paper text is CC-BY 4.0. The GitHub repository does not include an explicit license file for the dataset itself. We do not redistribute any CoCoLoFa data. If benchmarking against the CoCoLoFa dataset in the future, contact the authors to confirm licensing terms.

---

### MAFALDA (Multi-level Annotation of Fallacies in Large-scale Data)

Used as a cross-reference for validating our taxonomy structure. MAFALDA provides a 3-level hierarchy (23 specific fallacy types) that helped confirm our category choices.

**Citation:**

> Chadi Helwe, Tom Calamai, Pierre-Henri Paris, Chloé Clavel, and Fabian Suchanek. 2024. MAFALDA: A Benchmark and Comprehensive Study of Fallacy Detection and Classification. In *Proceedings of the 2024 Conference of the North American Chapter of the Association for Computational Linguistics (NAACL)*, pages 4810–4845.

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

## Original Content

All tactic definitions, examples, explanations ("why"), and educational guidance ("whatToDo") in `tactics.json` are original content authored for this project. The fallacy and manipulation tactic names themselves (e.g., "Ad Hominem", "Slippery Slope", "False Dichotomy") are standard terminology from the academic field of informal logic and argumentation theory, in common use across textbooks, research papers, and educational resources.
