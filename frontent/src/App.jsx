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
import CallNotification from './Components/CallNotification'

const AppContent = () => {
  const location = useLocation()
  const{user}=useContext(UserContext)
  
  const isHomePage = location.pathname === "/home"
  const isMessagesPage = location.pathname === "/messages"

  return (
    <>
      {/* Global Call Notification - shows on all pages */}
      {user && <CallNotification />}
      
      {/* Header always centered at 620px - same as other pages */}
      <Container maxW="620px" px={{ base: 4, md: 6 }} position="relative" zIndex={10}>
        <Header/>
      </Container>
      
      {/* Content container - full width for messages, centered at 620px for other pages */}
      {isMessagesPage ? (
        <Box 
          w="100%"
          h="calc(100vh - 100px)"
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
      ) : (
        <>
          {/* HomePage needs wider container for sidebar */}
          {isHomePage ? (
            <Container maxW="1200px" px={{ base: 4, md: 6 }}>
              <Routes>
                <Route path="/home" element={user ? <HomePage/> : <Navigate to="/" />} />
              </Routes>
              {user && <LogOutButton/>}
              {user && <CreatePost/>}
            </Container>
          ) : (
            <Container maxW="620px" px={{ base: 4, md: 6 }}>
              <Routes>
                <Route path="/:username" element={user ?<UserPage/> : <Navigate to="/"/>}/>
                <Route path="/" element={!user ? <Login/>  : <Navigate to="/home" />}/>
                <Route path="/sign" element={<SignUp/>}/>
                <Route path="/update" element={user ? <UpdateProfile/> : <Navigate  to="/"/>}/>
                <Route path="/football" element={<FootballPage/>} />
                <Route path="/notifications" element={user ? <Box p={8} textAlign="center"><Text>Notifications coming soon!</Text></Box> : <Navigate to="/" />} />
                <Route path="/:username/post/:id" element={<PostPage/>}/>
              </Routes>
              {user && <LogOutButton/>}
              {user && <CreatePost/>}
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
