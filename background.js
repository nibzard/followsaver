// ABOUTME: Background service worker for FollowSaver extension
// ABOUTME: Handles data storage, deduplication, and management of collected following and followers data

// Storage management constants
const STORAGE_LIMITS = {
    MAX_USERS_PER_ACCOUNT: 10000,     // Maximum users per account (following or followers)
    MAX_TOTAL_USERS: 50000,           // Maximum total users across all accounts
    MAX_STORAGE_BYTES: 5 * 1024 * 1024, // 5MB storage limit (Chrome's limit is ~10MB)
    WARNING_THRESHOLD: 0.8             // Warn when 80% of limits reached
};

// Get estimated storage size
async function getStorageSize() {
    try {
        const data = await chrome.storage.local.get(null);
        const jsonString = JSON.stringify(data);
        return jsonString.length;
    } catch (error) {
        console.error('Error calculating storage size:', error);
        return 0;
    }
}

// Check if storage limits would be exceeded
async function checkStorageLimits(targetUser, pageType, newUsersCount) {
    const result = await chrome.storage.local.get(['userData']);
    const existingData = result.userData || {};
    
    // Check per-account limit
    const currentAccountUsers = existingData[targetUser]?.[pageType] 
        ? Object.keys(existingData[targetUser][pageType]).length 
        : 0;
    
    if (currentAccountUsers + newUsersCount > STORAGE_LIMITS.MAX_USERS_PER_ACCOUNT) {
        console.warn(`FollowSaver: Approaching account limit for @${targetUser} ${pageType}`);
        return {
            allowed: false,
            reason: `Account limit reached (${STORAGE_LIMITS.MAX_USERS_PER_ACCOUNT} users max)`
        };
    }
    
    // Check total users limit
    let totalUsers = 0;
    for (const user in existingData) {
        totalUsers += Object.keys(existingData[user].following || {}).length;
        totalUsers += Object.keys(existingData[user].followers || {}).length;
    }
    
    if (totalUsers + newUsersCount > STORAGE_LIMITS.MAX_TOTAL_USERS) {
        console.warn('FollowSaver: Approaching total storage limit');
        return {
            allowed: false,
            reason: `Total storage limit reached (${STORAGE_LIMITS.MAX_TOTAL_USERS} users max)`
        };
    }
    
    // Check storage size limit
    const currentSize = await getStorageSize();
    if (currentSize > STORAGE_LIMITS.MAX_STORAGE_BYTES * STORAGE_LIMITS.WARNING_THRESHOLD) {
        console.warn(`FollowSaver: Storage size warning: ${(currentSize / 1024 / 1024).toFixed(2)}MB used`);
        
        if (currentSize > STORAGE_LIMITS.MAX_STORAGE_BYTES) {
            return {
                allowed: false,
                reason: 'Storage size limit reached (5MB max)'
            };
        }
    }
    
    return { allowed: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'STORE_USER_DATA') {
        storeUserData(message.users, message.url, message.dataType);
        sendResponse({ success: true });
    } else if (message.type === 'GET_USER_DATA') {
        getUserData().then(data => {
            sendResponse({ data });
        });
        return true; // Keep message channel open for async response
    } else if (message.type === 'CLEAR_USER_DATA') {
        clearUserData().then(() => {
            sendResponse({ success: true });
        });
        return true;
    } else if (message.type === 'PAGE_TYPE_UPDATE') {
        updateBadgeForPageType(message.pageType, message.url, sender.tab.id);
        sendResponse({ success: true });
    } else if (message.type === 'RECORD_VIEW_STATE') {
        recordViewState().then(() => {
            sendResponse({ success: true });
        });
        return true;
    }
});

