//          ____  _      _         
//  ┌───┐  |  _ \| | ___| |__  ___ 
//  │ ▷ │  | |_) | |/ _ \ '_ \/ __|
//  └───┘  |  __/| |  __/ |_) \__ \
//          |_|   |_|\___|_.__/|___/

// Global state
let currentUser = null;
let relayConnections = {};
let currentView = 'home';
let uploadedVideoHash = null;
let allEvents = new Map();
let profileCache = new Map();
let reactionsCache = new Map();
let nip05ValidationCache = new Map();
let pendingNSFWAction = null;
let pendingRatioedAction = null;
let sessionNSFWAllowed = false;
let sessionRatioedAllowed = new Set();
let currentTrendingPeriod = 'week';
let isInitializingSettings = false;
let boostsCache = new Map();

// NIP-46 connection state
let nip46Connection = null;
let nip46Secret = null;

// Local storage keys
const STORAGE_KEYS = {
    privateKey: 'plebsPrivateKey',
    publicKey: 'plebsPublicKey',
    profile: 'plebsProfile',
    loginMethod: 'plebsLoginMethod',
    relays: 'plebsRelays',
    bunkerURL: 'plebsBunkerURL',
    nip46Secret: 'plebsNip46Secret'
};

// Blossom servers
const BLOSSOM_SERVERS = [
    'https://blossom.primal.net',
    'https://blossom.band',
    'https://24242.io',
];

// Premium Blossom server
const PREMIUM_BLOSSOM_SERVER = 'https://nostrmedia.com';

// Define relay URLs
const RELAY_URLS = [
    'wss://relay.damus.io',
    'wss://relay.nostr.band',
    'wss://nos.lol',
    'wss://relay.primal.net'
];

// WoT relay URLs
const WOT_RELAY_URLS = [
    'wss://nostrelites.org',
    'wss://wot.nostr.party',
    'wss://wot.sovbit.host',
    'wss://wot.nostr.net'
];

// Additional relay for publishing only
const PUBLISH_ONLY_RELAYS = [
    'wss://sendit.nosflare.com'
];

// Settings management
let userSettings = {
    useWotRelays: false,
    usePremiumBlossom: false,
    customBlossomServers: [],
    saveToNostr: true
};

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

// Initialize all relay connections
async function initializeRelayConnections() {
    console.log('Initializing relay connections...');
    const connectionPromises = RELAY_URLS.map(url =>
        connectToRelay(url).catch(err =>
            console.error(`Failed to initialize connection to ${url}:`, err)
        )
    );

    await Promise.allSettled(connectionPromises);
    console.log('Relay initialization complete');
}

// Monitor relay connection health
function monitorRelayConnections() {
    setInterval(() => {
        RELAY_URLS.forEach(url => {
            if (!relayConnections[url] || relayConnections[url].readyState !== WebSocket.OPEN) {
                console.log(`Connection to ${url} lost, attempting to reconnect...`);
                connectToRelay(url).catch(err =>
                    console.error(`Failed to reconnect to ${url}:`, err)
                );
            }
        });
    }, 10000); // Check every 10 seconds
}

// Initialize app without checking for login
async function initializeApp() {
    initTheme();

    // Initialize relay connections
    await initializeRelayConnections();

    // Check for stored login FIRST
    await checkStoredLogin();

    // Then handle the route
    handleRoute();
}

// Check for stored login
async function checkStoredLogin() {
    return new Promise((resolve) => {
        const storedMethod = localStorage.getItem(STORAGE_KEYS.loginMethod);
        const storedPubkey = localStorage.getItem(STORAGE_KEYS.publicKey);

        if (storedMethod && storedPubkey) {
            if (storedMethod === 'extension') {
                // Try to reconnect with extension
                if (window.nostr) {
                    window.nostr.getPublicKey().then(pubkey => {
                        if (pubkey === storedPubkey) {
                            currentUser = { pubkey };
                            onUserLoggedIn().then(resolve);
                        } else {
                            resolve();
                        }
                    }).catch(() => {
                        console.log('Extension login failed, clearing stored login');
                        clearStoredLogin();
                        resolve();
                    });
                } else {
                    resolve();
                }
            } else if (storedMethod === 'privateKey') {
                const storedKey = localStorage.getItem(STORAGE_KEYS.privateKey);
                if (storedKey) {
                    const pubkey = getPublicKeyFromPrivate(storedKey);
                    currentUser = { pubkey, privateKey: storedKey };
                    onUserLoggedIn().then(resolve);
                } else {
                    resolve();
                }
            } else if (storedMethod === 'readOnly') {
                currentUser = { pubkey: storedPubkey, readOnly: true };
                onUserLoggedIn().then(resolve);
            } else if (storedMethod === 'connect') {
                const bunkerURL = localStorage.getItem(STORAGE_KEYS.bunkerURL);
                const secret = localStorage.getItem(STORAGE_KEYS.nip46Secret);
                if (bunkerURL && secret) {
                    reconnectNip46(bunkerURL, secret).then(resolve);
                } else {
                    resolve();
                }
            }
        } else {
            resolve();
        }
    });
}

// Clear stored login
function clearStoredLogin() {
    Object.values(STORAGE_KEYS).forEach(key => {
        localStorage.removeItem(key);
    });
    currentUser = null;
    updateUserInterface();
}

// User logged in handler
async function onUserLoggedIn() {
    updateUserInterface();
    await initializeSettings();
}

// Update user interface
function updateUserInterface() {
    const userIcon = document.getElementById('userIcon');
    const userAvatar = document.getElementById('userAvatar');
    const userDropdown = document.getElementById('userDropdown');

    if (currentUser) {
        // Try to get profile from cache or storage
        const storedProfile = localStorage.getItem(STORAGE_KEYS.profile);
        if (storedProfile) {
            try {
                const profile = JSON.parse(storedProfile);
                if (profile.picture) {
                    userAvatar.src = profile.picture;
                    userAvatar.style.display = 'block';
                    userIcon.style.display = 'none';
                }
            } catch (e) {
                console.error('Failed to parse stored profile');
            }
        }

        // Fetch latest profile
        fetchUserProfile(currentUser.pubkey).then(profile => {
            if (profile && profile.picture) {
                userAvatar.src = profile.picture;
                userAvatar.style.display = 'block';
                userIcon.style.display = 'none';
                localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(profile));
            }
        });
    } else {
        userAvatar.style.display = 'none';
        userIcon.style.display = 'block';
    }
}

// User menu functions
function toggleUserMenu() {
    if (!currentUser) {
        showLoginModal();
    } else {
        const dropdown = document.getElementById('userDropdown');
        dropdown.classList.toggle('active');

        // Close dropdown when clicking outside
        if (dropdown.classList.contains('active')) {
            document.addEventListener('click', closeUserMenuOnClickOutside);
        }
    }
}

function closeUserMenuOnClickOutside(e) {
    const userMenu = document.getElementById('userMenu');
    if (!userMenu.contains(e.target)) {
        document.getElementById('userDropdown').classList.remove('active');
        document.removeEventListener('click', closeUserMenuOnClickOutside);
    }
}

// Login modal functions
function showLoginModal() {
    document.getElementById('loginModal').classList.add('active');
}

function hideLoginModal() {
    document.getElementById('loginModal').classList.remove('active');
}

// Login with extension
async function loginWithExtension() {
    if (!window.nostr) {
        alert('Please install a Nostr browser extension like Alby or nos2x');
        return;
    }

    try {
        const pubkey = await window.nostr.getPublicKey();

        currentUser = { pubkey };

        // Store login method
        localStorage.setItem(STORAGE_KEYS.loginMethod, 'extension');
        localStorage.setItem(STORAGE_KEYS.publicKey, pubkey);

        hideLoginModal();
        await onUserLoggedIn();

    } catch (error) {
        console.error('Extension login failed:', error);
        alert('Failed to login with extension. Please try again.');
    }
}

// NIP-46 Connect functions
function showConnectModal() {
    hideLoginModal();
    const modal = document.getElementById('connectModal');
    modal.classList.add('active');

    // Generate the connection URI and prepare for listening
    const uri = generateNostrConnectURI();
    document.getElementById('nostrConnectURI').value = uri;
}

function hideConnectModal() {
    document.getElementById('connectModal').classList.remove('active');
    window.pendingNostrConnect = null;
    window.isListeningForConnect = false;
}

// Generate nostrconnect:// URI for the user
function generateNostrConnectURI() {
    // Generate a new ephemeral key pair for this connection
    const ephemeralPrivKey = window.NostrTools.generateSecretKey();
    const ephemeralPubKey = window.NostrTools.getPublicKey(ephemeralPrivKey);

    // Store for later use
    window.pendingNostrConnect = {
        ephemeralPrivKey: bytesToHex(ephemeralPrivKey),
        ephemeralPubKey
    };

    // Create the metadata
    const metadata = {
        name: "Plebs",
        url: window.location.origin,
        description: "Decentralized video platform"
    };

    // Use multiple relays for better compatibility
    const relays = [
        'wss://relay.nsec.app',
        'wss://relay.damus.io',
        'wss://nos.lol',
        'wss://relay.nostr.band'
    ];

    // Some apps want base64, others want URL-encoded JSON
    const params = new URLSearchParams();

    // Add primary relay
    params.append('relay', relays[0]);

    // Add additional relays
    relays.slice(1).forEach(relay => {
        params.append('relay', relay);
    });

    // Add metadata
    params.append('metadata', JSON.stringify(metadata));

    return `nostrconnect://${ephemeralPubKey}?${params.toString()}`;
}

// Show QR code for mobile scanning
function showNostrConnectQR() {
    const uri = document.getElementById('nostrConnectURI').value;

    // Generate QR code
    const qrContainer = document.getElementById('nostrConnectQR');
    qrContainer.innerHTML = ''; // Clear existing QR

    if (window.QRCode) {
        new QRCode(qrContainer, {
            text: uri,
            width: 256,
            height: 256,
            colorDark: "#000000",
            colorLight: "#FFFFFF",
            correctLevel: QRCode.CorrectLevel.L
        });
    }

    // Show listening status for QR code
    document.getElementById('qrConnectionStatus').style.display = 'block';

    // Start listening for connection only if not already listening
    if (!window.isListeningForConnect) {
        window.isListeningForConnect = true;
        listenForNostrConnect();
    }
}

function toggleQRDisplay() {
    const qrSection = document.getElementById('qrCodeSection');
    const btn = event.target;

    if (qrSection.style.display === 'none') {
        qrSection.style.display = 'block';
        btn.textContent = 'Hide QR Code';
        showNostrConnectQR(); // Use existing function
    } else {
        qrSection.style.display = 'none';
        btn.textContent = 'Show QR Code';
    }
}

// Listen for incoming connection from the app
async function listenForNostrConnect() {
    if (!window.pendingNostrConnect) return;

    const { ephemeralPrivKey, ephemeralPubKey } = window.pendingNostrConnect;

    showConnectionStatus('Waiting for app connection...');

    const relays = ['wss://relay.nsec.app', 'wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band'];
    const connections = [];

    for (const relay of relays) {
        try {
            const ws = await connectToRelay(relay);
            connections.push({ relay, ws });

            const subId = generateRandomId();
            const subscription = JSON.stringify([
                'REQ',
                subId,
                {
                    kinds: [24133],
                    '#p': [ephemeralPubKey],
                    since: Math.floor(Date.now() / 1000) - 60
                }
            ]);
            ws.send(subscription);
        } catch (error) {
            console.error(`Failed to connect to ${relay}:`, error);
        }
    }

    if (connections.length === 0) {
        showConnectionStatus('Failed to connect to any relay');
        setTimeout(hideConnectionStatus, 3000);
        window.pendingNostrConnect = null;
        return;
    }

    const timeout = setTimeout(() => {
        showConnectionStatus('Connection timeout. Please try again.');
        setTimeout(hideConnectionStatus, 3000);
        window.pendingNostrConnect = null;
    }, 120000);

    let isConnected = false;
    let remotePubkey = null;
    let connectedRelay = null;

    const checkForConnection = async () => {
        if (isConnected) return;

        try {
            for (const { relay, ws } of connections) {
                if (ws.readyState !== WebSocket.OPEN) continue;

                const handler = (event) => {
                    try {
                        const message = JSON.parse(event.data);

                        if (message[0] === 'EVENT') {
                            const responseEvent = message.length === 2 ? message[1] : message[2];

                            if (responseEvent && responseEvent.kind === 24133) {
                                const pTag = responseEvent.tags.find(t => t[0] === 'p');

                                if (pTag && pTag[1] === ephemeralPubKey) {
                                    remotePubkey = responseEvent.pubkey;

                                    let decryptedContent;
                                    try {
                                        if (responseEvent.content.includes('?iv=')) {
                                            decryptedContent = window.NostrTools.nip04.decrypt(
                                                ephemeralPrivKey,
                                                remotePubkey,
                                                responseEvent.content
                                            );
                                        } else {
                                            const conversationKey = window.NostrTools.nip44.v2.utils.getConversationKey(
                                                hexToBytes(ephemeralPrivKey),
                                                remotePubkey
                                            );

                                            decryptedContent = window.NostrTools.nip44.v2.decrypt(
                                                responseEvent.content,
                                                conversationKey
                                            );
                                        }

                                        const response = JSON.parse(decryptedContent);

                                        if (response.result === 'ack') {
                                            isConnected = true;
                                            connectedRelay = relay;
                                            clearTimeout(timeout);

                                            showConnectionStatus('Connected! Getting public key...');

                                            handleNostrConnectSuccess(ws, ephemeralPrivKey, ephemeralPubKey, remotePubkey, relay);
                                        }
                                    } catch (decryptError) {
                                        console.error('Failed to decrypt response:', decryptError);
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.error('Error processing message:', e);
                    }
                };

                ws.addEventListener('message', handler);

                setTimeout(() => {
                    ws.removeEventListener('message', handler);
                }, 1000);
            }

            if (!isConnected) {
                setTimeout(checkForConnection, 2000);
            }

        } catch (e) {
            console.error('Connection check error:', e);
            setTimeout(checkForConnection, 2000);
        }
    };

    checkForConnection();
}

// Handle successful nostrconnect connection
async function handleNostrConnectSuccess(ws, ephemeralPrivKey, ephemeralPubKey, remotePubkey, relay) {
    try {
        // Now request the public key
        const getPubkeyRequest = {
            id: generateRandomId(),
            method: 'get_public_key',
            params: []
        };

        let encryptedContent;
        try {
            encryptedContent = await encryptNip44(ephemeralPrivKey, remotePubkey, JSON.stringify(getPubkeyRequest));
        } catch (e) {
            encryptedContent = await window.NostrTools.nip04.encrypt(
                ephemeralPrivKey,
                remotePubkey,
                JSON.stringify(getPubkeyRequest)
            );
        }

        const requestEvent = {
            kind: 24133,
            pubkey: ephemeralPubKey,
            content: encryptedContent,
            tags: [['p', remotePubkey]],
            created_at: Math.floor(Date.now() / 1000)
        };

        const signedRequestEvent = window.NostrTools.finalizeEvent(requestEvent, hexToBytes(ephemeralPrivKey));

        ws.send(JSON.stringify(['EVENT', signedRequestEvent]));

        const pubkeyResponse = await waitForNip46Response(ws, getPubkeyRequest.id, ephemeralPrivKey, remotePubkey);

        if (pubkeyResponse.result) {
            const userPubkey = pubkeyResponse.result;

            currentUser = { pubkey: userPubkey, nip46: true };
            nip46Connection = {
                relay: relay,
                remotePubkey,
                ephemeralPrivKey,
                ephemeralPubKey,
                secret: null
            };

            // Store connection info
            localStorage.setItem(STORAGE_KEYS.loginMethod, 'connect');
            localStorage.setItem(STORAGE_KEYS.publicKey, userPubkey);
            localStorage.setItem(STORAGE_KEYS.bunkerURL, `nostrconnect://${remotePubkey}`);
            localStorage.setItem(STORAGE_KEYS.nip46Secret, JSON.stringify({
                ephemeralPrivKey,
                remotePubkey,
                relay: relay
            }));

            hideConnectionStatus();
            hideConnectModal();
            window.pendingNostrConnect = null;
            await onUserLoggedIn();

            showConnectionStatus('Successfully connected!');
            setTimeout(hideConnectionStatus, 3000);

        } else {
            throw new Error('Failed to get public key from app');
        }
    } catch (error) {
        console.error('Failed to complete connection:', error);
        showConnectionStatus('Connection failed: ' + error.message);
        setTimeout(hideConnectionStatus, 5000);
        window.pendingNostrConnect = null;
    }
}

// Copy nostrconnect URI
function copyNostrConnectURI() {
    const textarea = document.getElementById('nostrConnectURI');
    const uri = textarea.value;

    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(uri).then(() => {
            handleCopySuccess();
        }).catch(err => {
            console.error('Clipboard API failed:', err);
            fallbackCopy();
        });
    } else {
        fallbackCopy();
    }

    function fallbackCopy() {
        try {
            textarea.select();
            textarea.setSelectionRange(0, 99999);
            document.execCommand('copy');
            handleCopySuccess();
        } catch (err) {
            console.error('Fallback copy failed:', err);
            alert('Failed to copy. Please manually select and copy the text.');
        }
    }

    function handleCopySuccess() {
        const btn = document.querySelector('.copy-btn');
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.background = 'var(--accent)';

        // Show listening status
        document.getElementById('connectStringStatus').style.display = 'block';

        // Start listening for connections only if not already listening
        if (!window.isListeningForConnect) {
            window.isListeningForConnect = true;
            listenForNostrConnect();
        }

        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
        }, 2000);
    }
}

function showConnectTab(tab) {
    const bunkerTab = document.getElementById('bunkerTab');
    const qrTab = document.getElementById('qrTab');
    const tabBtns = document.querySelectorAll('.tab-btn');

    tabBtns.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');

    if (tab === 'bunker') {
        bunkerTab.style.display = 'block';
        qrTab.style.display = 'none';
    } else {
        bunkerTab.style.display = 'none';
        qrTab.style.display = 'block';
        showNostrConnectQR();
    }
}

function selectBunker(provider) {
    // Update UI to show selected bunker
    document.querySelectorAll('.bunker-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    // Pre-fill bunker URL based on provider
    const bunkerUrlInput = document.getElementById('bunkerUrl');
    if (provider === 'nsec.app') {
        bunkerUrlInput.placeholder = 'bunker://...@relay.nsec.app';
    } else if (provider === 'highlighter.com') {
        bunkerUrlInput.placeholder = 'bunker://...@relay.highlighter.com';
    }
}

// Helper to wait for NIP-46
async function waitForNip46Response(ws, requestId, ephemeralPrivKey, remotePubkey) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('NIP-46 response timeout'));
        }, 30000);

        const privKeyHex = typeof ephemeralPrivKey === 'string' ?
            ephemeralPrivKey : bytesToHex(ephemeralPrivKey);
        const privKeyBytes = typeof ephemeralPrivKey === 'string' ?
            hexToBytes(ephemeralPrivKey) : ephemeralPrivKey;

        const ephemeralPubKey = window.NostrTools.getPublicKey(privKeyBytes);

        const handler = async (event) => {
            try {
                const message = JSON.parse(event.data);

                if (message[0] === 'EVENT') {
                    const responseEvent = message.length === 2 ? message[1] : message[2];

                    if (responseEvent && responseEvent.kind === 24133) {
                        if (responseEvent.pubkey === remotePubkey) {
                            const pTag = responseEvent.tags.find(t => t[0] === 'p');

                            if (pTag && pTag[1] === ephemeralPubKey) {
                                try {
                                    let decryptedContent;

                                    if (responseEvent.content.includes('?iv=')) {
                                        decryptedContent = await window.NostrTools.nip04.decrypt(
                                            privKeyHex,
                                            remotePubkey,
                                            responseEvent.content
                                        );
                                    } else {
                                        const conversationKey = window.NostrTools.nip44.v2.utils.getConversationKey(
                                            privKeyBytes,
                                            remotePubkey
                                        );

                                        decryptedContent = window.NostrTools.nip44.v2.decrypt(
                                            responseEvent.content,
                                            conversationKey
                                        );
                                    }

                                    const response = JSON.parse(decryptedContent);

                                    if (response.id === requestId) {
                                        clearTimeout(timeout);
                                        ws.removeEventListener('message', handler);
                                        resolve(response);
                                    }
                                } catch (decryptError) {
                                    console.error('Failed to decrypt NIP-46 response:', decryptError);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('Error processing message:', e);
            }
        };

        ws.addEventListener('message', handler);
    });
}

// Connect using a bunker string
async function connectWithBunker() {
    const bunkerUrl = document.getElementById('bunkerUrl').value.trim();

    if (!bunkerUrl || !bunkerUrl.startsWith('bunker://')) {
        alert('Please enter a valid bunker URL');
        return;
    }

    try {
        const urlParts = bunkerUrl.slice(9).split('?');
        const remotePubkey = urlParts[0];

        if (!remotePubkey) {
            throw new Error('Invalid bunker URL format - missing pubkey');
        }

        const params = new URLSearchParams(urlParts[1] || '');
        const relay = params.get('relay');
        let secret = params.get('secret');

        if (!relay) {
            throw new Error('Invalid bunker URL format - missing relay parameter');
        }

        const ephemeralPrivKey = window.NostrTools.generateSecretKey();
        const ephemeralPubKey = window.NostrTools.getPublicKey(ephemeralPrivKey);
        const ephemeralPrivKeyHex = bytesToHex(ephemeralPrivKey);

        nip46Secret = secret || remotePubkey;

        const ws = await connectToRelay(relay);

        const subId = generateRandomId();
        const subscription = JSON.stringify([
            'REQ',
            subId,
            {
                kinds: [24133],
                '#p': [ephemeralPubKey],
                since: Math.floor(Date.now() / 1000) - 60
            }
        ]);
        ws.send(subscription);

        showConnectionStatus('Connecting to bunker...');

        const connectRequest = {
            id: generateRandomId(),
            method: 'connect',
            params: [ephemeralPubKey, secret || '']
        };

        let encryptedContent;
        try {
            encryptedContent = await encryptNip44(ephemeralPrivKeyHex, remotePubkey, JSON.stringify(connectRequest));
        } catch (encryptError) {
            encryptedContent = await window.NostrTools.nip04.encrypt(
                ephemeralPrivKeyHex,
                remotePubkey,
                JSON.stringify(connectRequest)
            );
        }

        const requestEvent = {
            kind: 24133,
            pubkey: ephemeralPubKey,
            content: encryptedContent,
            tags: [['p', remotePubkey]],
            created_at: Math.floor(Date.now() / 1000)
        };

        const signedRequestEvent = window.NostrTools.finalizeEvent(requestEvent, ephemeralPrivKey);

        ws.send(JSON.stringify(['EVENT', signedRequestEvent]));

        const connectResponse = await waitForNip46Response(ws, connectRequest.id, ephemeralPrivKeyHex, remotePubkey);

        if (connectResponse.result === 'auth_url' && connectResponse.error) {
            showConnectionStatus('Authorization required. Opening approval page...');

            const authUrl = connectResponse.error;
            const authWindow = window.open(authUrl, 'nostr-auth', 'width=600,height=800');

            showConnectionStatus('Waiting for approval...');

            let approved = false;
            let attempts = 0;
            const maxAttempts = 60;

            while (!approved && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 1000));

                if (authWindow && authWindow.closed) {
                    const getPubkeyRequest = {
                        id: generateRandomId(),
                        method: 'get_public_key',
                        params: []
                    };

                    let pubkeyEncrypted;
                    try {
                        pubkeyEncrypted = await encryptNip44(ephemeralPrivKeyHex, remotePubkey, JSON.stringify(getPubkeyRequest));
                    } catch (e) {
                        pubkeyEncrypted = await window.NostrTools.nip04.encrypt(
                            ephemeralPrivKeyHex,
                            remotePubkey,
                            JSON.stringify(getPubkeyRequest)
                        );
                    }

                    const pubkeyRequestEvent = {
                        kind: 24133,
                        pubkey: ephemeralPubKey,
                        content: pubkeyEncrypted,
                        tags: [['p', remotePubkey]],
                        created_at: Math.floor(Date.now() / 1000)
                    };

                    const signedPubkeyRequestEvent = window.NostrTools.finalizeEvent(pubkeyRequestEvent, ephemeralPrivKey);

                    ws.send(JSON.stringify(['EVENT', signedPubkeyRequestEvent]));

                    try {
                        const pubkeyResponse = await waitForNip46Response(ws, getPubkeyRequest.id, ephemeralPrivKeyHex, remotePubkey);

                        if (pubkeyResponse.result) {
                            approved = true;
                            const userPubkey = pubkeyResponse.result;

                            currentUser = { pubkey: userPubkey, nip46: true };
                            nip46Connection = {
                                relay,
                                remotePubkey,
                                ephemeralPrivKey: ephemeralPrivKeyHex,
                                ephemeralPubKey,
                                secret: nip46Secret
                            };

                            localStorage.setItem(STORAGE_KEYS.loginMethod, 'connect');
                            localStorage.setItem(STORAGE_KEYS.publicKey, userPubkey);
                            localStorage.setItem(STORAGE_KEYS.bunkerURL, bunkerUrl);
                            localStorage.setItem(STORAGE_KEYS.nip46Secret, JSON.stringify({
                                ephemeralPrivKey: ephemeralPrivKeyHex,
                                remotePubkey,
                                relay
                            }));

                            hideConnectionStatus();
                            hideConnectModal();
                            await onUserLoggedIn();
                        }
                    } catch (e) {
                        // Not approved yet, continue waiting
                    }
                }

                attempts++;
            }

            if (!approved) {
                throw new Error('Connection approval timeout');
            }

        } else if (connectResponse.result === 'ack') {
            showConnectionStatus('Connected! Getting public key...');

            const getPubkeyRequest = {
                id: generateRandomId(),
                method: 'get_public_key',
                params: []
            };

            let pubkeyEncrypted;
            try {
                pubkeyEncrypted = await encryptNip44(ephemeralPrivKeyHex, remotePubkey, JSON.stringify(getPubkeyRequest));
            } catch (e) {
                pubkeyEncrypted = await window.NostrTools.nip04.encrypt(
                    ephemeralPrivKeyHex,
                    remotePubkey,
                    JSON.stringify(getPubkeyRequest)
                );
            }

            const pubkeyRequestEvent = {
                kind: 24133,
                pubkey: ephemeralPubKey,
                content: pubkeyEncrypted,
                tags: [['p', remotePubkey]],
                created_at: Math.floor(Date.now() / 1000)
            };

            const signedPubkeyRequestEvent = window.NostrTools.finalizeEvent(pubkeyRequestEvent, ephemeralPrivKey);

            ws.send(JSON.stringify(['EVENT', signedPubkeyRequestEvent]));

            const pubkeyResponse = await waitForNip46Response(ws, getPubkeyRequest.id, ephemeralPrivKeyHex, remotePubkey);

            if (pubkeyResponse.result) {
                const userPubkey = pubkeyResponse.result;

                currentUser = { pubkey: userPubkey, nip46: true };
                nip46Connection = {
                    relay,
                    remotePubkey,
                    ephemeralPrivKey: ephemeralPrivKeyHex,
                    ephemeralPubKey,
                    secret: nip46Secret
                };

                localStorage.setItem(STORAGE_KEYS.loginMethod, 'connect');
                localStorage.setItem(STORAGE_KEYS.publicKey, userPubkey);
                localStorage.setItem(STORAGE_KEYS.bunkerURL, bunkerUrl);
                localStorage.setItem(STORAGE_KEYS.nip46Secret, JSON.stringify({
                    ephemeralPrivKey: ephemeralPrivKeyHex,
                    remotePubkey,
                    relay
                }));

                hideConnectionStatus();
                hideConnectModal();
                await onUserLoggedIn();
            } else {
                throw new Error('Failed to get public key from bunker');
            }
        } else {
            throw new Error(connectResponse.error || 'Connection rejected by bunker');
        }

    } catch (error) {
        console.error('NIP-46 connection failed:', error);
        hideConnectionStatus();
        alert('Failed to connect: ' + error.message);
    }
}

