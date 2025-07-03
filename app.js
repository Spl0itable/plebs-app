// Blossom servers
const BLOSSOM_SERVERS = [
    'https://blossom.primal.net',
    'https://blossom.band',
    'https://24242.io',
    // We'll add more Blossom servers as they become available
];

// Global state
let currentUser = null;
let relayConnections = {};
let currentView = 'home';
let uploadedVideoHash = null;
let allEvents = new Map(); // Store events by ID
let profileCache = new Map(); // Store user profiles
let reactionsCache = new Map(); // Store reactions by video ID
let pendingNSFWAction = null; // Store pending action when NSFW modal is shown
let pendingRatioedAction = null; // Store pending action when ratioed modal is shown
let sessionNSFWAllowed = false; // Track NSFW permission for current session
let sessionRatioedAllowed = new Set(); // Track ratioed videos allowed in session
let currentTrendingPeriod = 'today'; // Track current trending period

// Define relay URLs
const RELAY_URLS = [
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://nos.lol',
    'wss://relay.primal.net'
];

// Theme management
function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
    const lightIcon = document.querySelector('.theme-icon-light');
    const darkIcon = document.querySelector('.theme-icon-dark');
    if (theme === 'dark') {
        lightIcon.style.display = 'block';
        darkIcon.style.display = 'none';
    } else {
        lightIcon.style.display = 'none';
        darkIcon.style.display = 'block';
    }
}

// Sidebar management
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');

    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
}

// Close sidebar when clicking on a link (mobile)
document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
            toggleSidebar();
        }
    });
});

// URL Routing with hash
function navigateTo(path) {
    window.location.hash = path;
}

async function handleRoute() {
    // Hide notifications modal on route change
    hideNotificationsModal();
    const hash = window.location.hash.slice(1) || '/';
    const pathParts = hash.split('/').filter(p => p);

    // Enhanced meta tag update with structured data
    const updateMetaTags = (title, description, image = null, type = 'website') => {
        // Use default image if none provided
        const ogImage = image || './images/plebs-og.png';

        // Update basic meta tags
        document.title = title;

        // Update or create meta tags
        const setMetaTag = (selector, attribute, value) => {
            let tag = document.querySelector(selector);
            if (!tag && selector.includes('property')) {
                tag = document.createElement('meta');
                tag.setAttribute('property', selector.match(/property="([^"]+)"/)[1]);
                document.head.appendChild(tag);
            } else if (!tag && selector.includes('name')) {
                tag = document.createElement('meta');
                tag.setAttribute('name', selector.match(/name="([^"]+)"/)[1]);
                document.head.appendChild(tag);
            }
            if (tag) tag.setAttribute('content', value);
        };

        setMetaTag('meta[name="description"]', 'content', description);
        setMetaTag('meta[property="og:title"]', 'content', title);
        setMetaTag('meta[property="og:description"]', 'content', description);
        setMetaTag('meta[property="og:type"]', 'content', type);
        setMetaTag('meta[property="og:site_name"]', 'content', 'Plebs');
        setMetaTag('meta[property="og:image"]', 'content', ogImage);

        // Set URL without hash for better sharing
        const canonicalUrl = window.location.origin + window.location.pathname;
        setMetaTag('meta[property="og:url"]', 'content', canonicalUrl);

        // Twitter Card tags
        setMetaTag('meta[name="twitter:card"]', 'content', image ? 'summary_large_image' : 'summary');
        setMetaTag('meta[name="twitter:title"]', 'content', title);
        setMetaTag('meta[name="twitter:description"]', 'content', description);
        setMetaTag('meta[name="twitter:image"]', 'content', ogImage);

        // Update canonical URL
        let canonical = document.querySelector('link[rel="canonical"]');
        if (!canonical) {
            canonical = document.createElement('link');
            canonical.setAttribute('rel', 'canonical');
            document.head.appendChild(canonical);
        }
        canonical.setAttribute('href', canonicalUrl);
    };

    // Add JSON-LD structured data
    const setStructuredData = (data) => {
        let script = document.querySelector('script[type="application/ld+json"]');
        if (!script) {
            script = document.createElement('script');
            script.type = 'application/ld+json';
            document.head.appendChild(script);
        }
        script.textContent = JSON.stringify(data);
    };

    // Reset to default meta tags first
    updateMetaTags(
        'Plebs - Uncensorable, Decentralized Video Platform',
        'Plebs is an uncensorable, decentralized video platform powered by the Nostr social protocol'
    );

    // Default structured data
    setStructuredData({
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": "Plebs",
        "description": "Uncensorable, decentralized video platform powered by Nostr",
        "url": window.location.origin
    });

    if (pathParts.length === 0) {
        loadHomeFeed();
    } else if (pathParts[0] === 'video' && pathParts[1]) {
        // For video pages, fetch metadata first for SEO
        const eventId = pathParts[1];

        // Show loading immediately
        document.getElementById('mainContent').innerHTML = '<div class="spinner"></div>';

        // Fetch video metadata for SEO
        try {
            const event = await fetchVideoEvent(eventId);
            if (event) {
                const videoData = parseVideoEvent(event);
                const profile = await fetchUserProfile(event.pubkey);

                if (videoData) {
                    const authorName = profile?.name || profile?.display_name || `User ${event.pubkey.slice(0, 8)}`;

                    // Update meta tags with video data
                    updateMetaTags(
                        `${videoData.title} - Plebs`,
                        videoData.description ? videoData.description.slice(0, 155) : `Watch "${videoData.title}" by ${authorName} on Plebs`,
                        videoData.thumbnail,
                        'video.other'
                    );

                    // Add video structured data
                    setStructuredData({
                        "@context": "https://schema.org",
                        "@type": "VideoObject",
                        "name": videoData.title,
                        "description": videoData.description || `Watch "${videoData.title}" on Plebs`,
                        "thumbnailUrl": videoData.thumbnail || undefined,
                        "uploadDate": new Date(event.created_at * 1000).toISOString(),
                        "duration": videoData.duration ? `PT${Math.floor(videoData.duration / 60)}M${videoData.duration % 60}S` : undefined,
                        "author": {
                            "@type": "Person",
                            "name": authorName,
                            "url": `${window.location.origin}/#/profile/${event.pubkey}`
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Failed to fetch video metadata:', error);
        }

        // Play video after metadata is set
        playVideo(pathParts[1]);
    } else if (pathParts[0] === 'profile' && pathParts[1]) {
        const pubkey = pathParts[1];

        // Fetch profile metadata for SEO
        try {
            const profile = await fetchUserProfile(pubkey);
            if (profile) {
                const displayName = profile?.name || profile?.display_name || `User ${pubkey.slice(0, 8)}`;
                const about = profile?.about || '';
                const avatarUrl = profile?.picture || profile?.avatar || '';

                updateMetaTags(
                    `${displayName} - Plebs`,
                    about ? about.slice(0, 155) : `Watch videos from ${displayName} on Plebs`,
                    avatarUrl,
                    'profile'
                );

                // Add person structured data
                setStructuredData({
                    "@context": "https://schema.org",
                    "@type": "Person",
                    "name": displayName,
                    "description": about,
                    "image": avatarUrl || undefined,
                    "url": `${window.location.origin}/#/profile/${pubkey}`
                });
            }
        } catch (error) {
            console.error('Failed to fetch profile metadata:', error);
        }

        loadProfile(pubkey);
    } else if (pathParts[0] === 'tag' && pathParts[1]) {
        const tag = pathParts[1];
        updateMetaTags(
            `${tag.charAt(0).toUpperCase() + tag.slice(1)} Videos - Plebs`,
            `Watch ${tag} videos on Plebs, the uncensorable decentralized video platform`
        );
        loadTag(tag);
    } else if (pathParts[0] === 'search' && pathParts[1]) {
        const query = decodeURIComponent(pathParts[1]);
        updateMetaTags(
            `Search: ${query} - Plebs`,
            `Search results for "${query}" on Plebs`
        );
        document.getElementById('searchInput').value = query;
        performSearch(pathParts[1]);
    } else if (pathParts[0] === 'subscriptions') {
        updateMetaTags(
            'Subscriptions - Plebs',
            'Watch videos from creators you follow on Plebs'
        );
        loadSubscriptions();
    } else if (pathParts[0] === 'my-videos') {
        updateMetaTags(
            'My Videos - Plebs',
            'Manage your videos on Plebs'
        );
        loadMyVideos();
    } else if (pathParts[0] === 'liked') {
        loadLikedVideos();
    } else {
        loadHomeFeed();
    }

    updateSidebarActive();
}

// Show notifications modal and fetch notifications
async function loadNotifications() {
    if (!currentUser) {
        alert("Please log in to view notifications");
        return;
    }

    const modal = document.getElementById("notificationsModal");
    const list = document.getElementById("notificationsList");
    list.innerHTML = '<div class="spinner"></div>';
    modal.classList.add("active");

    try {
        // Get user's videos
        const userVideosFilter = {
            kinds: [1],
            authors: [currentUser.pubkey],
            '#t': ['pv69420']
        };

        const userVideos = await fetchEvents(userVideosFilter);
        const videoIds = userVideos.map(e => e.id);

        if (videoIds.length === 0) {
            list.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No videos found to monitor.</p>';
            return;
        }

        // Fetch reactions to user's videos
        const reactions = [];
        const reactionFilter = {
            kinds: [7],
            '#e': videoIds,
            '#t': ['pv69420']
        };

        await new Promise((resolve) => {
            requestEventsStream(reactionFilter, (reactionEvent) => {
                const videoId = reactionEvent.tags.find(t => t[0] === 'e')?.[1];
                if (
                    videoId &&
                    videoIds.includes(videoId) &&
                    reactionEvent.pubkey !== currentUser.pubkey
                ) {
                    reactions.push(reactionEvent);
                }
            }, resolve);
        });

        // Fetch replies to user's videos
        const replies = [];
        const repliesFilter = {
            kinds: [1],
            '#e': videoIds
        };

        await new Promise((resolve) => {
            requestEventsStream(repliesFilter, (event) => {
                const videoId = event.tags.find(t => t[0] === 'e')?.[1];
                if (
                    videoId &&
                    videoIds.includes(videoId) &&
                    event.pubkey !== currentUser.pubkey
                ) {
                    replies.push(event);
                }
            }, resolve);
        });

        // Combine and sort notifications
        const notifications = [...reactions, ...replies].sort((a, b) => b.created_at - a.created_at);

        if (notifications.length === 0) {
            list.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No recent activity.</p>';
            return;
        }

        list.innerHTML = '';

        notifications.forEach(event => {
            const isReaction = event.kind === 7;
            const isReply = event.kind === 1;
            const videoId = event.tags.find(t => t[0] === 'e')?.[1];
            const video = userVideos.find(v => v.id === videoId);
            const videoTitle = video ? parseVideoEvent(video).title : 'Unknown Video';

            const from = event.pubkey.slice(0, 8);
            const timestamp = formatTimestamp(event.created_at);
            const content = isReaction
                ? `Reacted: ${event.content}`
                : `Replied: "${event.content.slice(0, 40)}${event.content.length > 40 ? '...' : ''}"`;

            const item = document.createElement('div');
            item.className = 'notification-item';
            item.innerHTML = `
                <div>
                    <div style="font-weight: 500;">${from}</div>
                    <div style="font-size: 0.875rem; color: var(--text-secondary);">${timestamp}</div>
                    <div style="margin-top: 0.25rem;">${content}</div>
                </div>
                <a href="#/video/${videoId}" onclick="hideNotificationsModal();">▶</a>
            `;
            list.appendChild(item);
        });

    } catch (error) {
        console.error("Failed to load notifications:", error);
        list.innerHTML = '<div class="error-message">Failed to load notifications</div>';
    }
}

// Utility: Fetch events via stream
function fetchEvents(filter) {
    return new Promise((resolve, reject) => {
        const results = [];
        requestEventsStream(filter, (event) => {
            results.push(event);
        }, () => resolve(results));
    });
}

// Utility: Close modal
function hideNotificationsModal() {
    document.getElementById("notificationsModal").classList.remove("active");
}

// Function to load liked videos
async function loadLikedVideos() {
    if (!currentUser) {
        document.getElementById('mainContent').innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Please login to view your liked videos.</p>';
        return;
    }

    currentView = 'liked';

    const mainContent = document.getElementById('mainContent');
    mainContent.innerHTML = `
        <h2 style="margin-bottom: 1.5rem;">Liked Videos</h2>
        <div class="video-grid" id="videoGrid">
            <div class="spinner"></div>
        </div>
    `;

    const videoGrid = document.getElementById('videoGrid');
    const likedVideoIds = new Set();

    // Create filter to get all like reactions from current user
    const reactionFilter = {
        kinds: [7],
        authors: [currentUser.pubkey],
        '#t': ['pv69420']
    };

    // Get all liked video IDs
    await new Promise((resolve) => {
        requestEventsStream(reactionFilter, (event) => {
            const videoIdTag = event.tags.find(tag => tag[0] === 'e');
            if (videoIdTag) {
                likedVideoIds.add(videoIdTag[1]);
            }
        }, resolve);
    });

    if (likedVideoIds.size === 0) {
        videoGrid.innerHTML = '<p style="text-align: center; color: var(--text-secondary); grid-column: 1/-1;">You haven\'t liked any videos yet.</p>';
        return;
    }

    // Create filter to get the video events
    const videoFilter = {
        kinds: [1],
        '#t': ['pv69420'],
        ids: Array.from(likedVideoIds)
    };

    // Use displayVideosStream to show these videos
    await displayVideosStream('Liked Videos', videoFilter);
}

// Function to handle zaps manually
async function handleZap(npub, amount, eventId = null) {
    if (!window.nostr) {
        alert('Please install a Nostr extension (like Alby or nos2x) to send zaps');
        return;
    }

    // Show zap amount selection modal
    showZapAmountModal(npub, eventId);
}

// Show zap amount selection modal
function showZapAmountModal(npub, eventId = null) {
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 3000;
        padding: 1rem;
    `;

    modal.innerHTML = `
        <div style="background: var(--bg-secondary); padding: 2rem; border-radius: 12px; max-width: 500px; width: 90%; text-align: center;">
            <h2 style="margin-bottom: 1.5rem;">Select Zap Amount</h2>
            
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; margin-bottom: 1.5rem;">
                <button class="zap-amount-btn" data-amount="21">21 ⚡</button>
                <button class="zap-amount-btn" data-amount="69">69 ⚡</button>
                <button class="zap-amount-btn" data-amount="420">420 ⚡</button>
                <button class="zap-amount-btn" data-amount="1337">1337 ⚡</button>
                <button class="zap-amount-btn" data-amount="5000">5k ⚡</button>
                <button class="zap-amount-btn" data-amount="10000">10k ⚡</button>
                <button class="zap-amount-btn" data-amount="21000">21k ⚡</button>
                <button class="zap-amount-btn" data-amount="1000000">1M ⚡</button>
            </div>
            
            <div style="margin-bottom: 1.5rem;">
                <input type="number" id="customZapAmount" placeholder="Custom amount" min="1" 
                       style="width: 100%; padding: 0.75rem; background: var(--bg-primary); border: 1px solid var(--border); 
                              border-radius: 8px; color: var(--text-primary); font-size: 1rem; text-align: center;">
            </div>
            
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button id="proceedZap" style="padding: 0.75rem 1.5rem; background: #f7931a; color: white; 
                                               border: none; border-radius: 8px; cursor: pointer; font-weight: 500;">
                    Continue with Custom Amount
                </button>
                <button onclick="this.closest('div[style*=fixed]').remove();" 
                        style="padding: 0.75rem 1.5rem; background: var(--bg-primary); color: var(--text-primary); 
                               border: 1px solid var(--border); border-radius: 8px; cursor: pointer;">
                    Cancel
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Add styles for zap amount buttons
    const style = document.createElement('style');
    style.textContent = `
        .zap-amount-btn {
            padding: 0.75rem;
            background: var(--bg-primary);
            border: 1px solid var(--border);
            border-radius: 8px;
            color: var(--text-primary);
            cursor: pointer;
            font-weight: 500;
            transition: all 0.2s;
        }
        .zap-amount-btn:hover {
            background: #f7931a;
            color: white;
            transform: translateY(-2px);
        }
    `;
    modal.appendChild(style);

    // Handle amount button clicks
    modal.querySelectorAll('.zap-amount-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const amount = parseInt(btn.getAttribute('data-amount'));
            modal.remove();
            await processZap(npub, amount, eventId);
        });
    });

    // Handle custom amount
    const customInput = modal.querySelector('#customZapAmount');
    const proceedBtn = modal.querySelector('#proceedZap');

    customInput.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        if (value > 0) {
            proceedBtn.textContent = `Zap ${value} sats`;
        } else {
            proceedBtn.textContent = 'Continue with Custom Amount';
        }
    });

    proceedBtn.addEventListener('click', async () => {
        const amount = parseInt(customInput.value);
        if (amount > 0) {
            modal.remove();
            await processZap(npub, amount, eventId);
        } else {
            alert('Please enter a valid amount');
        }
    });
}

