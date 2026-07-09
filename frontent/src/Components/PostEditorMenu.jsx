import React, { useCallback, useContext, useMemo } from 'react'
import {
  Box,
  Button,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  useDisclosure,
} from '@chakra-ui/react'
import { UserContext } from '../context/UserContext'
import { PostContext } from '../context/PostContext'
import EditPost from './EditPost'
import AddContributorModal from './AddContributorModal'
import ManageContributorsModal from './ManageContributorsModal'
import AddCollaboratorPhotoModal from './AddCollaboratorPhotoModal'
import CollaborativePostAudioModal from './CollaborativePostAudioModal'
import {
  getMyCollaboratorImage,
  getPostCarouselAudio,
  isCarouselPost,
} from '../utils/postCarousel.js'
import { isChessFeedPost, isGoFishFeedPost } from '../utils/gameFeedPostUtils.js'
import { parsePostFromApiResponse, postDetailApiUrl } from '../utils/postUtils.js'

const stopMenuEvent = (e, blockNav) => {
  e.preventDefault()
  e.stopPropagation()
  blockNav?.()
}

/**
 * Owner/contributor actions for a post (edit caption, collab photo, contributors, music).
 */
const PostEditorMenu = ({
  post,
  onPostUpdated,
  menuButtonProps = {},
  showFeedExtras = false,
  isOwnProfile = true,
  iconOnly = false,
  onMenuStateChange,
  onMenuInteraction,
}) => {
  const { user } = useContext(UserContext)
  const { setFollowPost } = useContext(PostContext) || {}

  const { isOpen: isAddContributorOpen, onOpen: onAddContributorOpen, onClose: onAddContributorClose } = useDisclosure()
  const { isOpen: isManageContributorsOpen, onOpen: onManageContributorsOpen, onClose: onManageContributorsClose } = useDisclosure()
  const { isOpen: isEditPostOpen, onOpen: onEditPostOpen, onClose: onEditPostClose } = useDisclosure()
  const { isOpen: isCollabPhotoOpen, onOpen: onCollabPhotoOpen, onClose: onCollabPhotoClose } = useDisclosure()
  const { isOpen: isCollabAudioOpen, onOpen: onCollabAudioOpen, onClose: onCollabAudioClose } = useDisclosure()

  const postedBy = typeof post?.postedBy === 'object' ? post.postedBy : null
  const postedById =
    (typeof post?.postedBy === 'string' ? post.postedBy : post?.postedBy?._id)?.toString?.() ?? ''
  const currentUserId = user?._id?.toString?.() ?? ''
  const isOwner = !!postedById && !!currentUserId && postedById === currentUserId
  const isContributor = post?.contributors?.some((c) => {
    const cId = (typeof c === 'string' ? c : c?._id)?.toString?.() ?? ''
    return !!cId && cId === currentUserId
  })

  const isChannelPost = !!post?.channelAddedBy
  const isWeatherPost = postedBy?.username === 'Weather' && post?.weatherData
  const isFootballPost = postedBy?.username === 'Football'
  const isChessPost = isChessFeedPost(post)
  const isCardPost = isGoFishFeedPost(post)

  const isSomeoneElsesProfile = !showFeedExtras && isOwnProfile === false
  const canActAsContributor = !!isContributor && !isSomeoneElsesProfile
  const isCarouselOwnerPost = isCarouselPost(post) && isOwner
  const canManageCollabAudio = !!post?.isCollaborative && isOwner
  const canManageCarouselAudio = isCarouselOwnerPost
  const myCollaboratorPhoto = getMyCollaboratorImage(post, currentUserId)
  const carouselAudio = useMemo(() => getPostCarouselAudio(post), [post])
  const hasCollabAudio = !!carouselAudio

  const canEditPostText =
    !!user &&
    !isChannelPost &&
    !isWeatherPost &&
    !isFootballPost &&
    !isChessPost &&
    !isCardPost &&
    !post?.channelAddedBy &&
    (isOwner || (!!post?.isCollaborative && canActAsContributor))

  const canManageCollabPost =
    !!post?.isCollaborative && (isOwner || isContributor)

  const canShowPenMenu =
    canEditPostText ||
    canManageCollabPost ||
    isCarouselOwnerPost

  const applyPostUpdate = useCallback(
    (updatedPost) => {
      if (!updatedPost) return
      onPostUpdated?.(updatedPost)
      if (setFollowPost) {
        setFollowPost((prev) =>
          prev.map((p) => (String(p._id) === String(updatedPost._id) ? updatedPost : p)),
        )
      }
    },
    [onPostUpdated, setFollowPost],
  )

  const refreshPostFromApi = useCallback(() => {
    if (!post?._id) return
    fetch(postDetailApiUrl(post._id), { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        const fetched = parsePostFromApiResponse(data)
        if (fetched) applyPostUpdate(fetched)
      })
      .catch(() => {})
  }, [post?._id, applyPostUpdate])

  const runMenuAction = (action) => (e) => {
    stopMenuEvent(e, onMenuInteraction)
    action()
  }

  if (!post || !canShowPenMenu) return null

  return (
    <>
      <Box
        as="span"
        display="inline-flex"
        data-no-navigate="true"
        data-feed-actions="true"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Menu
          placement="bottom-end"
          isLazy
          strategy="fixed"
          onOpen={() => {
            onMenuStateChange?.(true)
            onMenuInteraction?.()
          }}
          onClose={() => {
            onMenuStateChange?.(false)
            onMenuInteraction?.()
          }}
        >
          <MenuButton
            as={Button}
            size="xs"
            variant="outline"
            colorScheme="blue"
            type="button"
            aria-label="Edit post"
            onClick={(e) => stopMenuEvent(e, onMenuInteraction)}
            onMouseDown={(e) => stopMenuEvent(e, onMenuInteraction)}
            {...menuButtonProps}
          >
            {iconOnly ? '✏️' : '✏️ Edit'}
          </MenuButton>
          <MenuList zIndex={2000}>
            {canEditPostText && (
              <MenuItem onClick={runMenuAction(onEditPostOpen)}>
                {isCarouselOwnerPost ? 'Edit caption & photos' : 'Edit caption'}
              </MenuItem>
            )}
            {canManageCollabPost && (
              <>
                <MenuItem onClick={runMenuAction(onCollabPhotoOpen)}>
                  {myCollaboratorPhoto ? 'Change your photo' : 'Add your photo'}
                </MenuItem>
                {(isOwner || canActAsContributor) && (
                  <MenuItem onClick={runMenuAction(onAddContributorOpen)}>
                    Add contributor
                  </MenuItem>
                )}
                {(isOwner || canActAsContributor) && post.contributors?.length > 0 && (
                  <MenuItem onClick={runMenuAction(onManageContributorsOpen)}>
                    Manage contributors
                  </MenuItem>
                )}
              </>
            )}
            {(canManageCollabAudio || canManageCarouselAudio) && (
              <MenuItem onClick={runMenuAction(onCollabAudioOpen)}>
                {hasCollabAudio ? 'Change music' : 'Add music'}
              </MenuItem>
            )}
          </MenuList>
        </Menu>
      </Box>

      <AddContributorModal
        isOpen={isAddContributorOpen}
        onClose={onAddContributorClose}
        post={post}
        onContributorAdded={(updated) => (updated ? applyPostUpdate(updated) : refreshPostFromApi())}
      />

      <EditPost post={post} isOpen={isEditPostOpen} onClose={onEditPostClose} onUpdate={applyPostUpdate} />

      <AddCollaboratorPhotoModal
        isOpen={isCollabPhotoOpen}
        onClose={onCollabPhotoClose}
        post={post}
        onSaved={applyPostUpdate}
      />

      <CollaborativePostAudioModal
        isOpen={isCollabAudioOpen}
        onClose={onCollabAudioClose}
        post={post}
        onSaved={applyPostUpdate}
      />

      <ManageContributorsModal
        isOpen={isManageContributorsOpen}
        onClose={onManageContributorsClose}
        post={post}
        onContributorRemoved={(updated) => (updated ? applyPostUpdate(updated) : refreshPostFromApi())}
      />
    </>
  )
}

export default PostEditorMenu
