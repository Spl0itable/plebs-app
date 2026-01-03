const peertubeImportState = {
    metadata: null,
    lastFetched: null,
    streamUrlOverride: '',
    magnet: ''
};

let peertubeAutoFetchTimer = null;
let lastPeertubeUrlRequested = '';
let peertubeAutoFetchInitialized = false;

function showPeertubeModal() {
    hideCreateModal();
    if (!currentUser) {
        ensureLoggedIn();
        return;
    }
    resetPeertubeImportForm();
    document.getElementById('peertubeModal').classList.add('active');
    setupPeertubeUrlAutoFetch();
}

function hidePeertubeModal() {
    document.getElementById('peertubeModal').classList.remove('active');
}

function backToCreateModalFromPeertube() {
    hidePeertubeModal();
    showCreateModal();
}

function resetPeertubeImportForm() {
    const form = document.getElementById('peertubeImportForm');
    if (form) {
        form.reset();
    }
    peertubeImportState.metadata = null;
    peertubeImportState.lastFetched = null;
    peertubeImportState.streamUrlOverride = '';
    lastPeertubeUrlRequested = '';

    const statusEl = document.getElementById('peertubeMetaStatus');
    if (statusEl) {
        statusEl.textContent = '';
        statusEl.classList.remove('success', 'error', 'info');
    }

    const preview = document.getElementById('peertubePreview');
    if (preview) {
        preview.innerHTML = '';
    }

    const streamInput = document.getElementById('peertubeStreamUrl');
    if (streamInput) {
        streamInput.value = '';
    }

    const testBtn = document.getElementById('peertubeTestStreamBtn');
    if (testBtn) {
        testBtn.disabled = true;
    }

    peertubeImportState.magnet = '';
    updatePeertubeWebTorrentHint('WebTorrent will only run if a magnet is available.', 'info');
    configurePeertubeWebTorrentCheckbox(false);

    const testerVideo = document.getElementById('peertubeStreamTester');
    if (testerVideo) {
        testerVideo.pause();
        testerVideo.removeAttribute('src');
    }
}

function setPeertubeMetaStatus(message, type = 'info') {
    const statusEl = document.getElementById('peertubeMetaStatus');
    if (!statusEl) return;
    statusEl.textContent = message;
    ['success', 'error', 'info'].forEach(cls => statusEl.classList.remove(cls));
    if (type) {
        statusEl.classList.add(type);
    }
}

function updatePeertubeWebTorrentHint(message, type = 'info') {
    const hintEl = document.getElementById('peertubeWebTorrentHint');
    if (!hintEl) return;
    hintEl.textContent = message;
    ['success', 'error', 'info'].forEach(cls => hintEl.classList.remove(cls));
    if (type) {
        hintEl.classList.add(type);
    }
}

function configurePeertubeWebTorrentCheckbox(enabled) {
    const checkbox = document.getElementById('peertubeAllowWebTorrent');
    if (!checkbox) return;
    checkbox.disabled = !enabled;
    if (!enabled) {
        checkbox.checked = false;
    }
}

function setupPeertubeUrlAutoFetch() {
    const urlInput = document.getElementById('peertubeUrl');
    if (!urlInput) return;

    if (peertubeAutoFetchInitialized) {
        return;
    }
    peertubeAutoFetchInitialized = true;

    urlInput.addEventListener('input', () => {
        clearTimeout(peertubeAutoFetchTimer);
        const value = urlInput.value.trim();
        if (!value) {
            setPeertubeMetaStatus('');
            lastPeertubeUrlRequested = '';
            return;
        }

        peertubeAutoFetchTimer = setTimeout(() => {
            if (value && value !== lastPeertubeUrlRequested) {
                fetchPeertubeMetadata();
            }
        }, 600);
    });
}

