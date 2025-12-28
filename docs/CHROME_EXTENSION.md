# SnapURL 2.0 - Chrome Extension Documentation

> **Browser Integration**: Quick URL shortening from any webpage

## Overview

The SnapURL Chrome Extension allows users to shorten URLs directly from their browser without opening the web application. The extension integrates with the SnapURL API to create short links instantly.

**Note**: The chrome-extension directory is planned but not yet implemented in the repository. This document serves as a specification for future development.

## Features (Planned)

- **One-Click Shortening**: Right-click any link to shorten it
- **Current Tab Shortening**: Shorten the current page URL
- **Quick Access**: Popup interface for immediate shortening
- **Copy to Clipboard**: Automatically copy shortened URLs
- **History**: View recently created short URLs
- **Authentication**: Sync with SnapURL account
- **Custom Aliases**: Set custom short codes
- **QR Code Generation**: Generate QR codes for URLs

## Installation

### From Chrome Web Store (Coming Soon)

1. Visit [Chrome Web Store - SnapURL](https://chrome.google.com/webstore/detail/snapurl)
2. Click "Add to Chrome"
3. Click "Add Extension" in the popup
4. The SnapURL icon will appear in your toolbar

### Manual Installation (Development)

1. **Clone the repository**:
   ```bash
   git clone https://github.com/DhananjayThomble/URL-Shortener-App.git
   cd URL-Shortener-App
   ```

2. **Navigate to extension directory** (when available):
   ```bash
   cd chrome-extension
   ```

3. **Load in Chrome**:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `chrome-extension` directory
   - The SnapURL icon appears in your toolbar

## Usage

### Popup Interface

Click the SnapURL icon in the toolbar to open the popup:

**Features**:
- Input field for URL to shorten
- Button to shorten current tab
- List of recently created URLs
- Login/logout functionality
- Settings access

**Example**:
```
┌─────────────────────────────────┐
│        SnapURL                  │
├─────────────────────────────────┤
│ [Current Page]                  │
│ https://example.com/very/long/url│
│                                 │
│ [Shorten This Page] [Copy]     │
│                                 │
│ Or enter URL:                   │
│ ┌─────────────────────────────┐ │
│ │                             │ │
│ └─────────────────────────────┘ │
│ [Shorten URL]                   │
│                                 │
│ Recent URLs:                    │
│ • snapurl.in/abc123 (23 clicks)│
│ • snapurl.in/xyz789 (15 clicks)│
│                                 │
│ [View All] [Settings]           │
└─────────────────────────────────┘
```

### Context Menu

Right-click any link on a webpage to see:

```
┌──────────────────────────┐
│ Open link in new tab     │
│ Open link in new window  │
│ Bookmark this link       │
├──────────────────────────┤
│ SnapURL: Shorten link   │  ← Extension adds this
└──────────────────────────┘
```

Clicking "SnapURL: Shorten link" will:
1. Send link to SnapURL API
2. Create shortened URL
3. Copy to clipboard
4. Show notification with short URL

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt+Shift+S` | Open extension popup |
| `Alt+Shift+C` | Shorten current page |
| `Ctrl+Shift+V` | Paste and shorten |

## Architecture

### Extension Structure (Planned)

```
chrome-extension/
├── manifest.json          # Extension configuration
├── popup/
│   ├── popup.html        # Popup interface
│   ├── popup.js          # Popup logic
│   └── popup.css         # Popup styles
├── background/
│   └── background.js     # Background service worker
├── content/
│   └── content.js        # Content scripts
├── icons/
│   ├── icon16.png        # 16x16 icon
│   ├── icon48.png        # 48x48 icon
│   └── icon128.png       # 128x128 icon
├── lib/
│   └── api.js            # API client
└── options/
    ├── options.html      # Settings page
    └── options.js        # Settings logic
```

### Manifest V3 Configuration

```json
{
  "manifest_version": 3,
  "name": "SnapURL - URL Shortener",
  "version": "2.0.0",
  "description": "Shorten URLs instantly with SnapURL",
  "permissions": [
    "activeTab",
    "contextMenus",
    "storage",
    "clipboardWrite"
  ],
  "host_permissions": [
    "https://snapurl.in/*",
    "https://app.snapurl.in/*"
  ],
  "background": {
    "service_worker": "background/background.js"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "options_page": "options/options.html",
  "commands": {
    "_execute_action": {
      "suggested_key": {
        "default": "Alt+Shift+S"
      }
    },
    "shorten-current": {
      "suggested_key": {
        "default": "Alt+Shift+C"
      },
      "description": "Shorten current page URL"
    }
  }
}
```

## Development

### Setup Development Environment

```bash
# Clone repository
git clone https://github.com/DhananjayThomble/URL-Shortener-App.git
cd URL-Shortener-App

# Create extension directory (if not exists)
mkdir -p chrome-extension
cd chrome-extension

# Install dependencies (if using build tools)
npm install
```

### API Integration

**API Client** (`lib/api.js`):
```javascript
class SnapURLAPI {
  constructor() {
    this.baseURL = 'https://snapurl.in/api/v1';
    this.token = null;
  }

  async init() {
    // Get stored token
    const result = await chrome.storage.local.get(['accessToken']);
    this.token = result.accessToken;
  }

  async shortenURL(originalUrl, customAlias = null) {
    const response = await fetch(`${this.baseURL}/urls`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      },
      body: JSON.stringify({
        originalUrl,
        customAlias
      })
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return await response.json();
  }

  async getRecentURLs(limit = 5) {
    const response = await fetch(
      `${this.baseURL}/urls?limit=${limit}&sortBy=createdAt&order=desc`,
      {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      }
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return await response.json();
  }

  async login(email, password) {
    const response = await fetch(`${this.baseURL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    if (!response.ok) {
      throw new Error('Login failed');
    }

    const data = await response.json();
    this.token = data.accessToken;
    
    // Store token
    await chrome.storage.local.set({
      accessToken: data.accessToken,
      user: data.user
    });

    return data;
  }

  async logout() {
    this.token = null;
    await chrome.storage.local.remove(['accessToken', 'user']);
  }
}
```

### Background Script

**Background Service Worker** (`background/background.js`):
```javascript
// Initialize API
const api = new SnapURLAPI();

// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'shorten-link',
    title: 'SnapURL: Shorten link',
    contexts: ['link']
  });

  chrome.contextMenus.create({
    id: 'shorten-page',
    title: 'SnapURL: Shorten this page',
    contexts: ['page']
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await api.init();

  if (info.menuItemId === 'shorten-link') {
    await shortenAndCopy(info.linkUrl);
  } else if (info.menuItemId === 'shorten-page') {
    await shortenAndCopy(tab.url);
  }
});

// Shorten URL and copy to clipboard
async function shortenAndCopy(url) {
  try {
    const result = await api.shortenURL(url);
    const shortUrl = result.shortUrl;

    // Copy to clipboard
    await navigator.clipboard.writeText(shortUrl);

    // Show notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'URL Shortened!',
      message: `Short URL copied: ${shortUrl}`
    });
  } catch (error) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Error',
      message: `Failed to shorten URL: ${error.message}`
    });
  }
}

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'shorten-current') {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });
    await shortenAndCopy(tab.url);
  }
});
```

### Popup Interface

**Popup HTML** (`popup/popup.html`):
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>SnapURL</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="../icons/icon48.png" alt="SnapURL">
      <h1>SnapURL</h1>
    </div>

    <div id="login-section" class="hidden">
      <input type="email" id="email" placeholder="Email">
      <input type="password" id="password" placeholder="Password">
      <button id="login-btn">Login</button>
      <a href="https://app.snapurl.in/register" target="_blank">
        Create Account
      </a>
    </div>

    <div id="main-section" class="hidden">
      <div class="current-page">
        <label>Current Page:</label>
        <div id="current-url" class="url-display"></div>
        <button id="shorten-current-btn">Shorten This Page</button>
      </div>

      <div class="url-input">
        <label>Or enter URL:</label>
        <input type="text" id="url-input" placeholder="https://example.com">
        <button id="shorten-btn">Shorten URL</button>
      </div>

      <div class="result hidden" id="result">
        <div class="short-url-display">
          <input type="text" id="short-url" readonly>
          <button id="copy-btn">Copy</button>
        </div>
      </div>

      <div class="recent-urls">
        <h3>Recent URLs</h3>
        <div id="recent-list"></div>
      </div>

      <div class="footer">
        <button id="view-all-btn">View All URLs</button>
        <button id="logout-btn">Logout</button>
      </div>
    </div>
  </div>

  <script src="../lib/api.js"></script>
  <script src="popup.js"></script>
</body>
</html>
```

**Popup Script** (`popup/popup.js`):
```javascript
const api = new SnapURLAPI();

document.addEventListener('DOMContentLoaded', async () => {
  await api.init();
  await checkAuth();

  // Event listeners
  document.getElementById('login-btn')?.addEventListener('click', handleLogin);
  document.getElementById('shorten-current-btn')?.addEventListener('click', handleShortenCurrent);
  document.getElementById('shorten-btn')?.addEventListener('click', handleShorten);
  document.getElementById('copy-btn')?.addEventListener('click', handleCopy);
  document.getElementById('logout-btn')?.addEventListener('click', handleLogout);
  document.getElementById('view-all-btn')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://app.snapurl.in/dashboard' });
  });
});

async function checkAuth() {
  if (api.token) {
    showMainSection();
    await loadCurrentPage();
    await loadRecentURLs();
  } else {
    showLoginSection();
  }
}

async function handleLogin() {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    await api.login(email, password);
    await checkAuth();
  } catch (error) {
    alert('Login failed: ' + error.message);
  }
}

async function handleShortenCurrent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await shortenURL(tab.url);
}

async function handleShorten() {
  const url = document.getElementById('url-input').value;
  await shortenURL(url);
}

async function shortenURL(url) {
  try {
    const result = await api.shortenURL(url);
    showResult(result.shortUrl);
    await loadRecentURLs();
  } catch (error) {
    alert('Failed to shorten URL: ' + error.message);
  }
}

async function handleCopy() {
  const shortUrl = document.getElementById('short-url').value;
  await navigator.clipboard.writeText(shortUrl);
  
  // Show feedback
  const btn = document.getElementById('copy-btn');
  btn.textContent = 'Copied!';
  setTimeout(() => btn.textContent = 'Copy', 2000);
}

async function loadRecentURLs() {
  try {
    const result = await api.getRecentURLs(5);
    const list = document.getElementById('recent-list');
    list.innerHTML = result.data.map(url => `
      <div class="recent-url-item">
        <span class="short-code">${url.shortCode}</span>
        <span class="clicks">${url.clicks} clicks</span>
      </div>
    `).join('');
  } catch (error) {
    console.error('Failed to load recent URLs:', error);
  }
}
```

## Testing

### Manual Testing

1. Load extension in Chrome
2. Test popup interface
3. Test context menu
4. Test keyboard shortcuts
5. Verify API integration

### Automated Testing

**Selenium WebDriver**:
```javascript
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

async function testExtension() {
  const options = new chrome.Options();
  options.addExtensions('./chrome-extension.crx');

  const driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .build();

  try {
    // Test extension popup
    await driver.get('chrome-extension://ID/popup/popup.html');
    
    // Test shortening
    await driver.findElement(By.id('url-input')).sendKeys('https://example.com');
    await driver.findElement(By.id('shorten-btn')).click();
    
    // Verify result
    await driver.wait(until.elementLocated(By.id('short-url')), 5000);
    const shortUrl = await driver.findElement(By.id('short-url')).getAttribute('value');
    
    console.log('Short URL:', shortUrl);
  } finally {
    await driver.quit();
  }
}
```

## Publishing

### Chrome Web Store

1. **Create Developer Account**: [$5 one-time fee](https://chrome.google.com/webstore/devconsole/)

2. **Prepare Package**:
   ```bash
   # Create ZIP archive
   cd chrome-extension
   zip -r ../snapurl-extension.zip .
   ```

3. **Upload to Store**:
   - Go to Chrome Web Store Developer Dashboard
   - Click "New Item"
   - Upload ZIP file
   - Fill in store listing details
   - Submit for review

4. **Store Listing**:
   - Name: SnapURL - URL Shortener
   - Description: [Detailed description]
   - Category: Productivity
   - Screenshots: [5 screenshots]
   - Privacy Policy: [Link]

## Privacy & Permissions

### Permissions Explained

- **activeTab**: Access current tab URL for shortening
- **contextMenus**: Add context menu options
- **storage**: Store user authentication token
- **clipboardWrite**: Copy shortened URLs to clipboard

### Data Collection

The extension:
- ✅ Stores authentication token locally
- ✅ Sends URLs to SnapURL API for shortening
- ❌ Does NOT track browsing history
- ❌ Does NOT collect personal data beyond authentication

## Future Enhancements

- [ ] Firefox add-on version
- [ ] Safari extension
- [ ] Bulk URL shortening
- [ ] Analytics dashboard in popup
- [ ] Custom domain support
- [ ] Offline mode with queue
- [ ] URL validation before shortening
- [ ] Tag and categorize URLs

## Support

For extension-specific issues:
- Email: extension-support@snapurl.in
- GitHub Issues: [Report Bug](https://github.com/DhananjayThomble/URL-Shortener-App/issues/new?labels=chrome-extension)

## Cross-References

- **API Documentation**: [API.md](./API.md)
- **Architecture**: [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Development Guide**: [DEVELOPMENT.md](./DEVELOPMENT.md)

---

**Last Updated**: 2025-12-28  
**Version**: 2.0.0 (Planned)  
**Status**: Specification Document  
**Maintainer**: SnapURL Team
