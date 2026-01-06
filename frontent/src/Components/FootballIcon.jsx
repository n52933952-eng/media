import React from 'react'
import { Image } from '@chakra-ui/react'

const FootballIcon = ({ size = '48px', ...props }) => {
  return (
    <Image
      src="/fot.webp"
      w={size}
      h={size}
      objectFit="contain"
      cursor="pointer"
      flexShrink={0}
      {...props}
    />
  )
}

export default FootballIcon

