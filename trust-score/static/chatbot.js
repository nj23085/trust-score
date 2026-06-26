/* =========================================================
   CHATBOT.JS
   A smarter, fully client-side "Help & Support" assistant.
   - No API key, no backend call, never "expires".
   - Uses fuzzy word-overlap matching (not just exact substrings)
     so it understands differently-worded questions too.
   - Knowledge base covers the whole site: workflow, platforms,
     accuracy, extension, privacy, pricing, tech stack, ML
     features, dark mode, recent searches, and contact.
   ========================================================= */
(function () {
    "use strict";

    var STOPWORDS = ["the", "a", "an", "is", "are", "do", "does", "i", "to", "of", "for", "and", "on", "in",
        "it", "this", "that", "what", "how", "can", "you", "your", "my", "me", "with", "about", "be", "will",
        "have", "has", "or", "if", "as", "at", "from", "so", "there"];

    function tokenize(str) {
        return str
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter(function (w) { return w.length > 1 && STOPWORDS.indexOf(w) === -1; });
    }

    // Each entry: keywords = phrases/words that should trigger this answer.
    var KB = [
        {
            keywords: ["what is trust score", "what is trust-score", "what is this site", "what does this do", "about this project", "purpose"],
            answer: "Trust-Score is an AI-powered system that detects fake, paid, or misleading product reviews on Amazon, Flipkart, and Myntra — so you can shop with confidence. Paste a product link and we'll analyze its reviews for you. \"Check Karo Phir Buy Karo\" 🙂"
        },
        {
            keywords: ["how does it work", "how it works", "how does trust score work", "process", "workflow", "steps"],
            answer: "It's a 4-step pipeline: 1) Paste a product URL, 2) Our Chrome extension scrapes the live reviews from that exact page, 3) An AI/NLP model classifies each review as genuine, paid, or fake, 4) You get a trust score, charts, and a verdict for every single review. You can see this animated at the top of the homepage."
        },
        {
            keywords: ["which platform", "supported platform", "amazon", "flipkart", "myntra", "which sites", "which websites", "ecommerce sites"],
            answer: "We currently support India's top 3 e-commerce platforms: Amazon, Flipkart, and Myntra. Paste a product link from any of these and we auto-detect the platform for you."
        },
        {
            keywords: ["accuracy", "accurate", "how good is it", "reliable", "trustworthy", "precision"],
            answer: "Our machine learning model is trained on large labelled review datasets and achieves around 98% accuracy in separating genuine reviews from fake or paid ones."
        },
        {
            keywords: ["extension", "chrome extension", "install extension", "add to chrome", "plugin", "extension required", "extension not working", "extension not detected"],
            answer: "Trust-Score uses a small Chrome extension to scrape live reviews directly from the product page, since e-commerce sites block this from a regular server. Install it once from the Chrome Web Store (link in the banner at the top) and it works automatically every time you analyze a product. If it's not detected, try refreshing the page after installing."
        },
        {
            keywords: ["free", "cost", "price", "pricing", "pay", "subscription", "charges"],
            answer: "Trust-Score is completely free to use — paste any supported product link and get your trust score instantly, no sign-up needed."
        },
        {
            keywords: ["safe", "privacy", "data", "store my data", "personal information", "security", "gdpr"],
            answer: "We only analyze publicly visible product reviews and never ask for personal or account information. Full details are in our Privacy Policy (open it from the sidebar menu ☰)."
        },
        {
            keywords: ["fake percentage", "fake review", "what does the percentage mean", "score mean", "verdict", "trust score meaning", "results meaning"],
            answer: "Every analyzed review is classified as genuine or fake by our model. The \"fake %\" is the share of reviews flagged as fake or suspicious for that product — the higher it is, the more cautious you should be before buying."
        },
        {
            keywords: ["dark mode", "theme", "light mode", "night mode"],
            answer: "Toggle between light and dark mode anytime using the moon/sun icon at the top-right of the header."
        },
        {
            keywords: ["recent search", "history", "saved searches", "past products"],
            answer: "Your recently analyzed products are saved locally in your own browser and shown in the sidebar under \"Recent Searches\" — open the menu icon (☰) at the top-left to see them. Nothing is uploaded to a server."
        },
        {
            keywords: ["tech stack", "technology used", "built with", "programming language", "framework"],
            answer: "Trust-Score is built with Python & Flask on the backend, Scikit-learn for the ML model, NLP/TF-IDF for text features, Selenium-based scraping via the Chrome extension, and Chart.js/Highcharts for the result visualizations."
        },
        {
            keywords: ["ml feature", "machine learning model", "what features does the model use", "how does the ai detect fake reviews", "model details", "algorithm"],
            answer: "The model looks at things like word-level & character-level TF-IDF patterns, review length and word count, exclamation/uppercase ratio, unique-word ratio, star rating vs. verified-purchase signals, review \"burst\" timing, and helpful-vote counts to flag suspicious reviews."
        },
        {
            keywords: ["no reviews found", "no reviews", "empty result", "didn't work", "error", "not working", "broken", "failed"],
            answer: "If no reviews were found, make sure the Chrome extension is installed and the product page was fully loaded before you clicked Analyze. Some products may also genuinely have very few reviews. If the issue continues, our support team can help — want me to open Help & Support?"
        },
        {
            keywords: ["terms", "terms and conditions", "terms of use"],
            answer: "You can read our full Terms & Conditions from the sidebar menu (☰) → \"Terms of Use\", or visit the /terms page."
        },
        {
            keywords: ["who made this", "who built this", "developer", "creator", "open source", "source code"],
            answer: "Trust-Score is an independent project built to help shoppers spot fake reviews using AI. For specific questions about the codebase, our support team can connect you with the right person."
        },
        {
            keywords: ["hi", "hello", "hey", "yo", "hii", "good morning", "good evening"],
            answer: "Hey there! 👋 I'm the Trust-Score Assistant. Ask me anything about how the site works, supported platforms, accuracy, privacy, or the Chrome extension."
        },
        {
            keywords: ["thank", "thanks", "thank you", "appreciate"],
            answer: "You're welcome! Happy (and safe) shopping. 🛍️"
        },
        {
            keywords: ["bye", "goodbye", "see you", "exit", "close chat"],
            answer: "Goodbye! Feel free to reopen this chat anytime if you have more questions. 👋"
        },
        {
            keywords: ["contact", "support", "email", "human", "talk to someone", "complaint", "reach you", "customer care"],
            answer: "Sure — I'll open our Help & Support panel so you can reach our team directly by email (supporttrustscore@gmail.com). We typically reply within 24 hours."
        }
    ];

    // Pre-tokenize the KB once for speed
    KB.forEach(function (entry) {
        entry._tokenSets = entry.keywords.map(tokenize);
    });

    var QUICK_REPLIES = [
        "How does it work?",
        "Which platforms are supported?",
        "Is it free?",
        "Do I need the extension?",
        "Is my data safe?",
        "What tech is this built with?",
        "Contact support"
    ];

    var FALLBACK = "I'm not 100% sure about that one — but our human support team can help! I'll open the Help & Support panel for you (supporttrustscore@gmail.com).";

    var launcher = document.getElementById("tscLauncher");
    var launcherBadge = document.getElementById("tscLauncherBadge");
    var win = document.getElementById("tscWindow");
    var closeBtn = document.getElementById("tscClose");
    var messagesEl = document.getElementById("tscMessages");
    var quickRepliesEl = document.getElementById("tscQuickReplies");
    var form = document.getElementById("tscForm");
    var input = document.getElementById("tscInput");

    if (!launcher || !win) return; // widget not present on this page

    var hasGreeted = false;

    function scrollToBottom() {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function addMessage(text, sender) {
        var bubble = document.createElement("div");
        bubble.className = "tsc-msg " + sender;
        bubble.textContent = text;
        messagesEl.appendChild(bubble);
        scrollToBottom();
    }

    function showTyping() {
        var typing = document.createElement("div");
        typing.className = "tsc-typing";
        typing.innerHTML = "<span></span><span></span><span></span>";
        messagesEl.appendChild(typing);
        scrollToBottom();
        return typing;
    }

    function removeTyping(node) {
        if (node && node.parentNode) node.parentNode.removeChild(node);
    }

    function renderQuickReplies() {
        quickRepliesEl.innerHTML = "";
        QUICK_REPLIES.forEach(function (q) {
            var chip = document.createElement("button");
            chip.type = "button";
            chip.className = "tsc-chip";
            chip.textContent = q;
            chip.addEventListener("click", function () { handleUserMessage(q); });
            quickRepliesEl.appendChild(chip);
        });
    }

    // Fuzzy match: exact phrase match scores highest, partial word-overlap still counts.
    function findAnswer(text) {
        var lower = " " + text.toLowerCase() + " ";
        var queryTokens = tokenize(text);
        var querySet = {};
        queryTokens.forEach(function (t) { querySet[t] = true; });

        var best = null;
        var bestScore = 0;

        KB.forEach(function (entry) {
            var score = 0;
            entry.keywords.forEach(function (kw, i) {
                if (lower.indexOf(" " + kw + " ") !== -1 || lower.indexOf(kw) !== -1) {
                    score += kw.split(" ").length * 3; // strong signal: exact phrase present
                } else {
                    var overlap = 0;
                    entry._tokenSets[i].forEach(function (t) {
                        if (querySet[t]) overlap++;
                    });
                    score += overlap;
                }
            });
            if (score > bestScore) {
                bestScore = score;
                best = entry;
            }
        });

        return bestScore >= 1 ? best.answer : null;
    }

    function handleUserMessage(text) {
        text = text.trim();
        if (!text) return;
        addMessage(text, "user");
        input.value = "";

        var typingNode = showTyping();
        var answer = findAnswer(text);
        var isFallback = !answer;
        var finalAnswer = answer || FALLBACK;
        var wantsHuman = /contact|support|human|email|complaint|customer care/i.test(text);

        setTimeout(function () {
            removeTyping(typingNode);
            addMessage(finalAnswer, "bot");
            if (isFallback || wantsHuman) {
                // Re-use the site's existing Help & Support modal when available
                window.dispatchEvent(new CustomEvent("openHelpSupport"));
            }
        }, 500 + Math.random() * 400);
    }

    function greetIfNeeded() {
        if (hasGreeted) return;
        hasGreeted = true;
        var typingNode = showTyping();
        setTimeout(function () {
            removeTyping(typingNode);
            addMessage("Hi! 👋 I'm the Trust-Score Assistant. Ask me anything about how the site works, or tap a quick question below.", "bot");
            renderQuickReplies();
        }, 450);
    }

    function openChat() {
        win.classList.remove("tsc-hidden");
        if (launcherBadge) launcherBadge.classList.add("tsc-hidden");
        greetIfNeeded();
        setTimeout(function () { input && input.focus(); }, 200);
    }

    function closeChat() {
        win.classList.add("tsc-hidden");
    }

    launcher.addEventListener("click", function () {
        if (win.classList.contains("tsc-hidden")) openChat();
        else closeChat();
    });

    closeBtn && closeBtn.addEventListener("click", closeChat);

    form && form.addEventListener("submit", function (e) {
        e.preventDefault();
        handleUserMessage(input.value);
    });

    // Expose a tiny public API so other scripts (e.g. the spotlight popup) can open the chat
    window.TrustScoreChatbot = {
        open: openChat,
        close: closeChat
    };
})();