// Show connection status
function showConnectionStatus(message) {
    // Update all possible status displays
    const stringStatus = document.getElementById('connectStringStatus');
    const qrStatus = document.getElementById('qrConnectionStatus');

    if (stringStatus && stringStatus.style.display !== 'none') {
        stringStatus.querySelector('span').textContent = message;
    }

    if (qrStatus && qrStatus.style.display !== 'none') {
        qrStatus.querySelector('span').textContent = message;
    }
}

function hideConnectionStatus() {
    const stringStatus = document.getElementById('connectStringStatus');
    const qrStatus = document.getElementById('qrConnectionStatus');

    if (stringStatus) stringStatus.style.display = 'none';
    if (qrStatus) qrStatus.style.display = 'none';
}

// Private key login functions
function showPrivateKeyModal() {
    hideLoginModal();
    document.getElementById('privateKeyModal').classList.add('active');
}

function hidePrivateKeyModal() {
    document.getElementById('privateKeyModal').classList.remove('active');
}

function toggleKeyVisibility() {
    const input = document.getElementById('privateKeyInput');
    const checkbox = document.getElementById('showKey');
    input.type = checkbox.checked ? 'text' : 'password';
}

async function loginWithPrivateKey() {
    const keyInput = document.getElementById('privateKeyInput').value.trim();

    if (!keyInput) {
        alert('Please enter your private key');
        return;
    }

    try {
        let privateKey;
        let publicKey;

        if (keyInput.startsWith('nsec1')) {
            // Decode nsec
            const decoded = window.NostrTools.nip19.decode(keyInput);
            if (decoded.type !== 'nsec') {
                throw new Error('Invalid nsec key');
            }
            privateKey = decoded.data;
            publicKey = window.NostrTools.getPublicKey(privateKey);
        } else if (/^[0-9a-fA-F]{64}$/.test(keyInput)) {
            // Hex private key - convert to Uint8Array for nostr-tools
            privateKey = hexToBytes(keyInput);
            publicKey = window.NostrTools.getPublicKey(privateKey);
        } else {
            throw new Error('Invalid private key format');
        }

        currentUser = { pubkey: publicKey, privateKey: bytesToHex(privateKey) };

        // Store login info
        localStorage.setItem(STORAGE_KEYS.loginMethod, 'privateKey');
        localStorage.setItem(STORAGE_KEYS.publicKey, publicKey);
        localStorage.setItem(STORAGE_KEYS.privateKey, bytesToHex(privateKey));

        hidePrivateKeyModal();
        await onUserLoggedIn();

    } catch (error) {
        console.error('Private key login failed:', error);
        alert('Invalid private key. Please check and try again.');
    }
}

// Read-only login functions
function showReadOnlyModal() {
    hideLoginModal();
    document.getElementById('readOnlyModal').classList.add('active');
}

function hideReadOnlyModal() {
    document.getElementById('readOnlyModal').classList.remove('active');
}

async function loginReadOnly() {
    const keyInput = document.getElementById('publicKeyInput').value.trim();

    if (!keyInput) {
        alert('Please enter a public key');
        return;
    }

    try {
        let publicKey;

        if (keyInput.startsWith('npub1')) {
            // Decode npub
            const decoded = window.NostrTools.nip19.decode(keyInput);
            if (decoded.type !== 'npub') {
                throw new Error('Invalid npub key');
            }
            publicKey = decoded.data;
        } else if (/^[0-9a-fA-F]{64}$/.test(keyInput)) {
            // Hex public key
            publicKey = keyInput;
        } else {
            throw new Error('Invalid public key format');
        }

        currentUser = { pubkey: publicKey, readOnly: true };

        // Store login info
        localStorage.setItem(STORAGE_KEYS.loginMethod, 'readOnly');
        localStorage.setItem(STORAGE_KEYS.publicKey, publicKey);

        hideReadOnlyModal();
        await onUserLoggedIn();

    } catch (error) {
        console.error('Read-only login failed:', error);
        alert('Invalid public key. Please check and try again.');
    }
}

// Signup functions
function showSignupModal() {
    hideLoginModal();
    document.getElementById('signupModal').classList.add('active');
    updateSignupPreview();
}

function hideSignupModal() {
    document.getElementById('signupModal').classList.remove('active');
}

function updateSignupPreview() {
    const username = document.getElementById('signupUsername').value || 'Your Username';
    const about = document.getElementById('signupAbout').value || 'Your bio will appear here';

    document.getElementById('previewName').textContent = username;
    document.getElementById('previewAbout').textContent = about;
    document.getElementById('avatarInitial').textContent = username.charAt(0).toUpperCase();
}

async function signEvent(event) {
    if (!currentUser) {
        throw new Error('No user logged in');
    }

    if (currentUser.readOnly) {
        throw new Error('Cannot sign events in read-only mode');
    }

    // Ensure pubkey is set
    if (!event.pubkey) {
        event.pubkey = currentUser.pubkey;
    }

    if (window.nostr && !currentUser.privateKey && !currentUser.nip46) {
        // NIP-07 extension signing
        return await window.nostr.signEvent(event);
    } else if (currentUser.nip46) {
        // NIP-46 remote signing
        return await signEventWithNip46(event);
    } else if (currentUser.privateKey) {
        // Local key signing using nostr-tools
        const privKey = typeof currentUser.privateKey === 'string' ?
            hexToBytes(currentUser.privateKey) : currentUser.privateKey;

        // finalizeEvent returns the complete signed event
        const signedEvent = window.NostrTools.finalizeEvent(event, privKey);

        return signedEvent;
    } else {
        throw new Error('No signing method available');
    }
}

async function createAccount() {
    const username = document.getElementById('signupUsername').value.trim();
    const about = document.getElementById('signupAbout').value.trim();

    if (!username) {
        alert('Please enter a username');
        return;
    }

    try {
        // Generate new private key using browser bundle method
        const privateKey = window.NostrTools.generateSecretKey();
        const publicKey = window.NostrTools.getPublicKey(privateKey);

        // Create profile event
        const profileEvent = {
            kind: 0,
            pubkey: publicKey,
            created_at: Math.floor(Date.now() / 1000),
            tags: [],
            content: JSON.stringify({
                name: username,
                about: about,
                picture: `https://robohash.org/${publicKey}.png`
            })
        };

        // Use finalizeEvent to sign
        const signedProfileEvent = window.NostrTools.finalizeEvent(profileEvent, privateKey);

        // Publish profile
        await publishEvent(signedProfileEvent);

        // Create contact list
        const contactListEvent = {
            kind: 3,
            pubkey: publicKey,
            created_at: Math.floor(Date.now() / 1000),
            tags: [],
            content: ''
        };

        const signedContactListEvent = window.NostrTools.finalizeEvent(contactListEvent, privateKey);

        await publishEvent(signedContactListEvent);

        // Show success and keys
        const nsec = window.NostrTools.nip19.nsecEncode(privateKey);
        document.getElementById('generatedNsec').textContent = nsec;
        document.getElementById('signupSuccess').style.display = 'block';

        // Auto-login after 5 seconds
        setTimeout(() => {
            currentUser = { pubkey: publicKey, privateKey: bytesToHex(privateKey) };

            localStorage.setItem(STORAGE_KEYS.loginMethod, 'privateKey');
            localStorage.setItem(STORAGE_KEYS.publicKey, publicKey);
            localStorage.setItem(STORAGE_KEYS.privateKey, bytesToHex(privateKey));

            hideSignupModal();
            onUserLoggedIn();
        }, 5000);

    } catch (error) {
        console.error('Account creation failed:', error);
        alert('Failed to create account. Please try again.');
    }
}

function copyGeneratedKey() {
    const nsec = document.getElementById('generatedNsec').textContent;
    navigator.clipboard.writeText(nsec).then(() => {
        alert('Private key copied to clipboard! Save it securely.');
    });
}

// Logout function
async function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
        // Close any NIP-46 connections
        if (nip46Connection) {
            // Send disconnect message
            nip46Connection = null;
        }

        clearStoredLogin();

        // Close dropdown
        document.getElementById('userDropdown').classList.remove('active');

        // Refresh current view
        handleRoute();
    }
}

// Helper functions
function getPublicKeyFromPrivate(privateKey) {
    // Convert hex to Uint8Array if needed
    if (typeof privateKey === 'string') {
        return window.NostrTools.getPublicKey(hexToBytes(privateKey));
    }
    return window.NostrTools.getPublicKey(privateKey);
}

function generateRandomId() {
    // Use crypto.getRandomValues for browser compatibility
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
}

function generateRandomHex(length) {
    const bytes = new Uint8Array(length / 2);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Sign event based on current auth method
async function signEventForBundle(event, privateKey) {
    // The browser bundle uses finalizeEvent which both calculates id and signs
    const signedEvent = window.NostrTools.finalizeEvent(event, privateKey);
    return signedEvent.sig;
}

async function encryptNip44(privateKey, publicKey, content) {
    const privKeyBytes = typeof privateKey === 'string' ? hexToBytes(privateKey) : privateKey;
    const pubKeyHex = typeof publicKey === 'string' ? publicKey : bytesToHex(publicKey);

    try {
        if (window.NostrTools.nip44.encrypt) {
            return await window.NostrTools.nip44.encrypt(
                privateKey,
                publicKey,
                content
            );
        }
    } catch (e) {
        // Silently fall back to NIP-04
    }

    try {
        const conversationKey = window.NostrTools.nip44.getConversationKey(
            privKeyBytes,
            pubKeyHex
        );

        if (window.NostrTools.nip44.v2 && window.NostrTools.nip44.v2.encrypt) {
            return window.NostrTools.nip44.v2.encrypt(
                content,
                conversationKey
            );
        }
    } catch (e) {
        // Silently fall back to NIP-04
    }

    throw new Error('Failed to encrypt with NIP-44');
}

// NIP-46 signing
async function signEventWithNip46(event) {
    if (!nip46Connection) {
        throw new Error('No NIP-46 connection');
    }

    const request = {
        id: generateRandomId(),
        method: 'sign_event',
        params: [JSON.stringify(event)]
    };

    const ws = await connectToRelay(nip46Connection.relay);

    const ephemeralPrivKeyHex = nip46Connection.ephemeralPrivKey;

    let encryptedContent;
    try {
        encryptedContent = await encryptNip44(
            ephemeralPrivKeyHex,
            nip46Connection.remotePubkey,
            JSON.stringify(request)
        );
    } catch (e) {
        encryptedContent = await window.NostrTools.nip04.encrypt(
            ephemeralPrivKeyHex,
            nip46Connection.remotePubkey,
            JSON.stringify(request)
        );
    }

    const requestEvent = {
        kind: 24133,
        pubkey: nip46Connection.ephemeralPubKey,
        content: encryptedContent,
        tags: [['p', nip46Connection.remotePubkey]],
        created_at: Math.floor(Date.now() / 1000)
    };

    const signedRequestEvent = window.NostrTools.finalizeEvent(requestEvent, hexToBytes(ephemeralPrivKeyHex));

    ws.send(JSON.stringify(['EVENT', signedRequestEvent]));

    const response = await waitForNip46Response(
        ws,
        request.id,
        ephemeralPrivKeyHex,
        nip46Connection.remotePubkey
    );

    if (response.error) {
        throw new Error(response.error);
    }

    return JSON.parse(response.result);
}

// Compute shared secret for NIP-04 encryption
async function computeSharedSecret(privateKey, publicKey) {
    // Convert keys to proper format if needed
    const privKeyBytes = typeof privateKey === 'string' ? hexToBytes(privateKey) : privateKey;
    const pubKeyBytes = typeof publicKey === 'string' ? hexToBytes(publicKey) : publicKey;

    // Use secp256k1 to compute shared secret
    const sharedPoint = window.NostrTools.secp256k1.getSharedSecret(privKeyBytes, '02' + bytesToHex(pubKeyBytes));
    return sharedPoint.slice(1); // Remove the prefix byte
}

// Encrypt message using NIP-04
async function encryptMessage(message, sharedSecret) {
    const iv = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey(
        'raw',
        sharedSecret.slice(0, 32),
        { name: 'AES-CBC' },
        false,
        ['encrypt']
    );

    const encoded = new TextEncoder().encode(message);
    const padded = addPKCS7Padding(encoded);

    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-CBC', iv },
        key,
        padded
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    return bytesToBase64(combined);
}

// Decrypt message using NIP-04
async function decryptMessage(encryptedBase64, sharedSecret) {
    const combined = base64ToBytes(encryptedBase64);
    const iv = combined.slice(0, 16);
    const ciphertext = combined.slice(16);

    const key = await crypto.subtle.importKey(
        'raw',
        sharedSecret.slice(0, 32),
        { name: 'AES-CBC' },
        false,
        ['decrypt']
    );

    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-CBC', iv },
        key,
        ciphertext
    );

    const decoded = removePKCS7Padding(new Uint8Array(decrypted));
    return new TextDecoder().decode(decoded);
}