async function storeUserData(newUsers, url, dataType) {
    try {
        // Extract username and type from URL first for limit checking
        const urlMatch = url.match(/x\.com\/([^\/]+)\/(following|followers)/);
        const targetUser = urlMatch ? urlMatch[1] : 'unknown';
        const pageType = urlMatch ? urlMatch[2] : dataType;
        
        // Check storage limits before processing
        const limitsCheck = await checkStorageLimits(targetUser, pageType, newUsers.length);
        if (!limitsCheck.allowed) {
            console.error(`FollowSaver: Storage limit exceeded - ${limitsCheck.reason}`);
            // Notify user about storage limit via badge
            chrome.action.setBadgeText({ text: '!' });
            chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
            chrome.action.setTitle({ 
                title: `FollowSaver: ${limitsCheck.reason}. Please export and clear data.` 
            });
            return; // Stop storing new data
        }
        
        // Get existing data
        const result = await chrome.storage.local.get(['userData', 'lastUpdated', 'viewingState']);
        const existingData = result.userData || {};
        const lastUpdated = result.lastUpdated || {};
        const viewingState = result.viewingState || { lastViewedAt: null, lastViewedCounts: {} };
        
        // Initialize data structure for this user if it doesn't exist
        if (!existingData[targetUser]) {
            existingData[targetUser] = {
                following: {},
                followers: {}
            };
        }
        
        // Ensure both following and followers objects exist
        if (!existingData[targetUser].following) existingData[targetUser].following = {};
        if (!existingData[targetUser].followers) existingData[targetUser].followers = {};
        
        // Filter and validate new users before storing
        const validUsers = newUsers.filter(user => {
            // Validate user data structure
            if (!user || !user.id || typeof user.id !== 'string') {
                console.warn('FollowSaver: Skipping invalid user data');
                return false;
            }
            return true;
        });
        
        // Merge new users with existing data (deduplicate by user ID)
        validUsers.forEach(user => {
            // Defensive data merging with validation
            try {
                existingData[targetUser][pageType][user.id] = {
                    ...existingData[targetUser][pageType][user.id], // Keep existing data
                    ...user, // Overwrite with new data
                    lastSeen: new Date().toISOString()
                };
            } catch (mergeError) {
                console.error('FollowSaver: Error merging user data:', mergeError);
            }
        });
        
        // Update last collection timestamp for this user and data type
        if (!lastUpdated[targetUser]) lastUpdated[targetUser] = {};
        lastUpdated[targetUser][pageType] = new Date().toISOString();
        
        // Store updated data with error handling
        await chrome.storage.local.set({
            userData: existingData,
            lastUpdated: lastUpdated,
            viewingState: viewingState
        }).catch(error => {
            console.error('FollowSaver: Chrome storage error:', error);
            throw error;
        });
        
        // Log storage info
        const userCount = Object.keys(existingData[targetUser][pageType]).length;
        console.log(`Background: Stored ${newUsers.length} new ${pageType} users for @${targetUser}. Total: ${userCount} ${pageType} users.`);
        
        // Update badge for all tabs currently viewing this user's page
        updateBadgeForUser(targetUser, pageType);
        
        // Update notification badges for other tabs
        updateNotificationBadges();
        
    } catch (error) {
        console.error('Error storing user data:', error);
    }
}

// Clean up old data to manage memory
async function cleanupOldData(daysToKeep = 30) {
    try {
        const result = await chrome.storage.local.get(['userData', 'lastUpdated']);
        const userData = result.userData || {};
        const lastUpdated = result.lastUpdated || {};
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        const cutoffISO = cutoffDate.toISOString();
        
        let removedCount = 0;
        
        // Clean up old user data
        for (const account in userData) {
            for (const type in userData[account]) {
                if (type === 'following' || type === 'followers') {
                    for (const userId in userData[account][type]) {
                        const userEntry = userData[account][type][userId];
                        // Remove entries older than cutoff date
                        if (userEntry.lastSeen && userEntry.lastSeen < cutoffISO) {
                            delete userData[account][type][userId];
                            removedCount++;
                        }
                    }
                }
            }
        }
        
        if (removedCount > 0) {
            await chrome.storage.local.set({ userData, lastUpdated });
            console.log(`FollowSaver: Cleaned up ${removedCount} old entries`);
        }
        
        return removedCount;
    } catch (error) {
        console.error('Error cleaning up old data:', error);
        return 0;
    }
}

async function getUserData() {
    try {
        const result = await chrome.storage.local.get(['userData', 'lastUpdated', 'viewingState']);
        return {
            userData: result.userData || {},
            lastUpdated: result.lastUpdated || {},
            viewingState: result.viewingState || { lastViewedAt: null, lastViewedCounts: {} }
        };
    } catch (error) {
        console.error('Error getting user data:', error);
        return { userData: {}, lastUpdated: {}, viewingState: { lastViewedAt: null, lastViewedCounts: {} } };
    }
}