// Process the actual zap
async function processZap(npub, amount, eventId = null) {
    try {
        // Create a zap request event (kind 9734)
        const zapRequest = {
            kind: 9734,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ['p', window.NostrTools.nip19.decode(npub).data],
                ['amount', amount.toString()],
                ['relays', ...RELAY_URLS]
            ],
            content: ''
        };

        // Add event tag if zapping a specific video
        if (eventId) {
            zapRequest.tags.push(['e', eventId]);
        }

        // Sign the zap request
        const signedZapRequest = await window.nostr.signEvent(zapRequest);

        // Get the lightning invoice from a LNURL service
        const lnurlResponse = await fetchLightningInvoice(npub, amount, JSON.stringify(signedZapRequest));

        if (lnurlResponse.pr) {
            // Show the invoice modal
            showLightningInvoice(lnurlResponse.pr, amount, !!window.webln);

            // Start polling for payment confirmation
            const paymentHash = extractPaymentHash(lnurlResponse.pr);
            pollForZapReceipt(window.NostrTools.nip19.decode(npub).data, amount, eventId, paymentHash);

            // Try to pay with WebLN if available
            if (window.webln) {
                try {
                    await window.webln.enable();
                    const result = await window.webln.sendPayment(lnurlResponse.pr);
                    if (result.preimage) {
                        // Payment successful through WebLN
                        // The polling will detect it and show success
                    }
                } catch (e) {
                    // WebLN payment failed, user needs to pay manually
                    console.log('WebLN payment failed, waiting for manual payment');
                }
            }
        }
    } catch (error) {
        console.error('Failed to create zap:', error);
        alert('Failed to create zap. Please try again.');
    }
}

// Function to poll for zap receipts
async function pollForZapReceipt(recipientPubkey, amount, eventId, paymentHash) {
    const startTime = Date.now();
    const timeout = 60000; // 60 seconds timeout
    const pollInterval = 2000; // Check every 2 seconds

    const checkForReceipt = async () => {
        // Check if timeout reached
        if (Date.now() - startTime > timeout) {
            console.log('Zap receipt polling timeout');
            return;
        }

        // Create filter for zap receipts
        const filter = {
            kinds: [9735], // Zap receipt
            '#p': [recipientPubkey],
            since: Math.floor(startTime / 1000) - 10 // Look 10 seconds before start
        };

        if (eventId) {
            filter['#e'] = [eventId];
        }

        let foundReceipt = false;

        await new Promise((resolve) => {
            requestEventsStream(filter, (event) => {
                try {
                    // Check if this is our zap by amount
                    const bolt11Tag = event.tags.find(tag => tag[0] === 'bolt11');
                    if (bolt11Tag && bolt11Tag[1]) {
                        const receiptAmount = extractAmountFromBolt11(bolt11Tag[1]);

                        // Check if amount matches (with small tolerance for fees)
                        if (Math.abs(receiptAmount - amount) < 10) {
                            // Found our zap!
                            foundReceipt = true;

                            // Close invoice modal and show success
                            const invoiceModal = document.getElementById('lightning-invoice-modal');
                            if (invoiceModal) {
                                invoiceModal.remove();
                            }

                            showZapSuccess(amount);

                            // Update zap count if it's a video zap
                            if (eventId) {
                                setTimeout(async () => {
                                    const zapData = await loadZapsForVideo(eventId);
                                    updateZapButton(eventId, zapData.totalZaps);
                                }, 500);
                            }
                        }
                    }
                } catch (e) {
                    console.error('Error checking zap receipt:', e);
                }
            }, () => {
                resolve();
            });
        });

        // Continue polling if not found
        if (!foundReceipt) {
            setTimeout(checkForReceipt, pollInterval);
        }
    };

    // Start polling after a short delay
    setTimeout(checkForReceipt, 2000);
}

// Helper to extract payment hash from bolt11
function extractPaymentHash(bolt11) {
    return bolt11.slice(-20);
}

// Fetch lightning invoice from LNURL service
async function fetchLightningInvoice(npub, amount, zapRequest) {
    const pubkey = window.NostrTools.nip19.decode(npub).data;
    const profile = await loadUserProfile(pubkey);

    if (!profile) {
        throw new Error('Could not load user profile');
    }

    // Try lud16 (lightning address) first
    if (profile.lud16) {
        const [name, domain] = profile.lud16.split('@');
        const url = `https://${domain}/.well-known/lnurlp/${name}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.callback) {
                const invoiceUrl = new URL(data.callback);
                invoiceUrl.searchParams.set('amount', amount * 1000); // Convert to millisats
                invoiceUrl.searchParams.set('nostr', zapRequest);

                const invoiceResponse = await fetch(invoiceUrl.toString());
                return await invoiceResponse.json();
            }
        } catch (error) {
            console.error('Failed to fetch from lightning address:', error);
        }
    }

    // Try lud06 (LNURL) as fallback
    if (profile.lud06) {
        try {
            // Decode LNURL-encoded URL
            const decoded = window.NostrTools.nip19.decode(profile.lud06);
            const url = decoded.data;

            const response = await fetch(url);
            const data = await response.json();

            if (data.callback) {
                const invoiceUrl = new URL(data.callback);
                invoiceUrl.searchParams.set('amount', amount * 1000); // Convert to millisats
                invoiceUrl.searchParams.set('nostr', zapRequest);

                const invoiceResponse = await fetch(invoiceUrl.toString());
                return await invoiceResponse.json();
            }
        } catch (error) {
            console.error('Failed to fetch from LNURL:', error);
        }
    }

    throw new Error('User does not have Lightning support');
}

// Show lightning invoice modal
function showLightningInvoice(invoice, amount, isWebLN = false) {
    // Create a modal to show the invoice
    const modal = document.createElement('div');
    modal.id = 'lightning-invoice-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 3000;
        padding: 1rem;
    `;

    modal.innerHTML = `
        <div style="background: var(--bg-secondary); padding: 2rem; border-radius: 12px; max-width: 500px; width: 90%; text-align: center;">
            <h2 style="margin-bottom: 0.5rem;">Lightning Invoice</h2>
            <p style="margin-bottom: 1rem; color: var(--text-secondary);">Zap ${amount} sats</p>
            <p style="margin-bottom: 1rem;">${isWebLN ? 'Processing payment...' : 'Scan with your Lightning wallet:'}</p>
            
            <div style="background: white; padding: 1rem; border-radius: 8px; margin: 1rem auto; display: inline-block;">
                <div id="qrcode"></div>
            </div>
            
            <div style="margin: 1rem 0; color: var(--text-secondary); font-size: 0.875rem;">
                <div id="payment-status">
                    <div class="spinner" style="width: 20px; height: 20px; margin: 0 auto 0.5rem;"></div>
                    Waiting for payment confirmation...
                </div>
            </div>
            
            <textarea readonly style="width: 100%; padding: 0.5rem; margin: 1rem 0; font-size: 0.75rem; word-break: break-all; 
                                     height: 100px; resize: none; background: var(--bg-primary); color: var(--text-primary); 
                                     border: 1px solid var(--border); border-radius: 4px;">${invoice}</textarea>
            
            <div style="display: flex; gap: 0.5rem; justify-content: center;">
                <button onclick="navigator.clipboard.writeText('${invoice}').then(() => {
                    const btn = event.target;
                    const originalText = btn.textContent;
                    btn.textContent = 'Copied!';
                    btn.style.background = 'var(--accent)';
                    setTimeout(() => {
                        btn.textContent = originalText;
                        btn.style.background = '#f7931a';
                    }, 2000);
                });" style="padding: 0.5rem 1rem; background: #f7931a; color: white; border: none; border-radius: 4px; cursor: pointer;">
                    Copy Invoice
                </button>
                <button onclick="document.getElementById('lightning-invoice-modal').remove();" 
                        style="padding: 0.5rem 1rem; background: var(--bg-primary); color: var(--text-primary); 
                               border: 1px solid var(--border); border-radius: 4px; cursor: pointer;">
                    Close
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Generate QR code
    if (window.QRCode) {
        new QRCode(document.getElementById("qrcode"), {
            text: invoice.toUpperCase(),
            width: 256,
            height: 256,
            colorDark: "#000000",
            colorLight: "#FFFFFF",
            correctLevel: QRCode.CorrectLevel.L
        });
    }
}

// Show zap success animation
function showZapSuccess(amount) {
    // Remove any existing invoice modal
    const invoiceModal = document.getElementById('lightning-invoice-modal');
    if (invoiceModal) {
        invoiceModal.remove();
    }

    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 3000;
    `;

    modal.innerHTML = `
        <div style="background: var(--bg-secondary); padding: 3rem; border-radius: 12px; text-align: center;">
            <div class="zap-success-animation">
                <svg width="120" height="120" viewBox="0 0 24 24" fill="#f7931a" style="margin-bottom: 1rem;">
                    <path d="M7 2v11h3v9l7-12h-4l4-8z"/>
                </svg>
                <h2 style="color: #f7931a; margin-bottom: 0.5rem;">Zap Sent!</h2>
                <p style="font-size: 1.5rem; font-weight: bold;">${amount} sats</p>
            </div>
        </div>
    `;

    // Add animation styles
    const style = document.createElement('style');
    style.textContent = `
        .zap-success-animation {
            animation: zapPulse 0.5s ease-out;
        }
        
        .zap-success-animation svg {
            animation: zapBolt 0.8s ease-out;
        }
        
        @keyframes zapPulse {
            0% { transform: scale(0.8); opacity: 0; }
            50% { transform: scale(1.1); }
            100% { transform: scale(1); opacity: 1; }
        }
        
        @keyframes zapBolt {
            0% { transform: translateY(-20px) rotate(-10deg); opacity: 0; }
            50% { transform: translateY(0) rotate(5deg); opacity: 1; }
            100% { transform: translateY(0) rotate(0deg); }
        }
    `;
    document.head.appendChild(style);

    document.body.appendChild(modal);

    // Auto close after 2 seconds
    setTimeout(() => {
        modal.style.opacity = '0';
        modal.style.transition = 'opacity 0.3s ease-out';
        setTimeout(() => {
            modal.remove();
            style.remove();
        }, 300);
    }, 2000);
}

// Update the video player zap button
function updateZapButton(eventId, totalZaps) {
    // Find the zap button using data attribute
    const zapBtn = document.querySelector(`.action-btn.zap[data-event-id="${eventId}"]`);
    if (zapBtn) {
        zapBtn.querySelector('.count').textContent = totalZaps > 0 ? formatSats(totalZaps) : 'Zap';
        // Add active class if zapped
        if (totalZaps > 0) {
            zapBtn.classList.add('active');
        }
    }
}

// Check NSFW preference
function shouldShowNSFW() {
    return localStorage.getItem('allowNSFW') === 'true' || sessionNSFWAllowed;
}

// Scroll carousel
function scrollCarousel(direction) {
    const trendingGrid = document.getElementById('trendingGrid');
    if (!trendingGrid) return;

    const currentPage = parseInt(trendingGrid.dataset.currentPage || '0');
    const totalPages = parseInt(trendingGrid.dataset.totalPages || '1');
    const itemsPerPage = parseInt(trendingGrid.dataset.itemsPerPage || '3');

    const newPage = Math.max(0, Math.min(currentPage + direction, totalPages - 1));

    if (newPage !== currentPage) {
        goToPage(newPage);
    }
}

// Go to specific page
function goToPage(page) {
    const trendingGrid = document.getElementById('trendingGrid');
    const carouselDots = document.getElementById('carouselDots');
    if (!trendingGrid || !carouselDots) return;

    const itemsPerPage = parseInt(trendingGrid.dataset.itemsPerPage || '3');
    const cardWidth = 100 / itemsPerPage;
    const translateX = -page * 100;

    trendingGrid.style.transform = `translateX(${translateX}%)`;
    trendingGrid.dataset.currentPage = page;

    // Update dots
    carouselDots.querySelectorAll('.carousel-dot').forEach((dot, index) => {
        dot.classList.toggle('active', index === page);
    });

    // Update buttons
    updateCarouselButtons();
}

// Update carousel button states
function updateCarouselButtons() {
    const trendingGrid = document.getElementById('trendingGrid');
    const prevBtn = document.querySelector('.carousel-btn.prev');
    const nextBtn = document.querySelector('.carousel-btn.next');

    if (!trendingGrid || !prevBtn || !nextBtn) return;

    const currentPage = parseInt(trendingGrid.dataset.currentPage || '0');
    const totalPages = parseInt(trendingGrid.dataset.totalPages || '1');

    prevBtn.disabled = currentPage === 0;
    nextBtn.disabled = currentPage === totalPages - 1;
}

// Calculate if video is ratioed
function isVideoRatioed(reactions) {
    const likes = reactions.likes || 0;
    const dislikes = reactions.dislikes || 0;
    const total = likes + dislikes;

    // Criteria for being ratioed:
    // 1. At least 10 total reactions to avoid false positives
    // 2. Dislikes are at least 2x likes
    // 3. Dislikes make up at least 70% of total reactions
    if (total >= 10) {
        const dislikeRatio = dislikes / total;
        return dislikes >= likes * 2 && dislikeRatio >= 0.7;
    }
    return false;
}

// Connect to a relay
function connectToRelay(url) {
    return new Promise((resolve, reject) => {
        if (relayConnections[url] && relayConnections[url].readyState === WebSocket.OPEN) {
            resolve(relayConnections[url]);
            return;
        }

        const ws = new WebSocket(url);

        ws.onopen = () => {
            console.log(`Connected to ${url}`);
            relayConnections[url] = ws;
            resolve(ws);
        };

        ws.onerror = (error) => {
            console.error(`Failed to connect to ${url}:`, error);
            reject(error);
        };

        ws.onclose = () => {
            console.log(`Disconnected from ${url}`);
            delete relayConnections[url];
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleRelayMessage(url, message);
            } catch (error) {
                console.error('Failed to parse message:', error);
            }
        };
    });
}

