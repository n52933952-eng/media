import React, { useState, useEffect, useContext, useCallback, useMemo } from 'react'
import {
    Box,
    Container,
    Heading,
    Text,
    Flex,
    Spinner,
    Button,
    Input,
    InputGroup,
    InputLeftElement,
    useColorModeValue,
    VStack,
    HStack,
    Wrap,
    WrapItem,
    Tag,
    TagLabel,
    TagCloseButton,
    Image,
    IconButton,
} from '@chakra-ui/react'
import { SearchIcon } from '@chakra-ui/icons'
import { UserContext } from '../context/UserContext'
import useShowToast from '../hooks/useShowToast'

const weatherCache = {
    data: null,
    timestamp: null,
    preferences: null,
    CACHE_TTL: 5 * 60 * 1000,
}

if (typeof window !== 'undefined') {
    window.weatherCache = weatherCache
}

const cityNameOf = (c) => (typeof c === 'string' ? c : c?.name)

/** OpenWeatherMap timezone offset (seconds from UTC) → h:mm am/pm in that city */
const formatCityLocalTime = (timezoneOffsetSec) => {
    if (typeof timezoneOffsetSec !== 'number' || Number.isNaN(timezoneOffsetSec)) return null
    const d = new Date(Date.now() + timezoneOffsetSec * 1000)
    let h = d.getUTCHours()
    const m = String(d.getUTCMinutes()).padStart(2, '0')
    const period = h >= 12 ? 'pm' : 'am'
    h = h % 12
    if (h === 0) h = 12
    return `${h}:${m} ${period}`
}

const getSkyPalette = (condition, timezoneOffset, colorMode = 'dark') => {
    let hour = new Date().getUTCHours()
    if (typeof timezoneOffset === 'number') {
        hour = new Date(Date.now() + timezoneOffset * 1000).getUTCHours()
    }
    const night = hour >= 19 || hour < 6
    const c = (condition || '').toLowerCase()
    const light = colorMode === 'light'

    if (light) {
        if (night) return { bg: 'linear-gradient(145deg, #1B2F4A 0%, #243B5C 100%)', text: '#F4F8FC', muted: '#A8BDD4', accent: '#5BA8E8' }
        if (c.includes('rain') || c.includes('storm')) return { bg: 'linear-gradient(145deg, #C8E0F0 0%, #D8ECF8 100%)', text: '#0F3A4E', muted: '#4A7080', accent: '#1D9BF0' }
        if (c.includes('cloud')) return { bg: 'linear-gradient(145deg, #D0E4F0 0%, #E2F0F8 100%)', text: '#16384A', muted: '#567486', accent: '#2B9FD9' }
        return { bg: 'linear-gradient(145deg, #B8DFF5 0%, #D4EEFA 100%)', text: '#0A3550', muted: '#3F6F88', accent: '#1D9BF0' }
    }

    if (night) return { bg: 'linear-gradient(145deg, #121C32 0%, #1A2A48 100%)', text: '#F0F4FA', muted: '#9AABC4', accent: '#6B9EFF' }
    if (c.includes('storm') || c.includes('thunder')) return { bg: 'linear-gradient(145deg, #151E30 0%, #223048 100%)', text: '#EEF2F8', muted: '#9AA8BE', accent: '#7EB6FF' }
    if (c.includes('rain') || c.includes('drizzle')) return { bg: 'linear-gradient(145deg, #102838 0%, #1A3C50 100%)', text: '#EAF6FC', muted: '#8FB4C8', accent: '#4DB8E8' }
    if (c.includes('snow')) return { bg: 'linear-gradient(145deg, #162430 0%, #223848 100%)', text: '#F2F7FB', muted: '#A0B4C4', accent: '#A8D4F0' }
    if (c.includes('cloud')) return { bg: 'linear-gradient(145deg, #132833 0%, #1E3A48 100%)', text: '#EAF5FA', muted: '#8EADC0', accent: '#5CC8F0' }
    return { bg: 'linear-gradient(145deg, #0B2F48 0%, #134A66 100%)', text: '#E8F6FD', muted: '#8EC4DC', accent: '#3DB8F5' }
}

