![Plebs Logo](https://plebs.app/images/plebs-og.png)

# Plebs

**An uncensorable, decentralized video platform powered by the Nostr protocol**

Plebs is a revolutionary video platform that leverages the [Nostr](https://github.com/nostr-protocol/nostr) protocol and [Blossom](https://github.com/hzrd149/blossom) storage servers to create a truly decentralized and censorship-resistant video sharing experience. Built with privacy and freedom of expression at its core, Plebs ensures that content creators maintain full control over their videos.

## Features

### Core Features
- **Decentralized Storage** - Videos stored on multiple Blossom servers
- **Lightning Zaps** - Direct Bitcoin payments to content creators  
- **Nostr Integration** - Login with your Nostr identity (NIP-07)
- **Comments** - Engage through threaded integration
- **Reactions** - Like and dislike videos
- **Search** - Find videos by title, description, or tags

### Advanced Features
- **Trending Videos** - Discover popular content from today or this week
- **Subscriptions** - See videos from who you follow
- **Tag System** - Browse by categories (Bitcoin, Nostr, Tech, etc.)
- **Dark/Light Mode** - Choose your preferred theme
- **Mobile Responsive** - Works on all devices
- **NSFW Filter** - Content warnings with customizable preferences
- **Community Warnings** - Automatic detection of heavily downvoted "ratioed" content

## Demo

Visit the live application at [https://plebs.app](https://plebs.app)

### Nostr Implementation Details

- **Kind 0**: User profiles
- **Kind 3**: Contact lists (following)
- **Kind 5**: Video deletion requests
- **Kind 7**: Video reactions (likes/dislikes)
- **Kind 1**: Normal post content
- **Kind 9734**: Zap requests
- **Kind 9735**: Zap receipts
- **Kind 10063**: User server lists
- **Kind 24242**: Blossom authentication

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

Created by [@Luxas](https://nostr.band/npub16jdfqgazrkapk0yrqm9rdxlnys7ck39c7zmdzxtxqlmmpxg04r0sd733sv)