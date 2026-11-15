# Privacy shield in front of the model (14 Nov 2026)

**Question.** How should personal details in a renter's description (names, contacts, addresses, identity numbers) be kept
from the language model, while the people who need them (the renter, the underwriter) still see them? Constraints: Node/TS
in-process, no paid service, English and French, the model may be a cloud one, a demo that must not fall back silently.

| Option | What it is | Fit | Cost and risk | Source |
|---|---|---|---|---|
| Microsoft Presidio | Python analyzer (regex + context + NER) and anonymizer with reversible encrypt/deanonymize | The reference design | Python service beside a Node API; heavy for a demo | [Presidio as an LLM guardrail](https://dev.to/bspann/presidio-as-an-llm-guardrail-gcf), [overview](https://pasqualepillitteri.it/en/news/5538/microsoft-presidio-pii-data-protection-ai) |
| LLM Guard, PII Firewall | Python scanners: anonymize before, deanonymize after, with a vault | Same pattern | Python; reversibility differs by source | [comparison](https://grepture.com/compare/best-pii-redaction-apis-for-llms), [pii-firewall](https://pypi.org/project/pii-firewall/0.2.3/) |
| Hosted redaction APIs | Send text to a vendor that redacts it | Wrong way round | The data leaves to a third party first | [comparison](https://grepture.com/compare/best-pii-redaction-apis-for-llms) |
| Own gateway in the API | Validated patterns + a local NER model (transformers.js, already used for embeddings) + keyed tags + encrypted vault | Fits the stack, no new runtime | Name recall depends on the model; must be measured | [DPDP build guide](https://ecorpit.com/pii-redaction-before-llm-dpdp-build-guide-2026/), [NER model](https://huggingface.co/Xenova/distilbert-base-multilingual-cased-ner-hrl) |

**Recommendation: build** the gateway in the API from the public pattern: detect, replace with an opaque typed tag, send,
restore for people allowed to see it. Patterns for structured identifiers (validated where a checksum exists), a local
multilingual NER model for names, rules with cues as the fallback. A guard on the model provider re-checks every prompt, so a
call site that forgets the shield still cannot leak.

**Pitfalls the design answers.** Tags stay opaque (type and a short keyed id, never part of the value) and consistent within
a text. The mapping is the crown jewel: sealed with AES-256-GCM under a key per client program, never in prompts, logs or the
search index. Later partial mentions ("Ms. Thompson" after "Sarah Thompson") are tagged too. Exact-match leak counts
undercount paraphrase and rare combinations; the shield is pseudonymisation, and the data stays personal data in law.
Instruction-like text in the input raises name leakage in model output ([arXiv 2505.14549](https://arxiv.org/html/2505.14549v1)):
the model here only ever sees tags, so there is no value for it to repeat. Lexical metrics miss re-expressed information
([arXiv 2504.21035](https://arxiv.org/html/2504.21035v1)).

**Open.** Quasi-identifiers (rare activity + date + small town) pass through. Key rotation is not built. External agents
(MCP) get the same treatment in a later step.

Sources (all read 14 Nov 2026, secondary unless the model card): dev.to Presidio guardrail; pasqualepillitteri.it Presidio
overview; grepture.com comparison; pypi.org pii-firewall; ecorpit.com DPDP guide; huggingface.co model cards (primary);
arXiv 2505.14549 and 2504.21035 (primary).