async function fetchPeertubeMetadata() {
    const urlInput = document.getElementById('peertubeUrl');
    if (!urlInput) return;
    const url = urlInput.value.trim();
    console.log('[Peertube] fetch metadata requested:', url);
    if (!url) {
        setPeertubeMetaStatus('Enter a Peertube URL to fetch metadata.', 'error');
        return;
    }

    const parsed = parsePeertubeVideoUrl(url);
    if (!parsed || !parsed.id) {
        setPeertubeMetaStatus('Could not determine the video ID. Please check the URL.', 'error');
        return;
    }

    lastPeertubeUrlRequested = url;

    setPeertubeMetaStatus('Fetching metadata from the instance…', 'info');
    const slowTimer = setTimeout(() => {
        setPeertubeMetaStatus('Peertube is responding slowly—still waiting for metadata...', 'info');
    }, PEERTUBE_METADATA_SLOW_THRESHOLD_MS);

    try {
        const { metadata: data, status } = await fetchPeertubeVideoMetadataFromApi(parsed.origin, parsed.id);
        peertubeImportState.metadata = data;
        peertubeImportState.lastFetched = Date.now();

        const statusNote = status === 206
            ? ' (Partial content response)'
            : status !== 200
                ? ` (Status ${status})`
                : '';

        const titleInput = document.getElementById('peertubeTitle');
        const descriptionInput = document.getElementById('peertubeDescription');
        const tagsInput = document.getElementById('peertubeTags');
        const authorInput = document.getElementById('peertubeAuthor');
        const thumbnailInput = document.getElementById('peertubeThumbnail');

        if (titleInput && data.name) {
            titleInput.value = data.name;
        }
        if (descriptionInput && data.description) {
            descriptionInput.value = data.description;
        }
        if (tagsInput && Array.isArray(data.tags)) {
            tagsInput.value = data.tags.join(',');
        }

        if (authorInput) {
            const owner = data.account || data.owner || data.user;
            let creator = '';
            if (owner?.displayName) {
                creator = owner.displayName;
            } else if (owner?.username) {
                creator = owner.username;
            }
            if (owner?.host) {
                creator = creator ? `${creator}@${owner.host}` : `${owner.username}@${owner.host}`;
            }
            if (creator) {
                authorInput.value = creator;
            }
        }

        if (thumbnailInput) {
            const thumb = data.snapshotUrl || data.thumbnail || data.previewUrl;
            if (thumb) {
                thumbnailInput.value = thumb;
            }
        }

        const preview = document.getElementById('peertubePreview');
        if (preview) {
            preview.innerHTML = `
                <strong>${data.name || 'Peertube Video'}</strong>
                <div style="margin-top:0.35rem;">
                    ${data.description ? data.description.slice(0, 150) + (data.description.length > 150 ? '…' : '') : 'No description available.'}
                </div>
                <div style="margin-top:0.5rem; color: var(--text-secondary); font-size:0.85rem;">
                    Instance: ${parsed.host || parsed.origin}
                </div>
            `;
        }

        setPeertubeMetaStatus(`Metadata loaded from ${parsed.origin}${statusNote}`, 'success');
        console.log('[Peertube] metadata loaded:', parsed.origin, parsed.id, data);

        const testBtn = document.getElementById('peertubeTestStreamBtn');
        if (testBtn) {
            testBtn.disabled = false;
        }

        const extractedMagnet = findPeertubeMagnet(data);
        peertubeImportState.magnet = extractedMagnet;
        if (extractedMagnet) {
            updatePeertubeWebTorrentHint('Magnet detected automatically for WebTorrent playback.', 'success');
            configurePeertubeWebTorrentCheckbox(true);
        } else {
            updatePeertubeWebTorrentHint('No magnet/torrent provided by this instance yet.', 'info');
            configurePeertubeWebTorrentCheckbox(false);
        }
    } catch (error) {
        console.error('Peertube metadata fetch failed:', error);
        setPeertubeMetaStatus(`Unable to fetch metadata (${error.message}). Fill fields manually if needed.`, 'error');
        const testBtn = document.getElementById('peertubeTestStreamBtn');
        if (testBtn) {
            testBtn.disabled = true;
        }
        updatePeertubeWebTorrentHint('Unable to determine torrent metadata while fetching.', 'error');
        configurePeertubeWebTorrentCheckbox(false);
        peertubeImportState.magnet = '';
    } finally {
        clearTimeout(slowTimer);
    }
}

const PEERTUBE_STREAM_SKIP_EXTENSIONS = ['.m3u8'];
const PEERTUBE_METADATA_SLOW_THRESHOLD_MS = 4000;
const PEERTUBE_API_FETCH_TIMEOUT_MS = 20000;
const PEERTUBE_STREAM_PROBE_TIMEOUT_MS = 20000;

