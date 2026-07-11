import {
	Box,
	Button,
	Flex,
	FormControl,
	Input,
	Spinner,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalOverlay,
	Text,
	Tooltip,
	VStack,
	useDisclosure,
	useToast,
} from "@chakra-ui/react";

import{useState,useContext,useMemo,useEffect,useRef,useCallback} from 'react'
import{UserContext} from '../context/UserContext'
import{PostContext} from '../context/PostContext'
import useShowToast from '../hooks/useShowToast.js'
import PostLikesModal from './PostLikesModal.jsx'




import { isChessFeedPost, isGoFishFeedPost } from '../utils/gameFeedPostUtils.js'
import { getReplyCount, withReplyCountDelta, hideChannelPostComments } from '../utils/postUtils.js'

const Actions = ({ post, showFeedExtras = true, onReplyAdded }) => {
	const isEphemeralGamePost = isChessFeedPost(post) || isGoFishFeedPost(post)
	if (isEphemeralGamePost) {
		return null
	}

	const hideComments = hideChannelPostComments(post)

	const{user}=useContext(UserContext)
	const ENABLE_POST_SHARE_TO_CHAT = (import.meta.env.VITE_ENABLE_POST_SHARE_TO_CHAT || 'true') !== 'false'

	const toast = useToast()
	


	const[liked,setLiked] = useState(
		post?.likedByMe ?? post?.likes?.includes(user?._id) ?? false,
	)
	const [likeCount, setLikeCount] = useState(
		post?.likeCount ?? post?.likes?.length ?? 0,
	)
	const [likePreview, setLikePreview] = useState(post?.likePreview || null)
	const likePreviewRef = useRef(likePreview)
	const lastOtherPreviewRef = useRef(null)
	likePreviewRef.current = likePreview

	const selfId = user?._id?.toString?.() || String(user?._id || '')
	const previewId = (p) => (p?._id != null ? String(p._id) : '')

	const rememberOtherPreview = useCallback((p) => {
		if (!p) return
		const pid = previewId(p)
		if (!pid || (selfId && pid === selfId)) return
		lastOtherPreviewRef.current = p
	}, [selfId])

	useEffect(() => {
		rememberOtherPreview(post?.likePreview)
		rememberOtherPreview(likePreview)
	}, [post?.likePreview, likePreview, rememberOtherPreview])

	useEffect(() => {
		setLiked(post?.likedByMe ?? post?.likes?.includes(user?._id) ?? false)
		setLikeCount(post?.likeCount ?? post?.likes?.length ?? 0)
		const incoming = post?.likePreview || null
		const count = post?.likeCount ?? post?.likes?.length ?? 0
		if (incoming) {
			rememberOtherPreview(incoming)
			setLikePreview(incoming)
		} else if (count <= 0) {
			setLikePreview(null)
		}
		// count > 0 + null incoming → keep current preview (don't wipe on unlike race)
	}, [post?._id, post?.likedByMe, post?.likeCount, post?.likes, post?.likePreview, user?._id, rememberOtherPreview])
    
	const{followPost,setFollowPost}=useContext(PostContext)
   
	
	

    const{isOpen,onOpen,onClose}=useDisclosure()
	const {
		isOpen: isShareOpen,
		onOpen: onShareOpen,
		onClose: onShareClose,
	} = useDisclosure()
	const {
		isOpen: isCapsuleOpen,
		onOpen: onCapsuleOpen,
		onClose: onCapsuleClose,
	} = useDisclosure()
	const {
		isOpen: isLikesOpen,
		onOpen: onLikesOpen,
		onClose: onLikesClose,
	} = useDisclosure()
	const [capsuleLoading, setCapsuleLoading] = useState(false)
	const [capsuleLoadingDuration, setCapsuleLoadingDuration] = useState(null)
	const [capsuleSealed, setCapsuleSealed] = useState(false)
	const [capsuleOpenAt, setCapsuleOpenAt] = useState(null)
	const [capsuleSelectedLabel, setCapsuleSelectedLabel] = useState('')
   
	const[reply,setReply]=useState("")
	const [conversations, setConversations] = useState([])
	const [loadingConversations, setLoadingConversations] = useState(false)
	const [loadingMoreConversations, setLoadingMoreConversations] = useState(false)
	const [shareConversationsHasMore, setShareConversationsHasMore] = useState(false)
	const [sendingShareToId, setSendingShareToId] = useState(null)
	const shareConversationsCursorRef = useRef(null)
	const SHARE_CONVERSATIONS_PAGE = 9
	const loadingMoreConversationsRef = useRef(false)
  
	const[loading,setLoading]=useState(false)
 
	const showToast = useShowToast()
	const currentUserId = user?._id?.toString?.() || String(user?._id || '')
	const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
	const isCapsuleEligiblePost = useMemo(() => {
		const postId = String(post?._id || '')
		return !(
			post?.footballData ||
			post?.weatherData ||
			isChessFeedPost(post) ||
			isGoFishFeedPost(post) ||
			post?.raceGameData ||
			post?.isMatchReaction ||
			postId.startsWith('live_')
		)
	}, [post])
	const permalink = useMemo(() => {
		const username = post?.postedBy?.username || post?.postedBy?.name || 'post'
		const siteOrigin = (import.meta.env.VITE_PUBLIC_SITE_URL || 'https://playsocial.social').replace(/\/$/, '')
		return `${siteOrigin}/${username}/post/${post?._id}`
	}, [post?._id, post?.postedBy?.username, post?.postedBy?.name])
  
	
	   
	
	const handlelikeandunlike = async(e) => {
     e?.preventDefault?.()
     e?.stopPropagation?.()
     if(!user) return 

	 const previousLiked = liked
	 const previousCount = likeCount
	 const previousPreview = likePreviewRef.current
	 rememberOtherPreview(previousPreview)

	 const selfPreview = {
		_id: user._id,
		username: user.username,
		name: user.name,
		profilePic: user.profilePic || null,
	 }

	 // Optimistic UI first
	 const optimisticLiked = !previousLiked
	 const optimisticCount = Math.max(0, previousCount + (optimisticLiked ? 1 : -1))
	 const optimisticPreview = optimisticLiked
		? selfPreview
		: optimisticCount <= 0
			? null
			: lastOtherPreviewRef.current ||
			  (previewId(previousPreview) !== selfId ? previousPreview : null)

	 setLiked(optimisticLiked)
	 setLikeCount(optimisticCount)
	 setLikePreview(optimisticPreview)
	 likePreviewRef.current = optimisticPreview

	 try{
    const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/likes/` + post._id,{
		credentials:"include",
		method:"PUT",
		headers:{
			"Content-Type" : "application/json"
		}
	})
    const data = await res.json()

	const newLiked = typeof data?.liked === 'boolean' ? data.liked : optimisticLiked
	const newCount =
		typeof data?.likeCount === 'number'
			? data.likeCount
			: optimisticCount

	let newPreview
	if (newLiked) {
		newPreview = data?.likePreview || selfPreview
	} else if (newCount <= 0) {
		newPreview = null
	} else if (data?.likePreview) {
		newPreview = data.likePreview
		rememberOtherPreview(data.likePreview)
	} else {
		newPreview = lastOtherPreviewRef.current || null
	}

	setFollowPost(
		followPost.map((p) =>
			p._id === post._id
				? {
					...p,
					likedByMe: newLiked,
					likeCount: newCount,
					likePreview: newPreview,
				}
				: p,
		),
	)
	setLiked(newLiked)
	setLikeCount(newCount)
	setLikePreview(newPreview)
	likePreviewRef.current = newPreview
	 }catch(error){
		console.log(error)
		setLiked(previousLiked)
		setLikeCount(previousCount)
		setLikePreview(previousPreview)
		likePreviewRef.current = previousPreview
	 }
  }

  const fetchConversations = useCallback(async ({ loadMore = false } = {}) => {
	if (!showFeedExtras || !ENABLE_POST_SHARE_TO_CHAT || !user) return
	if (loadMore) {
		if (
			loadingMoreConversationsRef.current ||
			!shareConversationsHasMore ||
			!shareConversationsCursorRef.current
		) {
			return
		}
		loadingMoreConversationsRef.current = true
		setLoadingMoreConversations(true)
	} else {
		setLoadingConversations(true)
		shareConversationsCursorRef.current = null
		setShareConversationsHasMore(false)
	}

	try {
		const params = new URLSearchParams({ limit: String(SHARE_CONVERSATIONS_PAGE) })
		if (loadMore && shareConversationsCursorRef.current) {
			params.set('cursor', shareConversationsCursorRef.current)
		}
		const res = await fetch(`${baseUrl}/api/message/conversations?${params.toString()}`, {
			credentials: 'include',
		})
		const data = await res.json()
		if (!res.ok) {
			throw new Error(data?.error || 'Failed to load conversations')
		}
		const list = Array.isArray(data?.conversations) ? data.conversations : (Array.isArray(data) ? data : [])
		const nextCursor = typeof data?.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null
		const hasMore = !!data?.hasMore && !!nextCursor
		shareConversationsCursorRef.current = nextCursor
		setShareConversationsHasMore(hasMore)
		setConversations((prev) => {
			if (!loadMore) return list
			const seen = new Set(prev.map((c) => String(c?._id || '')))
			const fresh = list.filter((c) => {
				const id = String(c?._id || '')
				return id && !seen.has(id)
			})
			return [...prev, ...fresh]
		})
	} catch (e) {
		console.error('[Actions] fetch conversations:', e)
		if (!loadMore) showToast('Error', 'Could not load chats', 'error')
	} finally {
		if (loadMore) {
			loadingMoreConversationsRef.current = false
			setLoadingMoreConversations(false)
		} else {
			setLoadingConversations(false)
		}
	}
  }, [showFeedExtras, ENABLE_POST_SHARE_TO_CHAT, user, shareConversationsHasMore, baseUrl, showToast])

  const openShareModal = () => {
	if (!showFeedExtras) return
	if (!ENABLE_POST_SHARE_TO_CHAT) {
		showToast('Info', 'Sharing is disabled right now', 'info')
		return
	}
	onShareOpen()
	setConversations([])
	fetchConversations({ loadMore: false })
  }

  const handleShareListScroll = (e) => {
	const el = e.currentTarget
	if (!el || !shareConversationsHasMore || loadingMoreConversations) return
	const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 48
	if (nearBottom) fetchConversations({ loadMore: true })
  }

  const getConversationLabel = (conv) => {
	if (conv?.isGroup) return conv?.groupName || 'Group'
	const other = (conv?.participants || []).find((p) => {
		const id = p?._id?.toString?.() || String(p?._id || '')
		return id && id !== currentUserId
	})
	return other?.name || other?.username || 'Direct chat'
  }

  const getRecipientIdForDirect = (conv) => {
	if (conv?.isGroup) return null
	const other = (conv?.participants || []).find((p) => {
		const id = p?._id?.toString?.() || String(p?._id || '')
		return id && id !== currentUserId
	})
	return other?._id || null
  }

  const handleShareToConversation = async (conv) => {
	const convId = conv?._id?.toString?.() || String(conv?._id || '')
	if (!convId || sendingShareToId) return
	setSendingShareToId(convId)
	try {
		const isGroup = !!conv?.isGroup
		const recipientId = getRecipientIdForDirect(conv)
		const payload = {
			message: `🔗 ${permalink}`,
			...(isGroup
				? { conversationId: conv._id }
				: { recipientId }),
		}
		if (!isGroup && !recipientId) {
			throw new Error('Could not resolve recipient')
		}
		const res = await fetch(`${baseUrl}/api/message`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		})
		const data = await res.json()
		if (!res.ok) {
			throw new Error(data?.error || 'Failed to share post')
		}
		showToast('Shared', `Sent to ${getConversationLabel(conv)}`, 'success')
		onShareClose()
	} catch (e) {
		console.error('[Actions] share to conversation:', e)
		showToast('Error', 'Could not share post', 'error')
	} finally {
		setSendingShareToId(null)
	}
  }










  // Fetch capsule status for this post when component mounts
  useEffect(() => {
	if (!showFeedExtras || !user || !post?._id || !isCapsuleEligiblePost) return
	const fetchStatus = async () => {
		try {
			const res = await fetch(`${baseUrl}/api/capsule/status/${post._id}`, { credentials: 'include' })
			if (res.ok) {
				const data = await res.json()
				if (data && data.openAt) {
					setCapsuleSealed(true)
					setCapsuleOpenAt(new Date(data.openAt))
					setCapsuleSelectedLabel(data.selectedLabel || '')
				}
			}
		} catch (_) {}
	}
	fetchStatus()
  }, [post?._id, user, isCapsuleEligiblePost, showFeedExtras])

  const handleSealCapsule = async (duration) => {
	if (!user) return
	setCapsuleLoadingDuration(duration)
	try {
		const res = await fetch(`${baseUrl}/api/capsule/seal`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ postId: post._id, duration }),
		})
		const data = await res.json()
		if (!res.ok) throw new Error(data?.error || 'Failed to seal capsule')
		setCapsuleSealed(true)
		setCapsuleOpenAt(new Date(data.openAt))
		setCapsuleSelectedLabel(data.selectedLabel || '')
		showToast('Capsule sealed!', `You will be notified when it opens`, 'success')
		onCapsuleClose()
	} catch (e) {
		showToast('Error', e.message || 'Could not seal capsule', 'error')
	} finally {
		setCapsuleLoadingDuration(null)
	}
  }

  const handleUnsealCapsule = async () => {
	if (!user) return
	setCapsuleLoading(true)
	try {
		const res = await fetch(`${baseUrl}/api/capsule/unseal/${post._id}`, {
			method: 'DELETE',
			credentials: 'include',
		})
		if (!res.ok) throw new Error('Failed to remove capsule')
		setCapsuleSealed(false)
		setCapsuleOpenAt(null)
		setCapsuleSelectedLabel('')
		showToast('Capsule removed', '', 'info')
		onCapsuleClose()
	} catch (e) {
		showToast('Error', e.message || 'Could not remove capsule', 'error')
	} finally {
		setCapsuleLoading(false)
	}
  }

  const formatCapsuleCountdown = (openAt) => {
	if (!openAt) return ''
	const diff = openAt - Date.now()
	if (diff <= 0) return 'Opening now...'
	const days = Math.floor(diff / (1000 * 60 * 60 * 24))
	const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
	const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
	if (days > 0) return `Opens in ${days}d ${hours}h`
	if (hours > 0) return `Opens in ${hours}h ${mins}m`
	return `Opens in ${Math.max(1, mins)}m`
  }

  const handlereply = async() => {
	if(!user) return
	try{

    const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/reply/` + post._id,{
		credentials:"include",

		method:"PUT",
		 
		headers:{
			"Content-Type" : "application/json"
		},
		
		body:JSON.stringify({text:reply})
	})

     const data = await res.json()

	 if(res.ok){
		const replyWithLikes = {
			...data,
			likes: data.likes || []
		}

		if (onReplyAdded) {
			onReplyAdded(replyWithLikes)
		} else {
			const updatedReply = followPost.map((p) => {
				if(p._id === post._id){
					const replies = Array.isArray(p.replies) ? [...p.replies, replyWithLikes] : [replyWithLikes]
					return { ...withReplyCountDelta(p, 1), replies }
				}
				return p 
			})
			setFollowPost(updatedReply)
		}

		setReply("")
		onClose()
		
		// Auto-scroll to the newly added comment
		// Delay to ensure modal is closed, DOM is updated, and comment is rendered
		setTimeout(() => {
			// Find the newly created comment by its _id
			const newCommentId = data._id
			if (newCommentId) {
				// Try to find the comment element by data attribute
				const newCommentElement = document.querySelector(`[data-comment-id="${newCommentId}"]`)
				if (newCommentElement) {
					newCommentElement.scrollIntoView({ 
						behavior: 'smooth', 
						block: 'center'  // Center the comment in viewport
					})
				} else {
					// Fallback: scroll to comments section if comment not found yet
					// Try again after a bit more delay
					setTimeout(() => {
						const commentElement = document.querySelector(`[data-comment-id="${newCommentId}"]`)
						if (commentElement) {
							commentElement.scrollIntoView({ 
								behavior: 'smooth', 
								block: 'center' 
							})
						}
					}, 300)
				}
			}
		}, 700)  // Increased delay to ensure comment is rendered
	 }

	 }catch(error){
		console.log(error)
	 }
}

	