async function clearUserData() {
    try {
        await chrome.storage.local.clear();
        chrome.action.setBadgeText({ text: '' });
        console.log('Background: All user data cleared');
    } catch (error) {
        console.error('Error clearing user data:', error);
    }
}

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
    console.log('FollowSaver extension installed');
    chrome.action.setBadgeText({ text: '' });
    
    // Set up periodic cleanup (runs every 24 hours)
    chrome.alarms.create('cleanup', { periodInMinutes: 24 * 60 });
});

// Handle periodic cleanup
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'cleanup') {
        console.log('FollowSaver: Running periodic cleanup');
        cleanupOldData(30); // Keep data for 30 days
    }
});

async function updateBadgeForPageType(pageType, url, tabId) {
    try {
        const data = await getUserData();
        
        // Extract username from URL
        const urlMatch = url.match(/x\.com\/([^\/]+)\/(following|followers)/);
        const targetUser = urlMatch ? urlMatch[1] : null;
        
        if (!targetUser || !data.userData[targetUser]) {
            chrome.action.setBadgeText({ text: '', tabId });
            return;
        }
        
        const accountData = data.userData[targetUser];
        let count = 0;
        let color = '#1DA1F2'; // Default blue
        
        if (pageType === 'following' && accountData.following) {
            count = Object.keys(accountData.following).length;
            color = '#1DA1F2'; // Blue for following
        } else if (pageType === 'followers' && accountData.followers) {
            count = Object.keys(accountData.followers).length;
            color = '#22C55E'; // Green for followers
        }
        
        chrome.action.setBadgeText({
            text: formatBadgeNumber(count),
            tabId: tabId
        });
        chrome.action.setBadgeBackgroundColor({ 
            color: color,
            tabId: tabId 
        });
        
        console.log(`Background: Updated badge for ${pageType} page - ${count} users (${color})`);
        
    } catch (error) {
        console.error('Error updating badge:', error);
    }
}

// Cache for tab queries to reduce redundant calls
let tabCacheTimeout = null;
let cachedTabs = null;

async function getCachedTabs() {
    if (cachedTabs && tabCacheTimeout) {
        return cachedTabs;
    }
    
    // Query tabs and cache for 1 second
    cachedTabs = await chrome.tabs.query({});
    
    // Clear cache after 1 second
    if (tabCacheTimeout) clearTimeout(tabCacheTimeout);
    tabCacheTimeout = setTimeout(() => {
        cachedTabs = null;
        tabCacheTimeout = null;
    }, 1000);
    
    return cachedTabs;
}

async function updateBadgeForUser(targetUser, dataType) {
    try {
        // Use cached tabs to avoid redundant queries
        const tabs = await getCachedTabs();
        const data = await getUserData();
        
        if (!data.userData[targetUser]) return;
        
        const accountData = data.userData[targetUser];
        
        // Filter relevant tabs first to minimize operations
        const relevantTabs = tabs.filter(tab => 
            tab.url && 
            tab.url.includes('x.com') && 
            tab.url.match(/x\.com\/([^\/]+)\/(following|followers)/)
        );
        
        // Batch badge updates
        const badgeUpdates = [];
        
        for (const tab of relevantTabs) {
            const urlMatch = tab.url.match(/x\.com\/([^\/]+)\/(following|followers)/);
            if (!urlMatch || urlMatch[1] !== targetUser) continue;
            
            const pageType = urlMatch[2];
            let count = 0;
            let color = '#1DA1F2';
            
            if (pageType === 'following' && accountData.following) {
                count = Object.keys(accountData.following).length;
                color = '#1DA1F2'; // Blue for following
            } else if (pageType === 'followers' && accountData.followers) {
                count = Object.keys(accountData.followers).length;
                color = '#22C55E'; // Green for followers
            }
            
            badgeUpdates.push({
                tabId: tab.id,
                text: formatBadgeNumber(count),
                color: color,
                pageType: pageType,
                count: count
            });
        }
        
        // Apply badge updates
        for (const update of badgeUpdates) {
            chrome.action.setBadgeText({
                text: update.text,
                tabId: update.tabId
            });
            chrome.action.setBadgeBackgroundColor({ 
                color: update.color,
                tabId: update.tabId 
            });
            
            console.log(`Background: Updated badge for tab ${update.tabId} - ${update.pageType} page - ${update.count} users`);
        }
        
    } catch (error) {
        console.error('Error updating badge for user:', error);
    }
}

