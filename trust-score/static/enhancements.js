/* =========================================================
   ENHANCEMENTS.JS
   - Controls Popup #1 (Welcome) and Popup #2 (Chatbot Spotlight)
   - Re-triggers workflow step animation when it scrolls into view
   ========================================================= */
(function () {
    "use strict";

    var WELCOME_KEY = "trust_score_welcome_shown";
    var SPOTLIGHT_KEY = "trust_score_spotlight_shown";

    var welcomeOverlay = document.getElementById("welcomePopupOverlay");
    var spotlightOverlay = document.getElementById("spotlightPopupOverlay");
    var guideOverlay = document.getElementById("analysisGuideOverlay");

    function show(overlay) {
        if (!overlay) return;
        overlay.classList.remove("tg-hidden", "tg-closing");
    }

    function hide(overlay, after) {
        if (!overlay) return;
        overlay.classList.add("tg-closing");
        setTimeout(function () {
            overlay.classList.add("tg-hidden");
            overlay.classList.remove("tg-closing");
            if (typeof after === "function") after();
        }, 300);
    }

    function maybeShowSpotlight() {
        if (localStorage.getItem(SPOTLIGHT_KEY) === "true") return;
        setTimeout(function () {
            show(spotlightOverlay);
            localStorage.setItem(SPOTLIGHT_KEY, "true");
        }, 900);
    }

    // ---- Popup #1: Welcome ----
    if (welcomeOverlay) {
        if (localStorage.getItem(WELCOME_KEY) !== "true") {
            setTimeout(function () {
                show(welcomeOverlay);
                localStorage.setItem(WELCOME_KEY, "true");
            }, 700);
        } else {
            // Welcome already seen before -> still consider showing spotlight once
            maybeShowSpotlight();
        }

        var welcomeClose = document.getElementById("welcomeCloseBtn");
        var welcomeGetStarted = document.getElementById("welcomeGetStartedBtn");

        function closeWelcome() {
            hide(welcomeOverlay, maybeShowSpotlight);
        }

        welcomeClose && welcomeClose.addEventListener("click", closeWelcome);
        welcomeGetStarted && welcomeGetStarted.addEventListener("click", closeWelcome);
        welcomeOverlay.querySelector(".tg-popup-backdrop") &&
            welcomeOverlay.querySelector(".tg-popup-backdrop").addEventListener("click", closeWelcome);
    }

    // ---- Popup #2: Chatbot spotlight ----
    if (spotlightOverlay) {
        var spotlightClose = document.getElementById("spotlightCloseBtn");
        var spotlightLater = document.getElementById("spotlightLaterBtn");
        var spotlightChat = document.getElementById("spotlightChatBtn");

        function closeSpotlight() {
            hide(spotlightOverlay);
        }

        spotlightClose && spotlightClose.addEventListener("click", closeSpotlight);
        spotlightLater && spotlightLater.addEventListener("click", closeSpotlight);
        spotlightChat && spotlightChat.addEventListener("click", function () {
            hide(spotlightOverlay, function () {
                if (window.TrustScoreChatbot) window.TrustScoreChatbot.open();
            });
        });
        spotlightOverlay.querySelector(".tg-popup-backdrop") &&
            spotlightOverlay.querySelector(".tg-popup-backdrop").addEventListener("click", closeSpotlight);
    }

    // ---- Popup #3: user-requested quick-start guide ----
    if (guideOverlay) {
        var guideTrigger = document.getElementById("analysisGuideTrigger");
        var guideClose = document.getElementById("analysisGuideClose");
        var guideStart = document.getElementById("analysisGuideStart");

        function closeGuide() { hide(guideOverlay); }

        guideTrigger && guideTrigger.addEventListener("click", function () { show(guideOverlay); });
        guideClose && guideClose.addEventListener("click", closeGuide);
        guideOverlay.querySelector(".tg-popup-backdrop") &&
            guideOverlay.querySelector(".tg-popup-backdrop").addEventListener("click", closeGuide);
        guideStart && guideStart.addEventListener("click", function () {
            hide(guideOverlay, function () {
                var input = document.getElementById("urlInput");
                if (input) {
                    input.scrollIntoView({ behavior: "smooth", block: "center" });
                    setTimeout(function () { input.focus(); }, 350);
                }
            });
        });
    }

    document.addEventListener("keydown", function (event) {
        if (event.key !== "Escape") return;
        if (guideOverlay && !guideOverlay.classList.contains("tg-hidden")) hide(guideOverlay);
        else if (spotlightOverlay && !spotlightOverlay.classList.contains("tg-hidden")) hide(spotlightOverlay);
        else if (welcomeOverlay && !welcomeOverlay.classList.contains("tg-hidden")) hide(welcomeOverlay);
    });

    // ---- Workflow showcase: re-play the step animation whenever it scrolls into view ----
    var workflowSection = document.getElementById("workflowShowcase");
    if (workflowSection && "IntersectionObserver" in window) {
        var steps = workflowSection.querySelectorAll(".workflow-step");
        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    steps.forEach(function (step) {
                        step.style.animation = "none";
                        // force reflow so the animation can be restarted
                        void step.offsetWidth;
                        step.style.animation = "";
                    });
                }
            });
        }, { threshold: 0.3 });
        observer.observe(workflowSection);
    }
})();