return (
		<Flex
			flexDirection='column'
			data-no-navigate="true"
			data-feed-actions="true"
			onClick={(e) => {
				e.preventDefault()
				e.stopPropagation()
			}}
		>
			<Flex gap={3} my={2}>
				<svg
					aria-label='Like'
					color={liked ? "rgb(237, 73, 86)" : ""}
					fill={liked ? "rgb(237, 73, 86)" : "transparent"}
					height='19'
					role='img'
					viewBox='0 0 24 22'
					width='20'
					style={{ cursor: 'pointer' }}
                    onClick={handlelikeandunlike}
				
				>
					<path
						d='M1 7.66c0 4.575 3.899 9.086 9.987 12.934.338.203.74.406 1.013.406.283 0 .686-.203 1.013-.406C19.1 16.746 23 12.234 23 7.66 23 3.736 20.245 1 16.672 1 14.603 1 12.98 1.94 12 3.352 11.042 1.952 9.408 1 7.328 1 3.766 1 1 3.736 1 7.66Z'
						stroke='currentColor'
						strokeWidth='2'
					></path>
				</svg>

				{!hideComments && (
				<svg
					aria-label='Comment'
					color=''
					fill=''
					height='20'
					role='img'
					viewBox='0 0 24 24'
					width='20'
					style={{ cursor: 'pointer' }}
				  onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						onOpen()
					}}
				>
					<title>Comment</title>
					<path
						d='M20.656 17.008a9.993 9.993 0 1 0-3.59 3.615L22 22Z'
						fill='none'
						stroke='currentColor'
						strokeLinejoin='round'
						strokeWidth='2'
					></path>
				</svg>
				)}

			{showFeedExtras && isCapsuleEligiblePost && (
				<Tooltip label={capsuleSealed ? `Set: ${capsuleSelectedLabel || formatCapsuleCountdown(capsuleOpenAt)}` : 'Remind me later'} placement="top" hasArrow>
					<Box
						as="button"
						display="flex"
						alignItems="center"
						justifyContent="center"
						onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (user) onCapsuleOpen() }}
						style={{ cursor: user ? 'pointer' : 'default', opacity: user ? 1 : 0.45 }}
						title="Remind me later"
					>
						<CapsuleSVG sealed={capsuleSealed} />
					</Box>
				</Tooltip>
			)}
			{showFeedExtras && (
				<ShareSVG onClick={openShareModal} disabled={!ENABLE_POST_SHARE_TO_CHAT} />
			)}
			</Flex>

			<Flex gap={2} alignItems={"center"}>
				{!hideComments && (
				<>
				<Text color={"gray.light"} fontSize='sm'>
				{getReplyCount(post)} Comment
				</Text>
				<Box w={0.5} h={0.5} borderRadius={"full"} bg={"gray.light"}></Box>
				</>
				)}
				{likeCount > 0 && (liked ? user?.profilePic : likePreview?.profilePic) ? (
					<Box
						as="img"
						src={liked ? user.profilePic : likePreview.profilePic}
						alt=""
						w="18px"
						h="18px"
						borderRadius="full"
						objectFit="cover"
						flexShrink={0}
					/>
				) : null}
				<Text
					color={"gray.light"}
					fontSize='sm'
					cursor={likeCount > 0 ? 'pointer' : 'default'}
					onClick={(e) => {
						e.preventDefault()
						e.stopPropagation()
						if (likeCount > 0) onLikesOpen()
					}}
					_hover={likeCount > 0 ? { textDecoration: 'underline' } : undefined}
				>
				{likeCount} {likeCount === 1 ? 'like' : 'likes'}
				</Text>
			</Flex>

			{!hideComments && (
			<Modal isOpen={isOpen} onClose={onClose}>
				
				<ModalOverlay />
				<ModalContent>
					<ModalHeader></ModalHeader>
					<ModalCloseButton />
					<ModalBody pb={6}>
						<FormControl>
							<Input placeholder="Write comment"
							 value={reply}
							 onChange={(e) => setReply(e.target.value)}
							/>
						</FormControl>
					</ModalBody>

					<ModalFooter>
						<Button colorScheme='blue' size={"sm"} mr={3} onClick={handlereply}>
							Reply
						</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>
			)}

			<Modal isOpen={isShareOpen} onClose={onShareClose}>
				<ModalOverlay />
				<ModalContent>
					<ModalHeader>Share to chat</ModalHeader>
					<ModalCloseButton />
					<ModalBody pb={4}>
						{loadingConversations ? (
							<Flex justify="center" py={6}>
								<Spinner size="md" />
							</Flex>
						) : conversations.length === 0 ? (
							<Text fontSize="sm" color="gray.500">No chats found</Text>
						) : (
							<Flex
								direction="column"
								gap={2}
								maxH="320px"
								overflowY="auto"
								onScroll={handleShareListScroll}
							>
								{conversations.map((conv) => (
									<Button
										key={conv?._id}
										variant="outline"
										justifyContent="flex-start"
										onClick={() => handleShareToConversation(conv)}
										isLoading={sendingShareToId === (conv?._id?.toString?.() || String(conv?._id || ''))}
										isDisabled={!!sendingShareToId}
									>
										{conv?.isGroup ? '👥 ' : '💬 '}{getConversationLabel(conv)}
									</Button>
								))}
								{loadingMoreConversations ? (
									<Flex justify="center" py={2}>
										<Spinner size="sm" />
									</Flex>
								) : null}
							</Flex>
						)}
					</ModalBody>
					<ModalFooter>
						<Button variant="ghost" onClick={onShareClose}>Close</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>
		{/* Moment Capsule Modal */}
		{showFeedExtras && isCapsuleEligiblePost && (
		<Modal isOpen={isCapsuleOpen} onClose={onCapsuleClose} isCentered size="sm">
			<ModalOverlay />
			<ModalContent>
				<ModalHeader fontSize="md" pb={1}>
					{capsuleSealed ? '💊 Reminder Set' : '💊 Remind me about this post'}
				</ModalHeader>
				<ModalCloseButton />
				<ModalBody pb={4}>
					{capsuleSealed ? (
						<VStack spacing={3} align="stretch">
							<Text fontSize="sm" color="gray.400">
								You saved this post in a capsule.
							</Text>
							<Text fontSize="sm" fontWeight="semibold" color="purple.300">
								{capsuleSelectedLabel ? `Selected: ${capsuleSelectedLabel}` : formatCapsuleCountdown(capsuleOpenAt)}
							</Text>
							<Text fontSize="xs" color="gray.500">
								When it opens, you'll get a notification to come back and relive this moment. 🎁
							</Text>
							<Text fontSize="xs" fontWeight="semibold" color="gray.300">Change reminder to:</Text>
							{[
								{ label: '1 minute', value: '1m' },
								{ label: '5 minutes', value: '5m' },
								{ label: '1 hour', value: '1h' },
								{ label: '3 days', value: '3d' },
							].map(({ label, value }) => (
								<Button
									key={`sealed-${value}`}
									variant="outline"
									size="sm"
									isLoading={capsuleLoadingDuration === value}
									isDisabled={!!capsuleLoadingDuration || capsuleLoading}
									onClick={() => handleSealCapsule(value)}
								>
									⏳ {label}
								</Button>
							))}
							<Button
								colorScheme="red"
								variant="outline"
								size="sm"
								isLoading={capsuleLoading}
								onClick={handleUnsealCapsule}
							>
								Cancel capsule
							</Button>
						</VStack>
					) : (
						<VStack spacing={3} align="stretch">
							<Text fontSize="sm" color="gray.400">
								Choose a time and we will send you a real-time notification to open this post later.
							</Text>
							<Text fontSize="xs" fontWeight="semibold" color="gray.300">Remind me in:</Text>
							{[
								{ label: '1 minute', value: '1m' },
								{ label: '5 minutes', value: '5m' },
								{ label: '1 hour', value: '1h' },
								{ label: '3 days', value: '3d' },
							].map(({ label, value }) => (
								<Button
									key={value}
									variant="outline"
									size="sm"
									isLoading={capsuleLoadingDuration === value}
									isDisabled={!!capsuleLoadingDuration}
									onClick={() => handleSealCapsule(value)}
								>
									⏳ {label}
								</Button>
							))}
						</VStack>
					)}
				</ModalBody>
				<ModalFooter pt={0}>
					<Button variant="ghost" size="sm" onClick={onCapsuleClose}>Cancel</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
		)}

			<PostLikesModal
				isOpen={isLikesOpen}
				onClose={onLikesClose}
				postId={post?._id}
				initialCount={likeCount}
			/>

		</Flex>
	);
};

