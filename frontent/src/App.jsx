import React,{useContext,useState,useEffect} from 'react'
import{Routes,Route,Navigate,useLocation,useNavigate} from 'react-router-dom'
import { FaArrowUp } from 'react-icons/fa'
import{SocketContext} from './context/SocketContext'

import{Container, Box, Text, useColorModeValue, useColorMode} from '@chakra-ui/react'

import UserPage from './Pages/UserPage'
import PostPage from './Pages/PostPage'
import Header from './Components/Header'
import Login from './Pages/Login'
import SignUp from './Pages/SignUp'
import{UserContext} from './context/UserContext'
import HomePage from './Pages/HomePage'
import LogOutButton from './Components/LogOutButton'
import UpdateProfile from './Pages/UpdatProile'
import CreatePost from './Components/CreatePost'
import MessagesPage from './Pages/MessagesPage'
import LiveStreamPage from './Pages/LiveStreamPage'
import FootballPage from './Pages/FootballPage'
import WeatherPage from './Pages/WeatherPage'
import NewsPage from './Pages/NewsPage'
import NotificationsPage from './Pages/NotificationsPage'
import ChessGamePage from './Pages/ChessGamePage'
import CardGamePage from './Pages/CardGamePage'
import RacingGamePage from './Pages/RacingGamePage'
import CallNotification from './Components/CallNotification'
import LiveKitCallUI from './Components/LiveKitCallUI'
import GroupCallUI from './Components/GroupCallUI'
import ChessChallengeNotification from './Components/ChessChallengeNotification'
import CardChallengeNotification from './Components/CardChallengeNotification'
import RacingChallengeNotification from './Components/RacingChallengeNotification'
import PrivacyPolicy from './Pages/PrivacyPolicy'
import TermsOfService from './Pages/TermsOfService'
import WelcomePage from './Pages/WelcomePage'
import CookieConsentBanner from './Components/CookieConsentBanner'
import AdSenseLoader from './Components/AdSenseLoader'