// Helper functions for encryption
function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
}

function bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes) {
    return btoa(String.fromCharCode.apply(null, bytes));
}

function base64ToBytes(base64) {
    return new Uint8Array(atob(base64).split('').map(c => c.charCodeAt(0)));
}

function addPKCS7Padding(data) {
    const blockSize = 16;
    const padding = blockSize - (data.length % blockSize);
    const padded = new Uint8Array(data.length + padding);
    padded.set(data);
    padded.fill(padding, data.length);
    return padded;
}

function removePKCS7Padding(data) {
    const padding = data[data.length - 1];
    return data.slice(0, data.length - padding);
}

async function signEventWithConnection(event) {
    // Sign with local ephemeral key for NIP-46 connection
    const ephemeralKey = generateRandomHex(32);
    event.pubkey = window.NostrTools.getPublicKey(ephemeralKey);
    event.id = window.NostrTools.getEventHash(event);
    event.sig = window.NostrTools.signEvent(event, ephemeralKey);
    return event;
}

async function reconnectNip46(bunkerUrl, secretData) {
    try {
        const data = JSON.parse(secretData);
        const { ephemeralPrivKey, remotePubkey, relay } = data;

        // Convert hex private key back to Uint8Array if needed
        const privKeyBytes = typeof ephemeralPrivKey === 'string' ?
            hexToBytes(ephemeralPrivKey) : ephemeralPrivKey;
        const ephemeralPrivKeyHex = typeof ephemeralPrivKey === 'string' ?
            ephemeralPrivKey : bytesToHex(ephemeralPrivKey);

        const ephemeralPubKey = window.NostrTools.getPublicKey(privKeyBytes);

        // Reconnect and verify
        const ws = await connectToRelay(relay);

        // Subscribe to responses
        const subId = generateRandomId();
        const subscription = JSON.stringify([
            'REQ',
            subId,
            {
                kinds: [24133],
                '#p': [ephemeralPubKey],
                since: Math.floor(Date.now() / 1000) - 60
            }
        ]);
        ws.send(subscription);

        // Test connection with get_public_key
        const getPubkeyRequest = {
            id: generateRandomId(),
            method: 'get_public_key',
            params: []
        };

        let encryptedContent;
        try {
            encryptedContent = await encryptNip44(ephemeralPrivKeyHex, remotePubkey, JSON.stringify(getPubkeyRequest));
        } catch (e) {
            encryptedContent = await window.NostrTools.nip04.encrypt(
                ephemeralPrivKeyHex,
                remotePubkey,
                JSON.stringify(getPubkeyRequest)
            );
        }

        const requestEvent = {
            kind: 24133,
            pubkey: ephemeralPubKey,
            content: encryptedContent,
            tags: [['p', remotePubkey]],
            created_at: Math.floor(Date.now() / 1000)
        };

        const signedRequestEvent = window.NostrTools.finalizeEvent(requestEvent, privKeyBytes);

        ws.send(JSON.stringify(['EVENT', signedRequestEvent]));

        const response = await waitForNip46Response(ws, getPubkeyRequest.id, ephemeralPrivKeyHex, remotePubkey);

        if (response.result) {
            currentUser = { pubkey: response.result, nip46: true };
            nip46Connection = {
                relay,
                remotePubkey,
                ephemeralPrivKey: ephemeralPrivKeyHex,
                ephemeralPubKey,
                secret: remotePubkey
            };
            await onUserLoggedIn();
        } else {
            throw new Error('Failed to reconnect');
        }
    } catch (error) {
        console.error('NIP-46 reconnection failed:', error);
        clearStoredLogin();
    }
}

// Ensure user is logged in
async function ensureLoggedIn() {
    if (currentUser) {
        return true;
    }

    showLoginModal();
    return false;
}

// Initialize settings after login
async function initializeSettings() {
    if (isInitializingSettings) return;
    isInitializingSettings = true;

    try {
        // Try to load from Nostr if user is logged in
        if (currentUser && !currentUser.readOnly) {
            const nostrSettings = await loadSettingsFromNostr();
            if (nostrSettings) {
                userSettings = nostrSettings;
                applySettings();
                return;
            }
        }

        // Fall back to localStorage
        const savedSettings = localStorage.getItem('plebsSettings');
        if (savedSettings) {
            try {
                userSettings = JSON.parse(savedSettings);
                applySettings();
            } catch (e) {
                console.error('Failed to parse saved settings:', e);
            }
        }
    } finally {
        isInitializingSettings = false;
    }
}

// Load settings from Nostr
async function loadSettingsFromNostr() {
    if (!currentUser || currentUser.readOnly) return null;

    try {
        const filter = {
            kinds: [30078],
            authors: [currentUser.pubkey],
            '#d': ['plebs-settings'],
            limit: 1
        };

        let settings = null;
        await new Promise((resolve) => {
            requestEventsStream(filter, (event) => {
                try {
                    settings = JSON.parse(event.content);
                } catch (e) {
                    console.error('Failed to parse Nostr settings:', e);
                }
            }, resolve);
        });

        return settings;
    } catch (error) {
        console.error('Failed to load settings from Nostr:', error);
        return null;
    }
}

// Save settings to Nostr
async function saveSettingsToNostr() {
    if (!currentUser || currentUser.readOnly) return false;

    try {
        const settingsEvent = {
            kind: 30078,
            tags: [
                ['d', 'plebs-settings'],
                ['title', 'Plebs App Settings'],
                ['client', 'Plebs']
            ],
            content: JSON.stringify(userSettings),
            created_at: Math.floor(Date.now() / 1000)
        };

        const signedEvent = await signEvent(settingsEvent);
        return await publishEvent(signedEvent);
    } catch (error) {
        console.error('Failed to save settings to Nostr:', error);
        return false;
    }
}

// Apply settings to the app
function applySettings() {
    const previousRelayUrls = [...RELAY_URLS];

    // Update relay URLs based on settings
    if (userSettings.useWotRelays) {
        RELAY_URLS.length = 0;
        RELAY_URLS.push(...WOT_RELAY_URLS);
    } else {
        RELAY_URLS.length = 0;
        RELAY_URLS.push(
            'wss://relay.damus.io',
            'wss://relay.nostr.band',
            'wss://nos.lol',
            'wss://relay.primal.net'
        );
    }

    // Only disconnect if relay URLs actually changed
    const relaysChanged = previousRelayUrls.length !== RELAY_URLS.length ||
        previousRelayUrls.some((url, index) => url !== RELAY_URLS[index]);

    if (relaysChanged) {
        // Close connections to ALL existing relays first
        Object.entries(relayConnections).forEach(([url, ws]) => {
            if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
                ws.close();
            }
            delete relayConnections[url];
        });

        // Clear any existing subscription handlers to prevent memory leaks
        if (window.subscriptionHandlers) {
            window.subscriptionHandlers = {};
        }

        // Initialize connections to new relays
        initializeRelayConnections().then(() => {
            console.log('Relay connections updated after settings change');
        });
    }

    // Update Blossom servers based on settings
    BLOSSOM_SERVERS.length = 0;

    BLOSSOM_SERVERS.push(
        'https://blossom.primal.net',
        'https://blossom.band',
        'https://24242.io'
    );

    if (userSettings.usePremiumBlossom) {
        BLOSSOM_SERVERS.unshift(PREMIUM_BLOSSOM_SERVER);
    }

    if (userSettings.customBlossomServers.length > 0) {
        BLOSSOM_SERVERS.push(...userSettings.customBlossomServers);
    }
}

// Show settings modal
function showSettingsModal() {
    if (!currentUser) {
        ensureLoggedIn().then(loggedIn => {
            if (!loggedIn) {
                return;
            }
            // If user logs in successfully, show the settings modal
            showSettingsModalContent();
        });
        return;
    }

    showSettingsModalContent();
}

// Helper function to show settings modal content
function showSettingsModalContent() {
    document.getElementById('useWotRelays').checked = userSettings.useWotRelays;
    document.getElementById('usePremiumBlossom').checked = userSettings.usePremiumBlossom;
    document.getElementById('customBlossomServers').value = userSettings.customBlossomServers.join(', ');
    document.getElementById('saveToNostr').checked = userSettings.saveToNostr;

    document.getElementById('settingsModal').classList.add('active');
}

// Hide settings modal
function hideSettingsModal() {
    document.getElementById('settingsModal').classList.remove('active');
}

// Toggle WoT relays
function toggleWotRelays() {
    const checkbox = document.getElementById('useWotRelays');
    userSettings.useWotRelays = checkbox.checked;
}

// Toggle premium Blossom
function togglePremiumBlossom() {
    const checkbox = document.getElementById('usePremiumBlossom');
    userSettings.usePremiumBlossom = checkbox.checked;
}

// Save settings
async function saveSettings() {
    const customServersInput = document.getElementById('customBlossomServers').value;
    userSettings.customBlossomServers = customServersInput
        .split(',')
        .map(url => url.trim())
        .filter(url => url.startsWith('http'));

    userSettings.saveToNostr = document.getElementById('saveToNostr').checked;

    localStorage.setItem('plebsSettings', JSON.stringify(userSettings));

    if (userSettings.saveToNostr && currentUser) {
        const saved = await saveSettingsToNostr();
        if (saved) {
            alert('Settings saved successfully!');
        } else {
            alert('Settings saved locally. Could not save to Nostr.');
        }
    } else {
        alert('Settings saved locally!');
    }

    applySettings();
    hideSettingsModal();
    handleRoute();
}

// Reset settings to defaults
function resetSettings() {
    if (confirm('Are you sure you want to reset all settings to defaults?')) {
        userSettings = {
            useWotRelays: false,
            usePremiumBlossom: false,
            customBlossomServers: [],
            saveToNostr: true
        };

        localStorage.removeItem('plebsSettings');
        applySettings();
        showSettingsModal();

        alert('Settings reset to defaults!');
    }
}

// Sidebar management
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.querySelector('.sidebar-overlay');

    // Update header height BEFORE toggling
    updateHeaderHeight();

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

// Routes based on page type
async function handleRoute() {
    hideNotificationsModal();
    const hash = window.location.hash.slice(1) || '/';
    const pathParts = hash.split('/').filter(p => p);

    // Update meta tags with structured data
    const updateMetaTags = (title, description, image = null, type = 'website') => {
        const ogImage = image || './images/plebs-og.png';

        document.title = title;

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

        // Include the full URL with hash
        const fullUrl = window.location.href;
        setMetaTag('meta[property="og:url"]', 'content', fullUrl);

        setMetaTag('meta[name="twitter:card"]', 'content', image ? 'summary_large_image' : 'summary');
        setMetaTag('meta[name="twitter:title"]', 'content', title);
        setMetaTag('meta[name="twitter:description"]', 'content', description);
        setMetaTag('meta[name="twitter:image"]', 'content', ogImage);

        let canonical = document.querySelector('link[rel="canonical"]');
        if (!canonical) {
            canonical = document.createElement('link');
            canonical.setAttribute('rel', 'canonical');
            document.head.appendChild(canonical);
        }
        canonical.setAttribute('href', fullUrl);
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

    updateMetaTags(
        'Plebs - Decentralized Video Platform',
        'Plebs is a censorship-resistant, decentralized video platform powered by the Nostr social protocol'
    );

    setStructuredData({
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": "Plebs",
        "description": "Censorship-resistant, decentralized video platform powered by Nostr",
        "url": window.location.href
    });

    if (pathParts.length === 0) {
        loadHomeFeed();
    } else if (pathParts[0] === 'video' && pathParts[1]) {
        const eventId = pathParts[1];

        document.getElementById('mainContent').innerHTML = '<div class="spinner"></div>';

        // Fetch video metadata for SEO
        try {
            const event = await fetchVideoEvent(eventId);
            if (event) {
                const videoData = parseVideoEvent(event);
                const profile = await fetchUserProfile(event.pubkey);

                if (videoData) {
                    const authorName = profile?.name || profile?.display_name || `User ${event.pubkey.slice(0, 8)}`;

                    updateMetaTags(
                        `${videoData.title} - Plebs`,
                        videoData.description ? videoData.description.slice(0, 155) : `Watch "${videoData.title}" by ${authorName} on Plebs`,
                        videoData.thumbnail,
                        'video.other'
                    );

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
                            "url": `${window.location.origin}${window.location.pathname}#/profile/${event.pubkey}`
                        },
                        "url": window.location.href  // Use full URL including hash
                    });
                }
            }
        } catch (error) {
            console.error('Failed to fetch video metadata:', error);
        }

        playVideo(eventId);
    } else if (pathParts[0] === 'profile' && pathParts[1]) {
        const pubkey = pathParts[1];

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

                setStructuredData({
                    "@context": "https://schema.org",
                    "@type": "Person",
                    "name": displayName,
                    "description": about,
                    "image": avatarUrl || undefined,
                    "url": window.location.href  // Use full URL including hash
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
            `Watch ${tag} videos on Plebs, the censorship-resistant decentralized video platform`
        );

        setStructuredData({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": `${tag.charAt(0).toUpperCase() + tag.slice(1)} Videos`,
            "description": `Watch ${tag} videos on Plebs`,
            "url": window.location.href
        });

        loadTag(tag);
    } else if (pathParts[0] === 'search' && pathParts[1]) {
        const query = decodeURIComponent(pathParts[1]);
        updateMetaTags(
            `Search: ${query} - Plebs`,
            `Search results for "${query}" on Plebs`
        );

        setStructuredData({
            "@context": "https://schema.org",
            "@type": "SearchResultsPage",
            "name": `Search: ${query}`,
            "description": `Search results for "${query}" on Plebs`,
            "url": window.location.href
        });

        document.getElementById('searchInput').value = query;
        performSearch(pathParts[1]);
    } else if (pathParts[0] === 'subscriptions') {
        updateMetaTags(
            'Subscriptions - Plebs',
            'Watch videos from creators you follow on Plebs'
        );

        setStructuredData({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": "Subscriptions",
            "description": "Watch videos from creators you follow on Plebs",
            "url": window.location.href
        });

        loadSubscriptions();
    } else if (pathParts[0] === 'my-videos') {
        updateMetaTags(
            'My Videos - Plebs',
            'Manage your videos on Plebs'
        );

        setStructuredData({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": "My Videos",
            "description": "Manage your videos on Plebs",
            "url": window.location.href
        });

        loadMyVideos();
    } else if (pathParts[0] === 'liked') {
        updateMetaTags(
            'Liked Videos - Plebs',
            'Watch your liked videos on Plebs'
        );

        setStructuredData({
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": "Liked Videos",
            "description": "Watch your liked videos on Plebs",
            "url": window.location.href
        });

        loadLikedVideos();
    } else {
        loadHomeFeed();
    }

    updateSidebarActive();
}