// Handle messages from relays
function handleRelayMessage(relayUrl, message) {
    if (message[0] === 'EVENT') {
        const subscriptionId = message[1];
        const event = message[2];

        // Store event
        allEvents.set(event.id, event);

        // Store profile if it's a kind 0 event
        if (event.kind === 0) {
            try {
                const profile = JSON.parse(event.content);
                profileCache.set(event.pubkey, profile);
            } catch (e) {
                console.error('Failed to parse profile:', e);
            }
        }

        // Trigger any subscription handlers
        if (window.subscriptionHandlers && window.subscriptionHandlers[subscriptionId]) {
            window.subscriptionHandlers[subscriptionId](event);
        }
    }
}

// Streaming request events
async function requestEventsStream(filter, onEvent, onComplete) {
    const subscriptionId = Math.random().toString(36).substring(7);
    const eventsMap = new Map();
    const seenEventIds = new Set();
    let completedRelays = 0;
    const totalRelays = RELAY_URLS.length;

    // Set up subscription handler
    if (!window.subscriptionHandlers) {
        window.subscriptionHandlers = {};
    }

    window.subscriptionHandlers[subscriptionId] = (event) => {
        if (!eventsMap.has(event.id)) {
            eventsMap.set(event.id, event);
            // Only call the streaming callback if we haven't seen this event before
            if (onEvent && !seenEventIds.has(event.id)) {
                seenEventIds.add(event.id);
                onEvent(event);
            }
        }
    };

    // Connect to all relays
    for (const url of RELAY_URLS) {
        try {
            const ws = await connectToRelay(url);
            const req = JSON.stringify(['REQ', subscriptionId, filter]);
            ws.send(req);

            // Listen for EOSE (End of Stored Events) message
            const originalOnMessage = ws.onmessage;
            ws.onmessage = (event) => {
                originalOnMessage(event);
                try {
                    const message = JSON.parse(event.data);
                    if (message[0] === 'EOSE' && message[1] === subscriptionId) {
                        // This relay has finished sending stored events
                        completedRelays++;

                        // Close subscription on this relay
                        ws.send(JSON.stringify(['CLOSE', subscriptionId]));

                        // Check if all relays have completed
                        if (completedRelays === totalRelays) {
                            delete window.subscriptionHandlers[subscriptionId];
                            if (onComplete) {
                                onComplete(Array.from(eventsMap.values()));
                            }
                        }
                    }
                } catch (error) {
                    // Ignore parse errors for non-JSON messages
                }
            };
        } catch (error) {
            console.error(`Failed to connect to ${url}:`, error);
            completedRelays++;
            // Check if all relays have completed (including failed ones)
            if (completedRelays === totalRelays) {
                delete window.subscriptionHandlers[subscriptionId];
                if (onComplete) {
                    onComplete(Array.from(eventsMap.values()));
                }
            }
        }
    }
}

// Function to handle streaming video display
async function displayVideosStream(title, filter) {
    const mainContent = document.getElementById('mainContent');
    mainContent.innerHTML = `
        <h2 style="margin-bottom: 1.5rem;">${title}</h2>
        <div class="video-grid" id="videoGrid">
            <div class="spinner"></div>
        </div>
    `;

    const videoGrid = document.getElementById('videoGrid');
    const renderedVideos = new Map();
    const videoEvents = [];
    const profileQueue = new Set();
    const reactionQueue = new Set();
    let profileTimer = null;
    let reactionTimer = null;

    // Global reaction storage to accumulate across all relays
    const globalReactions = new Map(); // videoId -> Map(userId -> {reaction, timestamp})

    // Function to update a video card
    const updateVideoCard = (event, profile, reactions) => {
        const cardId = `video-card-${event.id}`;
        const existingCard = document.getElementById(cardId);

        if (!existingCard) return;

        const cardHTML = createVideoCard(event, profile, reactions);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cardHTML;

        if (tempDiv.firstElementChild) {
            tempDiv.firstElementChild.id = cardId;
            existingCard.parentNode.replaceChild(tempDiv.firstElementChild, existingCard);
        }
    };

    // Function to render a single video card
    const renderVideoCard = (event, profile = null, reactions = null) => {
        const cardId = `video-card-${event.id}`;

        // Check if card already exists
        if (document.getElementById(cardId)) {
            updateVideoCard(event, profile, reactions);
            return;
        }

        const cardHTML = createVideoCard(event, profile, reactions);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cardHTML;

        if (!tempDiv.firstElementChild) return;

        tempDiv.firstElementChild.id = cardId;

        // Find correct position based on timestamp
        let inserted = false;
        const cards = videoGrid.querySelectorAll('.video-card');

        for (let i = 0; i < cards.length; i++) {
            const cardEventId = cards[i].id.replace('video-card-', '');
            const cardEvent = renderedVideos.get(cardEventId);
            if (cardEvent && event.created_at > cardEvent.created_at) {
                cards[i].parentNode.insertBefore(tempDiv.firstElementChild, cards[i]);
                inserted = true;
                break;
            }
        }

        if (!inserted) {
            videoGrid.appendChild(tempDiv.firstElementChild);
        }

        renderedVideos.set(event.id, event);
    };

    // Batch load profiles
    const loadProfilesBatch = async () => {
        if (profileQueue.size === 0) return;

        const pubkeys = Array.from(profileQueue);
        profileQueue.clear();

        const filter = {
            kinds: [0],
            authors: pubkeys
        };

        await requestEventsStream(filter, (profileEvent) => {
            try {
                const profile = JSON.parse(profileEvent.content);
                profileCache.set(profileEvent.pubkey, profile);

                // Update all videos by this author
                videoEvents.forEach(event => {
                    if (event.pubkey === profileEvent.pubkey) {
                        const reactions = reactionsCache.get(event.id);
                        updateVideoCard(event, profile, reactions);
                    }
                });
            } catch (e) {
                console.error('Failed to parse profile:', e);
            }
        });
    };

    // Calculate reactions from global storage
    const calculateReactions = (videoId) => {
        const reactions = { likes: 0, dislikes: 0, userReaction: null };
        const videoReactions = globalReactions.get(videoId);

        if (videoReactions) {
            videoReactions.forEach((data, userPubkey) => {
                if (data.reaction === '👍') {
                    reactions.likes++;
                    if (currentUser && userPubkey === currentUser.pubkey) {
                        reactions.userReaction = 'like';
                    }
                } else if (data.reaction === '👎') {
                    reactions.dislikes++;
                    if (currentUser && userPubkey === currentUser.pubkey) {
                        reactions.userReaction = 'dislike';
                    }
                }
            });
        }

        return reactions;
    };

    // Batch load reactions
    const loadReactionsBatch = async () => {
        if (reactionQueue.size === 0) return;

        const videoIds = Array.from(reactionQueue);
        reactionQueue.clear();

        const filter = {
            kinds: [7],
            '#e': videoIds,
            '#t': ['pv69420']
        };

        await requestEventsStream(filter, (reactionEvent) => {
            const videoId = reactionEvent.tags.find(tag => tag[0] === 'e')?.[1];
            if (videoId && videoIds.includes(videoId)) {
                // Initialize video reactions map if needed
                if (!globalReactions.has(videoId)) {
                    globalReactions.set(videoId, new Map());
                }

                const videoReactions = globalReactions.get(videoId);
                const userPubkey = reactionEvent.pubkey;
                const timestamp = reactionEvent.created_at;

                // Only update if this is newer than existing reaction from this user
                const existingReaction = videoReactions.get(userPubkey);
                if (!existingReaction || existingReaction.timestamp < timestamp) {
                    videoReactions.set(userPubkey, {
                        reaction: reactionEvent.content,
                        timestamp: timestamp
                    });

                    // Calculate and cache updated reactions
                    const reactions = calculateReactions(videoId);
                    reactionsCache.set(videoId, reactions);

                    // Update the video card if it exists
                    const event = videoEvents.find(e => e.id === videoId);
                    if (event) {
                        const profile = profileCache.get(event.pubkey);
                        updateVideoCard(event, profile, reactions);
                    }
                }
            }
        });
    };

    // Handle incoming video events
    await requestEventsStream(filter, (event) => {
        // Check if it's a video event
        const tags = event.tags || [];
        if (!tags.some(tag => tag[0] === 'x')) return;

        // Skip if we've already processed this event
        if (videoEvents.some(e => e.id === event.id)) {
            return;
        }

        videoEvents.push(event);
        allEvents.set(event.id, event);

        // Remove spinner if it exists
        const spinner = videoGrid.querySelector('.spinner');
        if (spinner) spinner.remove();

        // Render video card immediately with whatever data we have
        const cachedProfile = profileCache.get(event.pubkey);
        const cachedReactions = reactionsCache.get(event.id);
        renderVideoCard(event, cachedProfile, cachedReactions);

        // Queue profile load if not cached
        if (!cachedProfile) {
            profileQueue.add(event.pubkey);
            clearTimeout(profileTimer);
            profileTimer = setTimeout(loadProfilesBatch, 100);
        }

        // Queue reaction load
        reactionQueue.add(event.id);
        clearTimeout(reactionTimer);
        reactionTimer = setTimeout(loadReactionsBatch, 200);

    }, (allEvents) => {
        // Final cleanup
        if (videoEvents.length === 0) {
            videoGrid.innerHTML = '<p style="text-align: center; color: var(--text-secondary); grid-column: 1/-1;">No videos found.</p>';
        }

        // Force final profile and reaction load for any remaining items
        if (profileQueue.size > 0) {
            loadProfilesBatch();
        }
        if (reactionQueue.size > 0) {
            loadReactionsBatch();
        }
    });
}

// Load reactions for videos (non-streaming version for playVideo)
async function loadReactionsForVideos(videoIds, onUpdate = null) {
    const filter = {
        kinds: [7],
        '#e': videoIds,
        '#t': ['pv69420']
    };

    // Use a Map to track user reactions properly
    const userReactions = new Map(); // videoId -> Map(userId -> {reaction, timestamp})

    // Initialize maps for each video
    videoIds.forEach(id => {
        userReactions.set(id, new Map());
    });

    return new Promise((resolve) => {
        requestEventsStream(filter, (event) => {
            const videoId = event.tags.find(tag => tag[0] === 'e')?.[1];
            if (videoId && videoIds.includes(videoId)) {
                const videoReactionMap = userReactions.get(videoId);
                const userPubkey = event.pubkey;
                const timestamp = event.created_at;

                // Only update if this is newer than existing reaction from this user
                const existingReaction = videoReactionMap.get(userPubkey);
                if (!existingReaction || existingReaction.timestamp < timestamp) {
                    videoReactionMap.set(userPubkey, {
                        reaction: event.content,
                        timestamp: timestamp
                    });

                    // Calculate current reactions for this video
                    const reactions = { likes: 0, dislikes: 0, userReaction: null };
                    videoReactionMap.forEach((data, pubkey) => {
                        if (data.reaction === '👍') {
                            reactions.likes++;
                            if (currentUser && pubkey === currentUser.pubkey) {
                                reactions.userReaction = 'like';
                            }
                        } else if (data.reaction === '👎') {
                            reactions.dislikes++;
                            if (currentUser && pubkey === currentUser.pubkey) {
                                reactions.userReaction = 'dislike';
                            }
                        }
                    });

                    // Update cache
                    reactionsCache.set(videoId, reactions);

                    // Call update callback if provided
                    if (onUpdate) {
                        onUpdate(videoId, reactions);
                    }
                }
            }
        }, () => {
            // All events received - final calculation
            const reactions = {};
            videoIds.forEach(id => {
                reactions[id] = { likes: 0, dislikes: 0, userReaction: null };

                const videoReactionMap = userReactions.get(id);
                videoReactionMap.forEach((data, userPubkey) => {
                    if (data.reaction === '👍') {
                        reactions[id].likes++;
                        if (currentUser && userPubkey === currentUser.pubkey) {
                            reactions[id].userReaction = 'like';
                        }
                    } else if (data.reaction === '👎') {
                        reactions[id].dislikes++;
                        if (currentUser && userPubkey === currentUser.pubkey) {
                            reactions[id].userReaction = 'dislike';
                        }
                    }
                });

                // Update cache with final values
                reactionsCache.set(id, reactions[id]);
            });

            resolve(reactions);
        });
    });
}

// Load zaps for videos
async function loadZapsForVideo(eventId, onUpdate = null) {
    const filter = {
        kinds: [9735], // Zap receipts
        '#e': [eventId]
    };

    let totalZaps = 0;
    const zaps = [];

    return new Promise((resolve) => {
        requestEventsStream(filter, (event) => {
            try {
                // Extract zap amount from bolt11 tag
                const bolt11Tag = event.tags.find(tag => tag[0] === 'bolt11');
                if (bolt11Tag && bolt11Tag[1]) {
                    // Parse amount from bolt11 invoice
                    const amount = extractAmountFromBolt11(bolt11Tag[1]);
                    if (amount > 0) {
                        totalZaps += amount;
                        zaps.push({ amount, event });

                        // Call update callback if provided
                        if (onUpdate) {
                            onUpdate(totalZaps, zaps.length);
                        }
                    }
                }
            } catch (e) {
                console.error('Failed to parse zap:', e);
            }
        }, () => {
            resolve({ totalZaps, zaps, count: zaps.length });
        });
    });
}

// Extract amount from bolt11 invoice
function extractAmountFromBolt11(bolt11) {
    try {
        const amountMatch = bolt11.match(/lnbc(\d+)([munp])/i);
        if (amountMatch) {
            const amount = parseInt(amountMatch[1]);
            const multiplier = amountMatch[2];
            switch (multiplier) {
                case 'm': return amount * 100000; // millisats
                case 'u': return amount * 100; // microsats
                case 'n': return amount * 0.1; // nanosats
                case 'p': return amount * 0.0001; // picosats
                default: return amount * 100000000; // sats
            }
        }
    } catch (e) {
        console.error('Failed to parse bolt11:', e);
    }
    return 0;
}