const WeatherPage = () => {
    const { user } = useContext(UserContext)
    const [activeTab, setActiveTab] = useState('my')
    const [weatherData, setWeatherData] = useState([])
    const [loading, setLoading] = useState(true)
    const [selectedCities, setSelectedCities] = useState([])
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState([])
    const [searchLoading, setSearchLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [heroCity, setHeroCity] = useState(null)
    const [clockTick, setClockTick] = useState(0)

    const showToast = useShowToast()

    useEffect(() => {
        const id = setInterval(() => setClockTick((n) => n + 1), 30000)
        return () => clearInterval(id)
    }, [])

    const pageBg = useColorModeValue('#f4f7fb', '#0b0e14')
    const surface = useColorModeValue('white', '#151a24')
    const borderColor = useColorModeValue('#dde3ec', '#2a3142')
    const textColor = useColorModeValue('gray.800', 'white')
    const muted = useColorModeValue('gray.500', 'gray.400')
    const tabTrack = useColorModeValue('#e8eef5', '#1c2230')
    const hoverRow = useColorModeValue('blackAlpha.50', 'whiteAlpha.50')
    const accent = useColorModeValue('blue.500', 'blue.300')
    const colorMode = useColorModeValue('light', 'dark')
    const primarySolid = useColorModeValue('blue.500', 'blue.400')
    const onPrimary = 'white'

    const loadPreferences = useCallback(async () => {
        if (!user) {
            setSelectedCities([])
            return []
        }
        try {
            const baseUrl = import.meta.env.PROD ? window.location.origin : 'http://localhost:5000'
            const res = await fetch(`${baseUrl}/api/weather/preferences`, {
                credentials: 'include',
                cache: 'no-cache',
            })
            const data = await res.json()
            if (res.ok) {
                const list = data.cities || data.selectedCities || []
                setSelectedCities(Array.isArray(list) ? list : [])
                return list
            }
            setSelectedCities([])
            return []
        } catch (error) {
            console.error('Error loading preferences:', error)
            return []
        }
    }, [user])

    const fetchWeather = useCallback(async (silent = false) => {
        try {
            const baseUrl = import.meta.env.PROD ? window.location.origin : 'http://localhost:5000'
            const now = Date.now()

            if (
                weatherCache.data &&
                weatherCache.timestamp &&
                now - weatherCache.timestamp < weatherCache.CACHE_TTL
            ) {
                setWeatherData(weatherCache.data)
                if (!silent) setLoading(false)
                return
            }

            if (!silent) setLoading(true)

            const res = await fetch(`${baseUrl}/api/weather?limit=50`, { credentials: 'include' })
            const data = await res.json()

            if (res.ok && data.weather) {
                weatherCache.data = data.weather || []
                weatherCache.timestamp = now
                setWeatherData(data.weather || [])
            } else if (!silent) {
                showToast('Error', 'Failed to load weather data', 'error')
            }
        } catch (error) {
            console.error('Error fetching weather:', error)
            if (!silent) showToast('Error', 'Failed to load weather', 'error')
        } finally {
            if (!silent) setLoading(false)
        }
    }, [showToast])

    useEffect(() => {
        loadPreferences()
    }, [loadPreferences])

    useEffect(() => {
        fetchWeather()
    }, [fetchWeather])

    const handleSearch = async (query) => {
        setSearchQuery(query)
        if (query.trim().length < 2) {
            setSearchResults([])
            return
        }
        setSearchLoading(true)
        try {
            const baseUrl = import.meta.env.PROD ? window.location.origin : 'http://localhost:5000'
            const res = await fetch(
                `${baseUrl}/api/weather/search?query=${encodeURIComponent(query)}`,
                { credentials: 'include' },
            )
            const data = await res.json()
            if (res.ok && data.cities) setSearchResults(data.cities)
        } catch (error) {
            console.error('Error searching cities:', error)
            showToast('Error', 'Failed to search cities', 'error')
        } finally {
            setSearchLoading(false)
        }
    }

    const isSelected = (name, country) =>
        selectedCities.some((c) => {
            if (typeof c === 'string') return c === name
            return c.name === name && (!country || !c.country || c.country === country)
        })

    const handleAddCity = (city) => {
        if (!user) {
            showToast('Error', 'Please login to save preferences', 'error')
            return
        }
        if (selectedCities.length >= 10) {
            showToast('Info', 'Maximum 10 cities allowed', 'info')
            return
        }
        if (isSelected(city.name, city.country)) {
            showToast('Info', 'City already added', 'info')
            return
        }
        setSelectedCities((prev) => [...prev, city])
        setSearchQuery('')
        setSearchResults([])
    }

    const handleRemoveCity = (name) => {
        setSelectedCities((prev) => prev.filter((c) => cityNameOf(c) !== name))
    }

    const handleSavePreferences = async () => {
        if (!user) {
            showToast('Error', 'Please login to save preferences', 'error')
            return
        }
        setSaving(true)
        try {
            const baseUrl = import.meta.env.PROD ? window.location.origin : 'http://localhost:5000'
            const res = await fetch(`${baseUrl}/api/weather/preferences`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ cities: selectedCities }),
            })
            const data = await res.json()
            if (res.ok) {
                showToast(
                    'Success',
                    selectedCities.length === 0
                        ? 'All cities cleared'
                        : 'Your cities have been saved.',
                    'success',
                )
                if (window.weatherCache) {
                    window.weatherCache.data = null
                    window.weatherCache.timestamp = null
                    window.weatherCache.preferences = null
                }
                try {
                    Object.keys(localStorage).forEach((key) => {
                        if (key.startsWith('weatherCache_')) localStorage.removeItem(key)
                    })
                } catch (_) {}
                window.dispatchEvent(
                    new CustomEvent('weatherPreferencesUpdated', { detail: { cities: selectedCities } }),
                )
                await fetchWeather(true)
                await loadPreferences()
            } else {
                showToast('Error', data.error || 'Failed to save preferences', 'error')
            }
        } catch (error) {
            console.error('Error saving preferences:', error)
            showToast('Error', 'Failed to save preferences', 'error')
        } finally {
            setSaving(false)
        }
    }

    const getWeatherIcon = (iconCode, timezoneOffset) => {
        let code = iconCode || '01d'
        if (typeof timezoneOffset === 'number') {
            const h = new Date(Date.now() + timezoneOffset * 1000).getUTCHours()
            const isNight = h >= 19 || h < 6
            code = isNight ? String(code).replace(/d$/i, 'n') : String(code).replace(/n$/i, 'd')
        }
        return `https://openweathermap.org/img/wn/${code}@2x.png`
    }

    const myWeather = useMemo(() => {
        const names = new Set(selectedCities.map(cityNameOf).filter(Boolean))
        if (!names.size) return []
        const byName = new Map()
        for (const w of weatherData) {
            const city = w.location?.city
            if (city && names.has(city)) byName.set(city, w)
        }
        const ordered = []
        for (const c of selectedCities) {
            const hit = byName.get(cityNameOf(c))
            if (hit) ordered.push(hit)
        }
        return ordered
    }, [weatherData, selectedCities])

    useEffect(() => {
        if (!myWeather.length) {
            setHeroCity(null)
            return
        }
        const still =
            heroCity &&
            myWeather.some((w) => w.location?.city === heroCity)
        if (!still) setHeroCity(myWeather[0].location?.city)
    }, [myWeather, heroCity])

    const hero =
        myWeather.find((w) => w.location?.city === heroCity) || myWeather[0] || null
    const rest = myWeather.filter((w) => w.location?.city !== hero?.location?.city)
    const heroLocalTime = useMemo(
        () => formatCityLocalTime(hero?.location?.timezoneOffset),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [hero?.location?.timezoneOffset, clockTick],
    )
    const heroPalette = useMemo(
        () =>
            getSkyPalette(
                hero?.current?.condition?.description || hero?.current?.condition?.main,
                hero?.location?.timezoneOffset,
                colorMode,
            ),
        [
            hero?.current?.condition?.description,
            hero?.current?.condition?.main,
            hero?.location?.timezoneOffset,
            colorMode,
        ],
    )

    const TabButton = ({ id, label }) => {
        const active = activeTab === id
        return (
            <Button
                flex={1}
                size="sm"
                variant="ghost"
                bg={active ? primarySolid : 'transparent'}
                color={active ? onPrimary : muted}
                fontWeight={active ? '700' : '600'}
                borderRadius="11px"
                h="40px"
                onClick={() => {
                    setActiveTab(id)
                    if (id === 'my') void fetchWeather(true)
                }}
                _hover={{ bg: active ? primarySolid : hoverRow }}
                _active={{ bg: active ? primarySolid : hoverRow }}
            >
                {label}
            </Button>
        )
    }

    return (
        <Box minH="100vh" bg={pageBg}>
            <Container maxW="720px" py={{ base: 5, md: 8 }} px={{ base: 4, md: 6 }}>
                <VStack spacing={5} align="stretch">
                    <Flex align="center" justify="space-between" gap={3}>
                        <Box>
                            <HStack spacing={3} align="center">
                                <IconButton
                                    aria-label="Refresh weather"
                                    icon={<Text fontSize="lg">↻</Text>}
                                    size="sm"
                                    variant="outline"
                                    borderRadius="full"
                                    borderColor={borderColor}
                                    color={accent}
                                    isLoading={loading}
                                    onClick={() => fetchWeather(false)}
                                />
                                <Heading size="lg" color={textColor} letterSpacing="-0.02em">
                                    Weather
                                </Heading>
                            </HStack>
                            <Text mt={1} ml="46px" fontSize="sm" color={muted}>
                                {user
                                    ? `${selectedCities.length}/10 cities selected`
                                    : 'Sign in to build your personal city list'}
                            </Text>
                        </Box>
                    </Flex>

                    <Flex
                        p="4px"
                        bg={tabTrack}
                        borderRadius="14px"
                        gap={1}
                        borderWidth="1px"
                        borderColor={borderColor}
                    >
                        <TabButton id="my" label="My Weather" />
                        <TabButton id="cities" label="Cities" />
                    </Flex>

                    {activeTab === 'my' ? (
                        loading ? (
                            <Flex justify="center" py={16}>
                                <Spinner size="lg" color={accent} />
                            </Flex>
                        ) : !user ? (
                            <Box
                                bg={surface}
                                borderWidth="1px"
                                borderColor={borderColor}
                                borderRadius="16px"
                                p={8}
                                textAlign="center"
                            >
                                <Text color={textColor} fontWeight="600" mb={2}>
                                    Sign in to see your weather
                                </Text>
                                <Text color={muted} fontSize="sm">
                                    Save up to 10 cities and view live conditions here.
                                </Text>
                            </Box>
                        ) : myWeather.length === 0 ? (
                            <Box
                                bg={surface}
                                borderWidth="1px"
                                borderColor={borderColor}
                                borderRadius="16px"
                                p={8}
                                textAlign="center"
                            >
                                <Text color={textColor} fontWeight="600" mb={2}>
                                    No cities yet
                                </Text>
                                <Text color={muted} fontSize="sm" mb={5}>
                                    Add cities to see live conditions in one place.
                                </Text>
                                <Button colorScheme="blue" onClick={() => setActiveTab('cities')}>
                                    Add cities
                                </Button>
                            </Box>
                        ) : (
                            <VStack spacing={4} align="stretch">
                                {hero && (
                                    <Box
                                        style={{ background: heroPalette.bg }}
                                        borderRadius="20px"
                                        px={{ base: 5, md: 7 }}
                                        py={{ base: 6, md: 8 }}
                                        borderWidth="1px"
                                        borderColor={borderColor}
                                        position="relative"
                                        overflow="hidden"
                                    >
                                        <Box
                                            position="absolute"
                                            top={0}
                                            left={0}
                                            right={0}
                                            h="4px"
                                            bg={heroPalette.accent}
                                        />
                                        <Text fontSize="sm" fontWeight="600" color={heroPalette.muted} mb={2}>
                                            {hero.location?.city}
                                            {hero.location?.country ? `, ${hero.location.country}` : ''}
                                            {heroLocalTime ? ` · Time: ${heroLocalTime}` : ''}
                                        </Text>
                                        <HStack align="flex-end" spacing={3}>
                                            <Text
                                                fontSize={{ base: '5xl', md: '6xl' }}
                                                fontWeight="300"
                                                color={heroPalette.text}
                                                lineHeight="1"
                                                letterSpacing="-0.04em"
                                            >
                                                {Math.round(hero.current?.temperature ?? 0)}°
                                            </Text>
                                            {hero.current?.condition?.icon && (
                                                <Flex
                                                    align="center"
                                                    justify="center"
                                                    boxSize="56px"
                                                    borderRadius="full"
                                                    bg="whiteAlpha.200"
                                                    mb={1}
                                                >
                                                    <Image
                                                    src={getWeatherIcon(
                                                        hero.current.condition.icon,
                                                        hero.location?.timezoneOffset,
                                                    )}
                                                    alt=""
                                                    boxSize="48px"
                                                />
                                                </Flex>
                                            )}
                                        </HStack>
                                        <Text
                                            mt={3}
                                            fontSize="md"
                                            color={heroPalette.text}
                                            textTransform="capitalize"
                                            fontWeight="500"
                                        >
                                            {hero.current?.condition?.description ||
                                                hero.current?.condition?.main}
                                        </Text>
                                        <HStack mt={4} spacing={2} flexWrap="wrap">
                                            <Box
                                                px={3}
                                                py={1.5}
                                                borderRadius="full"
                                                bg="blackAlpha.300"
                                            >
                                                <Text fontSize="sm" fontWeight="600" color={heroPalette.muted}>
                                                    Humidity {hero.current?.humidity ?? 0}%
                                                </Text>
                                            </Box>
                                            <Box
                                                px={3}
                                                py={1.5}
                                                borderRadius="full"
                                                bg="blackAlpha.300"
                                            >
                                                <Text fontSize="sm" fontWeight="600" color={heroPalette.muted}>
                                                    Wind {(hero.current?.windSpeed ?? 0).toFixed(1)} m/s
                                                </Text>
                                            </Box>
                                        </HStack>
                                    </Box>
                                )}

                                {rest.map((w) => {
                                    const localTime = formatCityLocalTime(w.location?.timezoneOffset)
                                    const rowPalette = getSkyPalette(
                                        w.current?.condition?.description || w.current?.condition?.main,
                                        w.location?.timezoneOffset,
                                        colorMode,
                                    )
                                    return (
                                    <Flex
                                        key={w._id || w.location?.city}
                                        as="button"
                                        type="button"
                                        onClick={() => setHeroCity(w.location?.city)}
                                        align="center"
                                        justify="space-between"
                                        bg={surface}
                                        borderWidth="1px"
                                        borderColor={borderColor}
                                        borderRadius="16px"
                                        px={4}
                                        py={3.5}
                                        textAlign="left"
                                        gap={3}
                                        _hover={{ bg: hoverRow, borderColor: rowPalette.accent }}
                                        transition="all 0.15s"
                                    >
                                        <Box
                                            w="4px"
                                            alignSelf="stretch"
                                            borderRadius="full"
                                            bg={rowPalette.accent}
                                            flexShrink={0}
                                        />
                                        <Box flex="1">
                                            <Text fontWeight="700" color={textColor}>
                                                {w.location?.city}
                                            </Text>
                                            <Text fontSize="sm" color={muted} textTransform="capitalize">
                                                {w.current?.condition?.description ||
                                                    w.current?.condition?.main}
                                                {localTime ? ` · Time: ${localTime}` : ''}
                                            </Text>
                                        </Box>
                                        <HStack spacing={2}>
                                            {w.current?.condition?.icon && (
                                                <Flex
                                                    align="center"
                                                    justify="center"
                                                    boxSize="40px"
                                                    borderRadius="full"
                                                    bg="blackAlpha.100"
                                                    _dark={{ bg: 'whiteAlpha.200' }}
                                                >
                                                    <Image
                                                    src={getWeatherIcon(
                                                        w.current.condition.icon,
                                                        w.location?.timezoneOffset,
                                                    )}
                                                    alt=""
                                                    boxSize="36px"
                                                />
                                                </Flex>
                                            )}
                                            <Text fontSize="xl" fontWeight="700" color={rowPalette.accent}>
                                                {Math.round(w.current?.temperature ?? 0)}°
                                            </Text>
                                        </HStack>
                                    </Flex>
                                    )
                                })}
                            </VStack>
                        )
                    ) : (
                        <Box
                            bg={surface}
                            borderWidth="1px"
                            borderColor={borderColor}
                            borderRadius="16px"
                            p={{ base: 4, md: 5 }}
                        >
                            {!user ? (
                                <Text color={muted} fontSize="sm">
                                    Sign in to search and save cities.
                                </Text>
                            ) : (
                                <VStack spacing={4} align="stretch">
                                    <Text fontSize="sm" color={muted}>
                                        Search and add up to 10 cities, then save.
                                    </Text>

                                    {selectedCities.length > 0 && (
                                        <Box>
                                            <Text fontSize="xs" fontWeight="700" color={muted} mb={2}>
                                                SELECTED
                                            </Text>
                                            <Wrap spacing={2}>
                                                {selectedCities.map((c, i) => {
                                                    const name = cityNameOf(c)
                                                    return (
                                                        <WrapItem key={`${name}-${i}`}>
                                                            <Tag
                                                                size="md"
                                                                borderRadius="full"
                                                                variant="subtle"
                                                                colorScheme="gray"
                                                            >
                                                                <TagLabel>{name}</TagLabel>
                                                                <TagCloseButton
                                                                    onClick={() => handleRemoveCity(name)}
                                                                />
                                                            </Tag>
                                                        </WrapItem>
                                                    )
                                                })}
                                            </Wrap>
                                        </Box>
                                    )}

                                    <InputGroup size="lg">
                                        <InputLeftElement pointerEvents="none">
                                            <SearchIcon color="gray.400" />
                                        </InputLeftElement>
                                        <Input
                                            placeholder="Search city…"
                                            value={searchQuery}
                                            onChange={(e) => handleSearch(e.target.value)}
                                            borderRadius="12px"
                                            bg={pageBg}
                                            borderColor={borderColor}
                                        />
                                    </InputGroup>

                                    {searchLoading && (
                                        <Flex justify="center" py={2}>
                                            <Spinner size="sm" />
                                        </Flex>
                                    )}

                                    {searchResults.length > 0 && (
                                        <VStack align="stretch" spacing={0} maxH="280px" overflowY="auto">
                                            {searchResults.map((city, index) => {
                                                const selected = isSelected(city.name, city.country)
                                                return (
                                                    <Flex
                                                        key={`${city.name}-${city.country}-${index}`}
                                                        py={3}
                                                        px={1}
                                                        borderBottomWidth="1px"
                                                        borderColor={borderColor}
                                                        justify="space-between"
                                                        align="center"
                                                        _hover={{ bg: hoverRow }}
                                                    >
                                                        <Box>
                                                            <Text fontSize="sm" fontWeight="600" color={textColor}>
                                                                {city.name}
                                                                {city.country ? `, ${city.country}` : ''}
                                                            </Text>
                                                            {city.state && (
                                                                <Text fontSize="xs" color={muted}>
                                                                    {city.state}
                                                                </Text>
                                                            )}
                                                        </Box>
                                                        <Button
                                                            size="xs"
                                                            variant={selected ? 'ghost' : 'solid'}
                                                            colorScheme={selected ? 'gray' : 'blue'}
                                                            onClick={() =>
                                                                selected
                                                                    ? handleRemoveCity(city.name)
                                                                    : handleAddCity(city)
                                                            }
                                                            isDisabled={!selected && selectedCities.length >= 10}
                                                        >
                                                            {selected ? 'Remove' : 'Add'}
                                                        </Button>
                                                    </Flex>
                                                )
                                            })}
                                        </VStack>
                                    )}

                                    {searchQuery.trim().length >= 2 &&
                                        !searchLoading &&
                                        searchResults.length === 0 && (
                                            <Text fontSize="sm" color={muted} textAlign="center" py={4}>
                                                No cities found for “{searchQuery}”
                                            </Text>
                                        )}

                                    <Flex justify="space-between" align="center" pt={1}>
                                        <Text fontSize="sm" color={muted}>
                                            {selectedCities.length}/10 cities
                                        </Text>
                                        <Button
                                            colorScheme="blue"
                                            onClick={handleSavePreferences}
                                            isLoading={saving}
                                        >
                                            {selectedCities.length === 0
                                                ? 'Clear all cities'
                                                : `Save cities · ${selectedCities.length}/10`}
                                        </Button>
                                    </Flex>
                                </VStack>
                            )}
                        </Box>
                    )}
                </VStack>
            </Container>
        </Box>
    )
}

export default WeatherPage