// Show notifications modal and fetch notifications
async function loadNotifications() {
    if (!currentUser) {
        if (!await ensureLoggedIn()) {
            return;
        }
    }

    const modal = document.getElementById("notificationsModal");
    const list = document.getElementById("notificationsList");
    list.innerHTML = '<div class="spinner"></div>';
    modal.classList.add("active");

    try {
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

        // Fetch reactions
        const reactions = [];
        const reactionFilter = {
            kinds: [7],
            '#e': videoIds
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

        // Fetch replies
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

        // Fetch zaps
        const zaps = [];
        const zapsFilter = {
            kinds: [9735], // Zap receipts
            '#e': videoIds
        };

        await new Promise((resolve) => {
            requestEventsStream(zapsFilter, (zapEvent) => {
                const videoId = zapEvent.tags.find(t => t[0] === 'e')?.[1];
                if (videoId && videoIds.includes(videoId)) {
                    // Extract zapper pubkey from the 'P' tag (uppercase P for zap receipts)
                    const zapperTag = zapEvent.tags.find(t => t[0] === 'P');
                    if (zapperTag && zapperTag[1] !== currentUser.pubkey) {
                        zaps.push(zapEvent);
                    }
                }
            }, resolve);
        });

        // Combine and sort all notifications
        const notifications = [...reactions, ...replies, ...zaps].sort((a, b) => b.created_at - a.created_at);

        if (notifications.length === 0) {
            list.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No recent activity.</p>';
            return;
        }

        // Fetch profiles for all notification authors
        const uniquePubkeys = [...new Set([
            ...notifications.filter(n => n.kind !== 9735).map(n => n.pubkey),
            ...notifications.filter(n => n.kind === 9735).map(n => {
                const zapperTag = n.tags.find(t => t[0] === 'P');
                return zapperTag ? zapperTag[1] : null;
            }).filter(Boolean)
        ])];

        const profilePromises = uniquePubkeys.map(pubkey => fetchUserProfile(pubkey));
        await Promise.all(profilePromises);

        list.innerHTML = '';

        notifications.forEach(event => {
            const isReaction = event.kind === 7;
            const isReply = event.kind === 1;
            const isZap = event.kind === 9735;
            const videoId = event.tags.find(t => t[0] === 'e')?.[1];
            const video = userVideos.find(v => v.id === videoId);
            const videoTitle = video ? parseVideoEvent(video).title : 'Unknown Video';

            let displayName, avatarUrl, content, notificationPubkey;

            if (isZap) {
                // For zaps, get the zapper's info from the P tag
                const zapperTag = event.tags.find(t => t[0] === 'P');
                notificationPubkey = zapperTag ? zapperTag[1] : '';

                // Extract amount from bolt11 tag
                const bolt11Tag = event.tags.find(t => t[0] === 'bolt11');
                const amount = bolt11Tag ? extractAmountFromBolt11(bolt11Tag[1]) : 0;

                const profile = profileCache.get(notificationPubkey) || {};
                displayName = profile.name || profile.display_name || `User ${notificationPubkey.slice(0, 8)}`;
                avatarUrl = profile.picture || profile.avatar || '';
                content = `Zapped: ${formatSats(amount)} sats ⚡`;
            } else {
                notificationPubkey = event.pubkey;
                const profile = profileCache.get(event.pubkey) || {};
                displayName = profile.name || profile.display_name || `User ${event.pubkey.slice(0, 8)}`;
                avatarUrl = profile.picture || profile.avatar || '';
                content = isReaction
                    ? `Reacted: ${event.content}`
                    : `Replied: "${event.content.slice(0, 40)}${event.content.length > 40 ? '...' : ''}"`;
            }

            const timestamp = formatTimestamp(event.created_at);

            const item = document.createElement('div');
            item.className = 'notification-item';
            item.innerHTML = `
                <div class="notification-content">
                    <div class="notification-author">
                        ${avatarUrl ? `
                            <div class="notification-avatar">
                                <img src="${avatarUrl}" alt="${displayName}">
                            </div>
                        ` : ''}
                        <div>
                            <div style="font-weight: 500;">${displayName}</div>
                            <div style="font-size: 0.875rem; color: var(--text-secondary);">${timestamp}</div>
                        </div>
                    </div>
                    <div style="margin-top: 0.25rem; ${isZap ? 'color: #f7931a; font-weight: 500;' : ''}">${content}</div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.25rem;">on "${videoTitle}"</div>
                </div>
                <a href="#/video/${videoId}" onclick="hideNotificationsModal();" class="notification-link">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                    </svg>
                </a>
            `;
            list.appendChild(item);
        });

    } catch (error) {
        console.error("Failed to load notifications:", error);
        list.innerHTML = '<div class="error-message">Failed to load notifications</div>';
    }
}

// Fetch events via stream
function fetchEvents(filter) {
    return new Promise((resolve, reject) => {
        const results = [];
        requestEventsStream(filter, (event) => {
            results.push(event);
        }, () => resolve(results));
    });
}

// Close modal
function hideNotificationsModal() {
    document.getElementById("notificationsModal").classList.remove("active");
}

// Function to load liked videos
async function loadLikedVideos() {
    if (!currentUser) {
        await checkStoredLogin(); // Wait for login check
        if (!currentUser) {
            document.getElementById('mainContent').innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Please login to view your liked videos.</p>';
            return;
        }
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

    const reactionFilter = {
        kinds: [7],
        authors: [currentUser.pubkey],
        '#t': ['pv69420']
    };

    await new Promise((resolve) => {
        requestEventsStream(reactionFilter, (event) => {
            if (event.content === '👍') {
                const videoIdTag = event.tags.find(tag => tag[0] === 'e');
                if (videoIdTag) {
                    likedVideoIds.add(videoIdTag[1]);
                }
            }
        }, resolve);
    });

    if (likedVideoIds.size === 0) {
        videoGrid.innerHTML = '<p style="text-align: center; color: var(--text-secondary); grid-column: 1/-1;">You haven\'t liked any videos yet.</p>';
        return;
    }

    const videoFilter = {
        kinds: [1],
        '#t': ['pv69420'],
        ids: Array.from(likedVideoIds)
    };

    await displayVideosStream('Liked Videos', videoFilter);
}

// Function to handle boost button click
async function handleBoost(eventId) {
    if (!await ensureLoggedIn()) {
        return;
    }

    // Fixed 100 sats for boost
    showBoostAmountModal(eventId);
}

// Show boost amount selection modal (100 sats fixed)
function showBoostAmountModal(eventId) {
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
        <h2 style="margin-bottom: 1.5rem; background: linear-gradient(135deg, #f7931a, #ff9500); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Boost This Video</h2>
        <p style="font-size: 1.2rem; margin-bottom: 1.5rem;">Use Bitcoin Lightning + Nostr Zap to Boost for <strong>100 sats</strong> to help this video trend!</p>
        <p style="font-size: 1.2rem; margin-bottom: 1.5rem;">Videos that are boosted will also be highlighted throughout the app and their highlight will grow brighter the more they're boosted.</p>
        
        <div style="display: flex; gap: 0.5rem; justify-content: center;">
            <button onclick="processBoost('${eventId}', 100); this.closest('div[style*=fixed]').remove();" 
                    style="padding: 0.75rem 1.5rem; background: linear-gradient(135deg, #f7931a, #ff9500); 
                           color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 500;">
                Boost for 100 sats ⚡
            </button>
            <button onclick="this.closest('div[style*=fixed]').remove();" 
                    style="padding: 0.5rem 1.5rem; background: var(--bg-primary); color: var(--text-primary); 
                           border: 1px solid var(--border); border-radius: 8px; cursor: pointer;">
                Cancel
            </button>
        </div>
    </div>
`;

    document.body.appendChild(modal);
}

// Process the boost
async function processBoost(eventId, amount) {
    try {
        // Create boost zap request
        const boostZapRequest = {
            kind: 9734,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
                ['p', 'd49a9023a21dba1b3c8306ca369bf3243d8b44b8f0b6d1196607f7b0990fa8df'],
                ['amount', amount.toString()],
                ['relays', ...RELAY_URLS],
                ['e', eventId],
                ['purpose', 'boost']
            ],
            content: `Boost for video ${eventId}`
        };

        const signedZapRequest = await signEvent(boostZapRequest);

        // Fetch invoice from walletofsatoshi
        const lnurlResponse = await fetchBoostInvoice(amount, JSON.stringify(signedZapRequest));

        if (lnurlResponse.pr) {
            showBoostInvoice(lnurlResponse.pr, amount, eventId);

            // Poll for zap receipt
            pollForBoostReceipt(eventId, amount);

            if (window.webln) {
                try {
                    await window.webln.enable();
                    const result = await window.webln.sendPayment(lnurlResponse.pr);
                    if (result.preimage) {
                        // Payment successful through WebLN
                    }
                } catch (e) {
                    console.log('WebLN payment failed, waiting for manual payment');
                }
            }
        }
    } catch (error) {
        console.error('Failed to create boost:', error);
        alert('Failed to create boost. Please try again.');
    }
}

// Fetch boost invoice from walletofsatoshi
async function fetchBoostInvoice(amount, zapRequest) {
    const url = `https://walletofsatoshi.com/.well-known/lnurlp/69420`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.callback) {
            const invoiceUrl = new URL(data.callback);
            invoiceUrl.searchParams.set('amount', amount * 1000); // millisats
            invoiceUrl.searchParams.set('nostr', zapRequest);

            const invoiceResponse = await fetch(invoiceUrl.toString());
            return await invoiceResponse.json();
        }
    } catch (error) {
        console.error('Failed to fetch boost invoice:', error);
        throw error;
    }
}

// Show boost invoice modal
function showBoostInvoice(invoice, amount, eventId) {
    const modal = document.createElement('div');
    modal.id = 'boost-invoice-modal';
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
            <h2 style="margin-bottom: 0.5rem; background: linear-gradient(135deg, #f7931a, #ff9500); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Lightning Invoice</h2>
            <p style="margin-bottom: 1rem; color: var(--text-secondary);">Boost ${amount} sats</p>
            <p style="margin-bottom: 1rem;">Scan with your Lightning wallet:</p>
            
            <div style="background: white; padding: 1rem; border-radius: 8px; margin: 1rem auto; display: inline-block;">
                <div id="boost-qrcode"></div>
            </div>
            
            <div style="margin: 1rem 0; color: var(--text-secondary); font-size: 0.875rem;">
                <div id="boost-payment-status">
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
                    btn.style.background = 'linear-gradient(135deg, #f7931a, #ff9500)';
                    setTimeout(() => {
                        btn.textContent = originalText;
                        btn.style.background = '';
                    }, 2000);
                });" style="padding: 0.5rem 1rem; background: linear-gradient(135deg, #f7931a, #ff9500); color: white; border: none; border-radius: 4px; cursor: pointer;">
                    Copy Invoice
                </button>
                <button onclick="document.getElementById('boost-invoice-modal').remove();" 
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
        new QRCode(document.getElementById("boost-qrcode"), {
            text: invoice.toUpperCase(),
            width: 256,
            height: 256,
            colorDark: "#000000",
            colorLight: "#FFFFFF",
            correctLevel: QRCode.CorrectLevel.L
        });
    }
}

// Poll for boost zap receipt
async function pollForBoostReceipt(eventId, amount) {
    const startTime = Date.now();
    const timeout = 60000; // 60 seconds
    const pollInterval = 2000; // 2 seconds

    const checkForReceipt = async () => {
        if (Date.now() - startTime > timeout) {
            console.log('Boost receipt polling timeout');
            return;
        }

        const filter = {
            kinds: [9735],
            '#e': [eventId],
            since: Math.floor(startTime / 1000) - 10
        };

        let foundReceipt = false;

        await new Promise((resolve) => {
            requestEventsStream(filter, (event) => {
                try {
                    // Check if this is a boost zap to walletofsatoshi
                    const pTag = event.tags.find(tag => tag[0] === 'p');
                    if (pTag && pTag[1] === 'd49a9023a21dba1b3c8306ca369bf3243d8b44b8f0b6d1196607f7b0990fa8df') {
                        const bolt11Tag = event.tags.find(tag => tag[0] === 'bolt11');
                        if (bolt11Tag && bolt11Tag[1]) {
                            const receiptAmount = extractAmountFromBolt11(bolt11Tag[1]);

                            if (Math.abs(receiptAmount - amount) < 10) {
                                foundReceipt = true;

                                // Close invoice modal
                                const invoiceModal = document.getElementById('boost-invoice-modal');
                                if (invoiceModal) {
                                    invoiceModal.remove();
                                }

                                // Show success animation
                                showBoostSuccess(amount);

                                // Update boost cache
                                const currentBoosts = boostsCache.get(eventId) || 0;
                                boostsCache.set(eventId, currentBoosts + amount);

                                // Update boost button
                                updateBoostButton(eventId, currentBoosts + amount);
                            }
                        }
                    }
                } catch (e) {
                    console.error('Error checking boost receipt:', e);
                }
            }, () => {
                resolve();
            });
        });

        if (!foundReceipt) {
            setTimeout(checkForReceipt, pollInterval);
        }
    };

    setTimeout(checkForReceipt, 2000);
}

// Show boost success animation
function showBoostSuccess(amount) {
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
            <div class="boost-success-animation">
                <svg width="120" height="120" viewBox="0 0 24 24" fill="url(#boostGradient)" style="margin-bottom: 1rem;">
                    <defs>
                        <linearGradient id="boostGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" style="stop-color:#f7931a;stop-opacity:1" />
                            <stop offset="100%" style="stop-color:#ff9500;stop-opacity:1" />
                        </linearGradient>
                    </defs>
                    <path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z" stroke-width="2"/>
                </svg>
                <h2 style="background: linear-gradient(135deg, #f7931a, #ff9500); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 0.5rem;">Video Boosted!</h2>
                <p style="font-size: 1.5rem; font-weight: bold;">${amount} sats</p>
            </div>
        </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
        .boost-success-animation {
            animation: boostPulse 0.5s ease-out;
        }
        
        @keyframes boostPulse {
            0% { transform: scale(0.8); opacity: 0; }
            50% { transform: scale(1.1); }
            100% { transform: scale(1); opacity: 1; }
        }
    `;
    document.head.appendChild(style);

    document.body.appendChild(modal);

    setTimeout(() => {
        modal.style.opacity = '0';
        modal.style.transition = 'opacity 0.3s ease-out';
        setTimeout(() => {
            modal.remove();
            style.remove();
        }, 300);
    }, 2000);
}

// Update boost button UI
function updateBoostButton(eventId, totalBoosts) {
    const boostBtn = document.querySelector(`.action-btn.boost[data-event-id="${eventId}"]`);
    if (boostBtn) {
        boostBtn.querySelector('.count').textContent = totalBoosts > 0 ? formatSats(totalBoosts) : 'Boost';
        if (totalBoosts > 0) {
            boostBtn.classList.add('active');
        }
    }
}

// Load boosts for video
async function loadBoostsForVideo(eventId, onUpdate = null) {
    const filter = {
        kinds: [9735],
        '#e': [eventId],
        '#p': ['d49a9023a21dba1b3c8306ca369bf3243d8b44b8f0b6d1196607f7b0990fa8df']
    };

    let totalBoosts = 0;

    return new Promise((resolve) => {
        requestEventsStream(filter, (event) => {
            try {
                // Check if this has the purpose=boost tag
                const description = event.tags.find(tag => tag[0] === 'description')?.[1];
                if (description) {
                    try {
                        const zapRequest = JSON.parse(description);
                        const hasBoostTag = zapRequest.tags?.some(tag =>
                            tag[0] === 'purpose' && tag[1] === 'boost'
                        );

                        if (hasBoostTag) {
                            const bolt11Tag = event.tags.find(tag => tag[0] === 'bolt11');
                            if (bolt11Tag && bolt11Tag[1]) {
                                const amount = extractAmountFromBolt11(bolt11Tag[1]);
                                if (amount > 0) {
                                    totalBoosts += amount;

                                    if (onUpdate) {
                                        onUpdate(totalBoosts);
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        // If we can't parse description, skip this event
                    }
                }
            } catch (e) {
                console.error('Failed to parse boost:', e);
            }
        }, () => {
            boostsCache.set(eventId, totalBoosts);
            resolve(totalBoosts);
        });
    });
}

// Calculate boost level for video card highlighting
function getBoostLevel(boostAmount) {
    if (boostAmount >= 10000) return 4;
    if (boostAmount >= 5000) return 3;
    if (boostAmount >= 1000) return 2;
    if (boostAmount >= 100) return 1;
    return 0;
}

// Function to handle zaps
async function handleZap(npub, amount, eventId = null) {
    if (!await ensureLoggedIn()) {
        return;
    }

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
            <p style="font-size: 1.2rem; margin-bottom: 1.5rem;">Use Bitcoin Lightning + Nostr Zap to send sats directly to the content creator!</p>
            
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

    modal.querySelectorAll('.zap-amount-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const amount = parseInt(btn.getAttribute('data-amount'));
            modal.remove();
            await processZap(npub, amount, eventId);
        });
    });

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

        if (eventId) {
            zapRequest.tags.push(['e', eventId]);
        }

        const signedZapRequest = await signEvent(zapRequest);

        const lnurlResponse = await fetchLightningInvoice(npub, amount, JSON.stringify(signedZapRequest));

        if (lnurlResponse.pr) {
            showLightningInvoice(lnurlResponse.pr, amount, !!window.webln);

            const paymentHash = extractPaymentHash(lnurlResponse.pr);
            pollForZapReceipt(window.NostrTools.nip19.decode(npub).data, amount, eventId, paymentHash);

            if (window.webln) {
                try {
                    await window.webln.enable();
                    const result = await window.webln.sendPayment(lnurlResponse.pr);
                    if (result.preimage) {
                        // Payment successful through WebLN
                    }
                } catch (e) {
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
    const timeout = 60000; // 60 seconds
    const pollInterval = 2000; // 2 seconds

    const checkForReceipt = async () => {
        if (Date.now() - startTime > timeout) {
            console.log('Zap receipt polling timeout');
            return;
        }

        const filter = {
            kinds: [9735],
            '#p': [recipientPubkey],
            since: Math.floor(startTime / 1000) - 10
        };

        if (eventId) {
            filter['#e'] = [eventId];
        }

        let foundReceipt = false;

        await new Promise((resolve) => {
            requestEventsStream(filter, (event) => {
                try {
                    const bolt11Tag = event.tags.find(tag => tag[0] === 'bolt11');
                    if (bolt11Tag && bolt11Tag[1]) {
                        const receiptAmount = extractAmountFromBolt11(bolt11Tag[1]);

                        if (Math.abs(receiptAmount - amount) < 10) {
                            foundReceipt = true;

                            const invoiceModal = document.getElementById('lightning-invoice-modal');
                            if (invoiceModal) {
                                invoiceModal.remove();
                            }

                            showZapSuccess(amount);

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

        if (!foundReceipt) {
            setTimeout(checkForReceipt, pollInterval);
        }
    };

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

    if (profile.lud16) {
        const [name, domain] = profile.lud16.split('@');
        const url = `https://${domain}/.well-known/lnurlp/${name}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.callback) {
                const invoiceUrl = new URL(data.callback);
                invoiceUrl.searchParams.set('amount', amount * 1000);
                invoiceUrl.searchParams.set('nostr', zapRequest);

                const invoiceResponse = await fetch(invoiceUrl.toString());
                return await invoiceResponse.json();
            }
        } catch (error) {
            console.error('Failed to fetch from lightning address:', error);
        }
    }

    if (profile.lud06) {
        try {
            const decoded = window.NostrTools.nip19.decode(profile.lud06);
            const url = decoded.data;

            const response = await fetch(url);
            const data = await response.json();

            if (data.callback) {
                const invoiceUrl = new URL(data.callback);
                invoiceUrl.searchParams.set('amount', amount * 1000);
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
    const zapBtn = document.querySelector(`.action-btn.zap[data-event-id="${eventId}"]`);
    if (zapBtn) {
        zapBtn.querySelector('.count').textContent = totalZaps > 0 ? formatSats(totalZaps) : 'Zap';
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

    carouselDots.querySelectorAll('.carousel-dot').forEach((dot, index) => {
        dot.classList.toggle('active', index === page);
    });

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

    // Video is ratioed if:
    // 1. At least 10 total reactions
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
        // Check if we have an open connection
        if (relayConnections[url] && relayConnections[url].readyState === WebSocket.OPEN) {
            resolve(relayConnections[url]);
            return;
        }

        // If there's a connection in progress, wait for it
        if (relayConnections[url] && relayConnections[url].readyState === WebSocket.CONNECTING) {
            const checkConnection = setInterval(() => {
                const ws = relayConnections[url];
                if (!ws) {
                    clearInterval(checkConnection);
                    // Connection was removed, try again
                    connectToRelay(url).then(resolve).catch(reject);
                } else if (ws.readyState === WebSocket.OPEN) {
                    clearInterval(checkConnection);
                    resolve(ws);
                } else if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
                    clearInterval(checkConnection);
                    delete relayConnections[url];
                    // Try to reconnect
                    connectToRelay(url).then(resolve).catch(reject);
                }
            }, 100);
            return;
        }

        // Create new connection
        try {
            const ws = new WebSocket(url);
            relayConnections[url] = ws;

            ws.onopen = () => {
                console.log(`Connected to ${url}`);
                resolve(ws);
            };

            ws.onerror = (error) => {
                console.error(`Failed to connect to ${url}:`, error);
                delete relayConnections[url];
                reject(error);
            };

            ws.onclose = () => {
                console.log(`Disconnected from ${url}`);
                delete relayConnections[url];

                // Attempt to reconnect after a delay
                setTimeout(() => {
                    // Only reconnect if this URL is still in RELAY_URLS
                    if (RELAY_URLS.includes(url) && !relayConnections[url]) {
                        console.log(`Attempting to reconnect to ${url}`);
                        connectToRelay(url).catch(err =>
                            console.error(`Reconnection to ${url} failed:`, err)
                        );
                    }
                }, 5000);
            };

            ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    handleRelayMessage(url, message);
                } catch (error) {
                    console.error('Failed to parse message:', error);
                }
            };
        } catch (error) {
            console.error(`Failed to create WebSocket for ${url}:`, error);
            delete relayConnections[url];
            reject(error);
        }
    });
}

// Handle messages from relays
function handleRelayMessage(relayUrl, message) {
    if (message[0] === 'EVENT') {
        const subscriptionId = message[1];
        const event = message[2];

        allEvents.set(event.id, event);

        if (event.kind === 0) {
            try {
                const profile = JSON.parse(event.content);
                profileCache.set(event.pubkey, profile);
            } catch (e) {
                console.error('Failed to parse profile:', e);
            }
        }

        if (window.subscriptionHandlers && window.subscriptionHandlers[subscriptionId]) {
            window.subscriptionHandlers[subscriptionId](event);
        }
    }
}

