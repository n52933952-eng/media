// Live Channels Configuration
// YouTube live streams exposed in the app (verified working; others removed for playback / policy issues)

export const LIVE_CHANNELS = [
    {
        id: 'aljazeera',
        name: 'Al Jazeera',
        username: 'AlJazeera',
        category: 'news',
        logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/f/f1/Al_Jazeera_English_logo.svg/1200px-Al_Jazeera_English_logo.svg.png',
        bio: '🔴 Live news 24/7',
        streams: [
            {
                language: 'english',
                name: 'English',
                youtubeId: 'gCNeDWCI0vo',
                text: '🔴 Al Jazeera English - Live Stream\n\nWatch live news coverage 24/7',
                buttonColor: 'red'
            },
            {
                language: 'arabic',
                name: 'العربية',
                youtubeId: 'bNyUyrR0PHo',
                text: '🔴 الجزيرة مباشر - البث المباشر\n\nتابع الأخبار العاجلة على مدار الساعة',
                buttonColor: 'purple'
            }
        ]
    },
    {
        id: 'fox11',
        name: 'Fox 11',
        username: 'Fox11',
        category: 'news',
        logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/6/6a/KTTV_2020.svg/200px-KTTV_2020.svg.png',
        bio: '🔴 Live news from Los Angeles',
        streams: [
            {
                language: 'english',
                name: 'Watch Live',
                youtubeId: '8u8pQ_uLGjo',
                text: '🔴 Fox 11 - Live Stream\n\nBreaking news and live coverage from Los Angeles',
                buttonColor: 'blue'
            }
        ]
    },
    {
        id: 'cartoonito',
        name: 'Cartoonito',
        username: 'Cartoonito',
        category: 'kids',
        logo: 'https://via.placeholder.com/200x200/9B59B6/FFFFFF?text=Cartoonito',
        bio: '🔴 Kids cartoons and shows',
        streams: [
            {
                language: 'english',
                name: 'Watch Live',
                youtubeId: 'XfZetbS9084',
                text: '🔴 Cartoonito - Live Stream\n\nKids cartoons and entertainment',
                buttonColor: 'purple'
            }
        ]
    },
    {
        id: 'sky-news',
        name: 'Sky News',
        username: 'SkyNews',
        category: 'news',
        logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/5/5a/Sky_News_logo.svg/200px-Sky_News_logo.svg.png',
        bio: '🔴 Live news from the UK',
        streams: [
            {
                language: 'english',
                name: 'Watch Live',
                youtubeId: 'YDvsBbKfLPA',
                text: '🔴 Sky News - Live Stream\n\nBreaking news and live coverage from the UK',
                buttonColor: 'blue'
            }
        ]
    }
]

// Helper function to get channel by ID
export const getChannelById = (channelId) => {
    return LIVE_CHANNELS.find(channel => channel.id === channelId)
}

// Helper function to get channel by username
export const getChannelByUsername = (username) => {
    return LIVE_CHANNELS.find(channel => channel.username === username)
}

// Helper function to get all channels by category
export const getChannelsByCategory = (category) => {
    return LIVE_CHANNELS.filter(channel => channel.category === category)
}