// Format sats amount
function formatSats(sats) {
    if (sats >= 1000000) {
        return `${(sats / 1000000).toFixed(1)}M`;
    } else if (sats >= 1000) {
        return `${(sats / 1000).toFixed(1)}K`;
    }
    return sats.toString();
}

// Format counts amount
function formatNumber(num) {
    if (num >= 1000000) {
        return `${(num / 1000000).toFixed(1)}M`;
    } else if (num >= 1000) {
        return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
}

// Send reaction event
async function sendReaction(eventId, reaction) {
    if (!currentUser || !window.nostr) {
        alert('Please login to react to videos');
        return false;
    }

    const reactionEvent = {
        kind: 7,
        tags: [
            ['e', eventId],
            ['p', allEvents.get(eventId)?.pubkey || ''],
            ['t', 'pv69420']
        ],
        content: reaction,
        created_at: Math.floor(Date.now() / 1000)
    };

    try {
        const signedEvent = await window.nostr.signEvent(reactionEvent);
        const published = await publishEvent(signedEvent);

        if (published) {
            // Update local cache
            const reactions = reactionsCache.get(eventId) || { likes: 0, dislikes: 0, userReaction: null };

            // Remove previous reaction if exists
            if (reactions.userReaction === 'like') reactions.likes--;
            if (reactions.userReaction === 'dislike') reactions.dislikes--;

            // Add new reaction
            if (reaction === '👍') {
                reactions.likes++;
                reactions.userReaction = 'like';
            } else if (reaction === '👎') {
                reactions.dislikes++;
                reactions.userReaction = 'dislike';
            }

            reactionsCache.set(eventId, reactions);
            return true;
        }
    } catch (error) {
        console.error('Failed to send reaction:', error);
    }

    return false;
}

// Function to fetch a single profile and return immediately when found
async function fetchUserProfile(pubkey) {
    // Check cache first
    if (profileCache.has(pubkey)) {
        return profileCache.get(pubkey);
    }

    return new Promise((resolve) => {
        let found = false;
        const filter = {
            kinds: [0],
            authors: [pubkey],
            limit: 1
        };

        requestEventsStream(filter, (event) => {
            // Return immediately on first match
            if (!found && event.pubkey === pubkey) {
                found = true;
                try {
                    const profile = JSON.parse(event.content);
                    profileCache.set(event.pubkey, profile);
                    resolve(profile);
                } catch (e) {
                    console.error('Failed to parse profile:', e);
                    resolve(null);
                }
            }
        }, () => {
            // If no profile found after all relays complete
            if (!found) {
                resolve(null);
            }
        });
    });
}

// Load user profile
async function loadUserProfile(pubkey) {
    return fetchUserProfile(pubkey);
}

// Load multiple user profiles
async function loadUserProfiles(pubkeys) {
    const uniquePubkeys = [...new Set(pubkeys)];
    const uncachedPubkeys = uniquePubkeys.filter(pk => !profileCache.has(pk));

    if (uncachedPubkeys.length > 0) {
        const filter = {
            kinds: [0],
            authors: uncachedPubkeys
        };

        await new Promise((resolve) => {
            requestEventsStream(filter, (profileEvent) => {
                try {
                    const profile = JSON.parse(profileEvent.content);
                    profileCache.set(profileEvent.pubkey, profile);
                } catch (e) {
                    console.error('Failed to parse profile:', e);
                }
            }, resolve);
        });
    }

    const profiles = {};
    uniquePubkeys.forEach(pk => {
        profiles[pk] = profileCache.get(pk) || null;
    });

    return profiles;
}

// Publish event to relays
async function publishEvent(event) {
    const eventMessage = JSON.stringify(['EVENT', event]);
    let published = false;

    for (const url of RELAY_URLS) {
        try {
            const ws = await connectToRelay(url);
            ws.send(eventMessage);
            published = true;
        } catch (error) {
            console.error(`Failed to publish to ${url}:`, error);
        }
    }

    return published;
}

// Create note identifier from event
function createNote(event) {
    if (!window.NostrTools) {
        console.error('NostrTools not loaded');
        return null;
    }

    const { nip19 } = window.NostrTools;

    // Encode as note (just the event id)
    const note = nip19.noteEncode(event.id);

    return note;
}

// Initialize app
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize theme
    initTheme();

    // Listen for login events
    window.addEventListener('nlAuth', async (e) => {
        console.log('Auth event received:', e.detail);
        if (e.detail.type === 'login' || e.detail.type === 'signup') {
            currentUser = e.detail;
            console.log('User logged in:', currentUser);
            handleRoute();
        }
    });

    // Listen for logout
    window.addEventListener('nlLogout', async () => {
        console.log('User logged out');
        currentUser = null;
        handleRoute();
    });

    // Check if already logged in
    if (window.nostr) {
        try {
            const pubkey = await window.nostr.getPublicKey();
            currentUser = { pubkey };
            console.log('User already logged in:', pubkey);
        } catch (e) {
            console.log('No user logged in');
        }
    }

    // Handle hash changes
    window.addEventListener('hashchange', handleRoute);

    // Handle initial route
    handleRoute();
});

// Format duration
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Format timestamp
function formatTimestamp(timestamp) {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diff = now - date;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (years > 0) return `${years} year${years > 1 ? 's' : ''} ago`;
    if (months > 0) return `${months} month${months > 1 ? 's' : ''} ago`;
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return `${seconds} second${seconds > 1 ? 's' : ''} ago`;
}

// Get video URL with fallback
async function getVideoUrl(hash, servers = BLOSSOM_SERVERS) {
    for (const server of servers) {
        const url = `${server}/${hash}`;
        try {
            const response = await fetch(url, { method: 'HEAD' });
            if (response.ok) {
                return url;
            }
        } catch (error) {
            console.error(`Failed to check ${server}:`, error);
        }
    }
    return null;
}

// Check if video is NSFW
function isVideoNSFW(event) {
    const tags = event.tags || [];
    return tags.some(tag => tag[0] === 'content-warning' && tag[1] === 'nsfw');
}

// Function to create cards for videos
function createVideoCard(event, profile, reactions, isTrending = false, trendingRank = null) {
    const videoData = parseVideoEvent(event);
    if (!videoData) return '';

    const displayName = profile?.name || profile?.display_name || `User ${event.pubkey.slice(0, 8)}`;
    const avatarUrl = profile?.picture || profile?.avatar || '';
    const nip05 = profile?.nip05 || '';
    const isNSFW = isVideoNSFW(event);
    const isRatioed = isVideoRatioed(reactions || {});
    const isSuspiciousProfile = !avatarUrl || !nip05; // Check for missing avatar or nip05
    const showBlurred = (isNSFW && !shouldShowNSFW()) || (isRatioed && !sessionRatioedAllowed.has(event.id)) || (isSuspiciousProfile && !sessionRatioedAllowed.has(event.id));
    
    // If this is a trending video and it has a community warning, don't render it
    if (isTrending && (isRatioed || isSuspiciousProfile)) {
        return '';
    }

    return `
                <div class="video-card">
                    <div class="video-thumbnail ${showBlurred ? (isRatioed || isSuspiciousProfile ? 'ratioed' : 'nsfw') : ''}" 
                         onclick="${showBlurred ? (isRatioed || isSuspiciousProfile ? `showRatioedModal('${event.id}')` : `showNSFWModal('playVideo', '${event.id}')`) : `navigateTo('/video/${event.id}')`}">
                        ${videoData.thumbnail ?
            `<img src="${videoData.thumbnail}" alt="${videoData.title}" onerror="this.style.display='none'">` :
            `<video src="${videoData.url}" preload="metadata"></video>`
        }
                        ${showBlurred ? `
                            <div class="${(isRatioed || isSuspiciousProfile) ? 'ratioed-overlay' : 'nsfw-overlay'}">
                                <div class="${(isRatioed || isSuspiciousProfile) ? 'ratioed-badge' : 'nsfw-badge'}">${(isRatioed || isSuspiciousProfile) ? 'COMMUNITY WARNING' : 'NSFW'}</div>
                                <div>Click to view</div>
                            </div>
                        ` : ''}
                        ${!showBlurred && videoData.duration ? `<span class="video-duration">${formatDuration(videoData.duration)}</span>` : ''}
                        ${reactions && (reactions.likes > 0 || reactions.dislikes > 0) ? `
                        <div class="video-reactions">
                            ${reactions.likes > 0 ? `
                                <span class="reaction-count likes">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/>
                                    </svg>
                                    ${formatNumber(reactions.likes)}
                                </span>
                            ` : ''}
                            ${reactions.dislikes > 0 ? `
                                <span class="reaction-count dislikes">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                        <path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/>
                                    </svg>
                                    ${formatNumber(reactions.dislikes)}
                                </span>
                            ` : ''}
                        </div>
                    ` : ''}
                    </div>
                    <div class="video-info">
                        <a href="#/profile/${event.pubkey}" class="channel-info">
                            <div class="channel-avatar">
                                ${avatarUrl ? `<img src="${avatarUrl}" alt="${displayName}">` : ''}
                            </div>
                            <div class="channel-details">
                                <div class="channel-name">${displayName}</div>
                                ${nip05 ? `<div class="channel-nip05">${nip05}</div>` : ''}
                            </div>
                        </a>
                        <h3 class="video-title" onclick="${showBlurred ? (isRatioed || isSuspiciousProfile ? `showRatioedModal('${event.id}')` : `showNSFWModal('playVideo', '${event.id}')`) : `navigateTo('/video/${event.id}')`}">${videoData.title}</h3>
                        <div class="video-meta">
                            ${formatTimestamp(event.created_at)}
                            ${isNSFW ? ' • <span style="color: #ff0000;">NSFW</span>' : ''}
                            ${(isRatioed || isSuspiciousProfile) ? ' • <span style="color: #ff9800;">Community Warning</span>' : ''}
                        </div>
                    </div>
                </div>
            `;
}

// Show NSFW modal
function showNSFWModal(action, eventId) {
    pendingNSFWAction = { action, eventId };
    document.getElementById('nsfwModal').classList.add('active');
}

// Show ratioed modal
function showRatioedModal(eventId) {
    pendingRatioedAction = eventId;
    document.getElementById('ratioedModal').classList.add('active');
}

// Confirm NSFW
async function confirmNSFW() {
    const rememberChoice = document.getElementById('rememberNSFW').checked;

    // Save preference if remember is checked
    if (rememberChoice) {
        localStorage.setItem('allowNSFW', 'true');
    }

    // Always allow for this session
    sessionNSFWAllowed = true;

    // Close modal
    document.getElementById('nsfwModal').classList.remove('active');

    // Execute the pending action immediately
    if (pendingNSFWAction && pendingNSFWAction.action === 'playVideo') {
        // Navigate to video
        navigateTo(`/video/${pendingNSFWAction.eventId}`);
    }

    // Clear pending action
    pendingNSFWAction = null;

    // Only reload the view if remember was checked (to update all thumbnails)
    if (rememberChoice) {
        setTimeout(() => {
            handleRoute();
        }, 100);
    }
}

// Cancel NSFW
function cancelNSFW() {
    document.getElementById('nsfwModal').classList.remove('active');
    pendingNSFWAction = null;
    document.getElementById('rememberNSFW').checked = false;
}

// Proceed with ratioed video
function proceedRatioed() {
    if (pendingRatioedAction) {
        sessionRatioedAllowed.add(pendingRatioedAction);
        document.getElementById('ratioedModal').classList.remove('active');
        navigateTo(`/video/${pendingRatioedAction}`);
        pendingRatioedAction = null;
    }
}

// Cancel ratioed
function cancelRatioed() {
    document.getElementById('ratioedModal').classList.remove('active');
    pendingRatioedAction = null;
}

// Parse video event
function parseVideoEvent(event) {
    if (event.kind !== 1) {
        return null;
    }

    const tags = event.tags || [];

    if (!tags.some(tag => tag[0] === 't' && tag[1] === 'pv69420')) {
        return null;
    }

    const videoData = {
        title: '',
        description: event.content || '',
        hash: '',
        url: '',
        thumbnail: '',
        duration: 0,
        tags: [],
        author: event.pubkey
    };

    for (const tag of tags) {
        switch (tag[0]) {
            case 'title':
                videoData.title = tag[1];
                break;
            case 'x':
                videoData.hash = tag[1];
                break;
            case 'url':
                videoData.url = tag[1];
                break;
            case 'thumb':
                videoData.thumbnail = tag[1];
                break;
            case 'duration':
                videoData.duration = parseInt(tag[1]);
                break;
            case 't':
                if (tag[1] && tag[1] !== 'pv69420') {
                    videoData.tags.push(tag[1]);
                }
                break;
        }
    }

    if (!videoData.title && videoData.description) {
        const lines = videoData.description.split('\n');
        if (lines[0].startsWith('🎬 ')) {
            videoData.title = lines[0].substring(2).trim();
            videoData.description = lines.slice(2).join('\n').trim();
        }
    }

    // List of allowed video extensions
    const videoExtensions = ['mp4', 'mov', 'webm', 'avi', 'mkv', 'flv', 'wmv'];
    const extensionsPattern = videoExtensions.join('|');

    // Regex pattern: matches URLs with a 64-char hex string and a video extension
    const urlRegex = new RegExp(
        `https?:\\/\\/[^\\s]*([a-f0-9]{64})\\.(${extensionsPattern})(\\?[^\\s]*)?`,
        'gi'
    );

    // Replace matching URLs
    videoData.description = videoData.description.replace(urlRegex, '').trim();

    return videoData.title ? videoData : null;
}