// Streaming request events
// Streaming request events
async function requestEventsStream(filter, onEvent, onComplete) {
    const subscriptionId = Math.random().toString(36).substring(7);
    const eventsMap = new Map();
    const seenEventIds = new Set();
    let completedRelays = 0;
    const totalRelays = RELAY_URLS.length;
    const activeSubscriptions = new Set();

    if (!window.subscriptionHandlers) {
        window.subscriptionHandlers = {};
    }

    window.subscriptionHandlers[subscriptionId] = (event) => {
        if (!eventsMap.has(event.id)) {
            eventsMap.set(event.id, event);
            if (onEvent && !seenEventIds.has(event.id)) {
                seenEventIds.add(event.id);
                onEvent(event);
            }
        }
    };

    for (const url of RELAY_URLS) {
        try {
            const ws = await connectToRelay(url);
            const req = JSON.stringify(['REQ', subscriptionId, filter]);
            ws.send(req);
            activeSubscriptions.add(url);

            // Create a dedicated message handler for EOSE
            const handleEOSE = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message[0] === 'EOSE' && message[1] === subscriptionId) {
                        completedRelays++;
                        activeSubscriptions.delete(url);

                        // Send CLOSE command for this subscription
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify(['CLOSE', subscriptionId]));
                        }

                        if (completedRelays === totalRelays) {
                            delete window.subscriptionHandlers[subscriptionId];
                            if (onComplete) {
                                onComplete(Array.from(eventsMap.values()));
                            }
                        }
                    }
                } catch (error) {
                    // Ignore parse errors
                }
            };

            // Add EOSE handler without overriding the main message handler
            ws.addEventListener('message', handleEOSE);

            // Clean up the EOSE handler after a timeout
            setTimeout(() => {
                ws.removeEventListener('message', handleEOSE);
                if (activeSubscriptions.has(url)) {
                    completedRelays++;
                    activeSubscriptions.delete(url);

                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(['CLOSE', subscriptionId]));
                    }

                    if (completedRelays === totalRelays) {
                        delete window.subscriptionHandlers[subscriptionId];
                        if (onComplete) {
                            onComplete(Array.from(eventsMap.values()));
                        }
                    }
                }
            }, 30000); // 30 second timeout

        } catch (error) {
            console.error(`Failed to connect to ${url}:`, error);
            completedRelays++;
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
async function displayVideosStream(title, filter, clientFilter = null) {
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

    const globalReactions = new Map();

    const updateCardReactions = (eventId, reactions) => {
        const card = document.getElementById(`video-card-${eventId}`);
        if (!card) return;

        const thumbnail = card.querySelector('.video-thumbnail');
        const existingReactions = thumbnail.querySelector('.video-reactions');

        const newReactionsHTML = reactions && (reactions.likes > 0 || reactions.dislikes > 0) ? `
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
        ` : '';

        if (existingReactions) {
            if (newReactionsHTML) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = `<div class="video-reactions">${newReactionsHTML}</div>`;
                existingReactions.innerHTML = tempDiv.firstElementChild.innerHTML;
            } else {
                existingReactions.remove();
            }
        } else if (newReactionsHTML) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = `<div class="video-reactions">${newReactionsHTML}</div>`;
            thumbnail.appendChild(tempDiv.firstElementChild);
        }
    };

    const updateCardProfile = (eventId, profile) => {
        const card = document.getElementById(`video-card-${eventId}`);
        if (!card || !profile) return;

        const displayName = profile.name || profile.display_name || `User ${card.dataset.pubkey.slice(0, 8)}`;
        const avatarUrl = profile.picture || profile.avatar || '';
        const nip05 = profile.nip05 || '';

        const channelName = card.querySelector('.channel-name');
        if (channelName && channelName.textContent !== displayName) {
            channelName.textContent = displayName;
        }

        const channelDetails = card.querySelector('.channel-details');
        const existingNip05 = card.querySelector('.channel-nip05');

        if (nip05) {
            if (existingNip05) {
                if (existingNip05.textContent !== nip05) {
                    existingNip05.textContent = nip05;
                    existingNip05.dataset.nip05 = nip05;
                }
            } else {
                channelDetails.insertAdjacentHTML('beforeend',
                    `<div class="channel-nip05" data-nip05="${nip05}">${nip05}</div>`
                );
            }
        } else if (existingNip05) {
            existingNip05.remove();
        }

        const channelAvatar = card.querySelector('.channel-avatar');
        const existingImg = channelAvatar.querySelector('img');

        if (avatarUrl) {
            if (existingImg) {
                if (existingImg.getAttribute('data-avatar-url') !== avatarUrl) {
                    existingImg.src = avatarUrl;
                    existingImg.setAttribute('data-avatar-url', avatarUrl);
                }
            } else {
                channelAvatar.innerHTML = `<img src="${avatarUrl}" alt="${displayName}" data-avatar-url="${avatarUrl}">`;
            }
        } else if (existingImg) {
            existingImg.remove();
        }

        if ((avatarUrl || nip05) && card.dataset.validationDone !== 'true') {
            card.dataset.needsValidation = 'true';
            setTimeout(() => validateVideoCard(eventId, card.dataset.pubkey, profile, reactionsCache.get(eventId), false), 100);
        }
    };

    const renderVideoCard = (event, profile = null, reactions = null) => {
        const cardId = `video-card-${event.id}`;

        if (document.getElementById(cardId)) {
            if (profile) updateCardProfile(event.id, profile);
            if (reactions) updateCardReactions(event.id, reactions);
            return;
        }

        const cardHTML = createVideoCard(event, profile, reactions);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cardHTML;

        if (!tempDiv.firstElementChild) return;

        tempDiv.firstElementChild.id = cardId;

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

                videoEvents.forEach(event => {
                    if (event.pubkey === profileEvent.pubkey) {
                        updateCardProfile(event.id, profile);
                    }
                });
            } catch (e) {
                console.error('Failed to parse profile:', e);
            }
        });
    };

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

                    const reactions = calculateReactions(videoId);
                    reactionsCache.set(videoId, reactions);

                    updateCardReactions(videoId, reactions);
                }
            }
        });
    };

    await requestEventsStream(filter, (event) => {
        const tags = event.tags || [];
        if (!tags.some(tag => tag[0] === 'x')) return;

        if (clientFilter && !clientFilter(event)) return;

        if (videoEvents.some(e => e.id === event.id)) {
            return;
        }

        videoEvents.push(event);
        allEvents.set(event.id, event);

        const spinner = videoGrid.querySelector('.spinner');
        if (spinner) spinner.remove();

        const cachedProfile = profileCache.get(event.pubkey);
        const cachedReactions = reactionsCache.get(event.id);
        renderVideoCard(event, cachedProfile, cachedReactions);

        if (!cachedProfile) {
            profileQueue.add(event.pubkey);
            clearTimeout(profileTimer);
            profileTimer = setTimeout(loadProfilesBatch, 100);
        }

        reactionQueue.add(event.id);
        clearTimeout(reactionTimer);
        reactionTimer = setTimeout(loadReactionsBatch, 200);

    }, (allEvents) => {
        if (videoEvents.length === 0) {
            videoGrid.innerHTML = '<p style="text-align: center; color: var(--text-secondary); grid-column: 1/-1;">No videos found.</p>';
        }

        if (profileQueue.size > 0) {
            loadProfilesBatch();
        }
        if (reactionQueue.size > 0) {
            loadReactionsBatch();
        }
    });
}

// Load reactions for videos
async function loadReactionsForVideos(videoIds, onUpdate = null) {
    const filter = {
        kinds: [7],
        '#e': videoIds,
        '#t': ['pv69420']
    };

    const userReactions = new Map();

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

                const existingReaction = videoReactionMap.get(userPubkey);
                if (!existingReaction || existingReaction.timestamp < timestamp) {
                    videoReactionMap.set(userPubkey, {
                        reaction: event.content,
                        timestamp: timestamp
                    });

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

                    reactionsCache.set(videoId, reactions);

                    if (onUpdate) {
                        onUpdate(videoId, reactions);
                    }
                }
            }
        }, () => {
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

                reactionsCache.set(id, reactions[id]);
            });

            resolve(reactions);
        });
    });
}

// Load zaps for videos
async function loadZapsForVideo(eventId, onUpdate = null) {
    const filter = {
        kinds: [9735],
        '#e': [eventId]
    };

    let totalZaps = 0;
    const zaps = [];

    return new Promise((resolve) => {
        requestEventsStream(filter, (event) => {
            try {
                // Check if this is a boost zap (skip if it is)
                const pTag = event.tags.find(tag => tag[0] === 'p');
                if (pTag && pTag[1] === 'd49a9023a21dba1b3c8306ca369bf3243d8b44b8f0b6d1196607f7b0990fa8df') {
                    // This is a boost, check if it has the purpose tag
                    const description = event.tags.find(tag => tag[0] === 'description')?.[1];
                    if (description) {
                        try {
                            const zapRequest = JSON.parse(description);
                            const hasBoostTag = zapRequest.tags?.some(tag =>
                                tag[0] === 'purpose' && tag[1] === 'boost'
                            );
                            if (hasBoostTag) {
                                // Skip this boost zap
                                return;
                            }
                        } catch (e) {
                            // If we can't parse description, treat as regular zap
                        }
                    }
                }

                const bolt11Tag = event.tags.find(tag => tag[0] === 'bolt11');
                if (bolt11Tag && bolt11Tag[1]) {
                    const amount = extractAmountFromBolt11(bolt11Tag[1]);
                    if (amount > 0) {
                        totalZaps += amount;
                        zaps.push({ amount, event });

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
                case 'm': return amount * 100000;
                case 'u': return amount * 100;
                case 'n': return amount * 0.1;
                case 'p': return amount * 0.0001;
                default: return amount * 100000000;
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
    if (!currentUser || currentUser.readOnly) {
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
        const signedEvent = await signEvent(reactionEvent);
        const published = await publishEvent(signedEvent);

        if (published) {
            const reactions = reactionsCache.get(eventId) || { likes: 0, dislikes: 0, userReaction: null };

            if (reactions.userReaction === 'like') reactions.likes--;
            if (reactions.userReaction === 'dislike') reactions.dislikes--;

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

    const allPublishRelays = [...RELAY_URLS, ...PUBLISH_ONLY_RELAYS];

    for (const url of allPublishRelays) {
        try {
            const ws = await connectToRelay(url);
            ws.send(eventMessage);
            published = true;
            console.log(`Published to ${url}`);
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
    const note = nip19.noteEncode(event.id);

    return note;
}

// Initialize app on DOM load
document.addEventListener('DOMContentLoaded', () => {
    initializeApp().then(() => {
        // Start monitoring relay connections after initialization
        monitorRelayConnections();
    });

    // Set up hash change listener for routing
    window.addEventListener('hashchange', handleRoute);

    // Set up resize listener for carousel
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            updateHeaderHeight();

            // Update carousel if needed
            const trendingGrid = document.getElementById('trendingGrid');
            if (trendingGrid && trendingGrid.querySelector('.video-card')) {
                initializeCarousel();
            }
        }, 250);
    });

    // Update on orientation change for mobile devices
    window.addEventListener('orientationchange', () => {
        setTimeout(updateHeaderHeight, 100);
    });

    updateHeaderHeight();

    // Set up signup form listeners
    const signupUsername = document.getElementById('signupUsername');
    const signupAbout = document.getElementById('signupAbout');

    if (signupUsername) {
        signupUsername.addEventListener('input', updateSignupPreview);
    }
    if (signupAbout) {
        signupAbout.addEventListener('input', updateSignupPreview);
    }

    // Set up file input listeners
    const videoFile = document.getElementById('videoFile');
    const thumbnailFile = document.getElementById('thumbnailFile');

    if (videoFile) {
        videoFile.addEventListener('change', handleFileSelect);
    }
    if (thumbnailFile) {
        thumbnailFile.addEventListener('change', handleFileSelect);
    }

    // Set up upload form listener
    const uploadForm = document.getElementById('uploadForm');
    if (uploadForm) {
        uploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!currentUser || currentUser.readOnly) {
                if (!await ensureLoggedIn()) {
                    return;
                }
            }

            const videoFile = document.getElementById('videoFile').files[0];
            if (!videoFile) {
                alert('Please select a video file');
                return;
            }

            const title = document.getElementById('videoTitle').value;
            const description = escapeHtml(document.getElementById('videoDescription').value);
            const tags = document.getElementById('videoTags').value.split(',').map(t => t.trim()).filter(t => t);
            const isNSFW = document.getElementById('nsfwCheckbox').checked;

            if (isNSFW && !tags.includes('nsfw')) {
                tags.push('nsfw');
            }

            document.getElementById('uploadProgress').style.display = 'block';
            document.getElementById('uploadStatus').textContent = 'Calculating hash...';

            try {
                document.getElementById('uploadStatus').textContent = 'Uploading video to multiple servers...';
                const videoResult = await uploadToBlossom(videoFile);

                if (!videoResult.success) {
                    throw new Error(videoResult.error);
                }

                document.getElementById('progressFill').style.width = '50%';

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

                const video = document.createElement('video');
                video.preload = 'metadata';

                await new Promise((resolve) => {
                    video.onloadedmetadata = () => {
                        resolve();
                    };
                    video.src = URL.createObjectURL(videoFile);
                });

                const videoDuration = Math.floor(video.duration);

                const eventContent = {
                    kind: 1,
                    tags: [
                        ['title', title],
                        ['t', 'pv69420'],
                        ...tags.map(tag => ['t', tag]),
                        ['x', videoResult.hash],
                        ['url', videoResult.url],
                        ['m', videoFile.type],
                        ['size', videoFile.size.toString()],
                        ['duration', videoDuration.toString()],
                        ...(thumbnailUrl ? [['thumb', thumbnailUrl]] : []),
                        ...videoResult.mirrors.map(mirror => ['r', mirror.server]),
                        ...(isNSFW ? [['content-warning', 'nsfw']] : []),
                        ['client', 'Plebs']
                    ],
                    content: `${escapeHtml(title)}\n\n${escapeHtml(description)}\n\n${videoResult.url}`,
                    created_at: Math.floor(Date.now() / 1000)
                };

                const signedEvent = await signEvent(eventContent);
                const published = await publishEvent(signedEvent);

                if (!published) {
                    throw new Error('Failed to publish to any relay');
                }

                if (videoResult.mirrors && videoResult.mirrors.length > 0) {
                    const serverListEvent = {
                        kind: 10063,
                        tags: videoResult.mirrors.map(mirror => ['server', mirror.server]),
                        content: '',
                        created_at: Math.floor(Date.now() / 1000),
                    };

                    const signedServerListEvent = await signEvent(serverListEvent);
                    await publishEvent(signedServerListEvent);
                }

                document.getElementById('progressFill').style.width = '100%';
                document.getElementById('uploadStatus').textContent = 'Video published successfully!';

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
    }

    // Set up drag and drop for file upload
    const fileUpload = document.getElementById('fileUpload');
    if (fileUpload) {
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
    }

    // Set up search input enter key listener
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                searchVideos();
            }
        });
    }

    // Set up sidebar link click listeners for mobile
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                toggleSidebar();
            }
        });
    });
});

// Function to calculate and update header height
function updateHeaderHeight() {
    const header = document.querySelector('header');
    if (header) {
        // Force a reflow to ensure accurate measurement
        header.offsetHeight;
        const headerHeight = header.getBoundingClientRect().height;
        document.documentElement.style.setProperty('--header-height', `${headerHeight}px`);
    }
}

// Clean up WebSocket connections on page unload
window.addEventListener('beforeunload', () => {
    Object.values(relayConnections).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    });
});

