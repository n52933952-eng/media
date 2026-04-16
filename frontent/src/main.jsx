import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

import { ChakraProvider } from "@chakra-ui/react";
import { mode } from "@chakra-ui/theme-tools";
import { extendTheme } from "@chakra-ui/theme-utils";
import { ColorModeScript } from "@chakra-ui/color-mode";
import{BrowserRouter} from 'react-router-dom'
import{UserContextProvider} from './context/UserContext'
import{PostContextProvider} from './context/PostContext'
import{SocketContextProvider} from './context/SocketContext'
import { LiveKitProvider } from './context/LiveKitContext'
import { GroupCallProvider } from './context/GroupCallContext'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { GOOGLE_WEB_CLIENT_ID } from './config/googleWebClient'




const styles = {
	global: (props) => ({
		html: {
			// Reserve scrollbar gutter so opening a modal (body scroll lock) does not shift layout sideways.
			scrollbarGutter: "stable",
		},
		body: {
			color: mode("gray.800", "whiteAlpha.900")(props),
			bg: mode("gray.100", "#101010")(props),
			overflowX: "hidden",
		},
		"html, body": {
			overflowX: "hidden",
			maxWidth: "100%",
		},
	}),
};

// Chakra Modal/Drawer: if `preserveScrollBarGap` is omitted, RemoveScroll treats it as falsy and strips
// the scrollbar without padding compensation — slight horizontal jump. Defaults must be explicit.
const components = {
	Modal: {
		defaultProps: {
			preserveScrollBarGap: true,
		},
	},
	Drawer: {
		defaultProps: {
			preserveScrollBarGap: true,
		},
	},
	AlertDialog: {
		defaultProps: {
			preserveScrollBarGap: true,
		},
	},
};

const config = {
	initialColorMode: "dark",
	useSystemColorMode: true,
};

const colors = {
	gray: {
		light: "#616161",
		dark: "#1e1e1e",
	},
};

const theme = extendTheme({ config, styles, colors, components });



const appShell = (
  <UserContextProvider>
	<PostContextProvider>
    <SocketContextProvider>
    <LiveKitProvider>
    <GroupCallProvider>
   <BrowserRouter>
  
  <ChakraProvider theme={theme}>
    <App />

  <ColorModeScript initialColorMode={theme.config.initialColorMode} />
  </ChakraProvider>

  </BrowserRouter>
  </GroupCallProvider>
  </LiveKitProvider>
  </SocketContextProvider>
  </PostContextProvider>
  </UserContextProvider>
)

createRoot(document.getElementById('root')).render(
  <GoogleOAuthProvider clientId={GOOGLE_WEB_CLIENT_ID}>{appShell}</GoogleOAuthProvider>
)