// Handle tab updates to reset badge if needed
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url && tab.url.includes('x.com')) {
        // Check if this is a following or followers page
        if (tab.url.includes('/following')) {
            await updateBadgeForPageType('following', tab.url, tabId);
        } else if (tab.url.includes('/followers')) {
            await updateBadgeForPageType('followers', tab.url, tabId);
        } else {
            // Check for notification badge
            await updateNotificationBadge(tabId);
        }
    } else if (changeInfo.status === 'complete') {
        // Check for notification badge on non-X pages
        await updateNotificationBadge(tabId);
    }
});

// Badge number formatting function
function formatBadgeNumber(num, isNotification = false) {
    const prefix = isNotification ? '+' : '';
    if (num >= 1000000) {
        return prefix + (num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1) + 'M';
    }
    if (num >= 1000) {
        return prefix + (num / 1000).toFixed(num % 1000 === 0 ? 0 : 1) + 'k';
    }
    return prefix + num.toString();
}

// New functions for notification system
async function calculateNewUsers() {
    try {
        const data = await getUserData();
        const { userData, viewingState } = data;
        
        if (!viewingState.lastViewedAt) {
            return { totalNew: 0, accountNewCounts: {} };
        }
        
        const lastViewedTime = new Date(viewingState.lastViewedAt);
        let totalNew = 0;
        const accountNewCounts = {};
        
        Object.keys(userData).forEach(account => {
            accountNewCounts[account] = { following: 0, followers: 0 };
            
            // Check following
            if (userData[account].following) {
                Object.values(userData[account].following).forEach(user => {
                    const collectionTime = new Date(user.collectedAt || user.lastSeen);
                    if (collectionTime > lastViewedTime) {
                        accountNewCounts[account].following++;
                        totalNew++;
                    }
                });
            }
            
            // Check followers
            if (userData[account].followers) {
                Object.values(userData[account].followers).forEach(user => {
                    const collectionTime = new Date(user.collectedAt || user.lastSeen);
                    if (collectionTime > lastViewedTime) {
                        accountNewCounts[account].followers++;
                        totalNew++;
                    }
                });
            }
        });
        
        return { totalNew, accountNewCounts };
        
    } catch (error) {
        console.error('Error calculating new users:', error);
        return { totalNew: 0, accountNewCounts: {} };
    }
}

async function updateNotificationBadge(tabId) {
    try {
        const { totalNew } = await calculateNewUsers();
        
        if (totalNew > 0) {
            const badgeText = formatBadgeNumber(totalNew, true);
            await chrome.action.setBadgeText({ text: badgeText, tabId });
            await chrome.action.setBadgeBackgroundColor({ color: '#FF6B35', tabId }); // Orange
            console.log(`Background: Set notification badge to ${badgeText} for tab ${tabId}`);
        } else {
            await chrome.action.setBadgeText({ text: '', tabId });
        }
        
    } catch (error) {
        console.error('Error updating notification badge:', error);
    }
}

async function updateNotificationBadges() {
    try {
        const tabs = await chrome.tabs.query({});
        
        for (const tab of tabs) {
            // Skip tabs that are on X collection pages
            if (tab.url && tab.url.includes('x.com') && 
                (tab.url.includes('/following') || tab.url.includes('/followers'))) {
                continue;
            }
            
            await updateNotificationBadge(tab.id);
        }
        
    } catch (error) {
        console.error('Error updating notification badges:', error);
    }
}

async function recordViewState() {
    try {
        const data = await getUserData();
        const { userData } = data;
        
        // Record current counts and timestamp
        const currentCounts = {};
        Object.keys(userData).forEach(account => {
            currentCounts[account] = {
                following: userData[account].following ? Object.keys(userData[account].following).length : 0,
                followers: userData[account].followers ? Object.keys(userData[account].followers).length : 0
            };
        });
        
        const viewingState = {
            lastViewedAt: new Date().toISOString(),
            lastViewedCounts: currentCounts
        };
        
        await chrome.storage.local.set({ viewingState });
        
        // Clear notification badges
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
            if (!tab.url || !tab.url.includes('x.com') || 
                (!tab.url.includes('/following') && !tab.url.includes('/followers'))) {
                await chrome.action.setBadgeText({ text: '', tabId: tab.id });
            }
        }
        
        console.log('Background: Recorded view state and cleared notification badges');
        
    } catch (error) {
        console.error('Error recording view state:', error);
    }
}