// Function to load trending videos with streaming
async function loadTrendingVideos(period = 'today') {
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
        const globalBoosts = new Map();
        const processedVideos = new Set();
        let trendingVideos = [];
        let videosComplete = false;
        let reactionsComplete = false;
        let zapsComplete = false;
        let boostsComplete = false;
        let lastProcessTime = 0;
        let processTimer = null;
        let resolveTimer = null;
        let hasResolved = false;

        const processTrending = (force = false) => {
            const now = Date.now();
            if (!force && now - lastProcessTime < 200) {
                clearTimeout(processTimer);
                processTimer = setTimeout(() => processTrending(true), 200);
                return;
            }
            lastProcessTime = now;

            const newTrendingVideos = [];

            videoEvents.forEach(event => {
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

                reactionsCache.set(event.id, reactions);

                if (isVideoRatioed(reactions)) {
                    return;
                }

                const zapTotal = globalZaps.get(event.id) || 0;
                const boostTotal = globalBoosts.get(event.id) || 0;

                const ageHours = (now - event.created_at) / 3600;
                const timeWeight = Math.max(0, 24 - ageHours) / 24;

                // Include boosts in the score calculation with higher weight
                const zapScore = (zapTotal / 1000) * 5;
                const boostScore = (boostTotal / 100) * 10; // Boosts have 2x the weight of zaps
                const score = reactions.likes - (reactions.dislikes * 2) + zapScore + boostScore + (timeWeight * 10);

                if (score > 0) {
                    videoScores.set(event.id, score);
                    newTrendingVideos.push(event);
                }
            });

            newTrendingVideos.sort((a, b) => {
                const scoreA = videoScores.get(a.id) || 0;
                const scoreB = videoScores.get(b.id) || 0;
                return scoreB - scoreA;
            });

            trendingVideos = newTrendingVideos.slice(0, 12);

            const trendingGrid = document.getElementById('trendingGrid');
            if (trendingGrid && trendingVideos.length > 0 && !hasResolved) {
                const spinner = trendingGrid.querySelector('.spinner');
                if (spinner) {
                    renderTrendingVideos(trendingVideos).then(() => {
                        // Rendered successfully
                    });
                }
            }

            if (videosComplete && reactionsComplete && zapsComplete && boostsComplete && !hasResolved) {
                clearTimeout(processTimer);
                clearTimeout(resolveTimer);
                hasResolved = true;
                resolve(trendingVideos);
            }
        };

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
                        processTrending();
                    }
                }
            }, () => {
                reactionsComplete = true;
                processTrending(true);
            });
        };

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
                        // Check if this is a boost zap (skip if it is)
                        const pTag = zapEvent.tags.find(tag => tag[0] === 'p');
                        if (pTag && pTag[1] === 'd49a9023a21dba1b3c8306ca369bf3243d8b44b8f0b6d1196607f7b0990fa8df') {
                            // This is a potential boost, check if it has the purpose tag
                            const description = zapEvent.tags.find(tag => tag[0] === 'description')?.[1];
                            if (description) {
                                try {
                                    const zapRequest = JSON.parse(description);
                                    const hasBoostTag = zapRequest.tags?.some(tag =>
                                        tag[0] === 'purpose' && tag[1] === 'boost'
                                    );
                                    if (hasBoostTag) {
                                        // Skip this boost zap
                                        return;
                                    }
                                } catch (e) {
                                    // If we can't parse description, treat as regular zap
                                }
                            }
                        }

                        const bolt11Tag = zapEvent.tags.find(tag => tag[0] === 'bolt11');
                        if (bolt11Tag && bolt11Tag[1]) {
                            const amount = extractAmountFromBolt11(bolt11Tag[1]);
                            if (amount > 0) {
                                const currentTotal = globalZaps.get(videoId) || 0;
                                globalZaps.set(videoId, currentTotal + amount);
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

        const loadBoosts = () => {
            if (videoEvents.length === 0) {
                boostsComplete = true;
                processTrending(true);
                return;
            }

            const videoIds = videoEvents.map(e => e.id);
            const boostFilter = {
                kinds: [9735],
                '#e': videoIds,
                '#p': ['d49a9023a21dba1b3c8306ca369bf3243d8b44b8f0b6d1196607f7b0990fa8df'],
                since: since
            };

            requestEventsStream(boostFilter, (boostEvent) => {
                try {
                    const videoId = boostEvent.tags.find(tag => tag[0] === 'e')?.[1];
                    if (videoId && videoIds.includes(videoId)) {
                        // Check if this has the purpose=boost tag
                        const description = boostEvent.tags.find(tag => tag[0] === 'description')?.[1];
                        if (description) {
                            try {
                                const zapRequest = JSON.parse(description);
                                const hasBoostTag = zapRequest.tags?.some(tag =>
                                    tag[0] === 'purpose' && tag[1] === 'boost'
                                );

                                if (hasBoostTag) {
                                    const bolt11Tag = boostEvent.tags.find(tag => tag[0] === 'bolt11');
                                    if (bolt11Tag && bolt11Tag[1]) {
                                        const amount = extractAmountFromBolt11(bolt11Tag[1]);
                                        if (amount > 0) {
                                            const currentTotal = globalBoosts.get(videoId) || 0;
                                            globalBoosts.set(videoId, currentTotal + amount);
                                            boostsCache.set(videoId, currentTotal + amount);
                                            processTrending();
                                        }
                                    }
                                }
                            } catch (e) {
                                // If we can't parse description, skip this event
                            }
                        }
                    }
                } catch (e) {
                    console.error('Failed to parse boost:', e);
                }
            }, () => {
                boostsComplete = true;
                processTrending(true);
            });
        };

        requestEventsStream(filter, (event) => {
            const tags = event.tags || [];
            if (tags.some(tag => tag[0] === 'x') && !processedVideos.has(event.id)) {
                processedVideos.add(event.id);
                videoEvents.push(event);
                allEvents.set(event.id, event);

                processTrending();
            }
        }, () => {
            videosComplete = true;

            if (videoEvents.length > 0) {
                loadReactions();
                loadZaps();
                loadBoosts();
            } else {
                reactionsComplete = true;
                zapsComplete = true;
                boostsComplete = true;
                processTrending(true);
            }
        });

        resolveTimer = setTimeout(() => {
            if (trendingVideos.length >= 6 && !hasResolved) {
                hasResolved = true;
                resolve(trendingVideos);
            }
        }, 3000);

        setTimeout(() => {
            if (!hasResolved) {
                videosComplete = true;
                reactionsComplete = true;
                zapsComplete = true;
                boostsComplete = true;
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
                    <button class="trending-tab ${currentTrendingPeriod === 'week' ? 'active' : ''}" 
                            onclick="switchTrendingPeriod('week')">This Week</button>
                    <button class="trending-tab ${currentTrendingPeriod === 'today' ? 'active' : ''}" 
                            onclick="switchTrendingPeriod('today')">Today</button>
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

    loadTrendingSection();

    const filter = {
        kinds: [1],
        limit: 50,
        '#t': ['pv69420']
    };

    const videoGrid = document.getElementById('videoGrid');
    const renderedVideos = new Map();
    const videoEvents = [];
    const profileQueue = new Set();
    const reactionQueue = new Set();
    let profileTimer = null;
    let reactionTimer = null;

    const globalReactions = new Map();

    const updateCardReactions = (eventId, reactions) => {
        const card = document.getElementById(`video-card-${eventId}`);
        if (!card) return;

        const thumbnail = card.querySelector('.video-thumbnail');
        const existingReactions = thumbnail.querySelector('.video-reactions');

        const newReactionsHTML = reactions && (reactions.likes > 0 || reactions.dislikes > 0) ? `
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
        ` : '';

        if (existingReactions) {
            if (newReactionsHTML) {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = `<div class="video-reactions">${newReactionsHTML}</div>`;
                existingReactions.innerHTML = tempDiv.firstElementChild.innerHTML;
            } else {
                existingReactions.remove();
            }
        } else if (newReactionsHTML) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = `<div class="video-reactions">${newReactionsHTML}</div>`;
            thumbnail.appendChild(tempDiv.firstElementChild);
        }
    };

    const updateCardProfile = (eventId, profile) => {
        const card = document.getElementById(`video-card-${eventId}`);
        if (!card || !profile) return;

        const displayName = profile.name || profile.display_name || `User ${card.dataset.pubkey.slice(0, 8)}`;
        const avatarUrl = profile.picture || profile.avatar || '';
        const nip05 = profile.nip05 || '';

        const channelName = card.querySelector('.channel-name');
        if (channelName && channelName.textContent !== displayName) {
            channelName.textContent = displayName;
        }

        const channelDetails = card.querySelector('.channel-details');
        const existingNip05 = card.querySelector('.channel-nip05');

        if (nip05) {
            if (existingNip05) {
                if (existingNip05.textContent !== nip05) {
                    existingNip05.textContent = nip05;
                    existingNip05.dataset.nip05 = nip05;
                }
            } else {
                channelDetails.insertAdjacentHTML('beforeend',
                    `<div class="channel-nip05" data-nip05="${nip05}">${nip05}</div>`
                );
            }
        } else if (existingNip05) {
            existingNip05.remove();
        }

        const channelAvatar = card.querySelector('.channel-avatar');
        const existingImg = channelAvatar.querySelector('img');

        if (avatarUrl) {
            if (existingImg) {
                if (existingImg.getAttribute('data-avatar-url') !== avatarUrl) {
                    existingImg.src = avatarUrl;
                    existingImg.setAttribute('data-avatar-url', avatarUrl);
                }
            } else {
                channelAvatar.innerHTML = `<img src="${avatarUrl}" alt="${displayName}" data-avatar-url="${avatarUrl}">`;
            }
        } else if (existingImg) {
            existingImg.remove();
        }

        if ((avatarUrl || nip05) && card.dataset.validationDone !== 'true') {
            card.dataset.needsValidation = 'true';
            setTimeout(() => validateVideoCard(eventId, card.dataset.pubkey, profile, reactionsCache.get(eventId), false), 100);
        }
    };

    const renderVideoCard = (event, profile = null, reactions = null) => {
        const cardId = `video-card-${event.id}`;

        if (document.getElementById(cardId)) {
            if (profile) updateCardProfile(event.id, profile);
            if (reactions) updateCardReactions(event.id, reactions);
            return;
        }

        const cardHTML = createVideoCard(event, profile, reactions);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cardHTML;

        if (!tempDiv.firstElementChild) return;

        tempDiv.firstElementChild.id = cardId;

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

                videoEvents.forEach(event => {
                    if (event.pubkey === profileEvent.pubkey) {
                        updateCardProfile(event.id, profile);
                    }
                });
            } catch (e) {
                console.error('Failed to parse profile:', e);
            }
        });
    };

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

                    const reactions = calculateReactions(videoId);
                    reactionsCache.set(videoId, reactions);

                    updateCardReactions(videoId, reactions);
                }
            }
        });
    };

    await requestEventsStream(filter, (event) => {
        const tags = event.tags || [];
        if (!tags.some(tag => tag[0] === 'x')) return;

        if (videoEvents.some(e => e.id === event.id)) {
            return;
        }

        videoEvents.push(event);
        allEvents.set(event.id, event);

        const spinner = videoGrid.querySelector('.spinner');
        if (spinner) spinner.remove();

        const cachedProfile = profileCache.get(event.pubkey);
        const cachedReactions = reactionsCache.get(event.id);
        renderVideoCard(event, cachedProfile, cachedReactions);

        if (!cachedProfile) {
            profileQueue.add(event.pubkey);
            clearTimeout(profileTimer);
            profileTimer = setTimeout(loadProfilesBatch, 100);
        }

        reactionQueue.add(event.id);
        clearTimeout(reactionTimer);
        reactionTimer = setTimeout(loadReactionsBatch, 200);

    }, (allEvents) => {
        if (videoEvents.length === 0) {
            videoGrid.innerHTML = '<p style="text-align: center; color: var(--text-secondary); grid-column: 1/-1;">No videos found.</p>';
        }

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

    let itemsPerPage;
    if (window.innerWidth <= 480) {
        itemsPerPage = 1;
    } else if (window.innerWidth <= 768) {
        itemsPerPage = 2;
    } else {
        itemsPerPage = 3;
    }

    itemsPerPage = Math.min(itemsPerPage, totalCards);

    const totalPages = Math.ceil(totalCards / itemsPerPage);

    const gapRem = 1;
    const gapPixels = gapRem * 16;
    const totalGaps = itemsPerPage - 1;
    const totalGapWidth = totalGaps * gapPixels;

    const cardWidthPercent = (100 - (totalGapWidth / trendingGrid.offsetWidth * 100)) / itemsPerPage;

    cards.forEach(card => {
        card.style.flex = `0 0 ${cardWidthPercent}%`;
        card.style.maxWidth = `${cardWidthPercent}%`;
        card.style.width = `${cardWidthPercent}%`;
    });

    carouselDots.innerHTML = '';
    for (let i = 0; i < totalPages; i++) {
        const dot = document.createElement('div');
        dot.className = `carousel-dot ${i === 0 ? 'active' : ''}`;
        dot.onclick = () => goToPage(i);
        carouselDots.appendChild(dot);
    }

    trendingGrid.dataset.currentPage = '0';
    trendingGrid.dataset.totalPages = totalPages;
    trendingGrid.dataset.itemsPerPage = itemsPerPage;

    updateCarouselButtons();
    goToPage(0);
}

// Function to load trending section asynchronously
async function loadTrendingSection() {
    const trendingGrid = document.getElementById('trendingGrid');
    let hasRendered = false;

    try {
        const trendingPromise = loadTrendingVideos(currentTrendingPeriod);

        const checkInterval = setInterval(async () => {
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

    const trendingPubkeys = [...new Set(trendingVideos.map(v => v.pubkey))];
    await loadUserProfiles(trendingPubkeys);

    const renderedCards = trendingVideos.map((event, index) => {
        const profile = profileCache.get(event.pubkey);
        const reactions = reactionsCache.get(event.id);
        return createVideoCard(event, profile, reactions, true, index + 1);
    }).filter(card => card !== '');

    if (renderedCards.length > 0) {
        trendingGrid.innerHTML = renderedCards.join('');
        initializeCarousel();
    } else {
        trendingGrid.innerHTML = '<p style="text-align: center; color: var(--text-secondary); grid-column: 1/-1;">No trending videos found.</p>';
    }
}

// Function to switch trending period
async function switchTrendingPeriod(period) {
    currentTrendingPeriod = period;

    document.querySelectorAll('.trending-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.classList.add('active');

    const trendingGrid = document.querySelector('.trending-grid');
    if (trendingGrid) {
        trendingGrid.innerHTML = '<div class="spinner"></div>';
    }

    await loadTrendingSection();
}

// Load subscriptions
async function loadSubscriptions() {
    if (!currentUser) {
        await checkStoredLogin(); // Wait for login check
        if (!currentUser) {
            document.getElementById('mainContent').innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Please login to view your subscriptions.</p>';
            return;
        }
    }

    currentView = 'subscriptions';

    const mainContent = document.getElementById('mainContent');
    mainContent.innerHTML = '<div class="spinner"></div>';

    try {
        const followingFilter = {
            kinds: [3],
            authors: [currentUser.pubkey],
            limit: 1
        };

        let followingList = [];
        await new Promise((resolve) => {
            requestEventsStream(followingFilter, (event) => {
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
        await checkStoredLogin(); // Wait for login check
        if (!currentUser) {
            document.getElementById('mainContent').innerHTML = '<p style="text-align: center; color: var(--text-secondary);">Please login to view your videos.</p>';
            return;
        }
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
        '#t': ['pv69420'],
        limit: 500
    };

    const tagFilter = (event) => {
        const tags = event.tags || [];
        return tags.some(t => t[0] === 't' && t[1] === tag);
    };

    await displayVideosStream(`${tag.charAt(0).toUpperCase() + tag.slice(1)} Videos`, filter, tagFilter);
}

// Handle deleting video
async function handleDelete(eventId) {
    if (!currentUser || currentUser.readOnly) {
        if (!await ensureLoggedIn()) {
            alert('Please login to delete videos');
            return;
        }
    }

    if (!confirm('Are you sure you want to delete this video? This action cannot be undone.')) {
        return;
    }

    try {
        const deleteEvent = {
            kind: 5,
            tags: [
                ['e', eventId],
                ['t', 'pv69420']
            ],
            content: 'Deletion request',
            created_at: Math.floor(Date.now() / 1000)
        };

        const signedEvent = await signEvent(deleteEvent);
        const published = await publishEvent(signedEvent);

        if (published) {
            alert('Deletion request sent to relays. The video may take some time to be removed.');
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
    if (!currentUser || currentUser.readOnly) {
        if (!await ensureLoggedIn()) {
            alert('Please login to follow users');
            return false;
        }
    }

    try {
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

        if (!currentFollowingTags.some(tag => tag[1] === pubkey)) {
            currentFollowingTags.push(['p', pubkey]);
        }

        const contactListEvent = {
            kind: 3,
            tags: [...currentFollowingTags, ...currentRelayTags],
            content: '',
            created_at: Math.floor(Date.now() / 1000)
        };

        const signedEvent = await signEvent(contactListEvent);
        const published = await publishEvent(signedEvent);

        return published;
    } catch (error) {
        console.error('Failed to follow user:', error);
        return false;
    }
}

// Unfollow a user
async function unfollowUser(pubkey) {
    if (!currentUser || currentUser.readOnly) {
        alert('Please login to unfollow users');
        return false;
    }

    try {
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

        currentFollowingTags = currentFollowingTags.filter(tag => tag[1] !== pubkey);

        const contactListEvent = {
            kind: 3,
            tags: [...currentFollowingTags, ...currentRelayTags],
            content: '',
            created_at: Math.floor(Date.now() / 1000)
        };

        const signedEvent = await signEvent(contactListEvent);
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
        const profile = await fetchUserProfile(pubkey);
        const displayName = profile?.name || profile?.display_name || `User ${pubkey.slice(0, 8)}`;
        const avatarUrl = profile?.picture || profile?.avatar || '';
        const nip05 = profile?.nip05 || '';
        const about = profile?.about || '';

        const npub = window.NostrTools.nip19.npubEncode(pubkey);

        const isFollowingPromise = isFollowing(pubkey);
        const isOwnProfile = currentUser && currentUser.pubkey === pubkey;

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

        const filter = {
            kinds: [1],
            authors: [pubkey],
            '#t': ['pv69420']
        };

        const videoGrid = document.getElementById('profileVideoGrid');
        const videoEvents = [];
        const reactionQueue = new Set();
        let reactionTimer = null;

        await requestEventsStream(filter, (event) => {
            const tags = event.tags || [];
            if (!tags.some(tag => tag[0] === 'x')) return;

            videoEvents.push(event);
            allEvents.set(event.id, event);

            const spinner = videoGrid.querySelector('.spinner');
            if (spinner) spinner.remove();

            const cachedReactions = reactionsCache.get(event.id);
            const cardHTML = createVideoCard(event, profile, cachedReactions);

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

            reactionQueue.add(event.id);
            clearTimeout(reactionTimer);
            reactionTimer = setTimeout(async () => {
                if (reactionQueue.size > 0) {
                    const videoIds = Array.from(reactionQueue);
                    reactionQueue.clear();

                    await loadReactionsForVideos(videoIds, (videoId, reactions) => {
                        const updatedCard = createVideoCard(
                            videoEvents.find(e => e.id === videoId),
                            profile,
                            reactions
                        );

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

    const globalReactions = new Map();

    const matchesSearch = (event) => {
        const videoData = parseVideoEvent(event);
        if (!videoData) return false;

        if (videoData.title.toLowerCase().includes(decodedQuery)) return true;
        if (videoData.description.toLowerCase().includes(decodedQuery)) return true;
        if (videoData.tags.some(tag => tag.toLowerCase().includes(decodedQuery))) return true;

        return false;
    };

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

        if (document.getElementById(cardId)) {
            updateVideoCard(event, profile, reactions);
            return;
        }

        const cardHTML = createVideoCard(event, profile, reactions);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = cardHTML;

        if (!tempDiv.firstElementChild) return;

        tempDiv.firstElementChild.id = cardId;

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

                    const reactions = calculateReactions(videoId);
                    reactionsCache.set(videoId, reactions);

                    const event = videoEvents.find(e => e.id === videoId);
                    if (event) {
                        const profile = profileCache.get(event.pubkey);
                        updateVideoCard(event, profile, reactions);
                    }
                }
            }
        });
    };

    const filter = {
        kinds: [1],
        '#t': ['pv69420'],
        limit: 200
    };

    await requestEventsStream(filter, (event) => {
        const tags = event.tags || [];
        if (!tags.some(tag => tag[0] === 'x')) return;

        if (!matchesSearch(event)) return;

        if (videoEvents.some(e => e.id === event.id)) {
            return;
        }

        videoEvents.push(event);
        allEvents.set(event.id, event);

        const spinner = videoGrid.querySelector('.spinner');
        if (spinner) spinner.remove();

        const cachedProfile = profileCache.get(event.pubkey);
        const cachedReactions = reactionsCache.get(event.id);
        renderVideoCard(event, cachedProfile, cachedReactions);

        if (!cachedProfile) {
            profileQueue.add(event.pubkey);
            clearTimeout(profileTimer);
            profileTimer = setTimeout(loadProfilesBatch, 100);
        }

        reactionQueue.add(event.id);
        clearTimeout(reactionTimer);
        reactionTimer = setTimeout(loadReactionsBatch, 200);

    }, (allEvents) => {
        if (videoEvents.length === 0) {
            videoGrid.innerHTML = `<p style="text-align: center; color: var(--text-secondary); grid-column: 1/-1;">No videos found matching "${query}".</p>`;
        }

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
            if (!found && event.id === eventId) {
                found = true;
                allEvents.set(event.id, event);
                resolve(event);
            }
        }, () => {
            if (!found) {
                resolve(null);
            }
        });
    });
}

// Play video
async function playVideo(eventId, skipNSFWCheck = false, skipRatioedCheck = false) {
    const mainContent = document.getElementById('mainContent');

    if (!mainContent.querySelector('.spinner')) {
        mainContent.innerHTML = '<div class="spinner"></div>';
    }

    try {
        let event = allEvents.get(eventId);

        if (!event) {
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

        const profile = await fetchUserProfile(event.pubkey);
        const avatarUrl = profile?.picture || profile?.avatar || '';
        const nip05 = profile?.nip05 || '';

        // Validate profile first
        const [avatarValid, nip05Valid] = await Promise.all([
            avatarUrl ? createImageValidationPromise(avatarUrl) : Promise.resolve(false),
            nip05 ? validateNip05(nip05, event.pubkey) : Promise.resolve(false)
        ]);

        const isProfileSuspicious = !avatarValid || !nip05Valid;

        // Check NSFW independently from suspicious profile
        const isNSFW = isVideoNSFW(event);

        // Check if NSFW should be shown first (separate from community warning)
        if (!skipNSFWCheck && isNSFW && !shouldShowNSFW()) {
            showNSFWModal('playVideo', eventId);
            return;
        }

        const cachedReactions = reactionsCache.get(eventId) || { likes: 0, dislikes: 0 };
        const isCachedRatioed = isVideoRatioed(cachedReactions);

        // Only show community warning for suspicious profiles or ratioed videos (not NSFW with valid profile)
        if (!skipRatioedCheck && (isCachedRatioed || isProfileSuspicious) && !sessionRatioedAllowed.has(eventId)) {
            showRatioedModal(eventId);
            return;
        }

        if (videoData && profile) {
            const authorName = profile?.name || profile?.display_name || `User ${event.pubkey.slice(0, 8)}`;

            document.title = `${videoData.title} - Plebs`;

            const setMetaTag = (selector, attribute, value) => {
                let tag = document.querySelector(selector);
                if (tag) tag.setAttribute(attribute, value);
            };

            setMetaTag('meta[property="og:title"]', 'content', `${videoData.title} - Plebs`);
            setMetaTag('meta[property="og:description"]', 'content',
                videoData.description ? videoData.description.slice(0, 155) : `Watch "${videoData.title}" by ${authorName} on Plebs`);
            if (videoData.thumbnail) {
                setMetaTag('meta[property="og:image"]', 'content', videoData.thumbnail);
            }
        }

        const authorNpub = window.NostrTools.nip19.npubEncode(event.pubkey);

        const videoUrl = await getVideoUrl(videoData.hash) || videoData.url;

        const note = createNote(event);
        const userNpub = currentUser ? window.NostrTools.nip19.npubEncode(currentUser.pubkey) : '';

        const displayName = profile?.name || profile?.display_name || `User ${event.pubkey.slice(0, 8)}`;

        mainContent.innerHTML = `
            <div class="video-player-container">
                <div class="video-player">
                    <video controls autoplay>
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
                        <span class="ratioed-indicator" style="${isProfileSuspicious || isCachedRatioed ? '' : 'display: none;'}"> • <span style="color: #ff9800;">Community Warning</span></span>
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
                        <button class="action-btn boost"
                                onclick="handleBoost('${event.id}')"
                                data-event-id="${event.id}">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z" stroke-width="2"/>
                            </svg>
                            <span class="count">Boost</span>
                        </button>
                        <button class="action-btn" onclick="shareVideo('${event.id}')">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z"/>
                            </svg>
                            Share
                        </button>
                        <button class="action-btn" onclick="downloadVideo('${videoUrl}', ${JSON.stringify({ title: videoData.title }).replace(/"/g, '&quot;')})">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                            </svg>
                            Download
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
                        <p style="white-space: pre-wrap; margin-top: 0.5rem;">${videoData.description || 'No description provided.'}</p>
                    </div>
                    ${videoData.tags.length > 0 ? `
                        <div class="tags">
                            ${videoData.tags.map(tag => `<span class="tag" onclick="navigateTo('/tag/${tag}')">#${tag}</span>`).join('')}
                        </div>
                    ` : ''}
                </div>
                
                <div class="comments-section">
                    <h3>Comments</h3>
                    <div id="main-comment-input"></div>
                    <div id="comments-container">
                        <div class="spinner"></div>
                    </div>
                </div>
            </div>
        `;

        const video = mainContent.querySelector('video');
        video.onerror = async () => {
            const fallbackUrl = await getVideoUrl(videoData.hash, BLOSSOM_SERVERS.slice(1));
            if (fallbackUrl && fallbackUrl !== videoUrl) {
                video.src = fallbackUrl;
            } else {
                mainContent.innerHTML = '<div class="error-message">Failed to load video. The file may have been removed.</div>';
            }
        };

        const mainCommentInput = createCommentInput();
        document.getElementById('main-comment-input').replaceWith(mainCommentInput);

        const videoEventIds = [eventId];

        loadComments(videoEventIds);

        loadReactionsForVideos([eventId], (videoId, reactions) => {
            updateReactionButtons(videoId, reactions);

            const isRatioed = isVideoRatioed(reactions);
            if ((isRatioed || isProfileSuspicious) && !skipRatioedCheck && !sessionRatioedAllowed.has(eventId)) {
                const indicator = mainContent.querySelector('.ratioed-indicator');
                if (indicator) {
                    indicator.style.display = 'inline';
                }
            }
        });

        loadZapsForVideo(eventId, (totalZaps, count) => {
            updateZapButton(eventId, totalZaps);
        });

        // Load boosts for the video
        loadBoostsForVideo(eventId, (totalBoosts) => {
            updateBoostButton(eventId, totalBoosts);
        });

    } catch (error) {
        console.error('Failed to play video:', error);
        mainContent.innerHTML = '<div class="error-message">Failed to load video. Please try again.</div>';
    }
}

// Handle like button click
async function handleLike(eventId) {
    if (!await ensureLoggedIn()) {
        return;
    }

    const success = await sendReaction(eventId, '👍');
    if (success) {
        const reactions = reactionsCache.get(eventId);
        updateReactionButtons(eventId, reactions);
    }
}

// Handle dislike button click
async function handleDislike(eventId) {
    if (!await ensureLoggedIn()) {
        return;
    }

    const success = await sendReaction(eventId, '👎');
    if (success) {
        const reactions = reactionsCache.get(eventId);
        updateReactionButtons(eventId, reactions);
    }
}

// Handle download button click
async function downloadVideo(videoUrl, videoData) {
    try {
        if (videoUrl.startsWith('https://') && BLOSSOM_SERVERS.some(server => videoUrl.startsWith(server))) {
            const response = await fetch(videoUrl);
            const blob = await response.blob();

            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = videoData.title || 'video';
            a.click();
            URL.revokeObjectURL(blobUrl);
            a.remove();
        } else {
            const a = document.createElement('a');
            a.href = videoUrl;
            a.download = videoData.title || 'video';
            a.click();
            a.remove();
        }
    } catch (error) {
        console.error('Failed to download video:', error);
        alert('Failed to download video. Please try again.');
    }
}

// Update reaction buttons UI
function updateReactionButtons(eventId, reactions) {
    const likeBtn = document.querySelector(`.action-btn.like[data-event-id="${eventId}"]`);
    const dislikeBtn = document.querySelector(`.action-btn.dislike[data-event-id="${eventId}"]`);

    if (likeBtn && dislikeBtn) {
        likeBtn.querySelector('.count').textContent = formatNumber(reactions.likes || 0);
        dislikeBtn.querySelector('.count').textContent = formatNumber(reactions.dislikes || 0);

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

// Comment system functions
async function loadComments(eventIds) {
    const commentsContainer = document.getElementById('comments-container');
    if (!commentsContainer) return;

    commentsContainer.innerHTML = '<div class="spinner"></div>';

    try {
        const filter = {
            kinds: [1],
            '#e': eventIds,
            limit: 500
        };

        const comments = [];
        const commentReactions = new Map();

        await new Promise((resolve) => {
            requestEventsStream(filter, (event) => {
                comments.push(event);
                allEvents.set(event.id, event);
            }, resolve);
        });

        const uniquePubkeys = [...new Set(comments.map(c => c.pubkey))];
        const profilePromises = uniquePubkeys.map(pubkey => fetchUserProfile(pubkey));
        await Promise.all(profilePromises);

        const commentIds = comments.map(c => c.id);
        if (commentIds.length > 0) {
            const reactionFilter = {
                kinds: [7],
                '#e': commentIds
            };

            await new Promise((resolve) => {
                requestEventsStream(reactionFilter, (event) => {
                    const targetId = event.tags.find(t => t[0] === 'e')?.[1];

                    if (targetId && commentIds.includes(targetId)) {
                        if (!commentReactions.has(targetId)) {
                            commentReactions.set(targetId, new Map());
                        }
                        const reactions = commentReactions.get(targetId);
                        const timestamp = event.created_at;

                        const existingReaction = reactions.get(event.pubkey);
                        if (!existingReaction || existingReaction.timestamp < timestamp) {
                            reactions.set(event.pubkey, {
                                reaction: event.content,
                                timestamp: timestamp,
                                pubkey: event.pubkey
                            });
                        }
                    }
                }, resolve);
            });
        }

        const commentTree = buildCommentTree(comments, eventIds);

        renderComments(commentTree, profileCache, commentReactions, commentsContainer);

    } catch (error) {
        console.error('Failed to load comments:', error);
        commentsContainer.innerHTML = '<div class="error-message">Failed to load comments</div>';
    }
}

// Build hierarchical comment structure
function buildCommentTree(comments, rootEventIds) {
    const commentMap = new Map();
    const rootComments = [];

    comments.forEach(comment => {
        commentMap.set(comment.id, {
            ...comment,
            children: [],
            depth: 0
        });
    });

    comments.forEach(comment => {
        const eTags = comment.tags.filter(t => t[0] === 'e');

        let parentId = null;
        for (let i = eTags.length - 1; i >= 0; i--) {
            const eventId = eTags[i][1];
            if (!rootEventIds.includes(eventId) && commentMap.has(eventId)) {
                parentId = eventId;
                break;
            }
        }

        const commentNode = commentMap.get(comment.id);

        if (parentId && commentMap.has(parentId)) {
            const parent = commentMap.get(parentId);
            parent.children.push(commentNode);
            commentNode.depth = parent.depth + 1;
        } else {
            rootComments.push(commentNode);
        }
    });

    const sortComments = (comments) => {
        comments.sort((a, b) => b.created_at - a.created_at);
        comments.forEach(comment => sortComments(comment.children));
    };

    sortComments(rootComments);

    return rootComments;
}

// Render comment tree
function renderComments(comments, profiles, reactions, container) {
    if (comments.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No comments yet. Be the first to comment!</p>';
        return;
    }

    container.innerHTML = '';
    comments.forEach(comment => {
        const commentElement = createCommentElement(comment, profiles, reactions);
        container.appendChild(commentElement);
    });
}

// Create individual comment element
function createCommentElement(comment, profiles, reactions) {
    const profile = profiles.get(comment.pubkey) || {};
    const displayName = profile.name || profile.display_name || `User ${comment.pubkey.slice(0, 8)}`;
    const avatarUrl = profile.picture || profile.avatar || '';
    const nip05 = profile.nip05 || '';

    const commentReactions = reactions.get(comment.id) || new Map();
    let likes = 0;
    let userReaction = null;

    commentReactions.forEach((data, pubkey) => {
        if (data.reaction === '👍' || data.reaction === '+') {
            likes++;
            if (currentUser && pubkey === currentUser.pubkey) {
                userReaction = 'like';
            }
        }
    });

    const visualDepth = Math.min(comment.depth, 3);

    const commentDiv = document.createElement('div');
    commentDiv.className = 'comment';
    commentDiv.dataset.depth = visualDepth;
    commentDiv.dataset.commentId = comment.id;

    const depthIndicator = comment.depth > 3 ? `↳ ${comment.depth - 3} more` : '';

    const processedContent = processCommentContent(comment.content);

    const likeCountText = likes > 0 ? formatNumber(likes) : 'Like';

    commentDiv.innerHTML = `
        <div class="comment-thread-line"></div>
        <div class="comment-content">
            <div class="comment-header">
                <a href="#/profile/${comment.pubkey}" class="comment-author">
                    <div class="comment-avatar">
                        ${avatarUrl ? `<img src="${avatarUrl}" alt="${displayName}">` : ''}
                    </div>
                    <div class="comment-author-info">
                        <div class="comment-author-name">${displayName}</div>
                        ${nip05 ? `<div class="comment-author-nip05">${nip05}</div>` : ''}
                    </div>
                </a>
                <div class="comment-timestamp">${formatTimestamp(comment.created_at)}</div>
            </div>
            ${depthIndicator ? `<div class="comment-depth-indicator">${depthIndicator}</div>` : ''}
            <div class="comment-body">${processedContent}</div>
            <div class="comment-actions">
                <button class="comment-action-btn ${userReaction === 'like' ? 'active' : ''}" 
                        onclick="likeComment('${comment.id}')"
                        ${currentUser ? '' : 'disabled'}
                        data-comment-id="${comment.id}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/>
                    </svg>
                    <span class="like-count">${likeCountText}</span>
                </button>
                <button class="comment-action-btn" 
                        onclick="replyToComment('${comment.id}', '${comment.pubkey}')"
                        ${currentUser ? '' : 'disabled'}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/>
                    </svg>
                    Reply
                </button>
            </div>
        </div>
    `;

    if (comment.children.length > 0) {
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'comment-children';
        comment.children.forEach(child => {
            const childElement = createCommentElement(child, profiles, reactions);
            childrenContainer.appendChild(childElement);
        });
        commentDiv.appendChild(childrenContainer);
    }

    return commentDiv;
}

function processCommentContent(content) {
    let processedContent = escapeHtml(content);

    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    const imageRegex = /(https?:\/\/[^\s<]+\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s<]*)?)/gi;
    const videoRegex = /(https?:\/\/[^\s<]+\.(mp4|webm|mov)(\?[^\s<]*)?)/gi;
    const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/g;

    const mediaUrls = new Set();

    let match;
    while ((match = imageRegex.exec(content)) !== null) {
        mediaUrls.add(match[1]);
    }

    while ((match = videoRegex.exec(content)) !== null) {
        mediaUrls.add(match[1]);
    }

    const youtubeIds = new Map();
    while ((match = youtubeRegex.exec(content)) !== null) {
        mediaUrls.add(match[0]);
        youtubeIds.set(match[0], match[1]);
    }

    processedContent = processedContent.replace(urlRegex, (url) => {
        if (mediaUrls.has(url)) {
            return url;
        }
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="comment-link">${url}</a>`;
    });

    const imageMatches = content.match(imageRegex);
    if (imageMatches) {
        const embedsHtml = imageMatches.map(url =>
            `<div class="comment-media">
                <img src="${url}" alt="Embedded image" loading="lazy" onclick="window.open('${url}', '_blank')">
            </div>`
        ).join('');
        processedContent += embedsHtml;
    }

    const videoMatches = content.match(videoRegex);
    if (videoMatches) {
        const embedsHtml = videoMatches.map(url =>
            `<div class="comment-media">
                <video controls preload="metadata">
                    <source src="${url}" type="video/mp4">
                    <source src="${url}" type="video/webm">
                </video>
            </div>`
        ).join('');
        processedContent += embedsHtml;
    }

    youtubeIds.forEach((videoId, url) => {
        const embedHtml = `<div class="comment-media youtube-embed">
            <iframe src="https://www.youtube.com/embed/${videoId}" 
                    frameborder="0" 
                    allowfullscreen
                    loading="lazy">
            </iframe>
        </div>`;
        processedContent += embedHtml;
    });

    return processedContent;
}

// Add comment input box
function createCommentInput(replyTo = null) {
    const inputDiv = document.createElement('div');
    inputDiv.className = 'comment-input-container';
    inputDiv.id = replyTo ? `reply-input-${replyTo.id}` : 'main-comment-input';

    const placeholder = replyTo ? 'Write a reply...' : 'Add a comment...';
    const buttonText = replyTo ? 'Reply' : 'Comment';

    inputDiv.innerHTML = `
        <div class="comment-input-box">
            ${replyTo ? `
                <div class="replying-to">
                    Replying to @${replyTo.name || `User ${replyTo.pubkey.slice(0, 8)}`}
                    <button onclick="cancelReply('${replyTo.id}')" class="cancel-reply">×</button>
                </div>
            ` : ''}
            <textarea 
                class="comment-textarea" 
                placeholder="${placeholder}"
                rows="3"
                ${currentUser ? '' : 'disabled'}
            ></textarea>
            <div class="comment-input-actions">
                <button 
                    class="comment-submit-btn" 
                    onclick="submitComment(${replyTo ? `'${replyTo.id}', '${replyTo.pubkey}'` : 'null, null'})"
                    ${currentUser ? '' : 'disabled'}
                >
                    ${buttonText}
                </button>
            </div>
            ${!currentUser ? '<p class="comment-login-prompt">Please login to comment</p>' : ''}
        </div>
    `;

    return inputDiv;
}

// Submit comment
async function submitComment(parentId, parentPubkey) {
    if (!currentUser || currentUser.readOnly) {
        if (!await ensureLoggedIn()) {
            alert('Please login to comment');
            return;
        }
    }

    const container = parentId ? document.getElementById(`reply-input-${parentId}`) : document.getElementById('main-comment-input');
    if (!container) return;

    const textarea = container.querySelector('.comment-textarea');
    const content = textarea.value.trim();

    if (!content) {
        alert('Please write a comment');
        return;
    }

    const button = container.querySelector('.comment-submit-btn');
    button.disabled = true;
    button.textContent = 'Posting...';

    try {
        const videoEventIds = [];
        const eventId = window.location.hash.split('/')[2];

        videoEventIds.push(eventId);

        const tags = [];

        videoEventIds.forEach(id => {
            tags.push(['e', id, '', 'root']);
        });

        if (parentId) {
            tags.push(['e', parentId, '', 'reply']);
            tags.push(['p', parentPubkey]);
        }

        const videoEvent = allEvents.get(eventId);
        if (videoEvent) {
            tags.push(['p', videoEvent.pubkey]);
        }

        const commentEvent = {
            kind: 1,
            tags: tags,
            content: content,
            created_at: Math.floor(Date.now() / 1000)
        };

        const signedEvent = await signEvent(commentEvent);
        const published = await publishEvent(signedEvent);

        if (published) {
            textarea.value = '';

            if (parentId) {
                cancelReply(parentId);
            }

            // Add the comment to the DOM immediately
            addCommentToDOM(signedEvent, parentId);
        } else {
            throw new Error('Failed to publish comment');
        }
    } catch (error) {
        console.error('Failed to post comment:', error);
        alert('Failed to post comment. Please try again.');
    } finally {
        button.disabled = false;
        button.textContent = parentId ? 'Reply' : 'Comment';
    }
}

// Add comment to DOM without reloading
function addCommentToDOM(commentEvent, parentId = null) {
    // Store the event
    allEvents.set(commentEvent.id, commentEvent);

    // Get user profile
    const profile = profileCache.get(commentEvent.pubkey) || {};
    const displayName = profile.name || profile.display_name || `User ${commentEvent.pubkey.slice(0, 8)}`;
    const avatarUrl = profile.picture || profile.avatar || '';
    const nip05 = profile.nip05 || '';

    // Create comment node
    const commentNode = {
        ...commentEvent,
        children: [],
        depth: parentId ? 1 : 0
    };

    // Create the comment element
    const commentElement = createCommentElement(commentNode, profileCache, new Map());

    // Find where to insert the comment
    if (parentId) {
        // It's a reply - find the parent comment
        const parentComment = document.querySelector(`[data-comment-id="${parentId}"]`);
        if (parentComment) {
            let childrenContainer = parentComment.querySelector('.comment-children');
            if (!childrenContainer) {
                childrenContainer = document.createElement('div');
                childrenContainer.className = 'comment-children';
                parentComment.appendChild(childrenContainer);
            }

            // Update the depth if nested
            const parentDepth = parseInt(parentComment.dataset.depth || 0);
            commentElement.dataset.depth = Math.min(parentDepth + 1, 3);

            // Insert at the beginning of children (newest first)
            childrenContainer.insertBefore(commentElement, childrenContainer.firstChild);
        }
    } else {
        // It's a top-level comment
        const commentsContainer = document.getElementById('comments-container');
        if (commentsContainer) {
            // Remove "no comments" message if it exists
            const noCommentsMsg = commentsContainer.querySelector('p');
            if (noCommentsMsg && noCommentsMsg.textContent.includes('No comments yet')) {
                noCommentsMsg.remove();
            }

            // Insert at the beginning (newest first)
            commentsContainer.insertBefore(commentElement, commentsContainer.firstChild);
        }
    }

    // If profile is not cached, fetch it
    if (!profileCache.has(commentEvent.pubkey)) {
        fetchUserProfile(commentEvent.pubkey).then(profile => {
            if (profile) {
                updateCommentProfile(commentEvent.id, profile);
            }
        });
    }
}

// Update comment profile when fetched
function updateCommentProfile(commentId, profile) {
    const commentElement = document.querySelector(`[data-comment-id="${commentId}"]`);
    if (!commentElement) return;

    const displayName = profile.name || profile.display_name || `User ${commentElement.querySelector('.comment-author-name').textContent}`;
    const avatarUrl = profile.picture || profile.avatar || '';
    const nip05 = profile.nip05 || '';

    // Update name
    const nameElement = commentElement.querySelector('.comment-author-name');
    if (nameElement) {
        nameElement.textContent = displayName;
    }

    // Update avatar
    const avatarElement = commentElement.querySelector('.comment-avatar');
    if (avatarElement && avatarUrl) {
        avatarElement.innerHTML = `<img src="${avatarUrl}" alt="${displayName}">`;
    }

    // Update nip05
    const authorInfo = commentElement.querySelector('.comment-author-info');
    if (authorInfo && nip05) {
        const existingNip05 = authorInfo.querySelector('.comment-author-nip05');
        if (!existingNip05) {
            const nip05Element = document.createElement('div');
            nip05Element.className = 'comment-author-nip05';
            nip05Element.textContent = nip05;
            authorInfo.appendChild(nip05Element);
        }
    }
}

// Reply to comment
function replyToComment(commentId, commentPubkey) {
    document.querySelectorAll('.comment-reply-box').forEach(box => box.remove());

    const commentElement = document.querySelector(`[data-comment-id="${commentId}"]`);
    if (!commentElement) return;

    const authorName = commentElement.querySelector('.comment-author-name').textContent;

    const replyBox = document.createElement('div');
    replyBox.className = 'comment-reply-box';
    replyBox.id = `reply-box-${commentId}`;

    const replyInput = createCommentInput({
        id: commentId,
        pubkey: commentPubkey,
        name: authorName
    });

    replyBox.appendChild(replyInput);

    const commentContent = commentElement.querySelector('.comment-content');
    commentContent.appendChild(replyBox);

    replyBox.querySelector('.comment-textarea').focus();
}

// Cancel reply
function cancelReply(commentId) {
    const replyBox = document.getElementById(`reply-box-${commentId}`);
    if (replyBox) {
        replyBox.remove();
    }
}

// Like comment
async function likeComment(commentId) {
    if (!currentUser || currentUser.readOnly) {
        if (!await ensureLoggedIn()) {
            alert('Please login to like comments');
            return;
        }
    }

    const button = document.querySelector(`button[data-comment-id="${commentId}"]`);
    if (!button) return;

    const likeCountSpan = button.querySelector('.like-count');
    const currentLikeText = likeCountSpan.textContent;
    const currentLikes = currentLikeText === 'Like' ? 0 : parseInt(currentLikeText) || 0;
    const wasLiked = button.classList.contains('active');

    // Optimistically update UI
    if (wasLiked) {
        button.classList.remove('active');
        const newCount = Math.max(0, currentLikes - 1);
        likeCountSpan.textContent = newCount > 0 ? formatNumber(newCount) : 'Like';
    } else {
        button.classList.add('active');
        likeCountSpan.textContent = formatNumber(currentLikes + 1);
    }

    try {
        const reactionEvent = {
            kind: 7,
            tags: [
                ['e', commentId],
                ['p', allEvents.get(commentId)?.pubkey || ''],
                ['t', 'pv69420']
            ],
            content: wasLiked ? '-' : '👍',
            created_at: Math.floor(Date.now() / 1000)
        };

        const signedEvent = await signEvent(reactionEvent);
        const published = await publishEvent(signedEvent);

        if (!published) {
            // Revert on failure
            if (wasLiked) {
                button.classList.add('active');
                likeCountSpan.textContent = currentLikes > 0 ? formatNumber(currentLikes) : 'Like';
            } else {
                button.classList.remove('active');
                const revertCount = Math.max(0, currentLikes);
                likeCountSpan.textContent = revertCount > 0 ? formatNumber(revertCount) : 'Like';
            }
            throw new Error('Failed to publish reaction');
        }

        // Success - the UI is already updated
    } catch (error) {
        console.error('Failed to like comment:', error);
        // Don't show alert since we've already reverted the UI
    }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Upload modal functions
function showUploadModal() {
    if (!currentUser) {
        ensureLoggedIn();
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
    const input = event.target;
    const file = input.files[0];
    if (!file) return;

    const maxSize = 100 * 1024 * 1024; // 100MB
    if (file.size > maxSize) {
        alert('File size must be less than 100MB');
        input.value = '';
        return;
    }

    if (input.id === 'videoFile') {
        const allowedVideoTypes = [
            'video/mp4',
            'video/webm',
            'video/mov',
            'video/avi',
            'video/mkv',
            'video/wmv'
        ];
        if (!allowedVideoTypes.includes(file.type)) {
            alert('Invalid video file type. Please upload a video file (mp4, webm, mov, avi, mkv, wmv)');
            input.value = '';
            return;
        }

        const fileUpload = document.getElementById('fileUpload');
        fileUpload.classList.add('active');
        fileUpload.innerHTML = `
            <p style="font-weight: 500;">${file.name}</p>
            <p style="font-size: 0.875rem; color: var(--text-secondary);">${(file.size / 1024 / 1024).toFixed(2)} MB</p>
        `;
    } else if (input.id === 'thumbnailFile') {
        const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!allowedImageTypes.includes(file.type)) {
            alert('Invalid thumbnail file type. Please upload an image file (jpg, png, gif, webp)');
            input.value = '';
            return;
        }
    }
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
    const expiration = Math.floor(Date.now() / 1000) + 60;
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

    const signedEvent = await signEvent(authEvent);
    return signedEvent;
}

// Upload to Blossom with proper authentication
async function uploadToBlossom(file, servers = BLOSSOM_SERVERS) {
    const hash = await calculateSHA256(file);
    const successfulUploads = [];
    let primaryUrl = null;

    const serverStatusDiv = document.getElementById('serverStatus');
    serverStatusDiv.innerHTML = '';

    for (const server of servers) {
        try {
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

                if (!primaryUrl) {
                    primaryUrl = url;
                }

                console.log(`Successfully uploaded to ${server}`);

                // Create a status element for the current server
                const serverStatus = document.createElement('div');
                serverStatus.classList.add('server');
                serverStatus.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                    </svg>
                    ${server.replace('https://', '')}
                `;
                serverStatusDiv.appendChild(serverStatus);
            } else {
                console.error(`Upload to ${server} failed with status ${response.status}`);

                // Create a status element for the current server with failure status
                const serverStatus = document.createElement('div');
                serverStatus.classList.add('server', 'failure');
                serverStatus.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
                    </svg>
                    ${server.replace('https://', '')}
                `;
                serverStatusDiv.appendChild(serverStatus);
            }
        } catch (error) {
            console.error(`Failed to upload to ${server}:`, error);

            // Create a status element for the current server with failure status
            const serverStatus = document.createElement('div');
            serverStatus.classList.add('server', 'failure');
            serverStatus.innerHTML = `
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" />
                </svg>
                ${server.replace('https://', '')}
            `;
            serverStatusDiv.appendChild(serverStatus);
        }
    }

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

// Show ratioed modal
function showRatioedModal(eventId) {
    pendingRatioedAction = eventId;
    document.getElementById('ratioedModal').classList.add('active');
}

// Proceed with ratioed video
function proceedRatioed() {
    if (pendingRatioedAction) {
        const eventId = pendingRatioedAction;
        sessionRatioedAllowed.add(eventId);
        document.getElementById('ratioedModal').classList.remove('active');
        pendingRatioedAction = null;

        // Ensure the URL is correct before playing
        if (!window.location.hash.includes(`/video/${eventId}`)) {
            window.location.hash = `/video/${eventId}`;
        }

        document.getElementById('mainContent').innerHTML = '<div class="spinner"></div>';

        setTimeout(() => {
            playVideo(eventId, false, true);
        }, 10);
    }
}

// Cancel ratioed
function cancelRatioed() {
    document.getElementById('ratioedModal').classList.remove('active');
    pendingRatioedAction = null;
    if (window.location.hash.startsWith('#/video/')) {
        navigateTo('/');
    }
}

// Show NSFW modal
function showNSFWModal(action, eventId) {
    pendingNSFWAction = { action, eventId };
    document.getElementById('nsfwModal').classList.add('active');
}

// Confirm NSFW
async function confirmNSFW() {
    const rememberChoice = document.getElementById('rememberNSFW').checked;

    if (rememberChoice) {
        localStorage.setItem('allowNSFW', 'true');
    }

    sessionNSFWAllowed = true;

    document.getElementById('nsfwModal').classList.remove('active');

    if (pendingNSFWAction && pendingNSFWAction.action === 'playVideo') {
        const eventId = pendingNSFWAction.eventId;
        pendingNSFWAction = null;

        // Ensure the URL is correct before playing
        if (!window.location.hash.includes(`/video/${eventId}`)) {
            window.location.hash = `/video/${eventId}`;
        }

        document.getElementById('mainContent').innerHTML = '<div class="spinner"></div>';

        setTimeout(() => {
            playVideo(eventId, true, false);
        }, 10);
    }

    if (rememberChoice && !window.location.hash.startsWith('#/video/')) {
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
    if (window.location.hash.startsWith('#/video/')) {
        navigateTo('/');
    }
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

    // If we have a title from the tags, we need to strip it from the description
    if (videoData.title && videoData.description) {
        const parts = videoData.description.split('\n\n');

        if (parts.length > 1) {
            const firstPart = parts[0];

            const cleanFirstPart = firstPart.replace(/^[^\w\s]+\s*/, '').trim();

            if (cleanFirstPart === videoData.title || firstPart.includes(videoData.title)) {
                videoData.description = parts.slice(1).join('\n\n').trim();
            }
        } else {
            const cleanContent = videoData.description.replace(/^[^\w\s]+\s*/, '').trim();
            if (cleanContent.startsWith(videoData.title)) {
                const titleIndex = videoData.description.indexOf(videoData.title);
                const afterTitle = videoData.description.substring(titleIndex + videoData.title.length).trim();
                videoData.description = afterTitle.startsWith('\n') ? afterTitle.substring(1).trim() : afterTitle;
            }
        }
    }

    if (!videoData.title && videoData.description) {
        const lines = videoData.description.split('\n');

        if (lines[0]) {
            videoData.title = lines[0].replace(/^[^\w\s]+\s*/, '').trim();

            if (lines.length > 1) {
                videoData.description = lines.slice(1).join('\n').trim();
                videoData.description = videoData.description.replace(/^\n+/, '');
            } else {
                videoData.description = '';
            }
        }
    }

    // Remove any video URLs from the description
    const videoExtensions = ['mp4', 'mov', 'webm', 'avi', 'mkv', 'flv', 'wmv'];
    const extensionsPattern = videoExtensions.join('|');

    const urlRegex = new RegExp(
        `https?:\\/\\/[^\\s]*([a-f0-9]{64})\\.(${extensionsPattern})(\\?[^\\s]*)?`,
        'gi'
    );

    videoData.description = videoData.description.replace(urlRegex, '').trim();

    // Also remove the exact URL if it matches
    if (videoData.url && videoData.description.includes(videoData.url)) {
        videoData.description = videoData.description.replace(videoData.url, '').trim();
    }

    return videoData.title ? videoData : null;
}

// Check if video is NSFW
function isVideoNSFW(event) {
    const tags = event.tags || [];
    return tags.some(tag => tag[0] === 'content-warning' && tag[1] === 'nsfw');
}

// Helper function to validate NIP-05
async function validateNip05(nip05, pubkey) {
    const cacheKey = `${nip05}:${pubkey}`;
    if (nip05ValidationCache.has(cacheKey)) {
        return nip05ValidationCache.get(cacheKey);
    }

    try {
        const [name, domain] = nip05.split('@');
        if (!name || !domain) {
            nip05ValidationCache.set(cacheKey, false);
            return false;
        }

        const response = await fetch(`https://${domain}/.well-known/nostr.json?name=${name}`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            nip05ValidationCache.set(cacheKey, false);
            return false;
        }

        const data = await response.json();
        const isValid = data.names && data.names[name] === pubkey;

        nip05ValidationCache.set(cacheKey, isValid);
        setTimeout(() => nip05ValidationCache.delete(cacheKey), 24 * 60 * 60 * 1000);

        return isValid;
    } catch (error) {
        console.error('NIP-05 validation error:', error);
        nip05ValidationCache.set(cacheKey, false);
        return false;
    }
}

// Helper to check if image URL is valid
function createImageValidationPromise(url) {
    return new Promise((resolve) => {
        if (!url) {
            resolve(false);
            return;
        }

        const img = new Image();
        const timeout = setTimeout(() => {
            img.src = '';
            resolve(false);
        }, 5000);

        img.onload = () => {
            clearTimeout(timeout);
            resolve(true);
        };

        img.onerror = () => {
            clearTimeout(timeout);
            resolve(false);
        };

        img.src = url;
    });
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

    const cardId = `video-card-${event.id}`;
    const isSuspiciousProfile = !avatarUrl || !nip05;

    // Get boost data
    const boostAmount = boostsCache.get(event.id) || 0;
    const boostLevel = getBoostLevel(boostAmount);
    const isBoosted = boostLevel > 0;

    // Determine what type of overlay to show
    const showNSFWOverlay = isNSFW && !shouldShowNSFW();
    const showCommunityWarning = (isRatioed || isSuspiciousProfile) && !sessionRatioedAllowed.has(event.id);
    const showBlurred = showNSFWOverlay || showCommunityWarning;

    // NSFW takes precedence
    const overlayType = showNSFWOverlay ? 'nsfw' : 'ratioed';

    if (isTrending && (isRatioed || isSuspiciousProfile)) {
        return '';
    }

    const cardHTML = `
        <div class="video-card ${isBoosted ? `boosted boost-level-${boostLevel}` : ''}" id="${cardId}" data-event-id="${event.id}" data-pubkey="${event.pubkey}" data-is-trending="${isTrending}" data-validation-pending="${avatarUrl || nip05 ? 'true' : 'false'}">
            <div class="video-thumbnail ${showBlurred ? overlayType : ''}" 
                 onclick="${showBlurred ? (overlayType === 'nsfw' ? `showNSFWModal('playVideo', '${event.id}')` : `showRatioedModal('${event.id}')`) : `navigateTo('/video/${event.id}')`}">
                ${videoData.thumbnail ?
            `<img src="${videoData.thumbnail}" alt="${videoData.title}" onerror="this.style.display='none'">` :
            `<video src="${videoData.url}" preload="metadata"></video>`
        }
                ${showBlurred ? `
                    <div class="${overlayType}-overlay">
                        <div class="${overlayType}-badge">${overlayType === 'nsfw' ? 'NSFW' : 'COMMUNITY WARNING'}</div>
                        <div>Click to view</div>
                    </div>
                ` : ''}
                ${isBoosted && !showBlurred ? `
                    <div class="boost-indicator">
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z" stroke-width="2"/>
                        </svg>
                        ${formatSats(boostAmount)}
                    </div>
                ` : ''}
                ${isTrending && trendingRank ? `
                    <div class="trending-badge ${isBoosted ? 'with-boost' : ''}">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19.48,12.35c-1.57-4.08-7.16-4.3-5.81-10.23c0.1-0.44-0.37-0.78-0.75-0.55C9.29,3.71,6.68,8,8.87,13.62 c0.18,0.46-0.36,0.89-0.75,0.59c-1.81-1.37-2-3.34-1.84-4.75c0.06-0.52-0.62-0.77-0.91-0.34C4.69,10.16,4,11.84,4,14.37 c0.38,5.6,5.11,7.32,6.81,7.54c2.43,0.31,5.06-0.14,6.95-1.87C19.84,18.11,20.6,15.03,19.48,12.35z"/>
                        </svg>
                        #${trendingRank}
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
                        ${avatarUrl ? `<img src="${avatarUrl}" alt="${displayName}" data-avatar-url="${avatarUrl}">` : ''}
                    </div>
                    <div class="channel-details">
                        <div class="channel-name">${displayName}</div>
                        ${nip05 ? `<div class="channel-nip05" data-nip05="${nip05}">${nip05}</div>` : ''}
                    </div>
                </a>
                <h3 class="video-title" onclick="${showBlurred ? (overlayType === 'nsfw' ? `showNSFWModal('playVideo', '${event.id}')` : `showRatioedModal('${event.id}')`) : `navigateTo('/video/${event.id}')`}">${videoData.title}</h3>
                <div class="video-meta">
                    ${formatTimestamp(event.created_at)}
                    ${isNSFW ? ' • <span style="color: #ff0000;">NSFW</span>' : ''}
                    <span class="community-warning-indicator" style="${showCommunityWarning && !showNSFWOverlay ? '' : 'display: none;'}"> • <span style="color: #ff9800;">Community Warning</span></span>
                </div>
            </div>
        </div>
    `;

    if (profile && (avatarUrl || nip05)) {
        setTimeout(() => validateVideoCard(event.id, event.pubkey, profile, reactions, isTrending), 100);
    }

    return cardHTML;
}

// Function to validate and update video cards
async function validateVideoCard(eventId, pubkey, profile, reactions, isTrending = false) {
    const card = document.getElementById(`video-card-${eventId}`);
    if (!card) return;

    if (card.dataset.validationDone === 'true') return;

    const avatarUrl = profile?.picture || profile?.avatar || '';
    const nip05 = profile?.nip05 || '';

    const [avatarValid, nip05Valid] = await Promise.all([
        avatarUrl ? createImageValidationPromise(avatarUrl) : Promise.resolve(false),
        nip05 ? validateNip05(nip05, pubkey) : Promise.resolve(false)
    ]);

    const isSuspiciousProfile = !avatarValid || !nip05Valid;
    const isNSFW = isVideoNSFW(allEvents.get(eventId));
    const isRatioed = isVideoRatioed(reactions || {});

    if (isTrending === false && card.dataset.isTrending === 'true') {
        isTrending = true;
    }

    card.dataset.validationDone = 'true';
    card.dataset.needsValidation = 'false';

    if (isTrending && (isRatioed || isSuspiciousProfile)) {
        card.remove();

        const trendingGrid = document.getElementById('trendingGrid');
        if (trendingGrid && trendingGrid.querySelector('.video-card')) {
            setTimeout(() => {
                initializeCarousel();
            }, 100);
        }
        return;
    }

    const thumbnail = card.querySelector('.video-thumbnail');
    const currentOverlay = thumbnail.querySelector('.ratioed-overlay, .nsfw-overlay');

    // Separate checks for NSFW and community warnings
    const shouldShowNSFWOverlay = isNSFW && !shouldShowNSFW();
    const shouldShowCommunityWarning = (isRatioed || isSuspiciousProfile) && !sessionRatioedAllowed.has(eventId);

    // NSFW takes precedence over community warning
    const needsOverlay = shouldShowNSFWOverlay || shouldShowCommunityWarning;
    const overlayType = shouldShowNSFWOverlay ? 'nsfw' : 'ratioed';

    if ((currentOverlay && !needsOverlay) || (!currentOverlay && needsOverlay)) {
        if (needsOverlay) {
            if (!currentOverlay) {
                thumbnail.classList.add(overlayType);
                thumbnail.setAttribute('onclick',
                    overlayType === 'nsfw' ? `showNSFWModal('playVideo', '${eventId}')` : `showRatioedModal('${eventId}')`
                );

                const overlayHTML = `
                    <div class="${overlayType}-overlay">
                        <div class="${overlayType}-badge">${overlayType === 'nsfw' ? 'NSFW' : 'COMMUNITY WARNING'}</div>
                        <div>Click to view</div>
                    </div>
                `;
                thumbnail.insertAdjacentHTML('beforeend', overlayHTML);
            }
        } else {
            thumbnail.classList.remove('ratioed', 'nsfw');
            thumbnail.setAttribute('onclick', `navigateTo('/video/${eventId}')`);
            if (currentOverlay) currentOverlay.remove();
        }

        const warningIndicator = card.querySelector('.community-warning-indicator');
        if (warningIndicator) {
            // Only show community warning indicator if there's actually a community issue (not just NSFW)
            warningIndicator.style.display = shouldShowCommunityWarning && !shouldShowNSFWOverlay ? 'inline' : 'none';
        }

        const title = card.querySelector('.video-title');
        if (title) {
            title.setAttribute('onclick',
                needsOverlay ?
                    (overlayType === 'nsfw' ? `showNSFWModal('playVideo', '${eventId}')` : `showRatioedModal('${eventId}')`) :
                    `navigateTo('/video/${eventId}')`
            );
        }
    }
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