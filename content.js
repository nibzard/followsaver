// ABOUTME: Content script that injects the main world script and communicates with background
// ABOUTME: Listens for custom events from the injected script and forwards following/followers data to background

(function() {
    'use strict';
    
    console.log('FollowSaver: Content script loaded');
    
    // Check if we're on a following or followers page
    if (window.location.pathname.includes('/following') || window.location.pathname.includes('/followers')) {
        const pageType = window.location.pathname.includes('/following') ? 'following' : 'followers';
        console.log(`FollowSaver: On ${pageType} page, injecting script`);
        
        // Inject script into main world with cache busting
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('injected.js') + '?t=' + Date.now();
        script.onload = function() {
            console.log('FollowSaver: Injected script loaded with timestamp:', Date.now());
            this.remove();
        };
        script.onerror = function() {
            console.error('FollowSaver: Failed to load injected script');
        };
        
        // Inject as soon as possible
        if (document.documentElement) {
            document.documentElement.appendChild(script);
        } else {
            document.addEventListener('DOMContentLoaded', () => {
                document.documentElement.appendChild(script);
            });
        }
        
        // Listen for custom events from injected script
        window.addEventListener('X_USER_DATA', function(event) {
            const { users, url, dataType } = event.detail;
            console.log(`FollowSaver: Content script received ${users.length} ${dataType} users from injected script`);
            
            // Check if extension context is still valid
            if (!chrome.runtime?.id) {
                console.warn('FollowSaver: Extension context invalidated, cannot send data to background');
                return;
            }
            
            // Send to background script with error handling
            try {
                chrome.runtime.sendMessage({
                    type: 'STORE_USER_DATA',
                    users: users,
                    url: url,
                    dataType: dataType
                }).then(response => {
                    if (chrome.runtime.lastError) {
                        console.error('FollowSaver: Runtime error:', chrome.runtime.lastError);
                        return;
                    }
                    console.log(`FollowSaver: ${dataType} data sent to background script`, response);
                }).catch(error => {
                    if (error.message?.includes('Extension context invalidated')) {
                        console.warn('FollowSaver: Extension was reloaded, skipping data send');
                    } else {
                        console.error(`FollowSaver: Error sending ${dataType} data to background script:`, error);
                    }
                });
            } catch (error) {
                console.error('FollowSaver: Failed to send message:', error);
            }
        });
        
        // Notify background script of current page type for badge updates
        if (chrome.runtime?.id) {
            try {
                chrome.runtime.sendMessage({
                    type: 'PAGE_TYPE_UPDATE',
                    pageType: pageType,
                    url: window.location.href
                }).catch(error => {
                    if (!error.message?.includes('Extension context invalidated')) {
                        console.error('FollowSaver: Error sending page type update:', error);
                    }
                });
            } catch (error) {
                console.error('FollowSaver: Failed to send page type update:', error);
            }
        }
        
        console.log('FollowSaver: Event listener installed');
    } else {
        console.log('FollowSaver: Not on following/followers page, script not injected');
    }
})();