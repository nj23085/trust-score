/**
 * TrusKaro Analytics Helper
 * Simple wrapper functions for Google Analytics tracking
 */

class TrusKaroAnalytics {
    /**
     * Track product analysis submission
     */
    static trackAnalysisSubmit(platform, productUrl) {
        gtag('event', 'product_analysis_submit', {
            'platform': platform,  // amazon, flipkart, myntra
            'url_length': productUrl?.length || 0,
            'timestamp': new Date().toISOString()
        });
        console.log(`[Analytics] Analysis submitted for ${platform}`);
    }

    /**
     * Track analysis completion
     */
    static trackAnalysisComplete(platform, trustScore, totalReviews, fakeCount) {
        gtag('event', 'analysis_complete', {
            'platform': platform,
            'trust_score': trustScore,
            'total_reviews': totalReviews,
            'fake_reviews': fakeCount,
            'genuine_reviews': totalReviews - fakeCount,
            'fake_percentage': Math.round((fakeCount / totalReviews) * 100)
        });
        console.log(`[Analytics] Analysis complete - Trust Score: ${trustScore}`);
    }

    /**
     * Track tab view/navigation
     */
    static trackTabView(tabName, platform = null) {
        gtag('event', 'view_analysis_tab', {
            'tab_name': tabName,
            'platform': platform
        });
        console.log(`[Analytics] Viewed tab: ${tabName}`);
    }

    /**
     * Track platform selection
     */
    static trackPlatformSelect(platform) {
        gtag('event', 'select_platform', {
            'platform': platform
        });
        console.log(`[Analytics] Platform selected: ${platform}`);
    }

    /**
     * Track chart/graph interactions
     */
    static trackChartInteraction(chartType, action) {
        gtag('event', 'chart_interaction', {
            'chart_type': chartType,  // volume, length, distribution, price
            'action': action  // hover, click, zoom
        });
    }

    /**
     * Track trust score hover/click
     */
    static trackTrustScoreInteraction(trustScore, action = 'view') {
        gtag('event', 'trust_score_interaction', {
            'trust_score': trustScore,
            'action': action  // view, click, hover
        });
    }

    /**
     * Track product comparison/price check
     */
    static trackPriceComparison(platforms = []) {
        gtag('event', 'price_comparison', {
            'platforms_compared': platforms.join(','),
            'platform_count': platforms.length
        });
        console.log(`[Analytics] Price comparison: ${platforms.join(', ')}`);
    }

    /**
     * Track similar product view
     */
    static trackSimilarProductView(productCount) {
        gtag('event', 'view_similar_products', {
            'similar_products_shown': productCount
        });
    }

    /**
     * Track external link click
     */
    static trackExternalLink(url, platform) {
        gtag('event', 'click_external_link', {
            'url': url,
            'platform': platform
        });
        console.log(`[Analytics] Clicked external link: ${platform}`);
    }

    /**
     * Track search/filter action
     */
    static trackSearch(query, filters = {}) {
        gtag('event', 'search_performed', {
            'search_query': query,
            'filters_applied': JSON.stringify(filters)
        });
    }

    /**
     * Track error occurrence
     */
    static trackError(errorType, errorMessage) {
        gtag('event', 'error_occurred', {
            'error_type': errorType,
            'error_message': errorMessage
        });
        console.error(`[Analytics] Error tracked: ${errorType} - ${errorMessage}`);
    }

    /**
     * Track time spent on page
     */
    static trackTimeSpent(pageSection, timeInSeconds) {
        gtag('event', 'time_spent', {
            'page_section': pageSection,
            'duration_seconds': timeInSeconds
        });
    }

    /**
     * Track page performance
     */
    static trackPagePerformance() {
        if (window.performance && window.performance.timing) {
            const perfData = window.performance.timing;
            const pageLoadTime = perfData.loadEventEnd - perfData.navigationStart;
            
            gtag('event', 'page_performance', {
                'page_load_time_ms': pageLoadTime,
                'dom_ready_ms': perfData.domContentLoadedEventEnd - perfData.navigationStart
            });
            console.log(`[Analytics] Page load time: ${pageLoadTime}ms`);
        }
    }

    /**
     * Track user scroll depth
     */
    static trackScrollDepth(depth) {
        gtag('event', 'scroll_depth', {
            'scroll_percentage': depth
        });
    }

    /**
     * Track conversion (e.g., bookmark, share)
     */
    static trackConversion(conversionType, value = null) {
        gtag('event', 'conversion', {
            'conversion_type': conversionType,  // bookmark, share, download, etc
            'value': value
        });
        console.log(`[Analytics] Conversion tracked: ${conversionType}`);
    }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TrusKaroAnalytics;
}