async function fetchPeertubeVideoMetadataFromApi(origin, videoId, { timeoutMs = PEERTUBE_API_FETCH_TIMEOUT_MS } = {}) {
    if (!origin || !videoId) {
        throw new Error('Missing Peertube instance or video ID');
    }

    const normalizedOrigin = origin.replace(/\/+$/, '');
    const requestUrl = `${normalizedOrigin}/api/v1/videos/${encodeURIComponent(videoId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(requestUrl, { signal: controller.signal });
        if (!response.ok) {
            throw new Error(`Status ${response.status}`);
        }
        const metadata = await response.json();
        return {
            metadata,
            status: response.status
        };
    } finally {
        clearTimeout(timer);
    }
}

function gatherPeertubeStreamCandidates(metadata) {
    if (!metadata) return [];

    const seen = new Set();
    const candidates = [];

    const normalizeDownloadUrl = (url) => {
        if (!url || typeof url !== 'string') return null;
        const trimmed = url.trim();
        if (!trimmed) return null;
        return trimmed.replace(/-fragmented(?=\.mp4)/i, '');
    };

    const addCandidate = (url, label = '') => {
        if (!url || typeof url !== 'string') return;
        const trimmed = url.trim();
        if (!trimmed || seen.has(trimmed)) return;
        const cleanPath = trimmed.split('?')[0].split('#')[0];
        const extensionIndex = cleanPath.lastIndexOf('.');
        const extension = extensionIndex !== -1 ? cleanPath.substring(extensionIndex).toLowerCase() : '';
        if (extension && PEERTUBE_STREAM_SKIP_EXTENSIONS.includes(extension)) return;
        seen.add(trimmed);
        candidates.push({ url: trimmed, label });
    };

    const addFileVariants = (file, prefixLabel) => {
        if (!file || !file.fileDownloadUrl) return;
        const resolution = file.resolution?.label || file.resolution?.id || 'stream';
        const baseLabel = prefixLabel ? `${resolution} · ${prefixLabel}` : resolution;
        const normalizedDownloadUrl = normalizeDownloadUrl(file.fileDownloadUrl);
        if (normalizedDownloadUrl) {
            addCandidate(normalizedDownloadUrl, `${baseLabel} (download)`);
        } else {
            addCandidate(file.fileDownloadUrl, `${baseLabel} (download)`);
        }
    };

    if (Array.isArray(metadata.streamingPlaylists)) {
        metadata.streamingPlaylists.forEach(playlist => {
            if (!playlist || !Array.isArray(playlist.files)) return;
            playlist.files.forEach(file => addFileVariants(file, 'streaming playlist'));
        });
    }

    if (Array.isArray(metadata.files)) {
        metadata.files.forEach(file => addFileVariants(file, 'metadata file'));
    }
    if (Array.isArray(metadata.sourceFiles)) {
        metadata.sourceFiles.forEach(file => addFileVariants(file, 'source file'));
    }

    addCandidate(metadata.streamUrl, 'streamUrl');
    addCandidate(metadata.streamingUrl, 'streamingUrl');

    return candidates;
}

function findPeertubeMagnet(metadata) {
    if (!metadata) return '';
    if (Array.isArray(metadata.streamingPlaylists)) {
        for (const playlist of metadata.streamingPlaylists) {
            const files = playlist?.files || [];
            for (const file of files) {
                if (file?.magnetUri) {
                    return file.magnetUri;
                }
                if (file?.torrentUrl) {
                    return file.torrentUrl;
                }
                if (file?.torrentDownloadUrl) {
                    return file.torrentDownloadUrl;
                }
            }
        }
    }
    if (Array.isArray(metadata.files)) {
        for (const file of metadata.files) {
            if (file?.magnetUri) {
                return file.magnetUri;
            }
        }
    }
    return '';
}

function probePeertubeStreamUrl(videoElement, url, timeoutMs = PEERTUBE_STREAM_PROBE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (success, error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            videoElement.oncanplay = null;
            videoElement.onloadedmetadata = null;
            videoElement.onerror = null;
            videoElement.pause();
            videoElement.removeAttribute('src');
            if (success) {
                resolve(url);
            } else {
                reject(error);
            }
        };

        const timer = setTimeout(() => {
            settle(false, new Error('Timed out while checking stream'));
        }, timeoutMs);

        videoElement.oncanplay = () => settle(true);
        videoElement.onloadedmetadata = () => settle(true);
        videoElement.onerror = () => settle(false, new Error('Stream load failed'));

        videoElement.src = url;
        videoElement.load();
    });
}

async function testPeertubeStream() {
    const metadata = peertubeImportState.metadata;
    if (!metadata) {
        setPeertubeMetaStatus('Fetch metadata first to discover candidate streams.', 'error');
        return;
    }

    const candidates = gatherPeertubeStreamCandidates(metadata);
    if (!candidates.length) {
        setPeertubeMetaStatus('No direct MP4/WebM URLs detected in the metadata.', 'error');
        return;
    }

    const testerVideo = document.getElementById('peertubeStreamTester');
    if (!testerVideo) return;

    const testBtn = document.getElementById('peertubeTestStreamBtn');
    if (testBtn) {
        testBtn.disabled = true;
        testBtn.textContent = 'Testing…';
    }

    let detectedCandidate = null;
    try {
        for (let i = 0; i < candidates.length; i++) {
            const candidate = candidates[i];
            setPeertubeMetaStatus(`Testing stream ${candidate.label || (i + 1)}/${candidates.length}…`, 'info');
            try {
                await probePeertubeStreamUrl(testerVideo, candidate.url);
                detectedCandidate = candidate;
                break;
            } catch (error) {
                console.warn('Peertube stream test failed:', error);
            }
        }
    } finally {
        if (testBtn) {
            testBtn.disabled = false;
            testBtn.textContent = 'Test stream';
        }
        testerVideo.pause();
        testerVideo.removeAttribute('src');
    }

    if (detectedCandidate) {
        setPeertubeMetaStatus(`Playable stream found: ${detectedCandidate.url} ${detectedCandidate.label ? `(${detectedCandidate.label})` : ''}`, 'success');
        peertubeImportState.streamUrlOverride = detectedCandidate.url;
        const streamInput = document.getElementById('peertubeStreamUrl');
        if (streamInput) {
            streamInput.value = detectedCandidate.url;
        }
        return;
    }

    setPeertubeMetaStatus('No playable HTTP streams detected; you can still rely on WebTorrent.', 'error');
}

function parsePeertubeVideoUrl(value) {
    try {
        const parsedUrl = new URL(value);
        const segments = parsedUrl.pathname.split('/').filter(Boolean);
        let videoId = null;
        const watchIndex = segments.indexOf('watch');
        const videosIndex = segments.indexOf('videos');

        if (watchIndex !== -1 && segments.length > watchIndex + 1) {
            videoId = segments[watchIndex + 1];
        } else if (segments.length > 0) {
            videoId = segments[segments.length - 1];
        }

        return {
            origin: parsedUrl.origin,
            host: parsedUrl.host,
            id: videoId
        };
    } catch (e) {
        return null;
    }
}

async function handlePeertubeImport(e) {
    e.preventDefault();
    if (!currentUser) {
        ensureLoggedIn();
        return;
    }

    const url = document.getElementById('peertubeUrl')?.value.trim();
    const title = document.getElementById('peertubeTitle')?.value.trim();
    const description = document.getElementById('peertubeDescription')?.value.trim();
    const tagsValue = document.getElementById('peertubeTags')?.value || '';
    const author = document.getElementById('peertubeAuthor')?.value.trim();
    const nostr = document.getElementById('peertubeNostr')?.value.trim();
    const magnet = peertubeImportState.magnet;
    const allowTorrent = document.getElementById('peertubeAllowWebTorrent')?.checked;
    const thumbnail = document.getElementById('peertubeThumbnail')?.value.trim();
    const streamUrlOverride = document.getElementById('peertubeStreamUrl')?.value.trim();

    if (!url || !title) {
        alert('Please provide both a Peertube URL and a title.');
        return;
    }

    const parsed = parsePeertubeVideoUrl(url);
    if (!parsed || !parsed.id) {
        alert('Invalid Peertube URL. Please double-check the link.');
        return;
    }

    const tags = tagsValue.split(',').map(tag => tag.trim()).filter(tag => tag);

    const importData = {
        url,
        title,
        description,
        tags,
        author,
        nostr,
        magnet,
        allowTorrent,
        thumbnail,
        metadata: peertubeImportState.metadata,
        streamUrl: streamUrlOverride,
        parsedInstance: parsed.origin,
        parsedHost: parsed.host,
        videoId: parsed.id
    };

    try {
        await publishPeertubeVideo(importData);
        showToast('Peertube video imported successfully!', 'success');
        console.log('[Peertube] import success:', importData.url, importData.magnet);
        setTimeout(() => {
            resetPeertubeImportForm();
            hidePeertubeModal();
            navigateTo('/my-videos');
        }, 1500);
    } catch (error) {
        console.error('Peertube import failed:', error);
        showToast(error.message || 'Failed to import Peertube video.', 'error');
    }
}

function finalizePublishedVideoEvents(addressableEvent, legacyEvent, kind1Event) {
    const eventIds = [addressableEvent.id, legacyEvent.id, kind1Event.id];
    for (const id1 of eventIds) {
        for (const id2 of eventIds) {
            if (id1 !== id2) {
                videoEventLinks.set(id1, id2);
            }
        }
    }

    allEvents.set(addressableEvent.id, addressableEvent);
    allEvents.set(legacyEvent.id, legacyEvent);
    allEvents.set(kind1Event.id, kind1Event);
}

async function publishPeertubeVideo(importData) {
    const submitButton = document.querySelector('#peertubeImportForm button[type="submit"]');
    const buttonText = submitButton ? submitButton.textContent : '';
    if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Importing…';
    }

    setPeertubeMetaStatus('Publishing Peertube video to Nostr…', 'info');

    try {
        const videoData = await buildPeertubeVideoData(importData);
        videoData.dTag = generateVideoDTag();

        const addressableEvent = createNip71VideoEvent(videoData);
        const signedAddressableEvent = await signEvent(addressableEvent);

        const legacyNip71Event = createLegacyNip71VideoEvent(videoData);
        const signedLegacyEvent = await signEvent(legacyNip71Event);

        const kind1Event = createKind1VideoEvent(videoData, signedAddressableEvent.id);
        const signedKind1Event = await signEvent(kind1Event);

        const [addressablePublished, legacyPublished, kind1Published] = await Promise.all([
            publishEvent(signedAddressableEvent),
            publishEvent(signedLegacyEvent),
            publishEvent(signedKind1Event)
        ]);

        if (!addressablePublished && !legacyPublished && !kind1Published) {
            throw new Error('Failed to publish to any relay');
        }

        finalizePublishedVideoEvents(signedAddressableEvent, signedLegacyEvent, signedKind1Event);
        setPeertubeMetaStatus('Peertube video published successfully!', 'success');
    } catch (error) {
        setPeertubeMetaStatus(error.message || 'Failed to publish Peertube video.', 'error');
        throw error;
    } finally {
        if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = buttonText;
        }
    }
}

async function buildPeertubeVideoData(importData) {
    const metadata = importData.metadata || {};
    const primaryFile = selectPeertubePrimaryFile(metadata);
    const explicitStreamUrl = importData.streamUrl;
    const fallbackStreamUrl = primaryFile?.url || metadata.streamingUrl || metadata.streamUrl || importData.url;
    const streamUrl = explicitStreamUrl || fallbackStreamUrl;
    const fallbackSourceUrls = Array.from(new Set([
        ...(metadata.files || []).map(file => file.url).filter(Boolean),
        ...(metadata.sourceFiles || []).map(file => file.url).filter(Boolean),
        metadata.streamingUrl,
        metadata.streamUrl
    ].filter(Boolean)));
    const fallbackUrls = fallbackSourceUrls.filter(url => url !== streamUrl);
    const mirrors = fallbackUrls.map(url => ({ url }));
    const tags = (importData.tags || []).map(tag => tag.toLowerCase()).filter(tag => tag);
    if (!tags.includes('peertube')) {
        tags.push('peertube');
    }
    const duration = Math.floor(metadata.duration || primaryFile?.duration || 0);
    const size = primaryFile?.size || metadata.fileSize || 0;
    const width = primaryFile?.width || metadata.width || 0;
    const height = primaryFile?.height || metadata.height || 0;
    const hash = await derivePeertubeHash(importData, metadata, primaryFile?.sha256);
    const preview = metadata.previewUrl || metadata.snapshotUrl || '';
    const thumbnail = importData.thumbnail || metadata.snapshotUrl || metadata.thumbnail || '';

    return {
        title: importData.title,
        description: importData.description,
        url: streamUrl,
        streamUrl: streamUrl,
        thumbnail: thumbnail,
        preview: preview,
        duration: duration,
        size: size,
        type: primaryFile?.mime || metadata.mime || 'video/mp4',
        width: width,
        height: height,
        mirrors: mirrors,
        fallbackUrls: fallbackUrls,
        tags: tags,
        isNSFW: false,
        hash: hash,
        extraTags: buildPeertubeExtraTags(importData, metadata)
    };
}

function selectPeertubePrimaryFile(metadata) {
    if (!metadata) return null;

    const candidates = [];
    if (Array.isArray(metadata.files)) {
        candidates.push(...metadata.files);
    }
    if (Array.isArray(metadata.sourceFiles)) {
        candidates.push(...metadata.sourceFiles);
    }

    const validFiles = candidates.filter(file => file && file.url);
    if (!validFiles.length) {
        return null;
    }

    validFiles.sort((a, b) => {
        const widthDiff = (b.width || 0) - (a.width || 0);
        if (widthDiff !== 0) return widthDiff;
        return (b.size || 0) - (a.size || 0);
    });

    return validFiles[0];
}

function buildPeertubeExtraTags(importData, metadata) {
    const tags = [['source', 'peertube']];

    if (importData.parsedInstance) {
        tags.push(['peertube-instance', importData.parsedInstance]);
    }
    if (importData.videoId) {
        tags.push(['peertube-video-id', importData.videoId]);
    }
    if (importData.url) {
        tags.push(['peertube-watch', importData.url]);
    }
    const account = metadata.account || metadata.owner || metadata.user || null;
    let accountCreator = '';
    if (account) {
        const usernamePart = account.username || '';
        const hostPart = account.host ? `@${account.host}` : '';
        if (usernamePart || hostPart) {
            accountCreator = `${usernamePart}${hostPart}`;
        }
    }
    const creator = importData.author || accountCreator;
    if (creator) {
        tags.push(['peertube-author', creator]);
    }
    if (metadata.account?.nip05) {
        tags.push(['peertube-nip05', metadata.account.nip05]);
    }
    const normalizedPubkey = normalizeNostrPubkey(importData.nostr);
    if (normalizedPubkey) {
        tags.push(['p', normalizedPubkey]);
        tags.push(['peertube-nostr', normalizedPubkey]);
    } else if (importData.nostr) {
        tags.push(['peertube-nostr-raw', importData.nostr]);
    }

    if (importData.allowTorrent) {
        tags.push(['peertube-allow-webtorrent', 'true']);
        if (importData.magnet) {
            tags.push(['peertube-magnet', importData.magnet]);
        }
    }

    return tags;
}

function normalizeNostrPubkey(value) {
    if (!value) return null;
    const trimmed = value.trim();

    try {
        const decoded = window.NostrTools.nip19.decode(trimmed);
        if (decoded?.type === 'npub') {
            return decoded.data;
        }
        if (decoded?.type === 'nprofile' && decoded?.data?.pubkey) {
            return decoded.data.pubkey;
        }
    } catch (error) {
        // ignore
    }

    if (/^[0-9A-Fa-f]{64}$/.test(trimmed)) {
        return trimmed.toLowerCase();
    }

    return null;
}

async function derivePeertubeHash(importData, metadata, primaryHash) {
    if (primaryHash) return primaryHash;
    const candidate = metadata.hash || metadata.sha256 || metadata.videoHash || '';
    if (candidate) return candidate;

    const fallbackInput = importData.url || metadata.watchUrl || metadata.streamUrl || metadata.snapshotUrl || '';
    if (!fallbackInput) return '';

    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(fallbackInput);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hashBuffer)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    } catch (error) {
        console.error('Failed to derive Peertube hash:', error);
        return '';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const peertubeForm = document.getElementById('peertubeImportForm');
    if (peertubeForm) {
        peertubeForm.addEventListener('submit', handlePeertubeImport);
    }
});
