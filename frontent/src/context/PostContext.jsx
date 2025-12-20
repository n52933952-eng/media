

import{createContext,useState} from 'react'

// eslint-disable-next-line react-refresh/only-export-components
export const PostContext = createContext({})

export function PostContextProvider({children}){
   
     const[followPost,setFollowPost]=useState([])

    return(
        <PostContext.Provider value={{followPost,setFollowPost}}>
            {children}
        </PostContext.Provider>
    )

}