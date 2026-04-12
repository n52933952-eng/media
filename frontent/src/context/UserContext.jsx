import { createContext, useMemo, useState } from 'react'


// eslint-disable-next-line react-refresh/only-export-components
export const UserContext = createContext({})


const getInilizeState =() => {
  const current = localStorage.getItem("userInfo")
  return current ? JSON.parse(current) : null
}


export function UserContextProvider({ children }) {
  const [user, setUser] = useState(getInilizeState)
  const [orientation, setOrientation] = useState(() => localStorage.getItem('chessOrientation') || null)

  const value = useMemo(
    () => ({ user, setUser, orientation, setOrientation }),
    [user, orientation]
  )

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

