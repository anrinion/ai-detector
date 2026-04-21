// ==UserScript==
// @name         AI Content Highlighter
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  Highlight likely AI-generated text using configurable heuristics
// @author       You
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ==================== CONFIGURATION & STATE ====================
    const DEFAULT_CONFIG = {
        // Global
        threshold: 6,
        debounceMs: 10000,
        excludedDomains: [],
        debug: false,

        heuristics: {
            punctuationMonotony: {
                enabled: true,
                weight: 6,
                emDashPer200Words: 3,
                curlyQuotesBonus: 0.2
            },
            homoglyph: {
                enabled: true,
                weight: 10
            },
            multilingualLeakage: {
                enabled: true,
                weight: 9,
                cjkRange: true,
                persianRange: true,
                leakedStrings: ['破1656', '撒']
            },
            vocabulary: {
                enabled: true,
                weight: 7,
                highRiskWords: [
                    'delve', 'tapestry', 'testament', 'realm', 'pivotal', 'vibrant',
                    'unleash', 'unlock', 'robust', 'seamless', 'operational excellence',
                    'strategic alignment', 'in today\'s digital age'
                ],
                thresholdPer250Words: 3
            },
            emojiSignature: {
                enabled: true,
                weight: 5,
                aiEmojis: ['✨', '🚀']
            },
            formattingArtifacts: {
                enabled: true,
                weight: 7,
                latexDelimiterPatterns: ['\\[', '\\]', '\\(', '\\)'],
                titleCaseThreshold: 0.6
            },
            structuralUniformity: {
                enabled: true,
                weight: 5,
                uniformSentenceLengthRange: [15, 25],
                uniformityThreshold: 0.9
            },
            cannedDisclaimers: {
                enabled: true,
                weight: 10,
                phrases: [
                    'as an ai language model',
                    'as of my last knowledge update',
                    'it is important to note that',
                    'i hope this finds you well'
                ]
            },
            lackOfSpecificity: {
                enabled: true,
                weight: 4,
                vagueTerms: [
                    'a recent study', 'many people', 'experts say', 'research shows',
                    'it is widely believed', 'some argue'
                ],
                thresholdRatio: 2.0
            }
        }
    };

    let config = loadConfig();
    let scanTimer = null;
    let observer = null;
    let tooltipEl = null;
    let settingsPanel = null;
    let isApplyingHighlights = false;   // Prevent recursive scans

    // Debug logging
    function log(...args) {
        if (config.debug) console.log('[AI-Highlighter]', ...args);
    }

    function warn(...args) {
        if (config.debug) console.warn('[AI-Highlighter]', ...args);
    }

    // ==================== PERSISTENCE ====================
    function loadConfig() {
        const saved = GM_getValue('aiHighlighterConfig', null);
        if (saved) {
            try {
                return deepMerge(DEFAULT_CONFIG, JSON.parse(saved));
            } catch (e) {
                console.error('Failed to parse saved config', e);
                return deepMerge({}, DEFAULT_CONFIG);
            }
        }
        return deepMerge({}, DEFAULT_CONFIG);
    }

    function saveConfig() {
        GM_setValue('aiHighlighterConfig', JSON.stringify(config));
        log('Config saved');
    }

    function deepMerge(target, source) {
        const output = { ...target };
        for (let key in source) {
            if (source.hasOwnProperty(key)) {
                if (typeof source[key] === 'object' && !Array.isArray(source[key]) && target[key]) {
                    output[key] = deepMerge(target[key], source[key]);
                } else {
                    output[key] = source[key];
                }
            }
        }
        return output;
    }

    // ==================== DOMAIN EXCLUSION ====================
    function isDomainExcluded() {
        const host = location.hostname;
        return config.excludedDomains.some(pattern => {
            const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
            const regex = new RegExp(`^${regexPattern}$`, 'i');
            return regex.test(host);
        });
    }

    // ==================== HEURISTICS (unchanged) ====================
    const Heuristics = {
        punctuationMonotony(text) {
            const cfg = config.heuristics.punctuationMonotony;
            const words = text.split(/\s+/).filter(w => w.length > 0);
            const wordCount = words.length;
            if (wordCount < 50) return { score: 0, triggers: [] };

            const emDashCount = (text.match(/—/g) || []).length;
            const emDashDensity = (emDashCount / wordCount) * 200;
            let score = 0;
            const triggers = [];

            if (emDashDensity >= cfg.emDashPer200Words) {
                score += 0.6;
                triggers.push(`High em-dash density (${emDashCount} in ${wordCount} words)`);
            }

            const curlyDouble = (text.match(/[“”]/g) || []).length;
            const straightDouble = (text.match(/"/g) || []).length;
            if (curlyDouble > straightDouble * 0.8) {
                score += cfg.curlyQuotesBonus;
                triggers.push('Consistent use of curly quotes (AI hallmark)');
            }

            return { score: Math.min(score, 1.0), triggers };
        },

        homoglyph(text) {
            const cfg = config.heuristics.homoglyph;
            const wordRegex = /\b\w+\b/g;
            let match;
            let suspiciousCount = 0;
            const suspiciousExamples = [];
            while ((match = wordRegex.exec(text)) !== null) {
                const word = match[0];
                if (/[^\x00-\x7F]/.test(word) && /^[A-Za-zÀ-ÿ]+$/.test(word) === false) {
                    suspiciousCount++;
                    if (suspiciousExamples.length < 3) suspiciousExamples.push(word);
                }
            }
            const zwspCount = (text.match(/\u200B/g) || []).length;
            const zwjCount = (text.match(/\u200D/g) || []).length;

            let score = 0;
            const triggers = [];
            if (suspiciousCount > 0) {
                score += Math.min(suspiciousCount * 0.3, 1.0);
                triggers.push(`Found ${suspiciousCount} words with non-ASCII characters (e.g., ${suspiciousExamples.join(', ')})`);
            }
            if (zwspCount > 0) {
                score += 0.8;
                triggers.push(`Detected ${zwspCount} zero-width spaces (invisible watermark)`);
            }
            if (zwjCount > 0) {
                score += 0.8;
                triggers.push(`Detected ${zwjCount} zero-width joiners`);
            }

            return { score: Math.min(score, 1.0), triggers };
        },

        multilingualLeakage(text) {
            const cfg = config.heuristics.multilingualLeakage;
            let score = 0;
            const triggers = [];

            const cjkMatches = text.match(/[\u4E00-\u9FFF]/g) || [];
            if (cjkMatches.length > 0) {
                score += 0.9;
                triggers.push(`Found ${cjkMatches.length} CJK characters in English text`);
            }

            const persianMatches = text.match(/[\u0600-\u06FF]/g) || [];
            if (persianMatches.length > 0) {
                score += 0.9;
                triggers.push(`Found ${persianMatches.length} Persian/Arabic characters`);
            }

            cfg.leakedStrings.forEach(str => {
                if (text.includes(str)) {
                    score += 0.8;
                    triggers.push(`Found known leakage pattern: "${str}"`);
                }
            });

            return { score: Math.min(score, 1.0), triggers };
        },

        vocabulary(text) {
            const cfg = config.heuristics.vocabulary;
            const words = text.split(/\s+/).filter(w => w.length > 0);
            const wordCount = words.length;
            if (wordCount < 50) return { score: 0, triggers: [] };

            const lowerText = text.toLowerCase();
            let hitCount = 0;
            const hitsFound = [];
            cfg.highRiskWords.forEach(term => {
                const count = (lowerText.match(new RegExp(term, 'g')) || []).length;
                if (count > 0) {
                    hitCount += count;
                    hitsFound.push(`${term} (${count})`);
                }
            });

            const densityPer250 = (hitCount / wordCount) * 250;
            let score = 0;
            const triggers = [];
            if (densityPer250 >= cfg.thresholdPer250Words) {
                score = Math.min(densityPer250 / (cfg.thresholdPer250Words * 3), 1.0);
                triggers.push(`High AI vocabulary density: ${hitCount} hits in ${wordCount} words (${densityPer250.toFixed(1)} per 250)`);
                if (hitsFound.length) triggers.push(`Terms: ${hitsFound.join(', ')}`);
            }

            return { score, triggers };
        },

        emojiSignature(text) {
            const cfg = config.heuristics.emojiSignature;
            let score = 0;
            const triggers = [];
            cfg.aiEmojis.forEach(emoji => {
                if (text.includes(emoji)) {
                    score += 0.7;
                    triggers.push(`AI-favored emoji detected: ${emoji}`);
                }
            });
            return { score: Math.min(score, 1.0), triggers };
        },

        formattingArtifacts(text) {
            const cfg = config.heuristics.formattingArtifacts;
            let score = 0;
            const triggers = [];

            const latexPattern = /\\\[|\\\]|\\\(|\\\)/g;
            const latexMatches = text.match(latexPattern) || [];
            if (latexMatches.length > 0) {
                score += 0.8;
                triggers.push(`Found LaTeX delimiters: ${latexMatches.join(' ')}`);
            }

            const lines = text.split('\n');
            let titleCaseLines = 0;
            lines.forEach(line => {
                line = line.trim();
                if (line.length < 5) return;
                const words = line.split(/\s+/);
                const titleWords = words.filter(w => /^[A-Z][a-z]+$/.test(w) || /^[A-Z]+$/.test(w));
                if (titleWords.length >= 2 && titleWords.length / words.length > 0.7) {
                    titleCaseLines++;
                }
            });
            const ratio = titleCaseLines / Math.max(lines.length, 1);
            if (ratio >= cfg.titleCaseThreshold) {
                score += 0.6;
                triggers.push(`High ratio of Title Case headers (${(ratio*100).toFixed(0)}%)`);
            }

            return { score: Math.min(score, 1.0), triggers };
        },

        structuralUniformity(text) {
            const cfg = config.heuristics.structuralUniformity;
            const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
            if (sentences.length < 5) return { score: 0, triggers: [] };

            const wordCounts = sentences.map(s => s.trim().split(/\s+/).length);
            const [minLen, maxLen] = cfg.uniformSentenceLengthRange;
            const inRange = wordCounts.filter(wc => wc >= minLen && wc <= maxLen).length;
            const uniformity = inRange / sentences.length;

            let score = 0;
            const triggers = [];
            if (uniformity >= cfg.uniformityThreshold) {
                score = uniformity;
                triggers.push(`Sentence length uniformity: ${(uniformity*100).toFixed(0)}% of sentences are 15-25 words`);
            }

            const threeItemListPattern = /\b(\w+),\s+(\w+),\s+and\s+(\w+)\b/gi;
            const threeItemMatches = text.match(threeItemListPattern) || [];
            if (threeItemMatches.length >= 2) {
                score += 0.3;
                triggers.push(`Found ${threeItemMatches.length} "rule of three" lists`);
            }

            return { score: Math.min(score, 1.0), triggers };
        },

        cannedDisclaimers(text) {
            const cfg = config.heuristics.cannedDisclaimers;
            const lower = text.toLowerCase();
            let score = 0;
            const triggers = [];
            cfg.phrases.forEach(phrase => {
                if (lower.includes(phrase)) {
                    score = 1.0;
                    triggers.push(`Contains AI disclaimer: "${phrase}"`);
                }
            });
            return { score, triggers };
        },

        lackOfSpecificity(text) {
            const cfg = config.heuristics.lackOfSpecificity;
            const words = text.split(/\s+/).filter(w => w.length > 0);
            const wordCount = words.length;
            if (wordCount < 100) return { score: 0, triggers: [] };

            const lower = text.toLowerCase();
            let vagueCount = 0;
            const vagueFound = [];
            cfg.vagueTerms.forEach(term => {
                const count = (lower.match(new RegExp(term, 'g')) || []).length;
                if (count > 0) {
                    vagueCount += count;
                    vagueFound.push(`${term} (${count})`);
                }
            });

            const specificPattern = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
            const specificMatches = text.match(specificPattern) || [];
            const specificCount = specificMatches.length;

            const vaguePer500 = (vagueCount / wordCount) * 500;
            const specificPer500 = (specificCount / wordCount) * 500;

            let score = 0;
            const triggers = [];
            if (vaguePer500 > specificPer500 * cfg.thresholdRatio) {
                score = Math.min(vaguePer500 / (specificPer500 + 1), 1.0);
                triggers.push(`Vague terms (${vagueCount}) outnumber specific entities (${specificCount})`);
                if (vagueFound.length) triggers.push(`Examples: ${vagueFound.slice(0,3).join(', ')}`);
            }

            return { score, triggers };
        }
    };

    // ==================== SCORING ENGINE ====================
    function analyzeText(text) {
        const results = [];
        let totalWeightedScore = 0;
        let totalWeight = 0;
        const allTriggers = [];

        for (const [name, heuristicFn] of Object.entries(Heuristics)) {
            const cfgHeur = config.heuristics[name];
            if (!cfgHeur || !cfgHeur.enabled) continue;

            try {
                const { score, triggers } = heuristicFn(text);
                const weight = cfgHeur.weight;
                totalWeightedScore += score * weight;
                totalWeight += weight;
                if (triggers.length > 0) {
                    results.push({ name, score, weight, triggers });
                    allTriggers.push(...triggers);
                }
            } catch (e) {
                warn(`Heuristic ${name} error:`, e);
            }
        }

        const normalizedScore = totalWeight > 0 ? (totalWeightedScore / totalWeight) * 10 : 0;
        const finalScore = Math.min(normalizedScore * 10, 100);

        return {
            score: finalScore,
            triggers: allTriggers,
            details: results
        };
    }

    // ==================== BLOCK PROCESSING ====================
    function getBlockElements() {
        const selectors = 'p, div:not(.ai-highlighter-ui):not(.ai-highlight), li, blockquote, h1, h2, h3, h4, h5, h6, section, article, td, th';
        const elements = document.querySelectorAll(selectors);
        return Array.from(elements).filter(el => {
            const text = el.innerText?.trim() || '';
            if (text.length < 30) return false;
            if (el.closest('.ai-highlighter-ui')) return false;
            return true;
        });
    }

    function clearHighlights() {
        document.querySelectorAll('.ai-highlight').forEach(el => {
            const parent = el.parentNode;
            while (el.firstChild) {
                parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
            parent.normalize();
        });
        log('Cleared all highlights');
    }

    function applyHighlights() {
        if (isDomainExcluded()) {
            log('Domain excluded, skipping highlight');
            return;
        }

        if (isApplyingHighlights) return;
        isApplyingHighlights = true;

        try {
            const blocks = getBlockElements();
            log(`Scanning ${blocks.length} block elements`);

            blocks.forEach(block => {
                const text = block.innerText;
                const analysis = analyzeText(text);
                if (analysis.score >= config.threshold) {
                    const wrapper = document.createElement('span');
                    wrapper.className = 'ai-highlight';
                    wrapper.setAttribute('data-ai-evidence', JSON.stringify(analysis.triggers.slice(0, 10)));

                    while (block.firstChild) {
                        wrapper.appendChild(block.firstChild);
                    }
                    block.appendChild(wrapper);

                    log(`Highlighted block with score ${analysis.score.toFixed(1)}`);
                }
            });
        } finally {
            isApplyingHighlights = false;
        }
    }

    // ==================== TOOLTIP (unchanged) ====================
    function initTooltip() {
        if (tooltipEl) return;
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'ai-highlighter-tooltip';
        tooltipEl.style.cssText = `
            position: fixed;
            background: #333;
            color: #fff;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 13px;
            max-width: 350px;
            z-index: 2147483647;
            pointer-events: none;
            box-shadow: 0 3px 10px rgba(0,0,0,0.3);
            display: none;
        `;
        document.body.appendChild(tooltipEl);

        document.addEventListener('mouseover', e => {
            const target = e.target.closest('.ai-highlight');
            if (!target) {
                tooltipEl.style.display = 'none';
                return;
            }

            const evidenceRaw = target.getAttribute('data-ai-evidence');
            if (!evidenceRaw) return;

            try {
                const evidence = JSON.parse(evidenceRaw);
                let html = '<strong style="color:#FFEB3B">⚠️ Likely AI generated</strong><ul style="margin:5px 0 0 15px; padding:0;">';
                evidence.slice(0, 5).forEach(item => {
                    html += `<li>${escapeHtml(item)}</li>`;
                });
                if (evidence.length > 5) html += `<li>... and ${evidence.length - 5} more indicators</li>`;
                html += '</ul>';
                tooltipEl.innerHTML = html;
                tooltipEl.style.display = 'block';
            } catch (e) {
                tooltipEl.textContent = 'Likely AI generated';
                tooltipEl.style.display = 'block';
            }
        });

        document.addEventListener('mousemove', e => {
            if (tooltipEl.style.display === 'block') {
                const x = e.clientX + 15;
                const y = e.clientY + 10;
                tooltipEl.style.left = x + 'px';
                tooltipEl.style.top = y + 'px';
            }
        });

        document.addEventListener('mouseout', e => {
            if (e.target.closest('.ai-highlight')) {
                tooltipEl.style.display = 'none';
            }
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ==================== MUTATION OBSERVER (FIXED) ====================
    function startObserver() {
        if (observer) observer.disconnect();
        observer = new MutationObserver(mutations => {
            // Ignore if we're already applying highlights or if mutations are our own
            if (isApplyingHighlights) return;

            const shouldRescan = mutations.some(m => {
                if (m.type !== 'childList') return false;
                // Skip if target or added nodes belong to our UI or highlights
                if (m.target.closest && (m.target.closest('.ai-highlighter-ui') || m.target.closest('.ai-highlight'))) {
                    return false;
                }
                // Check added nodes
                for (let node of m.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.closest && (node.closest('.ai-highlighter-ui') || node.closest('.ai-highlight'))) {
                            continue;
                        }
                        // Only rescan if the added node might contain text blocks
                        if (node.querySelector) {
                            const hasTextBlocks = node.querySelector('p, div, li, blockquote, h1, h2, h3, h4, h5, h6, section, article, td, th');
                            if (hasTextBlocks) return true;
                        }
                    }
                }
                return false;
            });

            if (shouldRescan) {
                scheduleScan();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    function scheduleScan() {
        if (scanTimer) clearTimeout(scanTimer);
        scanTimer = setTimeout(() => {
            if (isDomainExcluded() || isApplyingHighlights) return;
            log('Debounced rescan triggered');
            clearHighlights();
            applyHighlights();
            scanTimer = null;
        }, config.debounceMs);
    }

    // ==================== SETTINGS UI ====================
    function createSettingsPanel() {
        // Remove existing if any
        if (settingsPanel) settingsPanel.remove();

        settingsPanel = document.createElement('div');
        settingsPanel.className = 'ai-highlighter-ui';
        settingsPanel.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            width: 380px;
            max-height: 90vh;
            overflow-y: auto;
            background: #fff;
            border: 1px solid #ccc;
            border-radius: 8px;
            box-shadow: 0 5px 20px rgba(0,0,0,0.3);
            z-index: 2147483646;
            padding: 16px;
            font-family: system-ui, sans-serif;
            font-size: 14px;
            color: #333;
        `;

        let html = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <h3 style="margin:0;">🤖 AI Highlighter Settings</h3>
                <button id="ai-close-settings" style="background:none; border:none; font-size:20px; cursor:pointer;">&times;</button>
            </div>

            <div style="margin-bottom:15px;">
                <label>Global Threshold: <span id="ai-threshold-value">${config.threshold}</span></label>
                <input type="range" id="ai-threshold" min="0" max="100" value="${config.threshold}" style="width:100%;">
            </div>

            <div style="margin-bottom:15px;">
                <label>Rescan Debounce (ms):</label>
                <input type="number" id="ai-debounce" value="${config.debounceMs}" min="100" max="5000" step="100" style="width:80px;">
            </div>

            <div style="margin-bottom:15px;">
                <label style="display:flex; align-items:center;">
                    <input type="checkbox" id="ai-debug" ${config.debug ? 'checked' : ''}> Debug Mode (console logging)
                </label>
            </div>

            <div style="margin-bottom:15px;">
                <label>Excluded Domains (one per line, * wildcard):</label>
                <textarea id="ai-excluded" rows="3" style="width:100%;">${config.excludedDomains.join('\n')}</textarea>
            </div>

            <div style="margin-bottom:15px;">
                <h4 style="margin:10px 0;">Heuristics</h4>
                <div id="ai-heuristics-list"></div>
            </div>

            <div style="display:flex; gap:10px;">
                <button id="ai-exclude-site" style="padding:8px 16px; background:#f44336; color:white; border:none; border-radius:4px; cursor:pointer;">Exclude This Site</button>
                <button id="ai-save-settings" style="padding:8px 16px; background:#4CAF50; color:white; border:none; border-radius:4px; cursor:pointer;">Save & Rescan</button>
                <button id="ai-rescan" style="padding:8px 16px; background:#2196F3; color:white; border:none; border-radius:4px; cursor:pointer;">Rescan Now</button>
            </div>
        `;

        settingsPanel.innerHTML = html;
        document.body.appendChild(settingsPanel);

        // Helper to render heuristic config panel
        function renderHeuristicConfig(name, cfgHeur) {
            const container = document.createElement('div');
            container.style.marginLeft = '25px';
            container.style.marginTop = '5px';
            container.style.padding = '5px';
            container.style.backgroundColor = '#f5f5f5';
            container.style.borderRadius = '4px';
            container.style.display = 'none'; // hidden by default

            const paramNames = Object.keys(cfgHeur).filter(k => k !== 'enabled' && k !== 'weight');
            if (paramNames.length === 0) {
                container.innerHTML = '<em>No adjustable parameters</em>';
                return container;
            }

            paramNames.forEach(param => {
                const value = cfgHeur[param];
                const div = document.createElement('div');
                div.style.marginBottom = '8px';

                const label = document.createElement('label');
                label.style.display = 'block';
                label.style.fontSize = '12px';
                label.textContent = param + ':';

                let input;
                if (typeof value === 'boolean') {
                    input = document.createElement('input');
                    input.type = 'checkbox';
                    input.checked = value;
                    input.dataset.heuristic = name;
                    input.dataset.param = param;
                    input.dataset.type = 'boolean';
                    label.appendChild(input);
                    label.appendChild(document.createTextNode(' Enabled'));
                } else if (typeof value === 'number') {
                    input = document.createElement('input');
                    input.type = 'number';
                    input.value = value;
                    input.step = param.includes('Threshold') || param.includes('Ratio') ? '0.1' : '1';
                    input.min = '0';
                    input.style.width = '80px';
                    input.dataset.heuristic = name;
                    input.dataset.param = param;
                    input.dataset.type = 'number';
                    div.appendChild(label);
                    div.appendChild(input);
                } else if (Array.isArray(value)) {
                    input = document.createElement('textarea');
                    input.value = value.join('\n');
                    input.rows = 3;
                    input.style.width = '100%';
                    input.style.fontSize = '12px';
                    input.dataset.heuristic = name;
                    input.dataset.param = param;
                    input.dataset.type = 'array';
                    div.appendChild(label);
                    div.appendChild(input);
                } else {
                    // fallback string input
                    input = document.createElement('input');
                    input.type = 'text';
                    input.value = value;
                    input.style.width = '100%';
                    input.dataset.heuristic = name;
                    input.dataset.param = param;
                    input.dataset.type = 'string';
                    div.appendChild(label);
                    div.appendChild(input);
                }

                if (input && !(typeof value === 'boolean')) {
                    div.appendChild(input);
                }
                container.appendChild(div);
            });

            return container;
        }

        // Populate heuristics toggles and params
        const heurContainer = document.getElementById('ai-heuristics-list');
        for (const [name, cfgHeur] of Object.entries(config.heuristics)) {
            const div = document.createElement('div');
            div.style.marginBottom = '8px';
            div.style.borderBottom = '1px solid #eee';
            div.style.paddingBottom = '5px';

            const label = document.createElement('label');
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.cursor = 'pointer';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.heuristic = name;
            checkbox.checked = cfgHeur.enabled;
            checkbox.style.marginRight = '6px';

            const span = document.createElement('span');
            span.textContent = formatHeuristicName(name) + ` (weight: ${cfgHeur.weight})`;
            span.style.flex = '1';

            label.appendChild(checkbox);
            label.appendChild(span);
            div.appendChild(label);

            // Add toggle link and config panel
            const toggleLink = document.createElement('a');
            toggleLink.href = '#';
            toggleLink.textContent = '⚙️';
            toggleLink.style.marginLeft = '20px';
            toggleLink.style.fontSize = '12px';
            toggleLink.style.textDecoration = 'none';

            const configPanel = renderHeuristicConfig(name, cfgHeur);
            div.appendChild(configPanel);

            toggleLink.onclick = (e) => {
                e.preventDefault();
                configPanel.style.display = configPanel.style.display === 'none' ? 'block' : 'none';
            };

            div.appendChild(toggleLink);
            heurContainer.appendChild(div);
        }

        // Event listeners
        document.getElementById('ai-threshold').addEventListener('input', e => {
            document.getElementById('ai-threshold-value').textContent = e.target.value;
        });

        document.getElementById('ai-close-settings').addEventListener('click', () => {
            settingsPanel.remove();
            settingsPanel = null;
        });

        document.getElementById('ai-save-settings').addEventListener('click', () => {
            // Gather values
            config.threshold = parseInt(document.getElementById('ai-threshold').value);
            config.debounceMs = parseInt(document.getElementById('ai-debounce').value);
            config.debug = document.getElementById('ai-debug').checked;
            config.excludedDomains = document.getElementById('ai-excluded').value.split('\n').map(s => s.trim()).filter(s => s);

            // Heuristics enabled states
            document.querySelectorAll('#ai-heuristics-list input[type=checkbox]').forEach(cb => {
                const name = cb.dataset.heuristic;
                if (config.heuristics[name]) {
                    config.heuristics[name].enabled = cb.checked;
                }
            });

            // Update advanced heuristic parameters
            document.querySelectorAll('#ai-heuristics-list input[data-heuristic], #ai-heuristics-list textarea[data-heuristic]').forEach(input => {
                const heuristicName = input.dataset.heuristic;
                const paramName = input.dataset.param;
                const type = input.dataset.type;
                let value;
                if (type === 'boolean') {
                    value = input.checked;
                } else if (type === 'number') {
                    value = parseFloat(input.value) || 0;
                } else if (type === 'array') {
                    value = input.value.split('\n').map(s => s.trim()).filter(s => s);
                } else {
                    value = input.value;
                }

                if (config.heuristics[heuristicName]) {
                    config.heuristics[heuristicName][paramName] = value;
                }
            });

            saveConfig();
            log('Config saved', config);

            // Rescan
            clearHighlights();
            applyHighlights();
            settingsPanel.remove();
            settingsPanel = null;
        });

        document.getElementById('ai-rescan').addEventListener('click', () => {
            clearHighlights();
            applyHighlights();
        });

        document.getElementById('ai-exclude-site').addEventListener('click', () => {
            const currentHost = location.hostname;
            if (!config.excludedDomains.includes(currentHost)) {
                config.excludedDomains.push(currentHost);
                document.getElementById('ai-excluded').value = config.excludedDomains.join('\n');
                saveConfig();
                if (config.debug) log(`Added ${currentHost} to excluded domains`);
                clearHighlights();
                settingsPanel.remove();
                settingsPanel = null;
                GM_notification({ text: `AI Highlighter: Excluded ${currentHost}`, timeout: 2000 });
            } else {
                alert('This site is already excluded.');
            }
        });
    }

    function formatHeuristicName(name) {
        return name.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
    }

    // ... (rest of the code remains the same)
    // ==================== INITIALIZATION ====================
    function init() {
        log('Initializing AI Highlighter');

        // UPDATED: Softer highlight color with dark text
        GM_addStyle(`
            .ai-highlight {
                background-color: #fff9c4 !important;
                color: #1e1e1e !important;
                cursor: help !important;
                border-radius: 2px;
                transition: background-color 0.2s;
            }
            .ai-highlight:hover {
                background-color: #fff176 !important;
            }
            .ai-highlighter-tooltip {
                font-family: system-ui, sans-serif !important;
                line-height: 1.4 !important;
            }
        `);

        GM_registerMenuCommand('⚙️ AI Highlighter Settings', () => {
            createSettingsPanel();
        });

        GM_registerMenuCommand('🔍 Rescan Page', () => {
            clearHighlights();
            applyHighlights();
            if (config.debug) GM_notification({ text: 'AI Highlighter: Rescan complete', timeout: 2000 });
        });

        if (!isDomainExcluded()) {
            setTimeout(() => {
                applyHighlights();
                initTooltip();
                startObserver();
            }, 1000);
        } else {
            log('Domain excluded, skipping scan');
        }

        // SPA navigation handling (optional)
        let lastUrl = location.href;
        new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                setTimeout(() => {
                    if (!isDomainExcluded()) {
                        clearHighlights();
                        applyHighlights();
                    }
                }, 1000);
            }
        }).observe(document, { subtree: true, childList: true });
    }

    // Start
    init();
})();