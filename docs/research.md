# Deterministic AI-Detection Heuristics for Academic Integrity (2023–2026)

These ten heuristics are designed for rapid, client-side identification of "suspicious" text markers without the use of server-side Large Language Models (LLMs).

1. **Punctuation Monotony: The "Em-Dash" habit**  
AI models, particularly ChatGPT and Claude, frequently overuse the em-dash (—) to create a facade of sophisticated writing. Human writers typically use hyphens (-) or commas for the same purpose.  
Heuristic: Flag text where em-dash density exceeds 3 per 200 words.  
Marker: Check for consistent use of "smart" or curly quotation marks (“ ”) vs. "straight" quotes (" ") common in raw human drafts.

2. **Homoglyph Substitution (Unicode Obfuscation)**  
Users often attempt to bypass detection by replacing Latin characters with visually similar Unicode characters from other scripts (e.g., Cyrillic 'а', Greek 'ο').  
Heuristic: Any character outside the standard ASCII range (U+0000 to U+007F) within an English word is high suspicion.  
Invisible Markers: Scan for Zero-Width Spaces (U+200B) or Zero-Width Joiners (U+200D) which are often used as "invisible watermarks".

3. **Reasoning Model Artifacts (Multilingual Leakage)**  
Reasoning models like OpenAI's o1 or Google's Gemini occasionally leak tokens from their internal "thought" process into the final output, particularly Chinese (CJK) and Persian characters.  
Heuristic: Detect CJK characters (U+4E00–U+9FFF) in English homework.  
Leakage Patterns: Watch for specific leaked strings like 破 1656 (found in Gemini/Antigravity logs) or the character 撒.

4. **Lexical Signatures (The "AI Slop" Vocabulary)**  
LLMs have a statistical preference for "high-probability" tokens that sound professional but lack specific meaning.  
High-Risk Words: "delve", "tapestry", "testament", "realm", "pivotal", "vibrant", "unleash", "unlock", "robust", "seamless".  
Corporate-Heavy Phrases: "operational excellence", "strategic alignment", "in today's digital age".

5. **Hallucinated Citation Verification**  
AI models often generate plausible-looking but non-existent bibliographic references.  
Heuristic: Verify DOIs (e.g., 10.1021/...) against local patterns. Any citation to "Firstname Lastname" or "arXiv:2305.XXXX" is a clear sign of AI padding.  
Link Verification: Run a client-side HTTP HEAD request; links like mckinsey.com/fake-url-slug-2024 that return 404/405 are confirmed hallucinations.

6. **Specific Emoji Signatures**  
Certain emojis are heavily overused by AI features or within AI-generated "hype" content.  
AI Indicators: The "sparkles" (✨) emoji is the de facto UI marker for AI, while the "rocket[text](about:blank#blocked)" (🚀) is common in AI-generated marketing copy.  
Human Moat: Frequent use of emotionally expressive emojis like 😭 (Loudly Crying) or 💀 (Skull) is historically rare in base AI output.

7. **Formatting Artifacts & Markup Residue**  
Copy-pasted AI content often retains specific technical delimiters or structural residues from the model's interface.  
Heuristic: Detect LaTeX math delimiters (e.g., `\[... \]`) in non-technical essays.  
Residue: Look for "Title Case" section headers (e.g., "## Challenges And Future Prospects") and "inline-header vertical lists" (bold term followed by a colon).

8. **Structural Uniformity (Low Burstiness)**  
Human writing varies greatly in sentence length and rhythm, whereas AI is statistically incentivized to produce uniform, "safe" structures.  
Metric: Calculate sentence word count variance. If 90% of sentences are between 15–25 words, the text is suspiciously uniform.  
Rule of Three: AI frequently lists exactly three items for rhythmic effect (e.g., "fast, efficient, and reliable").

9. **Procedural Remnants & Canned Disclaimers**  
Models often output identity-protection or safety-training disclaimers that students forget to remove.  
Identity Markers: "As an AI language model...", "As of my last knowledge update...", "It is important to note that...".  
Intro/Outro Slop: Standard canned greetings like "I hope this finds you well" in student essays.

10. **Information Gain & Lack of Specificity**  
AI provides generic, "cookie-cutter" summaries rather than unique, grounded perspectives.  
Heuristic: Calculate the ratio of "Vague Terms" (e.g., "a recent study," "many people") to "Specific Entities" (named researchers, specific dates, local events).  
Zero Typos: Flawless grammar and syntax in the work of a student who historically has technical struggles is a significant indicator of AI usage.

### Summary of Suspicion Weights (Scoring)

| Heuristic Group               | Suspicion Weight (1–10) | Primary Marker                                          |
|-------------------------------|-------------------------|---------------------------------------------------------|
| Homoglyphs/Unicode            | 10                      | Non-ASCII character within an English word              |
| Canned Disclaimers            | 10                      | "As an AI language model" or variants                   |
| Multilingual Leakage          | 9                       | Random Chinese/Persian characters                       |
| Hallucinated Links            | 9                       | DOI resolution failure or 404 URL                       |
| Formatting Artifacts          | 7                       | LaTeX delimiters or Title Case headers                  |
| Vocabulary Density            | 7                       | More than 3 "High-Risk" tokens per 250 words            |
| Punctuation Monotony          | 6                       | Excess em-dashes and consistent curly quotes            |
| Structural Uniformity         | 5                       | Uniform sentence length (low burstiness)                |
| Emoji Slop                    | 5                       | Presence of ✨ or 🚀 in list-heavy text                |
| Lack of Personal Touch        | 4                       | No specific names/dates/local references                |