export default Actions;

const CapsuleSVG = ({ sealed = false }) => (
	<svg
		aria-label='Moment Capsule'
		height='20'
		width='20'
		viewBox='0 0 24 24'
		fill='none'
		stroke={sealed ? 'rgb(167, 112, 255)' : 'currentColor'}
		strokeWidth='2'
		strokeLinecap='round'
		strokeLinejoin='round'
		style={{ transition: 'stroke 0.25s' }}
	>
		<title>Moment Capsule</title>
		{/* pill / capsule shape */}
		<rect x='3' y='8' width='18' height='8' rx='4' ry='4' />
		{/* center divider */}
		<line x1='12' y1='8' x2='12' y2='16' />
		{/* left half filled when sealed */}
		{sealed && (
			<rect x='3' y='8' width='9' height='8' rx='4' ry='4' fill='rgb(167, 112, 255)' stroke='none' />
		)}
		{/* small clock dots inside right half */}
		<circle cx='16' cy='12' r='0.5' fill={sealed ? 'rgb(167,112,255)' : 'currentColor'} stroke='none' />
	</svg>
);

const ShareSVG = ({ onClick, disabled = false }) => {
	return (
		<svg
			aria-label='Share'
			color=''
			fill='rgb(243, 245, 247)'
			height='20'
			role='img'
			viewBox='0 0 24 24'
			width='20'
			onClick={
				disabled
					? undefined
					: (e) => {
							e.preventDefault()
							e.stopPropagation()
							onClick?.(e)
						}
			}
			style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1 }}
		>
			<title>Share</title>
			<line
				fill='none'
				stroke='currentColor'
				strokeLinejoin='round'
				strokeWidth='2'
				x1='22'
				x2='9.218'
				y1='3'
				y2='10.083'
			></line>
			<polygon
				fill='none'
				points='11.698 20.334 22 3.001 2 3.001 9.218 10.084 11.698 20.334'
				stroke='currentColor'
				strokeLinejoin='round'
				strokeWidth='2'
			></polygon>
		</svg>



	);
};