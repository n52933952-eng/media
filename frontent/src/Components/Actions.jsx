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

import{useState,useContext,useMemo,useEffect} from 'react'
import{UserContext} from '../context/UserContext'
import{PostContext} from '../context/PostContext'
import useShowToast from '../hooks/useShowToast.js'




const Actions = ({post}) => {
	

	const{user}=useContext(UserContext)
	const ENABLE_POST_SHARE_TO_CHAT = (import.meta.env.VITE_ENABLE_POST_SHARE_TO_CHAT || 'true') !== 'false'

	const toast = useToast()
	


	const[liked,setLiked] = useState(post?.likes?.includes(user?._id))
    
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
	const [capsuleLoading, setCapsuleLoading] = useState(false)
	const [capsuleLoadingDuration, setCapsuleLoadingDuration] = useState(null)
	const [capsuleSealed, setCapsuleSealed] = useState(false)
	const [capsuleOpenAt, setCapsuleOpenAt] = useState(null)
   
	const[reply,setReply]=useState("")
	const [conversations, setConversations] = useState([])
	const [loadingConversations, setLoadingConversations] = useState(false)
	const [sendingShareToId, setSendingShareToId] = useState(null)
  
	const[loading,setLoading]=useState(false)
 
	const showToast = useShowToast()
	const currentUserId = user?._id?.toString?.() || String(user?._id || '')
	const baseUrl = import.meta.env.PROD ? window.location.origin : "http://localhost:5000"
	const permalink = useMemo(() => {
		const username = post?.postedBy?.username || post?.postedBy?.name || 'post'
		return `${window.location.origin}/${username}/post/${post?._id}`
	}, [post?._id, post?.postedBy?.username, post?.postedBy?.name])
  
	
	   
	
	const handlelikeandunlike = async() => {
     if(!user) return 

	 try{
    const res = await fetch(`${import.meta.env.PROD ? window.location.origin : "http://localhost:5000"}/api/post/likes/` + post._id,{
		credentials:"include",
		method:"PUT",
		headers:{
			"Content-Type" : "application/json"
		}
	})
    const data = await res.json()

	
     if(!liked){

	const updatePost = followPost.map((p) => {
		if(p._id === post._id){
			return {...p,likes:[...p.likes,user._id]}
		}
		return p
	})    
	setFollowPost(updatePost)
  }else{
	const updaredpost = followPost.map((p) => {
		if(p._id === post._id){
			return { ...p, likes: p.likes.filter((id) => id !== user._id)}
		}
		return p
	})
	setFollowPost(updaredpost)
  }
 
  setLiked(!liked)
	 }catch(error){
		console.log(error)
	 }
  }

  const fetchConversations = async () => {
	if (!ENABLE_POST_SHARE_TO_CHAT || !user) return
	setLoadingConversations(true)
	try {
		const res = await fetch(`${baseUrl}/api/message/conversations?limit=30`, {
			credentials: 'include',
		})
		const data = await res.json()
		if (!res.ok) {
			throw new Error(data?.error || 'Failed to load conversations')
		}
		const list = Array.isArray(data?.conversations) ? data.conversations : (Array.isArray(data) ? data : [])
		setConversations(list)
	} catch (e) {
		console.error('[Actions] fetch conversations:', e)
		showToast('Error', 'Could not load chats', 'error')
	} finally {
		setLoadingConversations(false)
	}
  }

  const openShareModal = () => {
	if (!ENABLE_POST_SHARE_TO_CHAT) {
		showToast('Info', 'Sharing is disabled right now', 'info')
		return
	}
	onShareOpen()
	fetchConversations()
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
	if (!user || !post?._id) return
	const fetchStatus = async () => {
		try {
			const res = await fetch(`${baseUrl}/api/capsule/status/${post._id}`, { credentials: 'include' })
			if (res.ok) {
				const data = await res.json()
				if (data && data.openAt) {
					setCapsuleSealed(true)
					setCapsuleOpenAt(new Date(data.openAt))
				}
			}
		} catch (_) {}
	}
	fetchStatus()
  }, [post?._id, user])

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
	if (diff <= 0) return 'Opening soon...'
	const days = Math.floor(diff / (1000 * 60 * 60 * 24))
	const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
	if (days > 0) return `Opens in ${days}d ${hours}h`
	const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
	return `Opens in ${hours}h ${mins}m`
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
		const updatedReply = followPost.map((p) => {
			if(p._id === post._id){
				// Ensure the new reply has likes array initialized
				const replyWithLikes = {
					...data,
					likes: data.likes || []
				}
				return {...p,replies:[...p.replies,replyWithLikes]}
			}
			return p 
		})
		setFollowPost(updatedReply)
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
		<Flex flexDirection='column'>
			<Flex gap={3} my={2} onClick={(e) => e.preventDefault()}>
				<svg
					aria-label='Like'
					color={liked ? "rgb(237, 73, 86)" : ""}
					fill={liked ? "rgb(237, 73, 86)" : "transparent"}
					height='19'
					role='img'
					viewBox='0 0 24 22'
					width='20'
                    onClick={handlelikeandunlike}
				
				>
					<path
						d='M1 7.66c0 4.575 3.899 9.086 9.987 12.934.338.203.74.406 1.013.406.283 0 .686-.203 1.013-.406C19.1 16.746 23 12.234 23 7.66 23 3.736 20.245 1 16.672 1 14.603 1 12.98 1.94 12 3.352 11.042 1.952 9.408 1 7.328 1 3.766 1 1 3.736 1 7.66Z'
						stroke='currentColor'
						strokeWidth='2'
					></path>
				</svg>

				<svg
					aria-label='Comment'
					color=''
					fill=''
					height='20'
					role='img'
					viewBox='0 0 24 24'
					width='20'
				  onClick={onOpen}
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

			<Tooltip label={capsuleSealed ? formatCapsuleCountdown(capsuleOpenAt) : 'Seal as Moment Capsule'} placement="top" hasArrow>
				<Box
					as="button"
					display="flex"
					alignItems="center"
					justifyContent="center"
					onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (user) onCapsuleOpen() }}
					style={{ cursor: user ? 'pointer' : 'default', opacity: user ? 1 : 0.45 }}
					title="Moment Capsule"
				>
					<CapsuleSVG sealed={capsuleSealed} />
				</Box>
			</Tooltip>
			<ShareSVG onClick={openShareModal} disabled={!ENABLE_POST_SHARE_TO_CHAT} />
			</Flex>

			<Flex gap={2} alignItems={"center"}>
				<Text color={"gray.light"} fontSize='sm'>
				{post?.replies?.length} Comment
				</Text>
				<Box w={0.5} h={0.5} borderRadius={"full"} bg={"gray.light"}></Box>
				<Text color={"gray.light"} fontSize='sm'>
				{post?.likes?.length} likes
				</Text>
			</Flex>

			<Modal isOpen={isOpen} onClose={onClose}>
				
				<ModalOverlay />
				<ModalContent>
					<ModalHeader></ModalHeader>
					<ModalCloseButton />
					<ModalBody pb={6}>
						<FormControl>
							<Input placeholder="اكتب تعليق"
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

			<Modal isOpen={isShareOpen} onClose={onShareClose}>
				<ModalOverlay />
				<ModalContent>
					<ModalHeader>Share to chat</ModalHeader>
					<ModalCloseButton />
					<ModalBody pb={4}>
						<Text fontSize="sm" color="gray.500" mb={3} noOfLines={2}>
							{permalink}
						</Text>
						{loadingConversations ? (
							<Flex justify="center" py={6}>
								<Spinner size="md" />
							</Flex>
						) : conversations.length === 0 ? (
							<Text fontSize="sm" color="gray.500">No chats found</Text>
						) : (
							<Flex direction="column" gap={2} maxH="320px" overflowY="auto">
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
							</Flex>
						)}
					</ModalBody>
					<ModalFooter>
						<Button variant="ghost" onClick={onShareClose}>Close</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>
		{/* Moment Capsule Modal */}
		<Modal isOpen={isCapsuleOpen} onClose={onCapsuleClose} isCentered size="sm">
			<ModalOverlay />
			<ModalContent>
				<ModalHeader fontSize="md" pb={1}>
					{capsuleSealed ? '💊 Your Moment Capsule' : '💊 Save as Moment Capsule'}
				</ModalHeader>
				<ModalCloseButton />
				<ModalBody pb={4}>
					{capsuleSealed ? (
						<VStack spacing={3} align="stretch">
							<Text fontSize="sm" color="gray.400">
								You saved this post in a capsule.
							</Text>
							<Text fontSize="sm" fontWeight="semibold" color="purple.300">
								{formatCapsuleCountdown(capsuleOpenAt)}
							</Text>
							<Text fontSize="xs" color="gray.500">
								When it opens, you'll get a notification to come back and relive this moment. 🎁
							</Text>
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
								Save this post and we'll remind you to come back to it later — like a surprise from your past self. 🎁
							</Text>
							<Text fontSize="xs" fontWeight="semibold" color="gray.300">Remind me in:</Text>
							{[
								{ label: '1 minute', value: '1m' },
								{ label: '3 days', value: '3d' },
								{ label: '1 week', value: '1w' },
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
			onClick={disabled ? undefined : onClick}
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