// Function to load trending videos with streaming
async function loadTrendingVideos(period = 'today') {
    // Calculate time boundaries
    const now = Math.floor(Date.now() / 1000);
    const oneDay = 24 * 60 * 60;
    const oneWeek = 7 * oneDay;

    let since;
    if (period === 'today') {
        since = now - oneDay;
    } else if (period === 'week') {
        since = now - oneWeek;
    }

    const filter = {
        kinds: [1],
        '#t': ['pv69420'],
        since: since,
        limit: 100
    };

    return new Promise((resolve) => {
        const videoEvents = [];
        const videoScores = new Map();
        const globalReactions = new Map();
        const globalZaps = new Map();
        const processedVideos = new Set();
        let trendingVideos = [];
        let videosComplete = false;
        let reactionsComplete = false;
        let zapsComplete = false;
        let lastProcessTime = 0;
        let processTimer = null;
        let resolveTimer = null;
        let hasResolved = false;

        // Process trending videos incrementally
        const processTrending = (force = false) => {
            // Debounce processing to avoid too frequent updates
            const now = Date.now();
            if (!force && now - lastProcessTime < 200) {
                clearTimeout(processTimer);
                processTimer = setTimeout(() => processTrending(true), 200);
                return;
            }
            lastProcessTime = now;

            const newTrendingVideos = [];

            videoEvents.forEach(event => {
                // Calculate reactions
                const reactions = { likes: 0, dislikes: 0 };
                const videoReactions = globalReactions.get(event.id);

                if (videoReactions) {
                    videoReactions.forEach((data) => {
                        if (data.reaction === '👍') {
                            reactions.likes++;
                        } else if (data.reaction === '👎') {
                            reactions.dislikes++;
                        }
                    });
                }

                // Store reactions in cache
                reactionsCache.set(event.id, reactions);

                // Skip if video is ratioed
                if (isVideoRatioed(reactions)) {
                    return;
                }

                // Get zap count
                const zapTotal = globalZaps.get(event.id) || 0;

                // Calculate trending score including zaps
                const ageHours = (now - event.created_at) / 3600;
                const timeWeight = Math.max(0, 24 - ageHours) / 24;
                
                const zapScore = (zapTotal / 1000) * 5;
                const score = reactions.likes - (reactions.dislikes * 2) + zapScore + (timeWeight * 10);

                // Include videos with positive score
                if (score > 0) {
                    videoScores.set(event.id, score);
                    newTrendingVideos.push(event);
                }
            });

            // Sort by score
            newTrendingVideos.sort((a, b) => {
                const scoreA = videoScores.get(a.id) || 0;
                const scoreB = videoScores.get(b.id) || 0;
                return scoreB - scoreA;
            });

            // Update trending videos (limit to top 12)
            trendingVideos = newTrendingVideos.slice(0, 12);

            // Update the UI if we have the trending section loaded
            const trendingGrid = document.getElementById('trendingGrid');
            if (trendingGrid && trendingVideos.length > 0 && !hasResolved) {
                // Remove spinner if present
                const spinner = trendingGrid.querySelector('.spinner');
                if (spinner) {
                    renderTrendingVideos(trendingVideos).then(() => {
                        // Rendered successfully
                    });
                }
            }

            // If all streams are complete, resolve with final results
            if (videosComplete && reactionsComplete && zapsComplete && !hasResolved) {
                clearTimeout(processTimer);
                clearTimeout(resolveTimer);
                hasResolved = true;
                resolve(trendingVideos);
            }
        };

        // Load reactions for ALL collected videos
        const loadReactions = () => {
            if (videoEvents.length === 0) {
                reactionsComplete = true;
                processTrending(true);
                return;
            }

            const videoIds = videoEvents.map(e => e.id);
            const reactionFilter = {
                kinds: [7],
                '#e': videoIds,
                '#t': ['pv69420'],
                since: since
            };

            requestEventsStream(reactionFilter, (reactionEvent) => {
                const videoId = reactionEvent.tags.find(tag => tag[0] === 'e')?.[1];
                if (videoId && videoIds.includes(videoId)) {
                    if (!globalReactions.has(videoId)) {
                        globalReactions.set(videoId, new Map());
                    }

                    const videoReactions = globalReactions.get(videoId);
                    const userPubkey = reactionEvent.pubkey;
                    const timestamp = reactionEvent.created_at;

                    const existingReaction = videoReactions.get(userPubkey);
                    if (!existingReaction || existingReaction.timestamp < timestamp) {
                        videoReactions.set(userPubkey, {
                            reaction: reactionEvent.content,
                            timestamp: timestamp
                        });
                        // Reprocess trending when new reactions arrive
                        processTrending();
                    }
                }
            }, () => {
                reactionsComplete = true;
                processTrending(true);
            });
        };

        // Load zaps for ALL collected videos
        const loadZaps = () => {
            if (videoEvents.length === 0) {
                zapsComplete = true;
                processTrending(true);
                return;
            }

            const videoIds = videoEvents.map(e => e.id);
            const zapFilter = {
                kinds: [9735],
                '#e': videoIds,
                since: since
            };

            requestEventsStream(zapFilter, (zapEvent) => {
                try {
                    const videoId = zapEvent.tags.find(tag => tag[0] === 'e')?.[1];
                    if (videoId && videoIds.includes(videoId)) {
                        const bolt11Tag = zapEvent.tags.find(tag => tag[0] === 'bolt11');
                        if (bolt11Tag && bolt11Tag[1]) {
                            const amount = extractAmountFromBolt11(bolt11Tag[1]);
                            if (amount > 0) {
                                const currentTotal = globalZaps.get(videoId) || 0;
                                globalZaps.set(videoId, currentTotal + amount);
                                // Reprocess trending when new zaps arrive
                                processTrending();
                            }
                        }
                    }
                } catch (e) {
                    console.error('Failed to parse zap:', e);
                }
            }, () => {
                zapsComplete = true;
                processTrending(true);
            });
        };

        // Start collecting video events - wait for ALL relays
        requestEventsStream(filter, (event) => {
            const tags = event.tags || [];
            if (tags.some(tag => tag[0] === 'x') && !processedVideos.has(event.id)) {
                processedVideos.add(event.id);
                videoEvents.push(event);
                allEvents.set(event.id, event);

                // Process trending with each new video
                processTrending();
            }
        }, () => {
            // All relays have responded with videos
            videosComplete = true;

            console.log(`Trending: Found ${videoEvents.length} videos from all relays`);

            // NOW start loading reactions and zaps for ALL videos
            if (videoEvents.length > 0) {
                loadReactions();
                loadZaps();
            } else {
                reactionsComplete = true;
                zapsComplete = true;
                processTrending(true);
            }
        });

        // Set up progressive resolution
        // After 3 seconds, resolve with whatever we have if we have good results
        resolveTimer = setTimeout(() => {
            if (trendingVideos.length >= 6 && !hasResolved) {
                hasResolved = true;
                resolve(trendingVideos);
            }
        }, 3000);

        // Final timeout after 7 seconds
        setTimeout(() => {
            if (!hasResolved) {
                videosComplete = true;
                reactionsComplete = true;
                zapsComplete = true;
                processTrending(true);
                hasResolved = true;
                resolve(trendingVideos);
            }
        }, 7000);
    });
}

// Load home feed with trending section
async function loadHomeFeed() {
    currentView = 'home';

    const mainContent = document.getElementById('mainContent');

    // Immediately show the page structure with placeholders
    mainContent.innerHTML = `
        <div class="trending-section" id="trendingSection">
            <div class="trending-header">
                <h2>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19.48,12.35c-1.57-4.08-7.16-4.3-5.81-10.23c0.1-0.44-0.37-0.78-0.75-0.55C9.29,3.71,6.68,8,8.87,13.62 c0.18,0.46-0.36,0.89-0.75,0.59c-1.81-1.37-2-3.34-1.84-4.75c0.06-0.52-0.62-0.77-0.91-0.34C4.69,10.16,4,11.84,4,14.37 c0.38,5.6,5.11,7.32,6.81,7.54c2.43,0.31,5.06-0.14,6.95-1.87C19.84,18.11,20.6,15.03,19.48,12.35z"/>
                    </svg>
                    Trending
                </h2>
                <div class="trending-tabs">
                    <button class="trending-tab ${currentTrendingPeriod === 'today' ? 'active' : ''}" 
                            onclick="switchTrendingPeriod('today')">Today</button>
                    <button class="trending-tab ${currentTrendingPeriod === 'week' ? 'active' : ''}" 
                            onclick="switchTrendingPeriod('week')">This Week</button>
                </div>
            </div>
            <div class="trending-carousel-container">
                <button class="carousel-btn prev" onclick="scrollCarousel(-1)" disabled>
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
                    </svg>
                </button>
                <button class="carousel-btn next" onclick="scrollCarousel(1)">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                    </svg>
                </button>
                <div class="trending-grid" id="trendingGrid">
                    <div class="spinner"></div>
                </div>
                <div class="carousel-dots" id="carouselDots"></div>
            </div>
        </div>
        <hr class="section-divider">
        <h2 style="margin-bottom: 1.5rem;">Latest Videos</h2>
        <div class="video-grid" id="videoGrid">
            <div class="spinner"></div>
        </div>
    `;

    // Load trending videos in the background
    loadTrendingSection();

    // Immediately start loading latest videos
    const filter = {
        kinds: [1],
        limit: 50,
        '#t': ['pv69420']
    };

    // Use the existing streaming display logic
    const videoGrid = document.getElementById('videoGrid');
    const renderedVideos = new Map();
    const videoEvents = [];
    const profileQueue = new Set();
    const reactionQueue = new Set();
    let profileTimer = null;
    let reactionTimer = null;

    // Global reaction storage to accumulate across all relays
    const globalReactions = new Map();

    // Function to update a video card
    const updateVideoCard = (event, profile, reactions) => {
        const cardId = `video-card-${event.id}`;
        const existingCard = document.getElementById(cardId);

        if (!existingCard) return;

        const cardHTML = createVideoCard(event, profile, reactions);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cardHTML;

        if (tempDiv.firstElementChild) {
            tempDiv.firstElementChild.id = cardId;
            existingCard.parentNode.replaceChild(tempDiv.firstElementChild, existingCard);
        }
    };

    // Function to render a single video card
    const renderVideoCard = (event, profile = null, reactions = null) => {
        const cardId = `video-card-${event.id}`;

        // Check if card already exists
        if (document.getElementById(cardId)) {
            updateVideoCard(event, profile, reactions);
            return;
        }

        const cardHTML = createVideoCard(event, profile, reactions);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cardHTML;

        if (!tempDiv.firstElementChild) return;

        tempDiv.firstElementChild.id = cardId;

        // Find correct position based on timestamp
        let inserted = false;
        const cards = videoGrid.querySelectorAll('.video-card');

        for (let i = 0; i < cards.length; i++) {
            const cardEventId = cards[i].id.replace('video-card-', '');
            const cardEvent = renderedVideos.get(cardEventId);
            if (cardEvent && event.created_at > cardEvent.created_at) {
                cards[i].parentNode.insertBefore(tempDiv.firstElementChild, cards[i]);
                inserted = true;
                break;
            }
        }

        if (!inserted) {
            videoGrid.appendChild(tempDiv.firstElementChild);
        }

        renderedVideos.set(event.id, event);
    };

    // Batch load profiles
    const loadProfilesBatch = async () => {
        if (profileQueue.size === 0) return;

        const pubkeys = Array.from(profileQueue);
        profileQueue.clear();

        const filter = {
            kinds: [0],
            authors: pubkeys
        };

        await requestEventsStream(filter, (profileEvent) => {
            try {
                const profile = JSON.parse(profileEvent.content);
                profileCache.set(profileEvent.pubkey, profile);

                // Update all videos by this author
                videoEvents.forEach(event => {
                    if (event.pubkey === profileEvent.pubkey) {
                        const reactions = reactionsCache.get(event.id);
                        updateVideoCard(event, profile, reactions);
                    }
                });
            } catch (e) {
                console.error('Failed to parse profile:', e);
            }
        });
    };

    // Calculate reactions from global storage
    const calculateReactions = (videoId) => {
        const reactions = { likes: 0, dislikes: 0, userReaction: null };
        const videoReactions = globalReactions.get(videoId);

        if (videoReactions) {
            videoReactions.forEach((data, userPubkey) => {
                if (data.reaction === '👍') {
                    reactions.likes++;
                    if (currentUser && userPubkey === currentUser.pubkey) {
                        reactions.userReaction = 'like';
                    }
                } else if (data.reaction === '👎') {
                    reactions.dislikes++;
                    if (currentUser && userPubkey === currentUser.pubkey) {
                        reactions.userReaction = 'dislike';
                    }
                }
            });
        }

        return reactions;
    };

    // Batch load reactions
    const loadReactionsBatch = async () => {
        if (reactionQueue.size === 0) return;

        const videoIds = Array.from(reactionQueue);
        reactionQueue.clear();

        const filter = {
            kinds: [7],
            '#e': videoIds,
            '#t': ['pv69420']
        };

        await requestEventsStream(filter, (reactionEvent) => {
            const videoId = reactionEvent.tags.find(tag => tag[0] === 'e')?.[1];
            if (videoId && videoIds.includes(videoId)) {
                // Initialize video reactions map if needed
                if (!globalReactions.has(videoId)) {
                    globalReactions.set(videoId, new Map());
                }

                const videoReactions = globalReactions.get(videoId);
                const userPubkey = reactionEvent.pubkey;
                const timestamp = reactionEvent.created_at;

                // Only update if this is newer than existing reaction from this user
                const existingReaction = videoReactions.get(userPubkey);
                if (!existingReaction || existingReaction.timestamp < timestamp) {
                    videoReactions.set(userPubkey, {
                        reaction: reactionEvent.content,
                        timestamp: timestamp
                    });

                    // Calculate and cache updated reactions
                    const reactions = calculateReactions(videoId);
                    reactionsCache.set(videoId, reactions);

                    // Update the video card if it exists
                    const event = videoEvents.find(e => e.id === videoId);
                    if (event) {
                        const profile = profileCache.get(event.pubkey);
                        updateVideoCard(event, profile, reactions);
                    }
                }
            }
        });
    };

    // Handle incoming video events
    await requestEventsStream(filter, (event) => {
        // Check if it's a video event
        const tags = event.tags || [];
        if (!tags.some(tag => tag[0] === 'x')) return;

        // Skip if we've already processed this event
        if (videoEvents.some(e => e.id === event.id)) {
            return;
        }

        videoEvents.push(event);
        allEvents.set(event.id, event);

        // Remove spinner if it exists
        const spinner = videoGrid.querySelector('.spinner');
        if (spinner) spinner.remove();

        // Render video card immediately with whatever data we have
        const cachedProfile = profileCache.get(event.pubkey);
        const cachedReactions = reactionsCache.get(event.id);
        renderVideoCard(event, cachedProfile, cachedReactions);

        // Queue profile load if not cached
        if (!cachedProfile) {
            profileQueue.add(event.pubkey);
            clearTimeout(profileTimer);
            profileTimer = setTimeout(loadProfilesBatch, 100);
        }

        // Queue reaction load
        reactionQueue.add(event.id);
        clearTimeout(reactionTimer);
        reactionTimer = setTimeout(loadReactionsBatch, 200);

    }, (allEvents) => {
        // Final cleanup
        if (videoEvents.length === 0) {
            videoGrid.innerHTML = '<p style="text-align: center; color: var(--text-secondary); grid-column: 1/-1;">No videos found.</p>';
        }

        // Force final profile and reaction load for any remaining items
        if (profileQueue.size > 0) {
            loadProfilesBatch();
        }
        if (reactionQueue.size > 0) {
            loadReactionsBatch();
        }
    });
}

