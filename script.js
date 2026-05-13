// ==UserScript==
// @name         AI Detector
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Highlight likely AI-generated text using simple marker patterns
// @author       anrinion
// @license      MIT
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  // ---------- PERSISTENT EXCLUDED DOMAINS ----------
  function loadExcludedDomains() {
    try {
      const saved = GM_getValue("aiHighlighterExcludedDomains", "[]");
      return JSON.parse(saved);
    } catch (e) {
      return [];
    }
  }

  function saveExcludedDomains(domains) {
    GM_setValue("aiHighlighterExcludedDomains", JSON.stringify(domains));
  }

  let excludedDomains = loadExcludedDomains();

  function isDomainExcluded() {
    const host = location.hostname;
    return excludedDomains.some((pattern) => {
      const regexPattern = pattern.replace(/\./g, "\\.").replace(/\*/g, ".*");
      return new RegExp(`^${regexPattern}$`, "i").test(host);
    });
  }

  // ----------  AI MARKERS (with labels) ----------
  const AI_MARKERS = [
    {
      pattern:
        /\b(delve|tapestry|testament|realm|pivotal|vibrant|unleash|unlock|robust|seamless)\b/i,
      label: "high-risk vocabulary",
    },
    {
      pattern:
        /\b(operational excellence|strategic alignment|in today's digital age|brilliant)\b/i,
      label: "high-risk phrase",
    },
    { pattern: /as an ai language model/i, label: "AI disclaimer" },
    {
      pattern: /as of my last knowledge update/i,
      label: "AI knowledge cutoff phrase",
    },
    { pattern: /it is important to note that/i, label: "hedging phrase" },
    {
      pattern: /I hope this (?:email )?finds you well/i,
      label: "generic email opening",
    },
    {
      pattern: /if you have any (?:further )?questions/i,
      label: "customer service template",
    },
    {
      pattern:
        /\b(a recent study|many people|experts say|research shows|it is widely believed|some argue)\b/i,
      label: "vague attribution",
    },
    { pattern: /—/, label: "em dash" },
    { pattern: /```/, label: "triple backticks (code block)" },
    { pattern: /[«»]/, label: "guillemets" },
  ];

  // Only these emojis are considered “human”; everything else is an AI marker.
  const HUMAN_EMOJIS = new Set([
    "😅",
    "😭",
    "💀",
    "😊",
    "👌",
    "👍",
    "😢",
    "🤦‍♂️",
    "😎",
    "😐",
    "🙂",
    "😑",
    "😶",
    "🙄",
    "😝",
    "🫠",
    "😱",
    "🥳",
    "🤮",
    "🤭",
    "🧐",
    "❤️",
    "👀",
    "🤗",
    "🤣",
    "😮",
    "🥱",
    "😞",
    "🙈",
  ]);

  // Returns the reason (string) if an AI marker is found, otherwise null.
  function getAIMarkerReason(text) {
    // Check each text-based pattern
    for (const { pattern, label } of AI_MARKERS) {
      if (pattern.test(text)) {
        const match = text.match(pattern);
        const sample = match ? match[0] : "";
        return sample ? `${label}: “${escapeHtml(sample)}”` : label;
      }
    }

    // Inverted emoji check: any emoji NOT in the human set is suspected AI.
    const emojiList = text.match(/\p{Emoji_Presentation}/gu);
    if (emojiList) {
      for (const emoji of emojiList) {
        if (!HUMAN_EMOJIS.has(emoji)) {
          return `non-human emoji (${emoji})`;
        }
      }
    }

    return null;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------- BLOCK PROCESSING ----------
  function getBlockElements() {
    const selectors =
      "p, div, li, blockquote, h1, h2, h3, h4, h5, h6, section, article, td, th";
    const elements = document.querySelectorAll(selectors);
    const candidates = Array.from(elements).filter((el) => {
      const text = el.innerText?.trim() || "";
      if (text.length < 30) return false;
      if (el.closest(".ai-highlighter-ui, .ai-highlight")) return false;
      return true;
    });
    // Keep only leaf blocks (those that don't contain other candidates)
    return candidates.filter(
      (el) => !candidates.some((c) => c !== el && el.contains(c)),
    );
  }

  function clearHighlights() {
    document.querySelectorAll(".ai-highlight").forEach((el) => {
      const parent = el.parentNode;
      while (el.firstChild) {
        parent.insertBefore(el.firstChild, el);
      }
      parent.removeChild(el);
      parent.normalize();
    });
  }

  let applying = false;
  function applyHighlights() {
    if (isDomainExcluded() || applying) return;
    applying = true;
    try {
      const blocks = getBlockElements();
      blocks.forEach((block) => {
        const reason = getAIMarkerReason(block.innerText);
        if (reason) {
          const wrapper = document.createElement("span");
          wrapper.className = "ai-highlight";
          wrapper.setAttribute("data-ai-reason", reason);
          while (block.firstChild) {
            wrapper.appendChild(block.firstChild);
          }
          block.appendChild(wrapper);
        }
      });
    } finally {
      applying = false;
    }
  }

  // ---------- TOOLTIP WITH REASON ----------
  function initTooltip() {
    const tooltip = document.createElement("div");
    tooltip.className = "ai-highlighter-tooltip";
    tooltip.style.cssText = `
            position: fixed;
            background: #333;
            color: #fff;
            padding: 6px 10px;
            border-radius: 4px;
            font-size: 13px;
            max-width: 350px;
            z-index: 2147483647;
            pointer-events: none;
            display: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
            line-height: 1.3;
        `;
    document.body.appendChild(tooltip);

    document.addEventListener("mouseover", (e) => {
      const target = e.target.closest(".ai-highlight");
      if (!target) {
        tooltip.style.display = "none";
        return;
      }
      const reason = target.getAttribute("data-ai-reason") || "";
      tooltip.innerHTML = `<strong> Likely AI-generated</strong><br><span style="font-size:11px;color:#ccc;">${escapeHtml(reason)}</span>`;
      tooltip.style.display = "block";
    });
    document.addEventListener("mousemove", (e) => {
      if (tooltip.style.display === "block") {
        tooltip.style.left = e.clientX + 12 + "px";
        tooltip.style.top = e.clientY + 12 + "px";
      }
    });
    document.addEventListener("mouseout", (e) => {
      if (e.target.closest(".ai-highlight")) tooltip.style.display = "none";
    });
  }

  // ---------- MUTATION OBSERVER ----------
  let scanTimer = null;
  function scheduleRescan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      if (isDomainExcluded() || applying) return;
      clearHighlights();
      applyHighlights();
    }, 2000);
  }

  function startObserver() {
    const observer = new MutationObserver((mutations) => {
      if (applying) return;
      const shouldRescan = mutations.some((m) => {
        if (m.type !== "childList") return false;
        if (m.target.closest?.(".ai-highlighter-ui, .ai-highlight"))
          return false;
        for (let node of m.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.closest?.(".ai-highlighter-ui, .ai-highlight")) continue;
            if (node.querySelector) {
              const hasText = node.querySelector(
                "p, div, li, blockquote, h1, h2, h3, h4, h5, h6",
              );
              if (hasText) return true;
            }
          }
        }
        return false;
      });
      if (shouldRescan) scheduleRescan();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ---------- MENU COMMANDS ----------
  GM_registerMenuCommand("Rescan page", () => {
    clearHighlights();
    applyHighlights();
    GM_notification({ text: "AI Highlighter: Rescan complete", timeout: 2000 });
  });

  GM_registerMenuCommand("Exclude this site", () => {
    const host = location.hostname;
    if (!excludedDomains.includes(host)) {
      excludedDomains.push(host);
      saveExcludedDomains(excludedDomains);
      clearHighlights();
      GM_notification({
        text: `AI Highlighter: Excluded ${host}`,
        timeout: 2500,
      });
    } else {
      GM_notification({ text: `${host} is already excluded`, timeout: 2000 });
    }
  });

  // ---------- INITIALIZATION ----------
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
        }
    `);

  if (!isDomainExcluded()) {
    setTimeout(() => {
      applyHighlights();
      initTooltip();
      startObserver();
    }, 800);
  }

  // Handle SPA navigation
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => {
        if (!isDomainExcluded()) {
          clearHighlights();
          applyHighlights();
        }
      }, 800);
    }
  }).observe(document, { subtree: true, childList: true });
})();
