import React,{useContext} from 'react'
import{Routes,Route,Navigate,useLocation} from 'react-router-dom'

import{Container, Box, Text, useColorModeValue} from '@chakra-ui/react'

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
import FootballPage from './Pages/FootballPage'
import WeatherPage from './Pages/WeatherPage'
import NewsPage from './Pages/NewsPage'
import NotificationsPage from './Pages/NotificationsPage'
import ChessGamePage from './Pages/ChessGamePage'
import CallNotification from './Components/CallNotification'
import ChessChallengeNotification from './Components/ChessChallengeNotification'

const AppContent = () => {
  const location = useLocation()
  const{user}=useContext(UserContext)
  
  const isHomePage = location.pathname === "/home"
  const isMessagesPage = location.pathname === "/messages"
  // Check if current path is a user page (e.g., /username, but not /username/post/123 or other routes)
  const pathParts = location.pathname.split('/').filter(Boolean)
  const isUserPage = pathParts.length === 1 && 
                     !['sign', 'update', 'football', 'weather', 'news', 'notifications', 'chess', 'home', 'messages'].includes(pathParts[0])
  // Check if it's the current user's own page
  const isOwnUserPage = isUserPage && user && pathParts[0] === user.username

  return (
    <>
      {/* Global Call Notification - shows on all pages */}
      {user && <CallNotification />}
      
      {/* Global Chess Challenge Notification - shows on all pages */}
      {user && <ChessChallengeNotification />}
      
      {/* Header always centered at 620px - same as other pages */}
      <Container maxW="620px" px={{ base: 4, md: 6 }} position="relative" zIndex={10}>
        <Header/>
      </Container>
      
      {/* Logout button - always visible, fixed position */}
      {user && <LogOutButton/>}
      
      {/* Content container - full width for messages, centered at 620px for other pages */}
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
                <Route path="/:username" element={user ?<UserPage/> : <Navigate to="/"/>}/>
                <Route path="/" element={!user ? <Login/>  : <Navigate to="/home" />}/>
                <Route path="/sign" element={<SignUp/>}/>
                <Route path="/update" element={user ? <UpdateProfile/> : <Navigate  to="/"/>}/>
                <Route path="/football" element={<FootballPage/>} />
                <Route path="/weather" element={<WeatherPage/>} />
                <Route path="/news" element={<NewsPage/>} />
                <Route path="/notifications" element={user ? <NotificationsPage /> : <Navigate to="/" />} />
                <Route path="/chess/:opponentId" element={user ? <ChessGamePage /> : <Navigate to="/" />} />
                <Route path="/:username/post/:id" element={<PostPage/>}/>
              </Routes>
              {user && isOwnUserPage && <CreatePost/>}
            </Container>
          )}
        </>
      )}
    </>
  )
}

const App = () => {
  return <AppContent />
}

export default App
