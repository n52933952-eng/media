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

/** OpenWeatherMap timezone offset (seconds from UTC) → HH:mm in that city */
const formatCityLocalTime = (timezoneOffsetSec) => {
    if (typeof timezoneOffsetSec !== 'number' || Number.isNaN(timezoneOffsetSec)) return null
    const d = new Date(Date.now() + timezoneOffsetSec * 1000)
    const h = String(d.getUTCHours()).padStart(2, '0')
    const m = String(d.getUTCMinutes()).padStart(2, '0')
    return `${h}:${m}`
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

    const pageBg = useColorModeValue('#f6f7f9', '#0f1219')
    const surface = useColorModeValue('white', '#1a1f2e')
    const borderColor = useColorModeValue('#e4e7ec', '#2a3142')
    const textColor = useColorModeValue('gray.800', 'white')
    const muted = useColorModeValue('gray.500', 'gray.400')
    const tabTrack = useColorModeValue('#eceef2', '#252b3b')
    const hoverRow = useColorModeValue('gray.50', 'whiteAlpha.50')
    const accent = useColorModeValue('blue.600', 'blue.300')

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
        if (selectedCities.length === 0) {
            showToast('Info', 'Select at least one city', 'info')
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
                showToast('Success', 'Your cities have been saved.', 'success')
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
                setActiveTab('my')
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

    const getWeatherIcon = (iconCode) =>
        `https://openweathermap.org/img/wn/${iconCode}@2x.png`

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

    const TabButton = ({ id, label }) => (
        <Button
            flex={1}
            size="sm"
            variant="ghost"
            bg={activeTab === id ? surface : 'transparent'}
            color={activeTab === id ? textColor : muted}
            fontWeight={activeTab === id ? '700' : '600'}
            borderRadius="10px"
            onClick={() => setActiveTab(id)}
            _hover={{ bg: activeTab === id ? surface : hoverRow }}
        >
            {label}
        </Button>
    )

    return (
        <Box minH="100vh" bg={pageBg}>
            <Container maxW="720px" py={{ base: 5, md: 8 }} px={{ base: 4, md: 6 }}>
                <VStack spacing={5} align="stretch">
                    <Box>
                        <Heading size="lg" color={textColor} letterSpacing="-0.02em">
                            Weather
                        </Heading>
                        <Text mt={1} fontSize="sm" color={muted}>
                            {user
                                ? `${selectedCities.length}/10 cities selected`
                                : 'Sign in to build your personal city list'}
                        </Text>
                    </Box>

                    <Flex p="3px" bg={tabTrack} borderRadius="12px" gap={1}>
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
                                        bg={surface}
                                        borderWidth="1px"
                                        borderColor={borderColor}
                                        borderRadius="16px"
                                        px={{ base: 5, md: 7 }}
                                        py={{ base: 6, md: 8 }}
                                    >
                                        <Text fontSize="sm" fontWeight="600" color={muted} mb={2}>
                                            {hero.location?.city}
                                            {hero.location?.country ? `, ${hero.location.country}` : ''}
                                            {heroLocalTime ? ` · ${heroLocalTime}` : ''}
                                        </Text>
                                        <HStack align="flex-end" spacing={3}>
                                            <Text
                                                fontSize={{ base: '5xl', md: '6xl' }}
                                                fontWeight="300"
                                                color={textColor}
                                                lineHeight="1"
                                                letterSpacing="-0.04em"
                                            >
                                                {Math.round(hero.current?.temperature ?? 0)}°
                                            </Text>
                                            {hero.current?.condition?.icon && (
                                                <Image
                                                    src={getWeatherIcon(hero.current.condition.icon)}
                                                    alt=""
                                                    boxSize="56px"
                                                    mb={1}
                                                />
                                            )}
                                        </HStack>
                                        <Text
                                            mt={3}
                                            fontSize="md"
                                            color={textColor}
                                            textTransform="capitalize"
                                        >
                                            {hero.current?.condition?.description ||
                                                hero.current?.condition?.main}
                                        </Text>
                                        <HStack mt={4} spacing={5} color={muted} fontSize="sm">
                                            <Text>Humidity {hero.current?.humidity ?? 0}%</Text>
                                            <Text>
                                                Wind {(hero.current?.windSpeed ?? 0).toFixed(1)} m/s
                                            </Text>
                                        </HStack>
                                    </Box>
                                )}

                                {rest.map((w) => {
                                    const localTime = formatCityLocalTime(w.location?.timezoneOffset)
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
                                        borderRadius="12px"
                                        px={4}
                                        py={3.5}
                                        textAlign="left"
                                        _hover={{ bg: hoverRow }}
                                        transition="background 0.15s"
                                    >
                                        <Box>
                                            <Text fontWeight="600" color={textColor}>
                                                {w.location?.city}
                                            </Text>
                                            <Text fontSize="sm" color={muted} textTransform="capitalize">
                                                {w.current?.condition?.description ||
                                                    w.current?.condition?.main}
                                                {localTime ? ` · ${localTime}` : ''}
                                            </Text>
                                        </Box>
                                        <HStack spacing={2}>
                                            {w.current?.condition?.icon && (
                                                <Image
                                                    src={getWeatherIcon(w.current.condition.icon)}
                                                    alt=""
                                                    boxSize="36px"
                                                />
                                            )}
                                            <Text fontSize="xl" fontWeight="600" color={textColor}>
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
                                            isDisabled={selectedCities.length === 0}
                                        >
                                            Save cities
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
