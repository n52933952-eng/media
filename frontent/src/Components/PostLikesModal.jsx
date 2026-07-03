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

	const fetchPage = useCallback(
		async (isFirst) => {
			if (!postId) return
			if (isFirst) {
				setLoading(true)
				setError(null)
			} else {
				if (!hasMoreRef.current || loadingMore) return
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
				else setLoadingMore(false)
			}
		},
		[postId, loadingMore],
	)

	useEffect(() => {
		if (!isOpen || !postId) return
		cursorRef.current = null
		hasMoreRef.current = true
		seenRef.current = new Set()
		setUsers([])
		setTotal(initialCount ?? 0)
		fetchPage(true)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isOpen, postId])

	const handleScroll = (e) => {
		const el = e.target
		if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
			if (!loading && !loadingMore && hasMoreRef.current) fetchPage(false)
		}
	}

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
		<Modal isOpen={isOpen} onClose={onClose} isCentered size="sm" scrollBehavior="inside">
			<ModalOverlay />
			<ModalContent maxH="70vh">
				<ModalHeader fontSize="md" pb={2}>
					{title}
				</ModalHeader>
				<ModalCloseButton />
				<ModalBody pb={4} px={0}>
					{loading ? (
						<Flex justify="center" py={10}>
							<Spinner size="lg" />
						</Flex>
					) : error ? (
						<Text textAlign="center" color="gray.500" py={8} px={4}>
							{error}
						</Text>
					) : users.length === 0 ? (
						<Text textAlign="center" color="gray.500" py={8}>
							No likes yet
						</Text>
					) : (
						<Box maxH="52vh" overflowY="auto" onScroll={handleScroll} px={2}>
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
