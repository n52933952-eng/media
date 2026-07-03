import { useCallback, useEffect, useRef, useState } from 'react'
import {
	Avatar,
	Box,
	Flex,
	Modal,
	ModalBody,
	ModalCloseButton,
	ModalContent,
	ModalHeader,
	ModalOverlay,
	Spinner,
	Text,
} from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'

const PAGE_SIZE = 20
/** Fixed modal list height — scroll inside; loads more pages on scroll (cursor API). */
const LIST_HEIGHT = '420px'
const apiBase = () => (import.meta.env.PROD ? window.location.origin : 'http://localhost:5000')

/**
 * Instagram-style sheet listing who liked a post (cursor-paginated).
 */
export default function PostLikesModal({ isOpen, onClose, postId, initialCount = 0 }) {
	const navigate = useNavigate()
	const [users, setUsers] = useState([])
	const [total, setTotal] = useState(initialCount)
	const [loading, setLoading] = useState(false)
	const [loadingMore, setLoadingMore] = useState(false)
	const [error, setError] = useState(null)
	const cursorRef = useRef(null)
	const hasMoreRef = useRef(true)
	const seenRef = useRef(new Set())
	const loadingMoreRef = useRef(false)
	const listRef = useRef(null)
	const sentinelRef = useRef(null)

	const fetchPage = useCallback(async (isFirst) => {
		if (!postId) return
		if (isFirst) {
			setLoading(true)
			setError(null)
		} else {
			if (!hasMoreRef.current || loadingMoreRef.current) return
			loadingMoreRef.current = true
			setLoadingMore(true)
		}
		try {
			const parts = [`limit=${PAGE_SIZE}`]
			if (!isFirst && cursorRef.current) {
				parts.push(`cursor=${encodeURIComponent(cursorRef.current)}`)
			}
			const res = await fetch(
				`${apiBase()}/api/post/likes-list/${postId}?${parts.join('&')}`,
				{ credentials: 'include' },
			)
			const data = await res.json()
			if (!res.ok) throw new Error(data?.error || data?.message || 'Failed to load likes')

			const page = Array.isArray(data?.users) ? data.users : []
			cursorRef.current = data?.nextCursor ?? null
			hasMoreRef.current = !!data?.hasMore && !!data?.nextCursor
			if (typeof data?.total === 'number') setTotal(data.total)

			if (isFirst) {
				seenRef.current = new Set(page.map((u) => String(u._id)))
				setUsers(page)
			} else {
				setUsers((prev) => {
					const merged = [...prev]
					for (const u of page) {
						const id = String(u._id)
						if (id && !seenRef.current.has(id)) {
							seenRef.current.add(id)
							merged.push(u)
						}
					}
					return merged
				})
			}
		} catch (e) {
			if (isFirst) setError(e?.message || 'Failed to load likes')
		} finally {
			if (isFirst) setLoading(false)
			else {
				loadingMoreRef.current = false
				setLoadingMore(false)
			}
		}
	}, [postId])

	useEffect(() => {
		if (!isOpen || !postId) return
		cursorRef.current = null
		hasMoreRef.current = true
		seenRef.current = new Set()
		loadingMoreRef.current = false
		setUsers([])
		setTotal(initialCount ?? 0)
		setError(null)
		fetchPage(true)
	}, [isOpen, postId, initialCount, fetchPage])

	const handleScroll = useCallback(() => {
		const el = listRef.current
		if (!el || loading || loadingMoreRef.current || !hasMoreRef.current) return
		if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
			fetchPage(false)
		}
	}, [fetchPage, loading])

	// IntersectionObserver fallback for load-more at list bottom
	useEffect(() => {
		if (!isOpen || loading || users.length === 0) return
		const root = listRef.current
		const sentinel = sentinelRef.current
		if (!root || !sentinel) return

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries[0]?.isIntersecting && hasMoreRef.current && !loadingMoreRef.current) {
					fetchPage(false)
				}
			},
			{ root, rootMargin: '80px', threshold: 0 },
		)
		observer.observe(sentinel)
		return () => observer.disconnect()
	}, [isOpen, loading, users.length, fetchPage])

	const handleUserClick = (username) => {
		if (!username) return
		onClose()
		setTimeout(() => navigate(`/${username}`), 120)
	}

	const title =
		total > 0
			? `${total.toLocaleString()} ${total === 1 ? 'like' : 'likes'}`
			: 'Likes'

	return (
		<Modal isOpen={isOpen} onClose={onClose} isCentered size="sm" blockScrollOnMount>
			<ModalOverlay />
			<ModalContent maxW="400px" w="full" overflow="hidden">
				<ModalHeader fontSize="md" pb={2} flexShrink={0}>
					{title}
				</ModalHeader>
				<ModalCloseButton />
				<ModalBody pb={4} px={0} pt={0}>
					{loading ? (
						<Flex justify="center" align="center" h={LIST_HEIGHT}>
							<Spinner size="lg" />
						</Flex>
					) : error ? (
						<Flex justify="center" align="center" h={LIST_HEIGHT} px={4}>
							<Text textAlign="center" color="gray.500">
								{error}
							</Text>
						</Flex>
					) : users.length === 0 ? (
						<Flex justify="center" align="center" h={LIST_HEIGHT}>
							<Text textAlign="center" color="gray.500">
								No likes yet
							</Text>
						</Flex>
					) : (
						<Box
							ref={listRef}
							h={LIST_HEIGHT}
							overflowY="auto"
							overflowX="hidden"
							onScroll={handleScroll}
							px={2}
							css={{
								'&::-webkit-scrollbar': { width: '6px' },
								'&::-webkit-scrollbar-thumb': {
									background: 'rgba(128,128,128,0.4)',
									borderRadius: '3px',
								},
							}}
						>
							{users.map((u) => (
								<Flex
									key={u._id}
									align="center"
									gap={3}
									px={3}
									py={2}
									borderRadius="md"
									cursor="pointer"
									_hover={{ bg: 'whiteAlpha.100' }}
									onClick={() => handleUserClick(u.username)}
								>
									<Avatar
										size="sm"
										name={u.name || u.username}
										src={u.profilePic || undefined}
									/>
									<Box minW={0}>
										<Text fontWeight="semibold" fontSize="sm" noOfLines={1}>
											{u.name || u.username}
										</Text>
										<Text fontSize="xs" color="gray.500" noOfLines={1}>
											@{u.username}
										</Text>
									</Box>
								</Flex>
							))}
							<Box ref={sentinelRef} h="1px" w="full" aria-hidden />
							{loadingMore ? (
								<Flex justify="center" py={4}>
									<Spinner size="sm" />
								</Flex>
							) : null}
						</Box>
					)}
				</ModalBody>
			</ModalContent>
		</Modal>
	)
}
