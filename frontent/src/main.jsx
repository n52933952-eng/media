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




const styles = {
	global: (props) => ({
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

const theme = extendTheme({ config, styles, colors });



createRoot(document.getElementById('root')).render(
    <UserContextProvider>
	<PostContextProvider>
    <SocketContextProvider>
   <BrowserRouter>
  
  <ChakraProvider theme={theme}>
    <App />

  <ColorModeScript initialColorMode={theme.config.initialColorMode} />
  </ChakraProvider>

  </BrowserRouter>
  </SocketContextProvider>
  </PostContextProvider>
  </UserContextProvider>

)
