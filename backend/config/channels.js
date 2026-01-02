// Live Channels Configuration
// All YouTube live stream channels available in the app

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
        id: 'nbc-news',
        name: 'NBC News NOW',
        username: 'NBCNews',
        category: 'news',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/NBC_News_logo.svg/200px-NBC_News_logo.svg.png',
        bio: '🔴 Live breaking news coverage',
        streams: [
            {
                language: 'english',
                name: 'Watch Live',
                youtubeId: 'DL5ko1lz5VI',
                text: '🔴 NBC News NOW - Live Stream\n\nBreaking news and live coverage',
                buttonColor: 'blue'
            }
        ]
    },
    {
        id: 'relive',
        name: 'RELIVE',
        username: 'RELIVE',
        category: 'entertainment',
        logo: 'https://via.placeholder.com/200x200/FF6B6B/FFFFFF?text=RELIVE',
        bio: '🔴 Live entertainment stream',
        streams: [
            {
                language: 'english',
                name: 'Watch Live',
                youtubeId: '0pF6fbTX9-c',
                text: '🔴 RELIVE - Live Stream\n\nLive entertainment and content',
                buttonColor: 'red'
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
                youtubeId: 'L84qL_x_Xao',
                text: '🔴 Sky News - Live Stream\n\nBreaking news and live coverage from the UK',
                buttonColor: 'blue'
            }
        ]
    },
    {
        id: 'mst3k',
        name: 'MST3K FOREVER-a-thon',
        username: 'MST3K',
        category: 'entertainment',
        logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/8/8a/Mystery_Science_Theater_3000_logo.svg/200px-Mystery_Science_Theater_3000_logo.svg.png',
        bio: '🔴 Mystery Science Theater 3000 marathon',
        streams: [
            {
                language: 'english',
                name: 'Watch Live',
                youtubeId: 'B7qOZraAIlw',
                text: '🔴 MST3K FOREVER-a-thon - Live Stream\n\nMystery Science Theater 3000 marathon',
                buttonColor: 'purple'
            }
        ]
    },
    {
        id: 'natgeo-kids',
        name: 'Nat Geo Kids',
        username: 'NatGeoKids',
        category: 'kids',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/National_Geographic_Kids_logo.svg/200px-National_Geographic_Kids_logo.svg.png',
        bio: '🔴 Educational content for kids',
        streams: [
            {
                language: 'english',
                name: 'Watch Live',
                youtubeId: '42QyI_w6bEg',
                text: '🔴 Nat Geo Kids - Live Stream\n\nEducational and fun content for kids',
                buttonColor: 'green'
            }
        ]
    },
    {
        id: 'scishow-kids',
        name: 'SciShow Kids',
        username: 'SciShowKids',
        category: 'kids',
        logo: 'https://via.placeholder.com/200x200/3498DB/FFFFFF?text=SciShow',
        bio: '🔴 Science education for kids',
        streams: [
            {
                language: 'english',
                name: 'Watch Live',
                youtubeId: '0D--OVPUr1I',
                text: '🔴 SciShow Kids - Live Stream\n\nScience education and experiments for kids',
                buttonColor: 'blue'
            }
        ]
    },
    {
        id: 'jj-animal-time',
        name: "JJ's Animal Time LIVE!",
        username: 'JJAnimalTime',
        category: 'kids',
        logo: 'https://via.placeholder.com/200x200/FFA500/FFFFFF?text=JJ+Animals',
        bio: '🔴 Live animal content for kids',
        streams: [
            {
                language: 'english',
                name: 'Watch Live',
                youtubeId: 'dwbgawuNhCU',
                text: "🔴 JJ's Animal Time LIVE! - Live Stream\n\nFun animal content for kids",
                buttonColor: 'orange'
            }
        ]
    },
    {
        id: 'kids-arabic',
        name: 'Kids Arabic',
        username: 'KidsArabic',
        category: 'kids',
        logo: 'https://via.placeholder.com/200x200/16A085/FFFFFF?text=Kids+Arabic',
        bio: '🔴 Arabic content for kids',
        streams: [
            {
                language: 'arabic',
                name: 'Watch Live',
                youtubeId: 'Jqy2q5HTwnI',
                text: '🔴 Kids Arabic - Live Stream\n\nمحتوى عربي للأطفال',
                buttonColor: 'teal'
            }
        ]
    },
    {
        id: 'natgeo-animals',
        name: 'Nat Geo Animals',
        username: 'NatGeoAnimals',
        category: 'kids',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2e/National_Geographic_Kids_logo.svg/200px-National_Geographic_Kids_logo.svg.png',
        bio: '🔴 Animal documentaries and content',
        streams: [
            {
                language: 'english',
                name: 'Watch Live',
                youtubeId: 'THooYCltViI',
                text: '🔴 Nat Geo Animals - Live Stream\n\nAmazing animal documentaries and content',
                buttonColor: 'green'
            }
        ]
    },
    {
        id: 'mbc-drama',
        name: 'MBC Drama',
        username: 'MBCDrama',
        category: 'entertainment',
        logo: 'https://upload.wikimedia.org/wikipedia/commons/4/4a/MBC_Drama_Logo.svg',
        bio: '🔴 Arabic drama series 24/7',
        streams: [
            {
                language: 'arabic',
                name: 'Watch Live',
                youtubeId: 'eZx9oQcQAT4',
                text: '🔴 MBC Drama - Live Stream\n\nمسلسلات درامية عربية على مدار الساعة',
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