const AppContent = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const{user}=useContext(UserContext)
  const { socket } = useContext(SocketContext) || {}
  const { colorMode } = useColorMode()

  const [isScrolled, setIsScrolled] = useState(false)
  const [showScrollTop, setShowScrollTop] = useState(false)

  // Persistent listener: when the person WE challenged accepts, navigate to the race
  useEffect(() => {
    if (!socket || !user) return
    const handleRaceAccepted = (data) => {
      if (!data?.roomId || !data?.opponentId) return
      const pendingTo = localStorage.getItem('racePendingTo')
      const opId = data.opponentId?.toString()
      if (pendingTo && pendingTo === opId) {
        localStorage.removeItem('racePendingTo')
        localStorage.setItem('raceRoomId', data.roomId)
        // Mark this user as the host (challenger) so RacingGamePage knows
        localStorage.setItem('raceIsHost', 'true')
        navigate(`/race/${opId}`)
      }
    }
    socket.on('acceptRaceChallenge', handleRaceAccepted)
    return () => socket.off('acceptRaceChallenge', handleRaceAccepted)
  }, [socket, user, navigate])

  useEffect(() => {
    const handleScroll = () => {
      const y = window.scrollY
      setIsScrolled(y > 50)
      setShowScrollTop(y > 300)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const isHomePage = location.pathname === "/home"
  const isMessagesPage = location.pathname === "/messages"
  const isRacePage = location.pathname.startsWith("/race/")
  // Check if current path is a user page (e.g., /username, but not /username/post/123 or other routes)
  const pathParts = location.pathname.split('/').filter(Boolean)
  const isUserPage = pathParts.length === 1 &&
                     !['sign', 'update', 'football', 'weather', 'news', 'notifications', 'chess', 'card', 'race', 'home', 'messages', 'welcome', 'privacy', 'terms'].includes(pathParts[0])
  // Check if it's the current user's own page
  const isOwnUserPage = isUserPage && user && pathParts[0] === user.username

  return (
    <>
      <AdSenseLoader />
      <CookieConsentBanner />
      {/* Global Call Notification - shows on all pages */}
      {user && <CallNotification />}
      {user && <LiveKitCallUI />}
      {user && <GroupCallUI />}
      
      {/* Global Chess Challenge Notification - shows on all pages */}
      {user && <ChessChallengeNotification />}
      
      {/* Global Card (Go Fish) Challenge Notification - shows on all pages */}
      {user && <CardChallengeNotification />}

      {/* Global Racing Challenge Notification - shows on all pages */}
      {user && <RacingChallengeNotification />}
      
      {/* Fixed header — always stays at top regardless of parent overflow */}
      <Box
        position="fixed"
        top={0}
        left={0}
        right={0}
        zIndex={100}
        bg={
          isScrolled
            ? colorMode === 'dark'
              ? 'rgba(16,16,16,0.92)'
              : 'rgba(255,255,255,0.92)'
            : colorMode === 'dark'
              ? '#101010'
              : 'white'
        }
        backdropFilter={isScrolled ? 'blur(12px)' : 'none'}
        boxShadow={isScrolled ? '0 1px 14px rgba(0,0,0,0.18)' : 'none'}
        transition="background 0.25s ease, box-shadow 0.25s ease"
      >
        <Container maxW="620px" px={{ base: 4, md: 6 }} position="relative">
          <Header/>
        </Container>
      </Box>
      {/* Spacer to push page content below the fixed header (~72px = py-4 top+bottom + icon height) */}
      <Box h="72px" />
      
      {/* Logout button - always visible, fixed position */}
      {user && <LogOutButton/>}
      
      {/* Content: full-bleed messages / race; centered column for the rest */}
      {isMessagesPage ? (
        <>
          <Box 
            w="100%"
            h="calc(100vh - 80px)"
            position="fixed"
            top="80px"
            left="0"
            right="0"
            bg={useColorModeValue('white', '#101010')}
            zIndex={1}
          >
            <Routes>
              <Route path="/messages" element={user ? <MessagesPage/> : <Navigate to="/" />} />
            </Routes>
          </Box>
        </>
      ) : isRacePage ? (
        <Box
          position="fixed"
          top="72px"
          left="0"
          right="0"
          bottom="0"
          w="100%"
          maxW="100%"
          m={0}
          p={0}
          zIndex={1}
          overflow="hidden"
          bg="#000"
          display="flex"
          flexDirection="column"
          overscrollBehavior="none"
          sx={{
            touchAction: 'none',
            '& > *': { flex: 1, minH: 0, minW: 0, display: 'flex', flexDirection: 'column' },
          }}
        >
          <Routes>
            <Route path="/race/:opponentId" element={user ? <RacingGamePage /> : <Navigate to="/" />} />
          </Routes>
        </Box>
      ) : (
        <>
          {/* HomePage needs wider container for 3-column layout (Football | Feed | Suggested Users) */}
          {isHomePage ? (
            <Container maxW="1400px" px={{ base: 4, md: 6, lg: 8 }}>
              <Routes>
                <Route path="/home" element={user ? <HomePage/> : <Navigate to="/" />} />
              </Routes>
            </Container>
          ) : (
            <Container maxW="620px" px={{ base: 4, md: 6 }}>
              <Routes>
                <Route path="/welcome" element={<WelcomePage />} />
                <Route path="/privacy" element={<PrivacyPolicy />} />
                <Route path="/terms" element={<TermsOfService />} />
                <Route path="/:username" element={user ?<UserPage/> : <Navigate to="/"/>}/>
                <Route path="/" element={!user ? <Login/>  : <Navigate to="/home" />}/>
                <Route path="/sign" element={<SignUp/>}/>
                <Route path="/update" element={user ? <UpdateProfile/> : <Navigate  to="/"/>}/>
                <Route path="/football" element={<FootballPage/>} />
                <Route path="/weather" element={<WeatherPage/>} />
                <Route path="/news" element={<NewsPage/>} />
                <Route path="/notifications" element={user ? <NotificationsPage /> : <Navigate to="/" />} />
                <Route path="/chess/:opponentId" element={user ? <ChessGamePage /> : <Navigate to="/" />} />
                <Route path="/card/:opponentId" element={user ? <CardGamePage /> : <Navigate to="/" />} />
                <Route path="/live/broadcast" element={user ? <LiveStreamPage /> : <Navigate to="/" />} />
                <Route path="/live/:streamerId" element={user ? <LiveStreamPage /> : <Navigate to="/" />} />
                <Route path="/:username/post/:id" element={<PostPage/>}/>
              </Routes>
              {user && isOwnUserPage && <CreatePost/>}
            </Container>
          )}
        </>
      )}

      {/* Scroll-to-top button — appears after scrolling 300px, instant jump */}
      {showScrollTop && (
        <Box
          as="button"
          position="fixed"
          bottom="100px"
          right="20px"
          zIndex={200}
          onClick={() => window.scrollTo({ top: 0, behavior: 'instant' })}
          bg={colorMode === 'dark' ? 'whiteAlpha.200' : 'blackAlpha.100'}
          _hover={{ bg: colorMode === 'dark' ? 'whiteAlpha.300' : 'blackAlpha.200', transform: 'scale(1.1)' }}
          borderRadius="full"
          p={3}
          boxShadow="lg"
          transition="all 0.2s ease"
          aria-label="Back to top"
        >
          <FaArrowUp size={18} />
        </Box>
      )}
    </>
  )
}

const App = () => {
  return <AppContent />
}

export default App
