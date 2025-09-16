// ABOUTME: Injected script that runs in the main world to intercept Following/Followers API requests
// ABOUTME: This runs in the same context as the website's JavaScript to collect user data

(function() {
    'use strict';
    
    console.log('FollowSaver: Injected script loaded');
    
    // Store the original fetch function using Proxy for safer interception
    const originalFetch = window.fetch.bind(window);
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    
    // Cleanup function to restore original functions
    const cleanup = () => {
        window.fetch = originalFetch;
        XMLHttpRequest.prototype.open = originalXHROpen;
        XMLHttpRequest.prototype.send = originalXHRSend;
    };
    
    // Register cleanup on page unload
    window.addEventListener('beforeunload', cleanup);
    window.addEventListener('pagehide', cleanup);
    
    // Create a Proxy instead of direct function override for better safety
    const fetchProxy = new Proxy(originalFetch, {
        apply: function(target, thisArg, args) {
            const [resource, config] = args;

            // Log all requests for debugging (first 10 only to avoid spam)
            if (typeof resource === 'string') {
                if (window._followSaverRequestCount === undefined) window._followSaverRequestCount = 0;
                if (window._followSaverRequestCount < 10) {
                    console.log(`FollowSaver: Fetch request ${window._followSaverRequestCount + 1}:`, resource);
                    window._followSaverRequestCount++;
                }

                // Log GraphQL API requests specifically
                if (resource.includes('/api/graphql/')) {
                    console.log('FollowSaver: GraphQL fetch request detected:', resource);
                }
            }
            
            return target.apply(thisArg, args)
                .then(response => {
                    // Clone response so we can read it without consuming the original
                    const clonedResponse = response.clone();
                    
                    // Check if this is a Following or Followers API request
                    if (typeof resource === 'string' && 
                        resource.includes('/api/graphql/') && 
                        (resource.includes('/Following?') || resource.includes('/Followers?'))) {
                        
                        const apiType = resource.includes('/Following?') ? 'Following' : 'Followers';
                        console.log(`FollowSaver: Intercepted ${apiType} API request:`, resource);
                        
                        // Extract response data with validation
                        clonedResponse.json()
                            .then(data => {
                                // Validate and sanitize API response
                                if (validateApiResponse(data)) {
                                    console.log(`FollowSaver: ${apiType} API response data:`, data);
                                    
                                    const timeline = data?.data?.user?.result?.timeline?.timeline;
                                    if (timeline?.instructions) {
                                        processUserData(timeline.instructions, apiType.toLowerCase());
                                    }
                                } else {
                                    console.warn(`FollowSaver: Invalid ${apiType} API response structure`);
                                }
                            })
                            .catch(error => {
                                console.error(`FollowSaver: Error parsing ${apiType} API response:`, error);
                            });
                    }
                    
                    return response;
                })
                .catch(error => {
                    // Pass through errors without modification
                    throw error;
                });
        }
    });

    // Assign the proxy to window.fetch
    window.fetch = fetchProxy;
    
    // Safer XMLHttpRequest interception
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        // Store URL for later use
        this._xCollectorUrl = url;
        return originalXHROpen.call(this, method, url, ...rest);
    };
    
    XMLHttpRequest.prototype.send = function(...args) {
        // Debug XHR GraphQL requests
        if (this._xCollectorUrl && this._xCollectorUrl.includes('/api/graphql/')) {
            console.log('FollowSaver: XHR GraphQL request:', this._xCollectorUrl);
        }

        if (this._xCollectorUrl &&
            this._xCollectorUrl.includes('/api/graphql/') &&
            (this._xCollectorUrl.includes('/Following?') || this._xCollectorUrl.includes('/Followers?'))) {

            const url = this._xCollectorUrl;
            const apiType = url.includes('/Following?') ? 'Following' : 'Followers';
            
            this.addEventListener('load', function() {
                console.log(`FollowSaver: Intercepted XHR ${apiType} API request:`, url);
                try {
                    const data = JSON.parse(this.responseText);
                    if (validateApiResponse(data)) {
                        const timeline = data?.data?.user?.result?.timeline?.timeline;
                        if (timeline?.instructions) {
                            processUserData(timeline.instructions, apiType.toLowerCase());
                        }
                    } else {
                        console.warn(`FollowSaver: Invalid XHR ${apiType} API response structure`);
                    }
                } catch (error) {
                    console.error(`FollowSaver: Error parsing XHR ${apiType} API response:`, error);
                }
            });
        }
        
        return originalXHRSend.apply(this, args);
    };
    
    // Validate API response structure to prevent injection attacks
    function validateApiResponse(data) {
        try {
            // Check for expected structure without trusting the data
            if (!data || typeof data !== 'object') return false;
            if (!data.data || typeof data.data !== 'object') return false;
            if (!data.data.user || typeof data.data.user !== 'object') return false;
            if (!data.data.user.result || typeof data.data.user.result !== 'object') return false;
            
            // Additional validation for timeline structure
            const result = data.data.user.result;
            if (result.timeline) {
                if (typeof result.timeline !== 'object') return false;
                if (result.timeline.timeline && typeof result.timeline.timeline !== 'object') return false;
            }
            
            return true;
        } catch (e) {
            console.error('FollowSaver: API validation error:', e);
            return false;
        }
    }
    
    
    // Validate instruction structure
    function validateInstruction(instruction) {
        try {
            if (!instruction || typeof instruction !== 'object') return false;
            if (typeof instruction.type !== 'string') return false;
            if (instruction.entries && !Array.isArray(instruction.entries)) return false;
            return true;
        } catch (e) {
            return false;
        }
    }
    
    // Validate user entry structure
    function validateUserEntry(entry) {
        try {
            if (!entry?.content?.itemContent) return false;
            if (entry.content.itemContent.itemType !== 'TimelineUser') return false;
            if (!entry.content.itemContent.user_results?.result) return false;
            
            const user = entry.content.itemContent.user_results.result;
            if (!user.rest_id || typeof user.rest_id !== 'string') return false;
            
            return true;
        } catch (e) {
            return false;
        }
    }
    
    // Limit data size to prevent memory issues
    function truncateUserData(user) {
        // Convert to JSON string to check size
        const jsonStr = JSON.stringify(user);
        const MAX_USER_SIZE = 50000; // 50KB per user limit

        if (jsonStr.length > MAX_USER_SIZE) {
            console.warn(`FollowSaver: User data exceeds size limit (${jsonStr.length} bytes), truncating...`);

            // Keep ALL essential fields when data is too large
            return {
                rest_id: user.rest_id,
                core: {
                    name: user.core?.name,
                    screen_name: user.core?.screen_name,
                    created_at: user.core?.created_at
                },
                legacy: {
                    description: user.legacy?.description?.substring(0, 500),
                    location: user.legacy?.location,
                    url: user.legacy?.url,
                    followers_count: user.legacy?.followers_count,
                    friends_count: user.legacy?.friends_count,
                    statuses_count: user.legacy?.statuses_count,
                    listed_count: user.legacy?.listed_count,
                    verified: user.legacy?.verified,
                    protected: user.legacy?.protected,
                    profile_image_url_https: user.legacy?.profile_image_url_https,
                    profile_banner_url: user.legacy?.profile_banner_url
                }
            };
        }

        return user;
    }
    
    function processUserData(instructions, dataType) {
        const users = [];
        const MAX_USERS_PER_BATCH = 100; // Limit users per batch to prevent memory issues
        
        // Validate instructions array
        if (!Array.isArray(instructions)) {
            console.error('FollowSaver: Instructions is not an array');
            return;
        }
        
        try {
            for (const instruction of instructions) {
                // Validate instruction structure
                if (!validateInstruction(instruction)) {
                    console.warn('FollowSaver: Skipping invalid instruction');
                    continue;
                }
                
                if (instruction.type === 'TimelineAddEntries' && instruction.entries) {
                    for (const entry of instruction.entries) {
                        // Stop if we've collected enough users in this batch
                        if (users.length >= MAX_USERS_PER_BATCH) {
                            console.log(`FollowSaver: Reached batch limit of ${MAX_USERS_PER_BATCH} users`);
                            break;
                        }
                        
                        // Validate entry structure
                        if (!validateUserEntry(entry)) {
                            continue;
                        }
                        
                        const user = entry.content.itemContent.user_results.result;


                        // Truncate large user data to prevent memory issues
                        const truncatedUser = truncateUserData(user);

                        // Store user data with minimal metadata
                        const userData = {
                            id: user.rest_id,
                            collectedAt: new Date().toISOString(),
                            entryId: entry.entryId || 'unknown',
                            sortIndex: entry.sortIndex || 0,
                            rawData: truncatedUser
                        };
                        
                        users.push(userData);
                    }
                }
                
                // Break outer loop if batch limit reached
                if (users.length >= MAX_USERS_PER_BATCH) {
                    break;
                }
            }
        } catch (error) {
            console.error('FollowSaver: Error processing user data:', error);
            // Continue with users collected so far
        }
        
        if (users.length > 0) {
            console.log(`FollowSaver: Collected ${users.length} users from ${dataType} API`);
            
            // Only log sample if we have valid data
            if (users[0] && users[0].rawData) {
                console.log(`FollowSaver: Sample ${dataType} user data:`, {
                    id: users[0].id,
                    screen_name: users[0].rawData.core?.screen_name,
                    name: users[0].rawData.core?.name,
                    location: users[0].rawData.location, // location is at top level
                    profile_image_url_https: users[0].rawData.legacy?.profile_image_url_https,
                    created_at: users[0].rawData.core?.created_at
                });
            }
            
            // Send to content script via custom event
            window.dispatchEvent(new CustomEvent('X_USER_DATA', {
                detail: {
                    users: users,
                    url: window.location.href,
                    dataType: dataType
                }
            }));
        } else {
            console.log(`FollowSaver: No valid users found in this ${dataType} API response`);
        }
    }
    
    console.log('FollowSaver: Fetch and XHR overrides installed with safety measures');
})();