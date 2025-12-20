

import{createContext,useState} from 'react'


// eslint-disable-next-line react-refresh/only-export-components
export const UserContext = createContext({})


const getInilizeState =() => {
  const current = localStorage.getItem("userInfo")
  return current ? JSON.parse(current) : null
}


export function UserContextProvider({children}){

 
    const[user,setUser]=useState(getInilizeState)


    return(<UserContext.Provider value={{user,setUser}}>
      {children}
    </UserContext.Provider>

        
    )
 }

