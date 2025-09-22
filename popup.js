// ABOUTME: Popup script that handles UI interactions and data export functionality
// ABOUTME: Communicates with background script to retrieve and manage collected following and followers data

document.addEventListener('DOMContentLoaded', async function() {
    const statusEl = document.getElementById('status');
    const totalFollowingEl = document.getElementById('totalFollowing');
    const totalFollowersEl = document.getElementById('totalFollowers');
    const accountCountEl = document.getElementById('accountCount');
    const accountsListEl = document.getElementById('accountsList');
    const clearBtn = document.getElementById('clearBtn');
    
    // Record that popup was viewed (clears notification badge)
    await chrome.runtime.sendMessage({ type: 'RECORD_VIEW_STATE' });
    
    // Load and display data
    await loadData();

    // Clear functionality
    clearBtn.addEventListener('click', clearData);

    // Close dropdowns when clicking outside
    document.addEventListener('click', closeAllDropdowns);
    
    async function loadData() {
        try {
            statusEl.textContent = 'Loading...';
            
            const response = await chrome.runtime.sendMessage({ type: 'GET_USER_DATA' });
            const { userData, lastUpdated, viewingState } = response.data;
            
            // Calculate stats and new items
            const accounts = Object.keys(userData);
            let totalFollowing = 0;
            let totalFollowers = 0;
            let newFollowing = 0;
            let newFollowers = 0;
            
            const lastViewedTime = viewingState.lastViewedAt ? new Date(viewingState.lastViewedAt) : null;
            
            accounts.forEach(account => {
                if (userData[account].following) {
                    const followingCount = Object.keys(userData[account].following).length;
                    totalFollowing += followingCount;
                    
                    if (lastViewedTime) {
                        Object.values(userData[account].following).forEach(user => {
                            const collectionTime = new Date(user.collectedAt || user.lastSeen);
                            if (collectionTime > lastViewedTime) {
                                newFollowing++;
                            }
                        });
                    }
                }
                if (userData[account].followers) {
                    const followersCount = Object.keys(userData[account].followers).length;
                    totalFollowers += followersCount;
                    
                    if (lastViewedTime) {
                        Object.values(userData[account].followers).forEach(user => {
                            const collectionTime = new Date(user.collectedAt || user.lastSeen);
                            if (collectionTime > lastViewedTime) {
                                newFollowers++;
                            }
                        });
                    }
                }
            });
            
            // Update UI with new item indicators
            totalFollowingEl.textContent = formatNumber(totalFollowing) + (newFollowing > 0 ? ` (+${formatNumber(newFollowing)} new)` : '');
            totalFollowersEl.textContent = formatNumber(totalFollowers) + (newFollowers > 0 ? ` (+${formatNumber(newFollowers)} new)` : '');
            accountCountEl.textContent = formatNumber(accounts.length);
            
            // Populate accounts list
            accountsListEl.innerHTML = '';
            
            if (accounts.length === 0) {
                statusEl.textContent = 'No data collected yet';
                accountsListEl.innerHTML = '<div class="no-data">Visit x.com/username/following or followers pages to start collecting data</div>';
            } else {
                statusEl.textContent = 'Data collected';
                
                accounts.forEach(account => {
                    const followingCount = userData[account].following ? Object.keys(userData[account].following).length : 0;
                    const followersCount = userData[account].followers ? Object.keys(userData[account].followers).length : 0;
                    
                    // Calculate new items for this account
                    let newFollowingForAccount = 0;
                    let newFollowersForAccount = 0;
                    
                    if (lastViewedTime) {
                        if (userData[account].following) {
                            Object.values(userData[account].following).forEach(user => {
                                const collectionTime = new Date(user.collectedAt || user.lastSeen);
                                if (collectionTime > lastViewedTime) {
                                    newFollowingForAccount++;
                                }
                            });
                        }
                        if (userData[account].followers) {
                            Object.values(userData[account].followers).forEach(user => {
                                const collectionTime = new Date(user.collectedAt || user.lastSeen);
                                if (collectionTime > lastViewedTime) {
                                    newFollowersForAccount++;
                                }
                            });
                        }
                    }
                    
                    const lastFollowingUpdate = lastUpdated[account]?.following ? new Date(lastUpdated[account].following).toLocaleDateString() : 'Never';
                    const lastFollowersUpdate = lastUpdated[account]?.followers ? new Date(lastUpdated[account].followers).toLocaleDateString() : 'Never';
                    
                    const accountEl = document.createElement('div');
                    accountEl.className = 'account-item' + (newFollowingForAccount > 0 || newFollowersForAccount > 0 ? ' has-new' : '');
                    
                    const followingDisplay = formatFullNumber(followingCount) + (newFollowingForAccount > 0 ? ` <span class="new-count">(+${formatFullNumber(newFollowingForAccount)} new)</span>` : '');
                    const followersDisplay = formatFullNumber(followersCount) + (newFollowersForAccount > 0 ? ` <span class="new-count">(+${formatFullNumber(newFollowersForAccount)} new)</span>` : '');

                    // Calculate diff count for display
                    const notFollowingBack = calculateNotFollowingBack(userData[account]);
                    const diffCount = notFollowingBack.length;
                    const hasBothDataTypes = followingCount > 0 && followersCount > 0;

                    // Calculate followers/following ratio
                    const calculateRatio = (followers, following) => {
                        if (following === 0) return followers > 0 ? '∞' : '0';
                        return (followers / following).toFixed(2);
                    };

                    // Format ratio for display as "1:X"
                    const formatRatioDisplay = (ratio) => {
                        if (ratio === '∞') return '∞:1';
                        if (ratio === '0') return '0:1';
                        const numericRatio = parseFloat(ratio);
                        if (numericRatio >= 1) {
                            // When followers > following, show as "1:0.X"
                            return `1:${(1/numericRatio).toFixed(1)}`;
                        } else {
                            // When followers < following, show as "1:X"
                            return `1:${(1/numericRatio).toFixed(1)}`;
                        }
                    };

                    const ratio = hasBothDataTypes ? calculateRatio(followersCount, followingCount) : null;
                    const ratioDisplay = ratio ? formatRatioDisplay(ratio) : null;
                    const isGoodRatio = ratio && ratio !== '∞' ? parseFloat(ratio) >= (1/1.5) : false; // Following should be ≤1.5× followers, so ratio should be ≥0.67
                    const ratioClass = isGoodRatio ? 'ratio-good' : 'ratio-bad';

                    accountEl.innerHTML = `
                        <div class="account-info">
                            <div class="account-name">@${account}${(newFollowingForAccount > 0 || newFollowersForAccount > 0) ? ' <span class="new-indicator">NEW</span>' : ''}</div>
                            <div class="account-stats">
                                Following: ${followingDisplay} (${lastFollowingUpdate}) •
                                Followers: ${followersDisplay} (${lastFollowersUpdate})${hasBothDataTypes ? ` • <span class="${ratioClass}">Ratio: <strong>${ratioDisplay}</strong></span>` : ''}${hasBothDataTypes ? ` • <span class="diff-stat">Not following back: <strong>${formatFullNumber(diffCount)}</strong></span>` : ''}
                            </div>
                        </div>
                        <div class="account-export-buttons">
                            <div class="btn-group">
                                <button class="btn btn-small export-account-btn" data-account="${account}" title="Export all data (JSON)">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7,10 12,15 17,10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                    </svg>
                                    JSON
                                </button>
                                <button class="btn btn-small btn-dropdown export-json-dropdown" data-account="${account}" title="JSON export options">
                                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="6,9 12,15 18,9"></polyline>
                                    </svg>
                                </button>
                                <div class="dropdown-menu json-dropdown-menu" data-account="${account}">
                                    <button class="dropdown-item" data-export="all" data-format="json">Export All</button>
                                    <button class="dropdown-item ${followingCount === 0 ? 'disabled' : ''}" data-export="following" data-format="json" ${followingCount === 0 ? 'disabled' : ''}>Following Only (${formatFullNumber(followingCount)})</button>
                                    <button class="dropdown-item ${followersCount === 0 ? 'disabled' : ''}" data-export="followers" data-format="json" ${followersCount === 0 ? 'disabled' : ''}>Followers Only (${formatFullNumber(followersCount)})</button>
                                </div>
                            </div>
                            <div class="btn-group">
                                <button class="btn btn-small export-account-csv-btn" data-account="${account}" title="Export all data (CSV)">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                        <polyline points="7,10 12,15 17,10"/>
                                        <line x1="12" y1="15" x2="12" y2="3"/>
                                    </svg>
                                    CSV
                                </button>
                                <button class="btn btn-small btn-dropdown export-csv-dropdown" data-account="${account}" title="CSV export options">
                                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <polyline points="6,9 12,15 18,9"></polyline>
                                    </svg>
                                </button>
                                <div class="dropdown-menu csv-dropdown-menu" data-account="${account}">
                                    <button class="dropdown-item" data-export="all" data-format="csv">Export All</button>
                                    <button class="dropdown-item ${followingCount === 0 ? 'disabled' : ''}" data-export="following" data-format="csv" ${followingCount === 0 ? 'disabled' : ''}>Following Only (${formatFullNumber(followingCount)})</button>
                                    <button class="dropdown-item ${followersCount === 0 ? 'disabled' : ''}" data-export="followers" data-format="csv" ${followersCount === 0 ? 'disabled' : ''}>Followers Only (${formatFullNumber(followersCount)})</button>
                                </div>
                            </div>
                            ${hasBothDataTypes && diffCount > 0 ? `
                            <button class="btn btn-small btn-diff export-diff-btn" data-account="${account}" title="Export users you follow who don't follow back">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                    <polyline points="7,10 12,15 17,10"/>
                                    <line x1="12" y1="15" x2="12" y2="3"/>
                                </svg>
                                Diff
                            </button>
                            ` : ''}
                        </div>
                    `;
                    
                    accountsListEl.appendChild(accountEl);
                    
                    // Add export individual account functionality
                    const exportAccountBtn = accountEl.querySelector('.export-account-btn');
                    const exportAccountCSVBtn = accountEl.querySelector('.export-account-csv-btn');
                    const exportDiffBtn = accountEl.querySelector('.export-diff-btn');

                    // Dropdown buttons
                    const jsonDropdownBtn = accountEl.querySelector('.export-json-dropdown');
                    const csvDropdownBtn = accountEl.querySelector('.export-csv-dropdown');

                    // Dropdown menus
                    const jsonDropdownMenu = accountEl.querySelector('.json-dropdown-menu');
                    const csvDropdownMenu = accountEl.querySelector('.csv-dropdown-menu');

                    // Main export button events (export all)
                    exportAccountBtn.addEventListener('click', () => exportAccountData(account, userData[account], 'all'));
                    exportAccountCSVBtn.addEventListener('click', () => exportAccountDataAsCSV(account, userData[account], 'all'));

                    // Dropdown toggle events
                    jsonDropdownBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        closeAllDropdowns();
                        jsonDropdownMenu.classList.toggle('show');
                        updateAccountsListOverflow();
                    });

                    csvDropdownBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        closeAllDropdowns();
                        csvDropdownMenu.classList.toggle('show');
                        updateAccountsListOverflow();
                    });

                    // Dropdown item events
                    jsonDropdownMenu.addEventListener('click', (e) => {
                        if (e.target.classList.contains('dropdown-item') && !e.target.disabled) {
                            const exportType = e.target.dataset.export;
                            exportAccountData(account, userData[account], exportType);
                            jsonDropdownMenu.classList.remove('show');
                            updateAccountsListOverflow();
                        }
                    });

                    csvDropdownMenu.addEventListener('click', (e) => {
                        if (e.target.classList.contains('dropdown-item') && !e.target.disabled) {
                            const exportType = e.target.dataset.export;
                            exportAccountDataAsCSV(account, userData[account], exportType);
                            csvDropdownMenu.classList.remove('show');
                            updateAccountsListOverflow();
                        }
                    });

                    if (exportDiffBtn) {
                        exportDiffBtn.addEventListener('click', () => exportDiffAsCSV(account, userData[account]));
                    }
                });
            }
            
        } catch (error) {
            console.error('Error loading data:', error);
            statusEl.textContent = 'Error loading data';
        }
    }
    
    
    function downloadFile(data, filename) {
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        
        URL.revokeObjectURL(url);
    }
    
    function exportAccountData(accountName, accountData, dataType = 'all') {
        try {
            const followingCount = accountData.following ? Object.keys(accountData.following).length : 0;
            const followersCount = accountData.followers ? Object.keys(accountData.followers).length : 0;

            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
            let filesCreated = 0;

            // Export following data if requested and exists
            if ((dataType === 'all' || dataType === 'following') && followingCount > 0) {
                const followingRawData = {};
                Object.keys(accountData.following).forEach(userId => {
                    followingRawData[userId] = accountData.following[userId].rawData;
                });

                const followingExportObj = {
                    exportDate: new Date().toISOString(),
                    exportType: 'raw-following',
                    account: accountName,
                    totalUsers: followingCount,
                    accounts: { [accountName]: followingRawData }
                };

                downloadFile(followingExportObj, `x-following-${accountName}-${timestamp}.json`);
                filesCreated++;
            }

            // Export followers data if requested and exists
            if ((dataType === 'all' || dataType === 'followers') && followersCount > 0) {
                const followersRawData = {};
                Object.keys(accountData.followers).forEach(userId => {
                    followersRawData[userId] = accountData.followers[userId].rawData;
                });

                const followersExportObj = {
                    exportDate: new Date().toISOString(),
                    exportType: 'raw-followers',
                    account: accountName,
                    totalUsers: followersCount,
                    accounts: { [accountName]: followersRawData }
                };

                downloadFile(followersExportObj, `x-followers-${accountName}-${timestamp}.json`);
                filesCreated++;
            }

        } catch (error) {
            console.error('Error exporting account data:', error);
        }
    }
    
    async function clearData() {
        if (confirm('Are you sure you want to clear all collected data? This cannot be undone.')) {
            try {
                statusEl.textContent = 'Clearing data...';
                clearBtn.disabled = true;
                
                await chrome.runtime.sendMessage({ type: 'CLEAR_USER_DATA' });
                
                // Reset UI
                await loadData();
                
                statusEl.textContent = 'Data cleared';
                setTimeout(() => statusEl.textContent = 'No data collected yet', 2000);
                
            } catch (error) {
                console.error('Error clearing data:', error);
                statusEl.textContent = 'Clear failed';
            } finally {
                clearBtn.disabled = false;
            }
        }
    }
    
    async function exportAccountDataAsCSV(accountName, accountData, dataType = 'all') {
        try {
            const followingCount = accountData.following ? Object.keys(accountData.following).length : 0;
            const followersCount = accountData.followers ? Object.keys(accountData.followers).length : 0;

            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
            let filesCreated = 0;

            // Debug: Show the first user's complete data structure
            if (followingCount > 0) {
                const firstUserId = Object.keys(accountData.following)[0];
                const firstUser = accountData.following[firstUserId];
                console.log('FollowSaver Debug: First user complete raw data:', JSON.stringify(firstUser.rawData, null, 2));
            } else if (followersCount > 0) {
                const firstUserId = Object.keys(accountData.followers)[0];
                const firstUser = accountData.followers[firstUserId];
                console.log('FollowSaver Debug: First user complete raw data:', JSON.stringify(firstUser.rawData, null, 2));
            }

            // Export following data if requested and exists
            if ((dataType === 'all' || dataType === 'following') && followingCount > 0) {
                const followingUsers = [];
                Object.keys(accountData.following).forEach(userId => {
                    const userEntry = accountData.following[userId];
                    const extractedFields = extractUserFields(
                        userEntry.rawData,
                        accountName,
                        'following',
                        userEntry.collectedAt || userEntry.lastSeen
                    );
                    followingUsers.push(extractedFields);
                });

                // Debug: Show first extracted user data
                if (followingUsers.length > 0) {
                    console.log('FollowSaver Debug: First extracted user fields:', followingUsers[0]);
                }

                // Use async version for large datasets, sync for small ones
                const csvContent = followingUsers.length > 500
                    ? await convertToCSV(followingUsers)
                    : convertToCSVSync(followingUsers);
                downloadCSVFile(csvContent, `x-following-${accountName}-${timestamp}.csv`);
                filesCreated++;
            }

            // Export followers data if requested and exists
            if ((dataType === 'all' || dataType === 'followers') && followersCount > 0) {
                const followersUsers = [];
                Object.keys(accountData.followers).forEach(userId => {
                    const userEntry = accountData.followers[userId];
                    const extractedFields = extractUserFields(
                        userEntry.rawData,
                        accountName,
                        'followers',
                        userEntry.collectedAt || userEntry.lastSeen
                    );
                    followersUsers.push(extractedFields);
                });

                // Use async version for large datasets, sync for small ones
                const csvContent = followersUsers.length > 500
                    ? await convertToCSV(followersUsers)
                    : convertToCSVSync(followersUsers);
                downloadCSVFile(csvContent, `x-followers-${accountName}-${timestamp}.csv`);
                filesCreated++;
            }

        } catch (error) {
            console.error('Error exporting account CSV data:', error);
        }
    }
    
    
    // Calculate users you follow who don't follow back
    function calculateNotFollowingBack(accountData) {
        const following = accountData.following || {};
        const followers = accountData.followers || {};

        const followingIds = new Set(Object.keys(following));
        const followerIds = new Set(Object.keys(followers));

        const notFollowingBack = [];

        followingIds.forEach(userId => {
            if (!followerIds.has(userId)) {
                notFollowingBack.push({
                    userId,
                    rawData: following[userId].rawData,
                    collectedAt: following[userId].collectedAt || following[userId].lastSeen
                });
            }
        });

        console.log(`FollowSaver Diff: Following ${followingIds.size}, Followers ${followerIds.size}, Not following back: ${notFollowingBack.length}`);

        return notFollowingBack;
    }

    // Number Formatting Helper (abbreviated for badges)
    function formatNumber(num) {
        if (num >= 1000000) {
            return (num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1) + 'M';
        }
        if (num >= 1000) {
            return (num / 1000).toFixed(num % 1000 === 0 ? 0 : 1) + 'k';
        }
        return num.toString();
    }

    // Full Number Formatting Helper (with comma separators for popup display)
    function formatFullNumber(num) {
        return num.toLocaleString();
    }
    
    // CSV Export Helper Functions with security hardening
    function sanitizeCSVField(field) {
        if (field === null || field === undefined) return '';
        let str = String(field);
        
        // Prevent CSV injection attacks by escaping formula indicators
        // Check for formula injection patterns at the start of the field
        const formulaIndicators = ['=', '+', '-', '@', '\t', '\r'];
        if (formulaIndicators.some(indicator => str.startsWith(indicator))) {
            // Prefix with single quote to prevent formula execution
            str = "'" + str;
        }
        
        // Also check for formulas that might start with whitespace
        const trimmedStr = str.trim();
        if (trimmedStr !== str && formulaIndicators.some(indicator => trimmedStr.startsWith(indicator))) {
            str = "'" + str;
        }
        
        // Standard CSV escaping for quotes and special characters
        if (str.includes('"')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        if (str.includes(',') || str.includes('\n') || str.includes('\r')) {
            return '"' + str + '"';
        }
        
        // Additional safety: limit field length to prevent massive fields
        const MAX_FIELD_LENGTH = 10000;
        if (str.length > MAX_FIELD_LENGTH) {
            console.warn(`X Collector: CSV field truncated from ${str.length} to ${MAX_FIELD_LENGTH} characters`);
            str = str.substring(0, MAX_FIELD_LENGTH) + '...';
        }
        
        return str;
    }
    
    function extractUserFields(rawData, accountName, dataType, collectedAt) {
        // Handle different possible data structures
        const legacy = rawData.legacy || {};
        const core = rawData.core || {};
        const userResults = rawData.user_results?.result || {};

        // Debug logging to see the actual data structure (only for first few entries)
        if (Math.random() < 0.1) { // Log 10% of entries to avoid spam
            console.log('FollowSaver Debug: Raw data structure:', {
                hasLegacy: !!rawData.legacy,
                hasCore: !!rawData.core,
                hasUserResults: !!rawData.user_results,
                topLevelKeys: Object.keys(rawData),
                legacyKeys: rawData.legacy ? Object.keys(rawData.legacy) : [],
                sampleData: {
                    rest_id: rawData.rest_id,
                    screen_name: legacy.screen_name || core.user_results?.result?.legacy?.screen_name,
                    name: legacy.name || core.user_results?.result?.legacy?.name,
                    location: legacy.location || core.user_results?.result?.legacy?.location,
                    profile_image_url_https: legacy.profile_image_url_https || core.user_results?.result?.legacy?.profile_image_url_https,
                    created_at: legacy.created_at || core.user_results?.result?.legacy?.created_at
                }
            });
        }

        // Try multiple possible paths for each field with more robust extraction
        const extractField = (possibleFieldNames, fallbackValue = '') => {
            const fieldNames = Array.isArray(possibleFieldNames) ? possibleFieldNames : [possibleFieldNames];

            for (const fieldName of fieldNames) {
                // Try top-level rawData first (some fields like location are here)
                if (rawData[fieldName] !== undefined && rawData[fieldName] !== null && rawData[fieldName] !== '') {
                    return rawData[fieldName];
                }

                // Try legacy object
                if (legacy[fieldName] !== undefined && legacy[fieldName] !== null && legacy[fieldName] !== '') {
                    return legacy[fieldName];
                }

                // Try core.user_results.result.legacy path
                if (core.user_results?.result?.legacy?.[fieldName] !== undefined &&
                    core.user_results?.result?.legacy?.[fieldName] !== null &&
                    core.user_results?.result?.legacy?.[fieldName] !== '') {
                    return core.user_results.result.legacy[fieldName];
                }

                // Try userResults path
                if (userResults.legacy?.[fieldName] !== undefined &&
                    userResults.legacy?.[fieldName] !== null &&
                    userResults.legacy?.[fieldName] !== '') {
                    return userResults.legacy[fieldName];
                }

                // Try core object itself
                if (core[fieldName] !== undefined && core[fieldName] !== null && core[fieldName] !== '') {
                    return core[fieldName];
                }

                // Try professional object
                if (rawData.professional?.[fieldName] !== undefined && rawData.professional?.[fieldName] !== null && rawData.professional?.[fieldName] !== '') {
                    return rawData.professional[fieldName];
                }
            }

            return fallbackValue;
        };

        // Handle special cases for complex fields
        const extractLocation = () => {
            const locationField = extractField(['location']);
            if (typeof locationField === 'string') {
                return locationField;
            } else if (typeof locationField === 'object' && locationField !== null) {
                // Twitter's location object has a 'location' property inside it
                return locationField.location ||
                       locationField.full_name ||
                       locationField.name ||
                       locationField.display_name ||
                       locationField.country ||
                       locationField.locality ||
                       '';
            }
            return '';
        };

        const extractProfileImage = () => {
            // Try legacy first, then other paths
            return legacy.profile_image_url_https ||
                   legacy.profile_image_url ||
                   rawData.avatar?.url ||
                   rawData.avatar?.image_url ||
                   extractField(['profile_image_url_https', 'profile_image_url', 'avatar_url', 'image_url']);
        };

        return {
            userId: rawData.rest_id || userResults.rest_id || '',
            username: extractField(['screen_name', 'username', 'handle']),
            displayName: extractField(['name', 'display_name', 'displayName', 'full_name']),
            bio: extractField(['description', 'bio']),
            location: extractLocation(),
            website: extractField(['url', 'website', 'entities.url.urls[0].expanded_url']),
            followersCount: extractField(['followers_count', 'public_metrics.followers_count'], 0),
            followingCount: extractField(['friends_count', 'following_count', 'public_metrics.following_count'], 0),
            tweetsCount: extractField(['statuses_count', 'tweet_count', 'public_metrics.tweet_count'], 0),
            listedCount: extractField(['listed_count', 'public_metrics.listed_count'], 0),
            verified: extractField(['verified', 'is_verified'], false),
            protected: extractField(['protected', 'is_protected'], false),
            profileImageUrl: extractProfileImage(),
            profileBannerUrl: extractField(['profile_banner_url', 'header_url']),
            createdAt: extractField(['created_at', 'account_created_at']),
            accountType: dataType,
            sourceAccount: accountName,
            collectionDate: collectedAt || ''
        };
    }
    
    // Optimized CSV conversion with chunking to prevent UI blocking
    async function convertToCSV(data) {
        if (!data.length) return '';
        
        const headers = Object.keys(data[0]);
        const csvHeaders = headers.map(sanitizeCSVField).join(',');
        
        // Process data in chunks to avoid blocking the UI
        const CHUNK_SIZE = 100;
        const csvRows = [];
        
        for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            const chunk = data.slice(i, Math.min(i + CHUNK_SIZE, data.length));
            
            // Process chunk
            const chunkRows = chunk.map(row => 
                headers.map(header => sanitizeCSVField(row[header])).join(',')
            );
            
            csvRows.push(...chunkRows);
            
            // Yield control back to the browser every chunk to prevent blocking
            if (i + CHUNK_SIZE < data.length) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }
        
        return csvHeaders + '\n' + csvRows.join('\n');
    }
    
    // Legacy synchronous version for small datasets
    function convertToCSVSync(data) {
        if (!data.length) return '';
        
        const headers = Object.keys(data[0]);
        const csvHeaders = headers.map(sanitizeCSVField).join(',');
        
        const csvRows = data.map(row => 
            headers.map(header => sanitizeCSVField(row[header])).join(',')
        );
        
        return csvHeaders + '\n' + csvRows.join('\n');
    }
    
    function downloadCSVFile(csvContent, filename) {
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();

        URL.revokeObjectURL(url);
    }

    async function exportDiffAsCSV(accountName, accountData) {
        try {
            const notFollowingBack = calculateNotFollowingBack(accountData);

            if (notFollowingBack.length === 0) {
                alert(`Great news! All users that @${accountName} follows are following back, or you haven't collected both following and followers data yet.`);
                return;
            }

            const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');

            // Convert to CSV format with profile links
            const diffUsers = notFollowingBack.map(user => {
                const extractedFields = extractUserFields(
                    user.rawData,
                    accountName,
                    'not-following-back',
                    user.collectedAt
                );

                // Add profile link as first column
                return {
                    profileLink: `https://x.com/${extractedFields.username}`,
                    ...extractedFields
                };
            });

            const csvContent = diffUsers.length > 500
                ? await convertToCSV(diffUsers)
                : convertToCSVSync(diffUsers);

            downloadCSVFile(csvContent, `x-not-following-back-${accountName}-${timestamp}.csv`);

        } catch (error) {
            console.error('Error exporting diff CSV data:', error);
            alert('Error exporting diff data. Please try again.');
        }
    }

    // Helper function to close all dropdown menus
    function closeAllDropdowns() {
        const allDropdowns = document.querySelectorAll('.dropdown-menu.show');
        allDropdowns.forEach(dropdown => {
            dropdown.classList.remove('show');
        });
        updateAccountsListOverflow();
    }

    // Helper function to manage accounts list overflow based on dropdown state
    function updateAccountsListOverflow() {
        const accountsList = document.getElementById('accountsList');
        const hasActiveDropdown = document.querySelector('.dropdown-menu.show');

        if (hasActiveDropdown) {
            accountsList.classList.add('dropdown-active');
        } else {
            accountsList.classList.remove('dropdown-active');
        }
    }
});