// Initialize carousel functionality
function initializeCarousel() {
    const trendingGrid = document.getElementById('trendingGrid');
    const carouselDots = document.getElementById('carouselDots');
    const prevBtn = document.querySelector('.carousel-btn.prev');
    const nextBtn = document.querySelector('.carousel-btn.next');

    if (!trendingGrid || !carouselDots) return;

    const cards = trendingGrid.querySelectorAll('.video-card');
    const totalCards = cards.length;

    if (totalCards === 0) return;

    // Calculate items per page based on screen width
    let itemsPerPage;
    if (window.innerWidth <= 480) { // Mobile
        itemsPerPage = 1;
    } else if (window.innerWidth <= 768) { // Tablet
        itemsPerPage = 2;
    } else { // Desktop
        itemsPerPage = 3;
    }

    // Ensure we don't exceed the total number of cards
    itemsPerPage = Math.min(itemsPerPage, totalCards);
    
    const totalPages = Math.ceil(totalCards / itemsPerPage);

    // Create dots
    carouselDots.innerHTML = '';
    for (let i = 0; i < totalPages; i++) {
        const dot = document.createElement('div');
        dot.className = `carousel-dot ${i === 0 ? 'active' : ''}`;
        dot.onclick = () => goToPage(i);
        carouselDots.appendChild(dot);
    }

    // Store current page in grid element
    trendingGrid.dataset.currentPage = '0';
    trendingGrid.dataset.totalPages = totalPages;
    trendingGrid.dataset.itemsPerPage = itemsPerPage;

    // Update button states
    updateCarouselButtons();

    // Ensure initial layout is correct
    goToPage(0);
}

// Handle window resize for carousel
window.addEventListener('resize', () => {
    const trendingGrid = document.getElementById('trendingGrid');
    if (trendingGrid && trendingGrid.querySelector('.video-card')) {
        initializeCarousel();
    }
});

// Function to load trending section asynchronously
async function loadTrendingSection() {
    const trendingGrid = document.getElementById('trendingGrid');
    let hasRendered = false;

    try {
        // Start loading trending videos
        const trendingPromise = loadTrendingVideos(currentTrendingPeriod);

        // Check for early results every 500ms
        const checkInterval = setInterval(async () => {
            // Try to get current state without blocking
            const trendingVideos = await Promise.race([
                trendingPromise,
                new Promise(resolve => setTimeout(() => resolve(null), 10))
            ]);

            if (trendingVideos && trendingVideos.length > 0 && !hasRendered) {
                hasRendered = true;
                clearInterval(checkInterval);
                await renderTrendingVideos(trendingVideos);
            }
        }, 500);

        // Wait for final results
        const trendingVideos = await trendingPromise;
        clearInterval(checkInterval);

        if (trendingVideos.length > 0) {
            await renderTrendingVideos(trendingVideos);
        } else if (!hasRendered) {
            trendingGrid.innerHTML = '<p style="text-align: center; color: var(--text-secondary); grid-column: 1/-1;">No trending videos found.</p>';
        }
    } catch (error) {
        console.error('Failed to load trending videos:', error);
        const trendingSection = document.getElementById('trendingSection');
        if (trendingSection) {
            trendingSection.style.display = 'none';
        }
    }
}

// Helper function to render trending videos
async function renderTrendingVideos(trendingVideos) {
    const trendingGrid = document.getElementById('trendingGrid');

    // Load profiles for trending videos
    const trendingPubkeys = [...new Set(trendingVideos.map(v => v.pubkey))];
    await loadUserProfiles(trendingPubkeys);

    // Render trending videos and filter out any empty cards
    const renderedCards = trendingVideos.map((event, index) => {
        const profile = profileCache.get(event.pubkey);
        const reactions = reactionsCache.get(event.id);
        return createVideoCard(event, profile, reactions, true, index + 1);
    }).filter(card => card !== ''); // Filter out empty strings

    // Only update if we have cards to show
    if (renderedCards.length > 0) {
        trendingGrid.innerHTML = renderedCards.join('');
        // Initialize carousel after rendering
        initializeCarousel();
    } else {
        trendingGrid.innerHTML = '<p style="text-align: center; color: var(--text-secondary); grid-column: 1/-1;">No trending videos found.</p>';
    }
}

// Function to switch trending period
async function switchTrendingPeriod(period) {
    currentTrendingPeriod = period;

    // Update tab UI
    document.querySelectorAll('.trending-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');

    // Show spinner while loading
    const trendingGrid = document.querySelector('.trending-grid');
    if (trendingGrid) {
        trendingGrid.innerHTML = '<div class="spinner"></div>';
    }

    // Load trending section with new period
    await loadTrendingSection();
}

// Load subscriptions
async function loadSubscriptions() {
    if (!currentUser) {
        document.getElementById('mainContent').innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Please login to view your subscriptions.</p>';
        return;
    }

    currentView = 'subscriptions';

    const mainContent = document.getElementById('mainContent');
    mainContent.innerHTML = '<div class="spinner"></div>';

    try {
        // First, get the user's following list (kind 3)
        const followingFilter = {
            kinds: [3],
            authors: [currentUser.pubkey],
            limit: 1
        };

        let followingList = [];
        await new Promise((resolve) => {
            requestEventsStream(followingFilter, (event) => {
                // Parse the following list from tags
                const pTags = event.tags.filter(tag => tag[0] === 'p');
                followingList = pTags.map(tag => tag[1]);
            }, resolve);
        });

        if (followingList.length === 0) {
            mainContent.innerHTML = `
                <h2 style="margin-bottom: 1.5rem;">Subscriptions</h2>
                <p style="text-align: center; color: var(--text-secondary);">You're not following anyone yet. Find creators to follow!</p>
            `;
            return;
        }

        // Load videos from followed users
        const filter = {
            kinds: [1],
            authors: followingList,
            '#t': ['pv69420'],
            limit: 50
        };

        await displayVideosStream('Subscriptions', filter);

    } catch (error) {
        console.error('Failed to load subscriptions:', error);
        mainContent.innerHTML = '<div class="error-message">Failed to load subscriptions. Please try again.</div>';
    }
}

// Load my videos with streaming
async function loadMyVideos() {
    if (!currentUser) {
        document.getElementById('mainContent').innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Please login to view your videos.</p>';
        return;
    }

    currentView = 'my-videos';

    const filter = {
        kinds: [1],
        authors: [currentUser.pubkey],
        '#t': ['pv69420']
    };

    await displayVideosStream('My Videos', filter);
}

// Load videos by tag with streaming
async function loadTag(tag) {
    currentView = `tag-${tag}`;

    const filter = {
        kinds: [1],
        '#t': [tag],
        limit: 50
    };

    await displayVideosStream(`${tag.charAt(0).toUpperCase() + tag.slice(1)} Videos`, filter);
}

// Handle deleting video
async function handleDelete(eventId) {
    if (!currentUser || !window.nostr) {
        alert('Please login to delete videos');
        return;
    }

    if (!confirm('Are you sure you want to delete this video? This action cannot be undone.')) {
        return;
    }

    try {
        // Create deletion event (kind 5)
        const deleteEvent = {
            kind: 5,
            tags: [
                ['e', eventId],
                ['t', 'pv69420']
            ],
            content: 'Deletion request',
            created_at: Math.floor(Date.now() / 1000)
        };

        const signedEvent = await window.nostr.signEvent(deleteEvent);
        const published = await publishEvent(signedEvent);

        if (published) {
            alert('Deletion request sent to relays. The video may take some time to be removed.');
            // Navigate back to my videos
            navigateTo('/my-videos');
        } else {
            alert('Failed to send deletion request. Please try again.');
        }
    } catch (error) {
        console.error('Failed to delete video:', error);
        alert('Failed to delete video: ' + error.message);
    }
}

// Check if current user is following a pubkey
async function isFollowing(pubkey) {
    if (!currentUser) return false;

    const filter = {
        kinds: [3],
        authors: [currentUser.pubkey],
        limit: 1
    };

    let following = false;
    await new Promise((resolve) => {
        requestEventsStream(filter, (event) => {
            const pTags = event.tags.filter(tag => tag[0] === 'p');
            following = pTags.some(tag => tag[1] === pubkey);
        }, resolve);
    });

    return following;
}

// Follow a user
async function followUser(pubkey) {
    if (!currentUser || !window.nostr) {
        alert('Please login to follow users');
        return false;
    }

    try {
        // Get current following list
        const followingFilter = {
            kinds: [3],
            authors: [currentUser.pubkey],
            limit: 1
        };

        let currentFollowingTags = [];
        let currentRelayTags = [];

        await new Promise((resolve) => {
            requestEventsStream(followingFilter, (event) => {
                currentFollowingTags = event.tags.filter(tag => tag[0] === 'p');
                currentRelayTags = event.tags.filter(tag => tag[0] === 'r');
            }, resolve);
        });

        // Add new follow if not already following
        if (!currentFollowingTags.some(tag => tag[1] === pubkey)) {
            currentFollowingTags.push(['p', pubkey]);
        }

        // Create new contact list event
        const contactListEvent = {
            kind: 3,
            tags: [...currentFollowingTags, ...currentRelayTags],
            content: '',
            created_at: Math.floor(Date.now() / 1000)
        };

        const signedEvent = await window.nostr.signEvent(contactListEvent);
        const published = await publishEvent(signedEvent);

        return published;
    } catch (error) {
        console.error('Failed to follow user:', error);
        return false;
    }
}

// Unfollow a user
async function unfollowUser(pubkey) {
    if (!currentUser || !window.nostr) {
        alert('Please login to unfollow users');
        return false;
    }

    try {
        // Get current following list
        const followingFilter = {
            kinds: [3],
            authors: [currentUser.pubkey],
            limit: 1
        };

        let currentFollowingTags = [];
        let currentRelayTags = [];

        await new Promise((resolve) => {
            requestEventsStream(followingFilter, (event) => {
                currentFollowingTags = event.tags.filter(tag => tag[0] === 'p');
                currentRelayTags = event.tags.filter(tag => tag[0] === 'r');
            }, resolve);
        });

        // Remove the pubkey from following list
        currentFollowingTags = currentFollowingTags.filter(tag => tag[1] !== pubkey);

        // Create new contact list event
        const contactListEvent = {
            kind: 3,
            tags: [...currentFollowingTags, ...currentRelayTags],
            content: '',
            created_at: Math.floor(Date.now() / 1000)
        };

        const signedEvent = await window.nostr.signEvent(contactListEvent);
        const published = await publishEvent(signedEvent);

        return published;
    } catch (error) {
        console.error('Failed to unfollow user:', error);
        return false;
    }
}

// Handle follow/unfollow button click
async function handleFollow(pubkey, isCurrentlyFollowing) {
    const button = event.target;
    button.disabled = true;
    button.textContent = 'Processing...';

    let success;
    if (isCurrentlyFollowing) {
        success = await unfollowUser(pubkey);
    } else {
        success = await followUser(pubkey);
    }

    if (success) {
        // Update button state
        button.classList.toggle('following');
        button.textContent = isCurrentlyFollowing ? 'Follow' : 'Unfollow';
        button.setAttribute('onclick', `handleFollow('${pubkey}', ${!isCurrentlyFollowing})`);
    } else {
        button.textContent = isCurrentlyFollowing ? 'Unfollow' : 'Follow';
        alert('Failed to update follow status. Please try again.');
    }

    button.disabled = false;
}

// Load user profile page
async function loadProfile(pubkey) {
    currentView = `profile-${pubkey}`;

    const mainContent = document.getElementById('mainContent');
    mainContent.innerHTML = '<div class="spinner"></div>';

    try {
        // Load profile using the new streaming function
        const profile = await fetchUserProfile(pubkey);
        const displayName = profile?.name || profile?.display_name || `User ${pubkey.slice(0, 8)}`;
        const avatarUrl = profile?.picture || profile?.avatar || '';
        const nip05 = profile?.nip05 || '';
        const about = profile?.about || '';

        // Meta tags are already updated in handleRoute, no need to update again

        // Convert pubkey to npub
        const npub = window.NostrTools.nip19.npubEncode(pubkey);

        // Check following status in parallel
        const isFollowingPromise = isFollowing(pubkey);
        const isOwnProfile = currentUser && currentUser.pubkey === pubkey;

        // Show profile header immediately
        mainContent.innerHTML = `
            <div class="profile-header">
                <div class="profile-avatar">
                    ${avatarUrl ? `<img src="${avatarUrl}" alt="${displayName}">` : ''}
                </div>
                <div class="profile-info">
                    <h1 class="profile-name">${displayName}</h1>
                    ${nip05 ? `<div class="profile-nip05">${nip05}</div>` : ''}
                    ${about ? `<div class="profile-bio">${about}</div>` : ''}
                </div>
                <div class="profile-actions" id="profile-actions-${pubkey}">
                    <button class="profile-zap-btn" 
                            onclick="handleZap('${npub}', 1000)">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M7 2v11h3v9l7-12h-4l4-8z"/>
                        </svg>
                        Zap
                    </button>
                </div>
            </div>
            <h2 style="margin-bottom: 1.5rem;">Videos</h2>
            <div class="video-grid" id="profileVideoGrid">
                <div class="spinner"></div>
            </div>
        `;

        // Rest of the function remains the same...
        // Update follow button when status is determined
        isFollowingPromise.then(isFollowingUser => {
            const actionsDiv = document.getElementById(`profile-actions-${pubkey}`);
            if (actionsDiv && !isOwnProfile && currentUser) {
                const followBtn = document.createElement('button');
                followBtn.className = `profile-follow-btn ${isFollowingUser ? 'following' : ''}`;
                followBtn.onclick = () => handleFollow(pubkey, isFollowingUser);
                followBtn.textContent = isFollowingUser ? 'Unfollow' : 'Follow';
                actionsDiv.insertBefore(followBtn, actionsDiv.firstChild);
            }
        });

        // Load videos with streaming
        const filter = {
            kinds: [1],
            authors: [pubkey],
            '#t': ['pv69420']
        };

        const videoGrid = document.getElementById('profileVideoGrid');
        const videoEvents = [];
        const reactionQueue = new Set();
        let reactionTimer = null;

        // Handle incoming video events
        await requestEventsStream(filter, (event) => {
            // Check if it's a video event
            const tags = event.tags || [];
            if (!tags.some(tag => tag[0] === 'x')) return;

            videoEvents.push(event);
            allEvents.set(event.id, event);

            // Remove spinner on first video
            const spinner = videoGrid.querySelector('.spinner');
            if (spinner) spinner.remove();

            // Render video card immediately
            const cachedReactions = reactionsCache.get(event.id);
            const cardHTML = createVideoCard(event, profile, cachedReactions);

            // Insert in correct position (newest first)
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = cardHTML;

            if (tempDiv.firstElementChild) {
                let inserted = false;
                const existingCards = videoGrid.querySelectorAll('.video-card');

                for (let i = 0; i < existingCards.length; i++) {
                    const cardEvent = videoEvents.find(e =>
                        existingCards[i].innerHTML.includes(e.id)
                    );
                    if (cardEvent && event.created_at > cardEvent.created_at) {
                        existingCards[i].parentNode.insertBefore(tempDiv.firstElementChild, existingCards[i]);
                        inserted = true;
                        break;
                    }
                }

                if (!inserted) {
                    videoGrid.appendChild(tempDiv.firstElementChild);
                }
            }

            // Queue reaction load
            reactionQueue.add(event.id);
            clearTimeout(reactionTimer);
            reactionTimer = setTimeout(async () => {
                if (reactionQueue.size > 0) {
                    const videoIds = Array.from(reactionQueue);
                    reactionQueue.clear();

                    await loadReactionsForVideos(videoIds, (videoId, reactions) => {
                        // Update the specific video card
                        const updatedCard = createVideoCard(
                            videoEvents.find(e => e.id === videoId),
                            profile,
                            reactions
                        );

                        // Find and replace the card
                        const cards = videoGrid.querySelectorAll('.video-card');
                        for (const card of cards) {
                            if (card.innerHTML.includes(videoId)) {
                                const newDiv = document.createElement('div');
                                newDiv.innerHTML = updatedCard;
                                if (newDiv.firstElementChild) {
                                    card.parentNode.replaceChild(newDiv.firstElementChild, card);
                                }
                                break;
                            }
                        }
                    });
                }
            }, 200);

        }, () => {
            // All events received
            if (videoEvents.length === 0) {
                videoGrid.innerHTML = '<p style="text-align: center; color: var(--text-secondary); grid-column: 1/-1;">No videos uploaded yet.</p>';
            }
        });

    } catch (error) {
        console.error('Failed to load profile:', error);
        mainContent.innerHTML = '<div class="error-message">Failed to load profile. Please try again.</div>';
    }
}

