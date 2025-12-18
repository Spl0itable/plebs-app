![Plebs Logo](https://plebs.app/images/plebs-og.png)

# Plebs

**A censorship-resistant, decentralized video platform powered by the Nostr protocol**

Plebs is a decentralized video platform built on the [Nostr](https://github.com/nostr-protocol/nostr) protocol with [Blossom](https://github.com/hzrd149/blossom) storage servers. Videos are stored across multiple servers, and creators maintain full control of their content and identity through Nostr keys.

Visit the live application at [https://plebs.app](https://plebs.app)

## Features

### Core Features
- **Decentralized Storage** - Videos stored across multiple Blossom servers with redundancy
- **Lightning Zaps** - Direct Bitcoin payments to creators on videos and comments
- **Nostr Integration** - Login via browser extension (NIP-07), Nostr Connect/Bunker (NIP-46), or private key
- **Comments** - Threaded discussions with reactions and zaps
- **Reactions** - Like and dislike videos
- **Search** - Find videos by title, description, or tags

### Video Features
- **Live Streams** - Watch and broadcast live content
- **Shorts** - Short-form video support
- **Video Downloads** - Download videos directly
- **Embeddable Player** - Embed videos on external websites
- **Video Boosting** - Boost videos with zaps to help them trend
- **Draft Saving** - Save uploads as drafts and publish later
- **Client-side Compression** - Compress large videos (up to 5GB) before upload

### User Features
- **Multi-language Support** - Available in 12 languages (English, Spanish, French, German, Portuguese, Korean, Japanese, Chinese, Turkish, Russian, Arabic, Italian)
- **Watch History** - Track viewed videos with Nostr sync
- **Liked Videos** - View all your liked content in one place
- **Following Feed** - See videos from accounts you follow
- **Notifications** - Stay updated on interactions
- **Profile Editing** - Customize your profile directly in the app
- **Account Creation** - Create new Nostr accounts with guided key backup

### Moderation & Filtering
- **Mute Users** - Hide content from specific accounts
- **Report Videos** - Flag inappropriate content
- **Content Filter Packs** - Built-in filters for profanity, spam, and custom keywords
- **NSFW Filter** - Content warnings with customizable preferences
- **Community Warnings** - Automatic detection of heavily downvoted content
- **Web of Trust Relays** - Connect to WoT relays for better spam filtering

### Customization
- **Dark/Light Mode** - Choose your preferred theme
- **Custom Blossom Servers** - Add your own upload servers
- **Premium Blossom Server** - Optional NostrMedia.com integration
- **Settings Sync** - Save preferences to Nostr across devices

### Discovery
- **Trending Videos** - Popular content from today or this week with carousel
- **Tag System** - Browse by categories (Bitcoin, Nostr, Tech, etc.)
- **Real View Counts** - Actual watched views, not just loads
- **Mobile Responsive** - Works on all devices

### Nostr Implementation Details

- **Kind 0**: User profiles
- **Kind 1**: Video posts
- **Kind 3**: Contact lists (following)
- **Kind 5**: Deletion requests
- **Kind 7**: Reactions (likes/dislikes)
- **Kind 9734**: Zap requests
- **Kind 9735**: Zap receipts
- **Kind 10063**: User server lists
- **Kind 24133**: NIP-46 Nostr Connect
- **Kind 24242**: Blossom authentication
- **Kind 30078**: Application data (settings sync)

## Contributing

Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contact

Created by [21 Million LLC](https://nostrservices.com)
