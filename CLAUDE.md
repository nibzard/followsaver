# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Extension Development Commands

### Testing and Development
```bash
# Load extension for testing
# 1. Open Chrome -> chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked" and select this directory
# 4. Test on X.com following/followers pages

# Reload extension after changes
# Go to chrome://extensions/ and click the reload icon for FollowSaver

# View extension logs
# 1. Background script logs: chrome://extensions/ -> FollowSaver -> "service worker" link
# 2. Content script logs: Open DevTools on x.com pages -> Console tab
# 3. Popup logs: Right-click extension icon -> Inspect popup -> Console tab
```

## Architecture Overview

### Three-Layer Data Collection System

The extension uses a sophisticated three-layer architecture to intercept X/Twitter API calls and collect user data:

1. **Injected Script (injected.js)** - Runs in main world context
   - Intercepts `fetch()` and `XMLHttpRequest` calls to X's GraphQL API
   - Specifically targets `/api/graphql/Following` and `/api/graphql/Followers` endpoints
   - Extracts user data from API responses and dispatches custom events

2. **Content Script (content.js)** - Bridge between worlds
   - Injects the main world script into following/followers pages
   - Listens for custom events from injected script
   - Forwards collected data to background script via Chrome messaging

3. **Background Service Worker (background.js)** - Data management and persistence
   - Receives user data from content scripts
   - Handles deduplication and storage using Chrome's storage API
   - Manages badge notifications and viewing state tracking

### Data Storage Structure

```javascript
// Chrome storage contains:
{
  userData: {
    "username": {
      following: { "userId": { rawData: {...}, collectedAt: "ISO", lastSeen: "ISO" } },
      followers: { "userId": { rawData: {...}, collectedAt: "ISO", lastSeen: "ISO" } }
    }
  },
  lastUpdated: {
    "username": { following: "ISO", followers: "ISO" }
  },
  viewingState: {
    lastViewedAt: "ISO",
    lastViewedCounts: { "username": { following: 123, followers: 456 } }
  }
}
```

### Context-Aware Badge System

The extension implements a dual-mode badge system:

- **Collection Mode** (on x.com following/followers pages): Shows real-time counts with blue (following) or green (followers) background
- **Notification Mode** (elsewhere): Shows "+X new" with orange background for items collected since last popup view
- **State Management**: Tracks viewing timestamps to determine what counts as "new"

### Export System

The popup provides two export formats:
- **JSON**: Complete raw Twitter API data with metadata
- **CSV**: Flattened user data with key fields (username, bio, counts, etc.)

Both support per-account and bulk exports.

## Key Implementation Details

### URL Pattern Matching
- Content script only injects on pages matching `/following` or `/followers` patterns
- Background script extracts account names using regex: `x\.com\/([^\/]+)\/(following|followers)`

### API Interception Strategy
- Overrides both `fetch()` and `XMLHttpRequest` to catch all API calls
- Looks for GraphQL endpoints with "Following" or "Followers" in the URL
- Processes `timeline.instructions` arrays to extract user data from API responses

### Message Types
```javascript
// Background script handles these message types:
'STORE_USER_DATA'    // From content script with collected users
'GET_USER_DATA'      // From popup requesting all data
'CLEAR_USER_DATA'    // From popup to reset storage
'PAGE_TYPE_UPDATE'   // For badge updates during collection
'RECORD_VIEW_STATE'  // From popup to track viewing and clear notifications
```

### Badge Logic Flow
1. Tab navigation triggers badge context evaluation
2. Collection pages show current counts (formatBadgeNumber without +)
3. Non-collection pages show new item counts (formatBadgeNumber with +)
4. Opening popup records view state and clears notification badges

## File Responsibilities

- **manifest.json**: Manifest V3 configuration, permissions, content script matching
- **background.js**: Service worker, data storage, badge management, notification system
- **content.js**: Script injection orchestration, event forwarding
- **injected.js**: API interception, data extraction from GraphQL responses
- **popup.js**: UI logic, data presentation, export functionality, view state recording
- **popup.html/css**: Extension popup interface and styling

## Important Considerations

### Chrome Extension Context
- Uses Manifest V3 with service worker (not persistent background page)
- Requires "storage" and "activeTab" permissions
- Only operates on x.com domain with specific host permissions

### Data Processing
- Deduplication by user ID prevents duplicate entries
- Maintains both collection timestamps and last seen timestamps
- Preserves complete raw API responses for maximum data fidelity

### Privacy and Storage
- All data stored locally using Chrome's storage.local API
- No external network requests or data transmission
- User controls all data collection and deletion