// Search videos
async function searchVideos() {
    const query = document.getElementById('searchInput').value.trim();
    if (!query) return;

    // Navigate to search route
    navigateTo(`/search/${encodeURIComponent(query)}`);
}

async function performSearch(query) {
    const decodedQuery = decodeURIComponent(query).toLowerCase();
    currentView = `search-${decodedQuery}`;

    const mainContent = document.getElementById('mainContent');
    mainContent.innerHTML = `
        <h2 style="margin-bottom: 1.5rem;">Search Results for "${decodedQuery}"</h2>
        <div class="video-grid" id="videoGrid">
            <div class="spinner"></div>
        </div>
    `;

    const videoGrid = document.getElementById('videoGrid');
    const renderedVideos = new Map();
    const videoEvents = [];
    const profileQueue = new Set();
    const reactionQueue = new Set();
    let profileTimer = null;
    let reactionTimer = null;

    // Global reaction storage to accumulate across all relays
    const globalReactions = new Map();

    // Function to check if video matches search query
    const matchesSearch = (event) => {
        const videoData = parseVideoEvent(event);
        if (!videoData) return false;

        // Search in title
        if (videoData.title.toLowerCase().includes(decodedQuery)) return true;

        // Search in description
        if (videoData.description.toLowerCase().includes(decodedQuery)) return true;

        // Search in tags
        if (videoData.tags.some(tag => tag.toLowerCase().includes(decodedQuery))) return true;

        return false;
    };

    // Reuse the same update and render functions from displayVideosStream
    const updateVideoCard = (event, profile, reactions) => {
        const cardId = `video-card-${event.id}`;
        const existingCard = document.getElementById(cardId);

        if (!existingCard) return;

        const cardHTML = createVideoCard(event, profile, reactions);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cardHTML;

        if (tempDiv.firstElementChild) {
            tempDiv.firstElementChild.id = cardId;
            existingCard.parentNode.replaceChild(tempDiv.firstElementChild, existingCard);
        }
    };

    const renderVideoCard = (event, profile = null, reactions = null) => {
        const cardId = `video-card-${event.id}`;

        // Check if card already exists (deduplication)
        if (document.getElementById(cardId)) {
            updateVideoCard(event, profile, reactions);
            return;
        }

        const cardHTML = createVideoCard(event, profile, reactions);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cardHTML;

        if (!tempDiv.firstElementChild) return;

        tempDiv.firstElementChild.id = cardId;

        // Find correct position based on timestamp
        let inserted = false;
        const cards = videoGrid.querySelectorAll('.video-card');

        for (let i = 0; i < cards.length; i++) {
            const cardEventId = cards[i].id.replace('video-card-', '');
            const cardEvent = renderedVideos.get(cardEventId);
            if (cardEvent && event.created_at > cardEvent.created_at) {
                cards[i].parentNode.insertBefore(tempDiv.firstElementChild, cards[i]);
                inserted = true;
                break;
            }
        }

        if (!inserted) {
            videoGrid.appendChild(tempDiv.firstElementChild);
        }

        renderedVideos.set(event.id, event);
    };

    // Batch load profiles
    const loadProfilesBatch = async () => {
        if (profileQueue.size === 0) return;

        const pubkeys = Array.from(profileQueue);
        profileQueue.clear();

        const filter = {
            kinds: [0],
            authors: pubkeys
        };

        await requestEventsStream(filter, (profileEvent) => {
            try {
                const profile = JSON.parse(profileEvent.content);
                profileCache.set(profileEvent.pubkey, profile);

                // Update all videos by this author
                videoEvents.forEach(event => {
                    if (event.pubkey === profileEvent.pubkey) {
                        const reactions = reactionsCache.get(event.id);
                        updateVideoCard(event, profile, reactions);
                    }
                });
            } catch (e) {
                console.error('Failed to parse profile:', e);
            }
        });
    };

    // Calculate reactions from global storage
    const calculateReactions = (videoId) => {
        const reactions = { likes: 0, dislikes: 0, userReaction: null };
        const videoReactions = globalReactions.get(videoId);

        if (videoReactions) {
            videoReactions.forEach((data, userPubkey) => {
                if (data.reaction === '👍') {
                    reactions.likes++;
                    if (currentUser && userPubkey === currentUser.pubkey) {
                        reactions.userReaction = 'like';
                    }
                } else if (data.reaction === '👎') {
                    reactions.dislikes++;
                    if (currentUser && userPubkey === currentUser.pubkey) {
                        reactions.userReaction = 'dislike';
                    }
                }
            });
        }

        return reactions;
    };

    // Batch load reactions
    const loadReactionsBatch = async () => {
        if (reactionQueue.size === 0) return;

        const videoIds = Array.from(reactionQueue);
        reactionQueue.clear();

        const filter = {
            kinds: [7],
            '#e': videoIds,
            '#t': ['pv69420']
        };

        await requestEventsStream(filter, (reactionEvent) => {
            const videoId = reactionEvent.tags.find(tag => tag[0] === 'e')?.[1];
            if (videoId && videoIds.includes(videoId)) {
                // Initialize video reactions map if needed
                if (!globalReactions.has(videoId)) {
                    globalReactions.set(videoId, new Map());
                }

                const videoReactions = globalReactions.get(videoId);
                const userPubkey = reactionEvent.pubkey;
                const timestamp = reactionEvent.created_at;

                // Only update if this is newer than existing reaction from this user
                const existingReaction = videoReactions.get(userPubkey);
                if (!existingReaction || existingReaction.timestamp < timestamp) {
                    videoReactions.set(userPubkey, {
                        reaction: reactionEvent.content,
                        timestamp: timestamp
                    });

                    // Calculate and cache updated reactions
                    const reactions = calculateReactions(videoId);
                    reactionsCache.set(videoId, reactions);

                    // Update the video card if it exists
                    const event = videoEvents.find(e => e.id === videoId);
                    if (event) {
                        const profile = profileCache.get(event.pubkey);
                        updateVideoCard(event, profile, reactions);
                    }
                }
            }
        });
    };

    // Search all video events
    const filter = {
        kinds: [1],
        '#t': ['pv69420'],
        limit: 200
    };

    await requestEventsStream(filter, (event) => {
        // Check if it's a video event and matches search
        const tags = event.tags || [];
        if (!tags.some(tag => tag[0] === 'x')) return;

        // Check if video matches search criteria
        if (!matchesSearch(event)) return;

        // Skip if we've already processed this event (deduplication)
        if (videoEvents.some(e => e.id === event.id)) {
            return;
        }

        videoEvents.push(event);
        allEvents.set(event.id, event);

        // Remove spinner if it exists
        const spinner = videoGrid.querySelector('.spinner');
        if (spinner) spinner.remove();

        // Render video card immediately with whatever data we have
        const cachedProfile = profileCache.get(event.pubkey);
        const cachedReactions = reactionsCache.get(event.id);
        renderVideoCard(event, cachedProfile, cachedReactions);

        // Queue profile load if not cached
        if (!cachedProfile) {
            profileQueue.add(event.pubkey);
            clearTimeout(profileTimer);
            profileTimer = setTimeout(loadProfilesBatch, 100);
        }

        // Queue reaction load
        reactionQueue.add(event.id);
        clearTimeout(reactionTimer);
        reactionTimer = setTimeout(loadReactionsBatch, 200);

    }, (allEvents) => {
        // Final cleanup
        if (videoEvents.length === 0) {
            videoGrid.innerHTML = `<p style="text-align: center; color: var(--text-secondary); grid-column: 1/-1;">No videos found matching "${query}".</p>`;
        }

        // Force final profile and reaction load for any remaining items
        if (profileQueue.size > 0) {
            loadProfilesBatch();
        }
        if (reactionQueue.size > 0) {
            loadReactionsBatch();
        }
    });
}

// Update sidebar active state
function updateSidebarActive() {
    const items = document.querySelectorAll('.sidebar-item');
    items.forEach(item => item.classList.remove('active'));

    const hash = window.location.hash;
    items.forEach(item => {
        if (item.getAttribute('href') === hash ||
            (hash === '' && item.getAttribute('href') === '#/')) {
            item.classList.add('active');
        }
    });
}

// Function to fetch a single video event and return immediately when found
async function fetchVideoEvent(eventId) {
    return new Promise((resolve) => {
        let found = false;
        const filter = {
            ids: [eventId],
            '#t': ['pv69420'],
        };

        requestEventsStream(filter, (event) => {
            // Return immediately on first match
            if (!found && event.id === eventId) {
                found = true;
                allEvents.set(event.id, event);
                resolve(event);
            }
        }, () => {
            // If no event found after all relays complete
            if (!found) {
                resolve(null);
            }
        });
    });
}

// Play video
async function playVideo(eventId, skipNSFWCheck = false, skipRatioedCheck = false) {
    const mainContent = document.getElementById('mainContent');

    // Don't show spinner if we're already showing one from handleRoute
    if (!mainContent.querySelector('.spinner')) {
        mainContent.innerHTML = '<div class="spinner"></div>';
    }

    try {
        // Get event from cache or request it
        let event = allEvents.get(eventId);

        if (!event) {
            // Use the new fetchVideoEvent function that returns immediately
            event = await fetchVideoEvent(eventId);
        }

        if (!event) {
            mainContent.innerHTML = '<div class="error-message">Video not found.</div>';
            return;
        }

        const videoData = parseVideoEvent(event);
        if (!videoData) {
            mainContent.innerHTML = '<div class="error-message">Invalid video data.</div>';
            return;
        }

        // Check NSFW status immediately
        const isNSFW = isVideoNSFW(event);
        if (!skipNSFWCheck && isNSFW && !shouldShowNSFW()) {
            showNSFWModal('playVideo', eventId);
            return;
        }

        // Get profile early to check for suspicious profile
        const cachedProfile = profileCache.get(event.pubkey);
        const isSuspiciousProfile = cachedProfile && (!cachedProfile.picture && !cachedProfile.avatar || !cachedProfile.nip05);

        // For initial ratioed check, use cached reactions or default to not ratioed
        const cachedReactions = reactionsCache.get(eventId) || { likes: 0, dislikes: 0 };
        const isCachedRatioed = isVideoRatioed(cachedReactions);

        // Check both ratioed and suspicious profile conditions
        if (!skipRatioedCheck && (isCachedRatioed || isSuspiciousProfile) && !sessionRatioedAllowed.has(eventId)) {
            showRatioedModal(eventId);
            return;
        }

        // Start loading author profile in parallel
        const profilePromise = loadUserProfile(event.pubkey);

        // Convert pubkey to npub
        const authorNpub = window.NostrTools.nip19.npubEncode(event.pubkey);

        // Try to get working video URL
        const videoUrl = await getVideoUrl(videoData.hash) || videoData.url;

        // Create note for comments
        const note = createNote(event);
        const userNpub = currentUser ? window.NostrTools.nip19.npubEncode(currentUser.pubkey) : '';

        // Wait for profile
        const profile = await profilePromise;
        const displayName = profile?.name || profile?.display_name || `User ${event.pubkey.slice(0, 8)}`;
        const avatarUrl = profile?.picture || profile?.avatar || '';
        const nip05 = profile?.nip05 || '';
        const isProfileSuspicious = !avatarUrl || !nip05; // Re-check with fresh profile data

        // Video page
        mainContent.innerHTML = `
            <div class="video-player-container">
                <div class="video-player">
                    <video controls>
                        <source src="${videoUrl}" type="video/mp4">
                        <source src="${videoUrl}" type="video/webm">
                        Your browser does not support the video tag.
                    </video>
                </div>
                <div class="video-details">
                    <h1>${videoData.title}</h1>
                    <div class="video-meta">
                        ${formatTimestamp(event.created_at)}
                        ${isNSFW ? ' • <span style="color: #ff0000;">NSFW</span>' : ''}
                        <span class="ratioed-indicator" style="${isProfileSuspicious ? '' : 'display: none;'}"> • <span style="color: #ff9800;">Community Warning</span></span>
                    </div>
                    <div class="video-channel-info">
                        <a href="#/profile/${event.pubkey}" class="channel-info" style="text-decoration: none;">
                            <div class="channel-avatar">
                                ${avatarUrl ? `<img src="${avatarUrl}" alt="${displayName}">` : ''}
                            </div>
                            <div class="channel-details">
                                <div class="channel-name">${displayName}</div>
                                ${nip05 ? `<div class="channel-nip05">${nip05}</div>` : ''}
                            </div>
                        </a>
                    </div>
                    <div class="video-actions" id="video-actions-${eventId}">
                        <button class="action-btn like ${cachedReactions.userReaction === 'like' ? 'active' : ''}" 
                                onclick="handleLike('${event.id}')"
                                ${currentUser ? '' : 'disabled'}
                                data-event-id="${event.id}">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/>
                            </svg>
                            <span class="count">${formatNumber(cachedReactions.likes || 0)}</span>
                        </button>
                        <button class="action-btn dislike ${cachedReactions.userReaction === 'dislike' ? 'active' : ''}" 
                                onclick="handleDislike('${event.id}')"
                                ${currentUser ? '' : 'disabled'}
                                data-event-id="${event.id}">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/>
                            </svg>
                            <span class="count">${formatNumber(cachedReactions.dislikes || 0)}</span>
                        </button>
                        <button class="action-btn zap"
                                onclick="handleZap('${authorNpub}', 1000, '${event.id}')"
                                data-event-id="${event.id}">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M7 2v11h3v9l7-12h-4l4-8z"/>
                            </svg>
                            <span class="count">Zap</span>
                        </button>
                        <button class="action-btn" onclick="shareVideo('${event.id}')">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/>
                            </svg>
                            Share
                        </button>
                        ${currentUser && currentUser.pubkey === event.pubkey ? `
                            <button class="action-btn delete" onclick="handleDelete('${event.id}')">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                                </svg>
                                Delete
                            </button>
                        ` : ''}
                    </div>
                    
                    <div style="margin-top: 1.5rem;">
                        <h3>Description</h3>
                        <p style="white-space: pre-wrap; margin-top: 0.5rem;">${videoData.description}</p>
                    </div>
                    ${videoData.tags.length > 0 ? `
                        <div class="tags">
                            ${videoData.tags.map(tag => `<span class="tag" onclick="navigateTo('/tag/${tag}')">#${tag}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>
                
                ${note ? `
                    <div class="comments-section">
                        <h3>Comments</h3>
                        <zap-threads
                            anchor="${note}"
                            ${userNpub ? `user="${userNpub}"` : ''}
                            author="${authorNpub}"
                            relays="${RELAY_URLS.join(',')}"
                            disable="likes"
                        ></zap-threads>
                    </div>
                ` : ''}
            </div>
        `;

        // Handle video error with fallback
        const video = mainContent.querySelector('video');
        video.onerror = async () => {
            const fallbackUrl = await getVideoUrl(videoData.hash, BLOSSOM_SERVERS.slice(1));
            if (fallbackUrl && fallbackUrl !== videoUrl) {
                video.src = fallbackUrl;
            } else {
                mainContent.innerHTML = '<div class="error-message">Failed to load video. The file may have been removed.</div>';
            }
        };

        // Load reactions with streaming updates
        loadReactionsForVideos([eventId], (videoId, reactions) => {
            // Update UI immediately when reactions come in
            updateReactionButtons(videoId, reactions);

            // Check if video became ratioed
            const isRatioed = isVideoRatioed(reactions);
            if (isRatioed && !skipRatioedCheck && !sessionRatioedAllowed.has(eventId)) {
                const indicator = mainContent.querySelector('.ratioed-indicator');
                if (indicator) {
                    indicator.style.display = 'inline';
                }
            }
        });

        // Load zaps with streaming updates
        loadZapsForVideo(eventId, (totalZaps, count) => {
            // Update zap button immediately when zaps come in
            updateZapButton(eventId, totalZaps);
        });

    } catch (error) {
        console.error('Failed to play video:', error);
        mainContent.innerHTML = '<div class="error-message">Failed to load video. Please try again.</div>';
    }
}

// Handle like button click
async function handleLike(eventId) {
    const success = await sendReaction(eventId, '👍');
    if (success) {
        // Update UI
        const reactions = reactionsCache.get(eventId);
        updateReactionButtons(eventId, reactions);
    }
}

// Handle dislike button click
async function handleDislike(eventId) {
    const success = await sendReaction(eventId, '👎');
    if (success) {
        // Update UI
        const reactions = reactionsCache.get(eventId);
        updateReactionButtons(eventId, reactions);
    }
}

// Update reaction buttons UI
function updateReactionButtons(eventId, reactions) {
    // Use data attributes to find the correct buttons
    const likeBtn = document.querySelector(`.action-btn.like[data-event-id="${eventId}"]`);
    const dislikeBtn = document.querySelector(`.action-btn.dislike[data-event-id="${eventId}"]`);

    if (likeBtn && dislikeBtn) {
        // Update counts with formatting
        likeBtn.querySelector('.count').textContent = formatNumber(reactions.likes || 0);
        dislikeBtn.querySelector('.count').textContent = formatNumber(reactions.dislikes || 0);

        // Update active states
        likeBtn.classList.toggle('active', reactions.userReaction === 'like');
        dislikeBtn.classList.toggle('active', reactions.userReaction === 'dislike');
    }
}

// Share video
function shareVideo(eventId) {
    const isLocal = window.location.protocol === 'file:';
    const baseUrl = isLocal ? window.location.href.split('#')[0] : window.location.origin;
    const shareUrl = `${baseUrl}/#/video/${eventId}`;
    document.getElementById('shareUrlInput').value = shareUrl;
    document.getElementById('shareModal').classList.add('active');
}

// Copy share URL
function copyShareUrl() {
    const input = document.getElementById('shareUrlInput');
    input.select();
    document.execCommand('copy');

    document.getElementById('copySuccess').style.display = 'block';
    setTimeout(() => {
        document.getElementById('copySuccess').style.display = 'none';
    }, 2000);
}

// Hide share modal
function hideShareModal() {
    document.getElementById('shareModal').classList.remove('active');
    document.getElementById('copySuccess').style.display = 'none';
}

// Upload modal functions
function showUploadModal() {
    if (!currentUser) {
        alert('Please login to upload videos');
        return;
    }
    document.getElementById('uploadModal').classList.add('active');
}

function hideUploadModal() {
    document.getElementById('uploadModal').classList.remove('active');
    document.getElementById('uploadForm').reset();
    document.getElementById('uploadProgress').style.display = 'none';
    uploadedVideoHash = null;
}

// Handle file selection
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const maxSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxSize) {
        alert('File size must be less than 100MB');
        event.target.value = '';
        return;
    }

    const fileUpload = document.getElementById('fileUpload');
    fileUpload.classList.add('active');
    fileUpload.innerHTML = `
                <p style="font-weight: 500;">${file.name}</p>
                <p style="font-size: 0.875rem; color: var(--text-secondary);">${(file.size / 1024 / 1024).toFixed(2)} MB</p>
            `;
}

// Calculate SHA-256 hash
async function calculateSHA256(file) {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

// Create Blossom authorization event
async function createBlossomAuthEvent(hash, server) {
    const expiration = Math.floor(Date.now() / 1000) + 60; // 1 minute expiry
    const authEvent = {
        kind: 24242,
        content: `Upload ${hash}`,
        tags: [
            ['t', 'upload'],
            ['x', hash],
            ['expiration', expiration.toString()],
            ['client', 'Plebs']
        ],
        created_at: Math.floor(Date.now() / 1000)
    };

    // Sign the event
    const signedEvent = await window.nostr.signEvent(authEvent);
    return signedEvent;
}

// Upload to Blossom with proper authentication
async function uploadToBlossom(file, servers = BLOSSOM_SERVERS) {
    const hash = await calculateSHA256(file);
    const successfulUploads = [];
    let primaryUrl = null;

    // Try to upload to ALL servers for redundancy
    for (const server of servers) {
        try {
            // Create authorization event
            const authEvent = await createBlossomAuthEvent(hash, server);
            const authHeader = btoa(JSON.stringify(authEvent));

            const response = await fetch(`${server}/upload`, {
                method: 'PUT',
                body: file,
                headers: {
                    'Content-Type': file.type,
                    'Authorization': `Nostr ${authHeader}`
                }
            });

            if (response.ok) {
                const result = await response.json();
                const url = result.url || `${server}/${hash}`;
                successfulUploads.push({ server, url });

                // Use the first successful upload as primary URL
                if (!primaryUrl) {
                    primaryUrl = url;
                }

                console.log(`Successfully uploaded to ${server}`);
            } else {
                console.error(`Upload to ${server} failed with status ${response.status}`);
            }
        } catch (error) {
            console.error(`Failed to upload to ${server}:`, error);
        }
    }

    // Return success if at least one server accepted the upload
    if (successfulUploads.length > 0) {
        return {
            success: true,
            hash: hash,
            url: primaryUrl,
            server: successfulUploads[0].server,
            mirrors: successfulUploads
        };
    }

    return { success: false, error: 'Failed to upload to all servers' };
}

// Handle form submission
document.getElementById('uploadForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!currentUser || !window.nostr) {
        alert('Please login to upload videos');
        return;
    }

    const videoFile = document.getElementById('videoFile').files[0];
    if (!videoFile) {
        alert('Please select a video file');
        return;
    }

    const title = document.getElementById('videoTitle').value;
    const description = document.getElementById('videoDescription').value;
    const tags = document.getElementById('videoTags').value.split(',').map(t => t.trim()).filter(t => t);
    const isNSFW = document.getElementById('nsfwCheckbox').checked;

    // Automatically add 'nsfw' tag if NSFW checkbox is checked
    if (isNSFW && !tags.includes('nsfw')) {
        tags.push('nsfw');
    }

    // Show progress
    document.getElementById('uploadProgress').style.display = 'block';
    document.getElementById('uploadStatus').textContent = 'Calculating hash...';

    try {
        // Upload video
        document.getElementById('uploadStatus').textContent = 'Uploading video to multiple servers...';
        const videoResult = await uploadToBlossom(videoFile);

        if (!videoResult.success) {
            throw new Error(videoResult.error);
        }

        document.getElementById('progressFill').style.width = '50%';

        // Upload thumbnail if provided
        let thumbnailUrl = '';
        const thumbnailFile = document.getElementById('thumbnailFile').files[0];
        if (thumbnailFile) {
            document.getElementById('uploadStatus').textContent = 'Uploading thumbnail...';
            const thumbResult = await uploadToBlossom(thumbnailFile);
            if (thumbResult.success) {
                thumbnailUrl = thumbResult.url;
            }
        }

        document.getElementById('progressFill').style.width = '75%';
        document.getElementById('uploadStatus').textContent = 'Publishing to Nostr...';

        // Get video duration
        const video = document.createElement('video');
        video.preload = 'metadata';

        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                resolve();
            };
            video.src = URL.createObjectURL(videoFile);
        });

        const videoDuration = Math.floor(video.duration);

        // Create and sign kind 1 event (original video post)
        const eventContent = {
            kind: 1,
            tags: [
                ['title', title],
                ['t', 'pv69420'],
                ...tags.map(tag => ['t', tag]),  // User tags
                ['x', videoResult.hash],
                ['url', videoResult.url],
                ['m', videoFile.type],
                ['size', videoFile.size.toString()],
                ['duration', videoDuration.toString()],
                ...(thumbnailUrl ? [['thumb', thumbnailUrl]] : []),
                // Add all mirror servers
                ...videoResult.mirrors.map(mirror => ['r', mirror.server]),
                // Add NSFW tag if checked
                ...(isNSFW ? [['content-warning', 'nsfw']] : []),
                // Add NIP-89 client tag
                ['client', 'Plebs']
            ],
            content: `${description}\n\n${videoResult.url}`,
            created_at: Math.floor(Date.now() / 1000)
        };

        // Sign and publish kind 1 event
        const signedEvent = await window.nostr.signEvent(eventContent);
        const published = await publishEvent(signedEvent);

        if (!published) {
            throw new Error('Failed to publish to any relay');
        }

        // Generate UUID for kind 34235
        function generateUUID() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                const r = (Math.random() * 16) | 0;
                const v = c === 'x' ? r : (r & 0x3) | 0x8;
                return v.toString(16);
            });
        }
        const uuid = generateUUID();

        // Build imeta parts for kind 21
        const imetaParts = [
            `url ${videoResult.url}`,
            `x ${videoResult.hash}`,
            `m ${videoFile.type}`,
        ];
        if (thumbnailUrl) imetaParts.push(`image ${thumbnailUrl}`);
        if (videoResult.mirrors && videoResult.mirrors.length > 0) {
            videoResult.mirrors.forEach(mirror => {
                imetaParts.push(`fallback ${mirror.url}`);
            });
        }
        imetaParts.push('service nip96');

        // Build tags for kind 21
        const kind21Tags = [
            ['title', title],
            ['published_at', signedEvent.created_at.toString()],
            ['imeta', imetaParts.join(' ')],
            ['duration', videoDuration.toString()],
            ...tags.map(tag => ['t', tag]),
            ['p', currentUser.pubkey],
        ];
        if (isNSFW) kind21Tags.push(['content-warning', 'nsfw']);

        // Create and sign kind 21 event
        const kind21Event = {
            kind: 21,
            tags: kind21Tags,
            content: description || `New video: ${title}`,
            created_at: signedEvent.created_at,
        };

        const signedKind21 = await window.nostr.signEvent(kind21Event);
        await publishEvent(signedKind21);

        // Build tags for kind 34235
        const kind34235Tags = [
            ['d', uuid],
            ['title', title],
            ['summary', description],
            ['src', videoResult.url],
            ['m', videoFile.type],
            ['image', thumbnailUrl || ''],
            ...(isNSFW ? [['content-warning', 'nsfw']] : []),
            ...tags.map(tag => ['t', tag]),
            ['p', currentUser.pubkey],
        ];

        // Create and sign kind 34235 event
        const kind34235Event = {
            kind: 34235,
            tags: kind34235Tags,
            content: JSON.stringify({
                title: title,
                description: description,
                tags: tags,
                thumbnail: thumbnailUrl,
                mirrors: videoResult.mirrors.map(m => m.url),
            }),
            created_at: signedEvent.created_at,
        };

        const signedKind34235 = await window.nostr.signEvent(kind34235Event);
        await publishEvent(signedKind34235);

        // Publish User Server List (kind 10063) for mirrors
        if (videoResult.mirrors && videoResult.mirrors.length > 0) {
            const serverListEvent = {
                kind: 10063,
                tags: videoResult.mirrors.map(mirror => ['server', mirror.server]),
                content: '',
                created_at: Math.floor(Date.now() / 1000),
            };

            const signedServerListEvent = await window.nostr.signEvent(serverListEvent);
            await publishEvent(signedServerListEvent);
        }

        document.getElementById('progressFill').style.width = '100%';
        document.getElementById('uploadStatus').textContent = 'Video published successfully!';

        // Close modal and navigate
        setTimeout(() => {
            hideUploadModal();
            navigateTo('/my-videos');
        }, 2000);

    } catch (error) {
        console.error('Upload failed:', error);
        alert('Failed to upload video: ' + error.message);
        document.getElementById('uploadProgress').style.display = 'none';
    }
});

// Drag and drop support
const fileUpload = document.getElementById('fileUpload');

fileUpload.addEventListener('dragover', (e) => {
    e.preventDefault();
    fileUpload.classList.add('active');
});

fileUpload.addEventListener('dragleave', () => {
    fileUpload.classList.remove('active');
});

fileUpload.addEventListener('drop', (e) => {
    e.preventDefault();
    fileUpload.classList.remove('active');

    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
        document.getElementById('videoFile').files = e.dataTransfer.files;
        handleFileSelect({ target: { files: [file] } });
    }
});

// Enter key search
document.getElementById('searchInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        searchVideos();
    }
});

// Clean up WebSocket connections on page unload
window.addEventListener('beforeunload', () => {
    Object.values(relayConnections).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    });
});
